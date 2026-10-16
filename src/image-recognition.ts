import type { Cell, Position, Player } from "./types";
import { isSupportedBoardSize } from "./game";
// 模型推理的唯一实现（cell-cls + digit-head）。方向是 image-recognition → model-inference，
// 反向只有 type-only 导入（编译期擦除），所以没有运行时循环依赖。
// 主线程直算（无多核 / QA 关掉并行）时两条模型任务就在这里的 localAccelerator 上跑。
import { classifyCells, readDigitCandidates } from "./features/record/model-inference";

export interface RecognizeOptions {
  skipMoveOrder?: boolean;
  roi?: BoardRoi;
  parallel?: boolean;
  digitReader?: DigitReader;
  boardScanner?: BoardScanner;
  /** 内部用：局部图救援的第二次调用带 false，避免无限递归。 */
  fragmentRescue?: boolean;
  /**
   * 复用上一次识别的**棋盘几何**（2026-10-09）。用户点「复原手序」时，App 会把
   * 导入那一次已经算好的网格传进来——同一张图网格必然相同，重新探测只是白花时间
   * （实测网格检测在这条链路上要 5～7.6 秒，占导入总时长一半）。
   * 只跳过「探测」这一步：逐格特征、读号、装配全部照旧按这份几何重算，结果不变。
   */
  knownGrid?: { originX: number; originY: number; spacingX: number; spacingY: number } | null;
  /**
   * 复用上一次识别的**棋子位置与颜色**（2026-10-09）。复原真正需要的是「读号 + 装配」，
   * 而「子在哪、什么颜色」导入时已经算过一遍（那条路径同样含逐格特征分析与模型补位）。
   * 传进来就跳过「找子」，直接在这些格上读号；**只影响性能，不影响读数与装配逻辑**。
   * 仅当这份棋盘与本次是同一张图、同一网格时才该传（App 侧已按此约束使用）。
   */
  knownBoard?: Cell[][] | null;
  /**
   * 「补全识别」用的已读手序号（2026-10-09）：上一次复原已经读准的那些号，
   * 本次**只补剩下的棋子**。
   *
   * 为什么需要：复原路径最贵的一段是「读号」的模板扫描（手机等价条件下实测
   * 13–44 秒，占总时长八成以上；模型读号只占几毫秒），而它的成本是
   * 「每颗子 × 每个字体族/尺度 × 每个候选号 1..N × 每个偏移」——**逐子可切**。
   * 已经读准的子再扫一遍纯属重复，把它们钉住、只对没读到的子开火，既省时间，
   * 也让这一趟的预算集中在真正的难点上（提高多尺度读号的档位也不必担心总量翻倍）。
   *
   * 语义：命中的格**不跑模板扫描**，直接以 score=1 的单候选入池；真正的判据仍是
   * 装配器的「唯一号 + 1..N + 奇偶 + 边际」门控，所以钉错的号会让这一趟如实失败，
   * 不会伪造出一个看起来完整的手序。
   */
  knownNumbers?: ReadonlyArray<{ row: number; col: number; number: number }> | null;
}

/**
 * 识别入口（2026-10-07 加「局部图救援」）：书页插图常把棋盘裁成**中间一块**——只有
 * 网格线、没有外框也没有角，15 路拟合会失败并退回「标准边距」，行列整体错位（实测
 * 真实语料 40 张里 18 张是这一类，「棋子不完全、序号一塌糊涂」的主因）。
 * 这时**用自动路数再试一次**：那类图在自动模式下能正常定位网格（实测把握 0.80–0.93、
 * 棋子相对位置正确）。只在「退回 + 自动模式确实找到网格 + 把握 ≥0.6 + 至少 2 子」时
 * 才采纳，否则保持原结果如实报告识别不到；救援只多跑一次识别，且只在失败的图上发生。
 */
export const recognizeBoardImage = async (file: File, boardSize = 15, opts: RecognizeOptions = {}): Promise<ImageRecognitionResult> => {
  const first = await recognizeBoardImageOnce(file, boardSize, opts);
  if (boardSize === 0 || !first.gridFallback || opts.fragmentRescue === false) return first;
  try {
    const retry = await recognizeBoardImageOnce(file, 0, { ...opts, fragmentRescue: false });
    const stones = retry.board.flat().filter(Boolean).length;
    if (retry.grid && !retry.gridFallback && retry.confidence >= 0.6 && stones >= 2) {
      return { ...retry, note: `${retry.note}；15 路拟合失败，已按自动路数识别为 ${retry.boardSize} 路局部棋盘（行列需对照原图核对）` };
    }
  } catch {
    /* 救援失败：保持首次结果（如实报告没找到可靠网格） */
  }
  return first;
};

export interface ImageRecognitionResult {
  boardSize: number;
  board: Cell[][];
  /** 网格拟合是否失败并退回了「标准边距」（2026-10-07 局部图救援用）：true 表示
   *  这张图没找到可靠网格、行列很可能整体错位——调用方据此用自动路数再试一次。 */
  gridFallback?: boolean;
  numberedMoves: Array<Position & { player: Player; number: number }>;
  /**
   * 复原门控的诊断信息。`numberedMoves` 只有在这里明确 accepted 时才代表
   * 可以自动重建的完整手序；形式上凑齐 1..N 但存在近似交换的结果会被保留在
   * `readMoveNumbers`，并通过本字段解释为什么没有自动复原。
   */
  moveOrderQuality?: MoveOrderQuality;
  /** 实际读出的序号全集（含只标一部分的②类书谱：读出 k 个就报 k 个）。
   *  与 numberedMoves 的分工（09-28 诊断修正）：numberedMoves 只在**完整 1..N**
   *  时非空——那是「可重建落子顺序」的硬承诺；而读出的号本身此前在拼图不完整
   *  时被整段吞掉（实测 paper02 明明六个号全读对、对外却报 0，note 与输出互相
   *  矛盾）。本字段把读出数原样交给调用方：复原判定不变（仍看 numberedMoves
   *  完整性），但基线测量、重绘工具与 AI 通道的交叉核对从此有据可依。 */
  readMoveNumbers: Array<Position & { player: Player; number: number }>;
  /** 「复原手序」时被排除编号的那颗子（2026-10-13，多认一颗子的补救；见装配段的
   *  extra-stone 补救）：为 null 表示每颗子都参与了编号；非 null 表示盘上这颗子
   *  疑似多认（它与别处声称同一个号），**numberedMoves 因此比棋子数少 1**。
   *  调用方做「完整 1..N」判定时要把它算进去，否则会把一次成功的复原判成不完整。 */
  numberedSkippedStone: Position | null;
  confidence: number;
  ignoredColoredMarkers: number;
  note: string;
  /** 解码后原图的像素尺寸（缩放前）。调用方用它显示「手机到底交了多少像素」这类
   *  诊断信息——以前是在识别前先 createImageBitmap 一次只为拿尺寸，同一张图白解码
   *  两遍（iOS 上大图一次 100-400ms），所以由识别器顺带回报。 */
  imageWidth: number;
  imageHeight: number;
  /** 识别所用的工作画布尺寸。叠图核对必须按「画布 → 显示尺寸」的比例换算：识别会先
   *  把长边缩到 1600px，极小图还会被抬到 320px 下限（此时画布与原图**不成比例**），
   *  所以不能拿原图像素直接当坐标用。 */
  gridCanvas?: { width: number; height: number };
  /** 识别到（并已做相位校正）的网格几何，单位是上面那块画布的像素：
   *  origin 是左上角第一个交叉点，spacing 是相邻两条线的间距。
   *  叠图核对把它画回原图，用来一眼看出「识别结果到底压在哪些交叉点上」。 */
  grid?: { originX: number; originY: number; spacingX: number; spacingY: number };
}

export interface MoveOrderQuality {
  accepted: boolean;
  status: "accepted" | "ambiguous" | "incomplete";
  assignedMean: number;
  assignedMin: number;
  ambiguous: number;
  nonTop: number;
  maxRegret: number;
  pairwiseMargin: number | null;
  assignmentMargin: number | null;
  wildcardUsed: number;
  reason?: string;
}

type RasterImage = ImageBitmap | HTMLImageElement;

const loadRasterImage = async (file: File): Promise<{ image: RasterImage; revoke?: string }> => {
  if (typeof createImageBitmap === "function") {
    try {
      return { image: await createImageBitmap(file) };
    } catch {
      // Some WebViews reject createImageBitmap for screenshots. Fall back to <img>.
    }
  }
  const url = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("图片格式无法读取，请选择 JPG、PNG 或 WEBP 图片"));
    element.src = url;
  });
  return { image, revoke: url };
};

const closeRasterImage = (image: RasterImage, revoke?: string) => {
  if ("close" in image && typeof image.close === "function") image.close();
  if (revoke) URL.revokeObjectURL(revoke);
};

const luminance = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

export interface SampledImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  gray: Float32Array;
}

/** 灰度图构造的唯一实现。主线程与识别 worker 都调用它，所以并行分片读到的
 * gray 与串行路径逐位相同——这是「多核识谱结果必须与单线程完全一致」的前提，
 * 也让 worker 只需回传 RGBA（灰度在 worker 内按同一份代码重建，省一半拷贝）。 */
export const buildGray = (data: Uint8ClampedArray, pixelCount: number): Float32Array => {
  const gray = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    gray[pixel] = luminance(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]);
  }
  return gray;
};

export const createSampledImage = (data: Uint8ClampedArray, width: number, height: number): SampledImage =>
  ({ data, width, height, gray: buildGray(data, width * height) });

const sampleImage = (ctx: CanvasRenderingContext2D, side: number): SampledImage => {
  const { data } = ctx.getImageData(0, 0, side, side);
  return createSampledImage(data, side, side);
};

interface GridEstimate {
  originX: number;
  originY: number;
  spacingX: number;
  spacingY: number;
  quality: number;
}

/** Line score per row/column. A grid line is a narrow local contrast peak:
 * it may be darker than the board (wood/pale) or brighter than it
 * (circuit/aurora). Using the signed bright–dark–bright pattern made every
 * dark board fall through to the inaccurate fixed-inset fallback. A relative
 * second-difference keeps the detector exposure-independent while accepting
 * both line polarities. */
export const collectLineScores = (
  gray: Float32Array,
  width: number,
  height: number,
  alongX: boolean,
  innerStart = 1,
  innerEnd?: number,
) => {
  const span = alongX ? height : width;
  const inner = alongX ? width : height;
  const start = Math.max(1, Math.floor(innerStart));
  const end = Math.min(inner - 2, Math.ceil(innerEnd ?? inner - 2));
  const scores = new Float32Array(span);
  if (end <= start) return scores;
  for (let fixed = 1; fixed < span - 1; fixed += 1) {
    let score = 0;
    for (let index = start; index <= end; index += 1) {
      const center = alongX ? gray[fixed * width + index] : gray[index * width + fixed];
      const above = alongX
        ? gray[(fixed - 1) * width + index]
        : gray[index * width + fixed - 1];
      const below = alongX
        ? gray[(fixed + 1) * width + index]
        : gray[index * width + fixed + 1];
      const contrast = Math.abs(center - (above + below) / 2);
      const neighbourDelta = Math.abs(above - below);
      // Antialiased SVG lines can be split across two pixels. The neighbour
      // guard rejects broad lighting gradients while retaining either a dark
      // or a bright one-pixel line core.
      if (contrast > 10 && neighbourDelta < 55 && contrast > neighbourDelta * 0.22) {
        score += 1;
        continue;
      }
      // A core that spills onto a second pixel — a rescaled screenshot
      // (WeChat re-encodes and resizes), or a diagram drawn with 2px rules —
      // leaves one neighbour brighter than the other, so the guard above
      // rejects the line outright: this cost a board 10 of 15 rows and 11 of
      // 15 columns, and with the column comb under the retention bar in
      // fitCombSeries the grid was never found at all. Comparing two pixels
      // out restores the peak without loosening the gradient guard, since a
      // gradient keeps both outer neighbours far apart too.
      if (fixed < 2 || fixed >= span - 2) continue;
      const above2 = alongX
        ? gray[(fixed - 2) * width + index]
        : gray[index * width + fixed - 2];
      const below2 = alongX
        ? gray[(fixed + 2) * width + index]
        : gray[index * width + fixed + 2];
      const wideContrast = Math.abs(center - (above2 + below2) / 2);
      const wideNeighbourDelta = Math.abs(above2 - below2);
      if (wideContrast > 10 && wideNeighbourDelta < 55 && wideContrast > wideNeighbourDelta * 0.22) score += 1;
    }
    scores[fixed] = score;
  }
  return scores;
};

export interface CombFit {
  origin: number;
  spacing: number;
  score: number;
  coverage: number;
}

const scoreQuantile = (scores: Float32Array, quantile: number) => {
  const sorted = Array.from(scores).sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * quantile)))] ?? 0;
};

/** Search the original line-strength signal with a complete N-tooth comb.
 *
 * Peak grouping loses phase information when a border line is weak or hidden:
 * fourteen real lines can then be fitted as a complete board shifted by one
 * cell. Searching all origins/spacings keeps the missing fifteenth tooth in
 * the score. Support immediately before/after the proposed board is also
 * penalised, because it is usually the omitted border line of that shifted
 * candidate. */
export const fitCombSeries = (
  scores: Float32Array,
  boardSize: number,
  limits: { pool: number; seeds: number; output: number } = { pool: 180, seeds: 80, output: 80 },
  spacingRange?: { minimum: number; maximum?: number },
): CombFit[] => {
  const span = scores.length;
  const baseline = scoreQuantile(scores, 0.55);
  // Do not clip at a high quantile: clipping made every strong line equal and
  // left a one-cell-shifted comb indistinguishable from the real phase. The
  // global maximum is only used to normalise contrast; proximity below keeps
  // a strong but off-centre line from receiving full support.
  const cap = Math.max(baseline + 1, Math.max(...scores));
  const scale = cap - baseline;
  const minSpacing = Math.max(5, spacingRange?.minimum ?? 5);
  const maxSpacing = Math.min(
    (span - 1) / Math.max(1, boardSize - 1),
    spacingRange?.maximum ?? Number.POSITIVE_INFINITY,
  );
  if (maxSpacing < minSpacing) return [];

  // supportAt and the two scratch buffers live outside evaluate: evaluate runs
  // tens of thousands of times per image (coarse sweep over spacing × origin),
  // and allocating a closure plus two arrays per call was pure overhead. The
  // arithmetic and its order are unchanged, so results are bit-identical.
  const supportAt = (position: number, radius: number): number => {
    const center = Math.round(position);
    let peak = 0;
    let peakDistance = Number.POSITIVE_INFINITY;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = center + offset;
      if (index < 0 || index >= span) continue;
      if (scores[index] > peak) {
        peak = scores[index];
        peakDistance = Math.abs(offset + center - position);
      }
    }
    const contrast = Math.max(0, (peak - baseline) / scale);
    const sigma = Math.max(1, radius * 0.45);
    const proximity = Math.exp(-(peakDistance * peakDistance) / (2 * sigma * sigma));
    return Math.min(1.5, contrast) * (0.25 + proximity * 0.75);
  };
  const supportsScratch = new Float64Array(boardSize);
  const orderedScratch = new Float64Array(boardSize);
  const outsideWeights = [1, 0.72, 0.45];

  const evaluate = (origin: number, spacing: number): CombFit | null => {
    const end = origin + (boardSize - 1) * spacing;
    if (origin < 0 || end > span - 1) return null;
    const radius = Math.min(5, Math.max(1, Math.round(spacing * 0.09)));

    const supports = supportsScratch;
    for (let index = 0; index < boardSize; index += 1) supports[index] = supportAt(origin + index * spacing, radius);
    const ordered = orderedScratch;
    ordered.set(supports);
    ordered.sort();
    const weakCount = Math.min(4, boardSize);
    let weakSupport = 0;
    for (let index = 0; index < weakCount; index += 1) weakSupport += ordered[index];
    let insideSupport = 0;
    for (let index = 0; index < boardSize; index += 1) insideSupport += supports[index];
    const edgeSupport = supports[0] + supports[boardSize - 1];
    // Check several teeth beyond both proposed edges. In a full-screen image a
    // shifted candidate can take 12-13 genuine board lines and borrow one or
    // two UI separators to appear complete. Looking only one tooth outside did
    // not detect a two-cell phase error. A real complete board should not have
    // another strong same-period comb continuing past either edge.
    let outsideSupport = 0;
    for (let index = 0; index < 3; index += 1) {
      const distance = index + 1;
      const beforePosition = origin - spacing * distance;
      const afterPosition = end + spacing * distance;
      if (beforePosition >= 0) outsideSupport += supportAt(beforePosition, radius) * outsideWeights[index];
      if (afterPosition <= span - 1) outsideSupport += supportAt(afterPosition, radius) * outsideWeights[index];
    }
    let covered = 0;
    for (let index = 0; index < boardSize; index += 1) if (supports[index] >= 0.28) covered += 1;
    const coverage = covered / boardSize;
    // Low-tooth support differentiates 15/15 from 14/15; outside support
    // rejects the phase-shifted 14-line window. Edge weighting helps when
    // stones obscure central line pixels but the board border remains visible.
    const score = insideSupport
      + weakSupport * 0.72
      + edgeSupport * 0.32
      - outsideSupport * 1.05
      + coverage * 0.35;
    return { origin, spacing, score, coverage };
  };

  const candidates: CombFit[] = [];
  const retain = (candidate: CombFit, limit: number) => {
    const duplicate = candidates.findIndex((existing) => (
      Math.abs(existing.origin - candidate.origin) < 1.2
      && Math.abs(existing.spacing - candidate.spacing) < 0.18
    ));
    if (duplicate >= 0) {
      if (candidate.score > candidates[duplicate].score) candidates[duplicate] = candidate;
    } else {
      candidates.push(candidate);
    }
    candidates.sort((left, right) => right.score - left.score);
    if (candidates.length > limit) candidates.length = limit;
  };

  // Coarse global search: the subpixel refinement below re-fits the top
  // seeds at 0.1px/0.05px resolution, so the global pass only needs to land
  // near the true comb — wider steps keep mobile import latency bounded
  // (fitCombSeries was a top-3 hotspot, 2026-09-11).
  const spacingStep = Math.max(0.2, span / 1400);
  for (let spacing = minSpacing; spacing <= maxSpacing + 0.001; spacing += spacingStep) {
    const latestOrigin = span - 1 - (boardSize - 1) * spacing;
    for (let origin = 0; origin <= latestOrigin + 0.001; origin += 1) {
      const candidate = evaluate(origin, spacing);
      // Full-screen screenshots can contain stronger one-off UI separators
      // than the board lines. Keep a wider pool here; detectGrid will later
      // evaluate whether both axes coexist inside one coherent square window.
      if (candidate && candidate.coverage >= 0.55) retain(candidate, limits.pool);
    }
  }

  // Subpixel refinement is intentionally performed only around the strongest
  // globally searched candidates, keeping mobile import latency bounded.
  const coarse = [...candidates];
  const refined: CombFit[] = [];
  const retainRefined = (candidate: CombFit) => {
    const duplicate = refined.findIndex((existing) => (
      Math.abs(existing.origin - candidate.origin) < 0.45
      && Math.abs(existing.spacing - candidate.spacing) < 0.06
    ));
    if (duplicate >= 0) {
      if (candidate.score > refined[duplicate].score) refined[duplicate] = candidate;
    } else refined.push(candidate);
  };
  coarse.slice(0, limits.seeds).forEach((seed) => {
    for (let spacing = seed.spacing - 0.35; spacing <= seed.spacing + 0.351; spacing += 0.05) {
      for (let origin = seed.origin - 1; origin <= seed.origin + 1.001; origin += 0.1) {
        const candidate = evaluate(origin, spacing);
        if (candidate) retainRefined(candidate);
      }
    }
  });
  refined.sort((left, right) => right.score - left.score);
  return refined.slice(0, limits.output);
};

/** Evidence (0..1) that a one-pixel-wide line of the requested direction runs
 * through (x, y). A board is a two-direction mesh: at (almost) every declared
 * intersection a line of the perpendicular direction must cross. Analysis
 * tables, text baselines and stone-pattern backgrounds can imitate one axis of
 * periodic lines, but almost never a dense mesh of both directions. */
const directionalLineEvidence = (
  gray: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  alongX: boolean,
) => {
  let evidence = 0;
  for (let phase = -2; phase <= 2; phase += 1) {
    const px = alongX ? Math.round(x) + phase : Math.round(x);
    const py = alongX ? Math.round(y) : Math.round(y) + phase;
    if (px < 2 || py < 2 || px >= width - 2 || py >= height - 2) continue;
    const index = py * width + px;
    const center = gray[index];
    // Two pixels out on BOTH axes: one pixel can still sit on a 1-2px line's
    // antialiasing, which made every horizontal-line probe fail its
    // neighbour guard while the vertical probes worked.
    const sideA = alongX ? gray[index - 2] : gray[index - 2 * width];
    const sideB = alongX ? gray[index + 2] : gray[index + 2 * width];
    const contrast = Math.abs(center - (sideA + sideB) / 2);
    const neighbourDelta = Math.abs(sideA - sideB);
    if (contrast > 7 && neighbourDelta < 55) evidence = Math.max(evidence, Math.min(1, contrast / 18));
  }
  return evidence;
};

/** Evidence (0..1) that a straight line of the requested direction passes
 * through (x, y) and CONTINUES on both sides. The probes sit just off the
 * intersection and at mid-cell, and all of them must agree on one sub-pixel
 * line position: a real grid line is straight and continuous, while text,
 * tables and textured backgrounds do not keep one aligned edge across four
 * samples. Border intersections only probe inward. */
const lineThroughEvidence = (
  gray: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  alongX: boolean,
  offsets: number[],
) => {
  const fixedBase = Math.round(alongX ? x : y);
  const alongBase = Math.round(alongX ? y : x);
  // Hoisted out of the closure: this used to allocate the literal on every
  // call, and contrastAt is a profiling hotspot (~6% of recognition time).
  // Splitting by direction also removes a per-sample branch.
  const distances = [2, 3, 4];
  const contrastAt = (px: number, py: number) => {
    if (px < 5 || py < 5 || px >= width - 5 || py >= height - 5) return 0;
    const index = py * width + px;
    const center = gray[index];
    // Two pixels out on BOTH axes: one pixel can still sit on a 1-2px line's
    // antialiasing, which made every horizontal-line probe fail its
    // neighbour guard while the vertical probes worked.
    // The sample distance is then varied: a board that draws its own border
    // 3-4px thick (printed and notation-paper diagrams) hides every outermost
    // line from a fixed two-pixel probe, because one side sample lands inside
    // the run — all four border intersections measured 0.000 evidence and the
    // whole window was rejected as one row/column short of a valid grid.
    let best = 0;
    if (alongX) {
      for (let d = 0; d < 3; d += 1) {
        const distance = distances[d];
        const sideA = gray[index - distance];
        const sideB = gray[index + distance];
        const contrast = Math.abs(center - (sideA + sideB) / 2);
        const neighbourDelta = Math.abs(sideA - sideB);
        if (contrast > 7 && neighbourDelta < 65 && contrast > neighbourDelta * 0.18) {
          const evidence = Math.min(1, contrast / 16);
          if (evidence > best) best = evidence;
        }
      }
      return best;
    }
    for (let d = 0; d < 3; d += 1) {
      const distance = distances[d];
      const sideA = gray[index - distance * width];
      const sideB = gray[index + distance * width];
      const contrast = Math.abs(center - (sideA + sideB) / 2);
      const neighbourDelta = Math.abs(sideA - sideB);
      if (contrast > 7 && neighbourDelta < 65 && contrast > neighbourDelta * 0.18) {
        const evidence = Math.min(1, contrast / 16);
        if (evidence > best) best = evidence;
      }
    }
    return best;
  };
  let best = 0;
  for (let phase = -2; phase <= 2; phase += 1) {
    const fixed = fixedBase + phase;
    let worst = 1;
    for (const offset of offsets) {
      const along = Math.round(alongBase + offset);
      const evidence = contrastAt(alongX ? fixed : along, alongX ? along : fixed);
      if (evidence <= 0) {
        worst = 0;
        break;
      }
      if (evidence < worst) worst = evidence;
    }
    if (worst > best) best = worst;
  }
  return best;
};

/** Fraction of declared intersections where the two-direction mesh exists.
 * A stone legitimately hides its own intersection, so validity falls back to
 * a coarse stone-blob probe: diagonal disc samples against a diagonal outer
 * ring at 0.62-0.70 of the spacing (outside a full-size stone, inside the
 * cell). A real board therefore measures near 1.0 even when a third of the
 * points are occupied, while texture and one-direction table lines stay near
 * zero — and a window that only PARTIALLY overlaps the board loses whole
 * border rows at once, which the per-axis fractions expose. */
export const intersectionMesh = (
  image: { gray: Float32Array; width: number; height: number; data: Uint8ClampedArray },
  originX: number,
  originY: number,
  spacingX: number,
  spacingY: number,
  boardSize: number,
  sampleStep = 1,
) => {
  const { gray, width, height } = image;
  const endX = originX + (boardSize - 1) * spacingX;
  const endY = originY + (boardSize - 1) * spacingY;
  const rowFractions = new Array<number>(boardSize).fill(-1);
  const columnFractions = new Array<number>(boardSize).fill(-1);
  if (originX < 2 || originY < 2 || endX >= width - 2 || endY >= height - 2) {
    return { support: 0, rowFractions, columnFractions };
  }
  const spacing = Math.min(spacingX, spacingY);
  const reach = Math.min(6, Math.max(3, spacing * 0.13));
  // 0.42 keeps the far probe clear of a full-size neighbour stone's rim
  // (radius up to ~0.48 of the spacing) while still demanding the line exist
  // well away from the intersection itself.
  const halfSpan = spacing * 0.42;
  // Well-aligned evidence scales with line sharpness: on small-spacing
  // screenshots (device pixel ratio 1) one-pixel lines plus stone glow cap
  // the evidence near 0.5-0.6 even at perfect phase, while large images keep
  // 0.8+. The threshold follows so misaligned windows stay excluded.
  const strictEvidence = spacing >= 32 ? 0.6 : 0.5;
  const rowHits = new Array<number>(boardSize).fill(0);
  const columnHits = new Array<number>(boardSize).fill(0);
  const rowChecks = new Array<number>(boardSize).fill(0);
  const columnChecks = new Array<number>(boardSize).fill(0);
  const discOffsets: Array<[number, number]> = [];
  const ringOffsets: Array<[number, number]> = [];
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      discOffsets.push([
        Math.round(spacing * 0.22) * signX,
        Math.round(spacing * 0.22) * signY,
      ]);
    }
    // Ring samples sit on the diagonals at 0.62-0.70 of the spacing: safely
    // outside a full-size stone (radius ≈ 0.48) yet still far from the
    // diagonal neighbours (centre distance 1.41). Tighter rings landed on the
    // stone rim and its shadow, which hid occupied intersections and made
    // stone-heavy columns look invalid.
    for (const radiusScale of [0.62, 0.7]) {
      const ringOffset = Math.round(spacing * radiusScale * 0.7071);
      for (const signY of [-1, 1]) {
        ringOffsets.push([ringOffset * signX, ringOffset * signY]);
        ringOffsets.push([ringOffset * signX, -ringOffset * signY]);
      }
    }
  }
  const readColor = (px: number, py: number): Rgb | null => {
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    const index = (py * width + px) * 4;
    return [image.data[index], image.data[index + 1], image.data[index + 2]];
  };
  const stoneBlobAt = (x: number, y: number) => {
    const disc: Rgb[] = [];
    const ring: Rgb[] = [];
    for (const [dx, dy] of discOffsets) {
      const color = readColor(Math.round(x) + dx, Math.round(y) + dy);
      if (color) disc.push(color);
    }
    for (const [dx, dy] of ringOffsets) {
      const color = readColor(Math.round(x) + dx, Math.round(y) + dy);
      if (color) ring.push(color);
    }
    if (disc.length < 3 || ring.length < 6) return false;
    const medianColor = (items: Rgb[]): Rgb => [
      median(items.map((color) => color[0])),
      median(items.map((color) => color[1])),
      median(items.map((color) => color[2])),
    ];
    const discMedian = medianColor(disc);
    const ringMedian = medianColor(ring);
    const discDistance = rgbDistance(discMedian, ringMedian);
    // A stone is a COHERENT disc; high-frequency backgrounds have a large
    // spread around their own median, which otherwise validated texture rows
    // through pure noise contrast. Stroke marks (notebook checks) mix stroke
    // and board in the four disc samples, so a decisive distance stands on
    // its own and the coherence demand only guards the moderate band.
    const discSpread = median(disc.map((color) => rgbDistance(color, discMedian)));
    // Grid lines crossing an empty intersection on a dark board also create a
    // large disc-to-ring distance; a real mark sits ON the disc's diagonal
    // samples (share ≥ 0.5) while the diagonal samples of a line-only
    // intersection stay board-coloured.
    const discMarkedShare = disc.filter((color) => rgbDistance(color, ringMedian) >= 25).length / disc.length;
    return (discDistance >= 55 && discMarkedShare >= 0.5)
      || (discDistance >= 25 && discSpread <= 30);
  };
  for (let row = 0; row < boardSize; row += sampleStep) {
    const y = originY + row * spacingY;
    const verticalOffsets = row === 0
      ? [reach, halfSpan]
      : row === boardSize - 1 ? [-reach, -halfSpan] : [-reach, reach, -halfSpan, halfSpan];
    for (let col = 0; col < boardSize; col += sampleStep) {
      const x = originX + col * spacingX;
      const horizontalOffsets = col === 0
        ? [reach, halfSpan]
        : col === boardSize - 1 ? [-reach, -halfSpan] : [-reach, reach, -halfSpan, halfSpan];
      // Demands a WELL-ALIGNED line, not merely a detected one: windows cut
      // from inside a larger grid or glued to page texture drift 2-4px
      // across the board, which caps their crossing evidence well below a
      // correctly phased window's.
      const crossEvidence = Math.min(
        lineThroughEvidence(gray, width, height, x, y, true, verticalOffsets),
        lineThroughEvidence(gray, width, height, x, y, false, horizontalOffsets),
      );
      let ok = crossEvidence >= strictEvidence;
      if (!ok) ok = stoneBlobAt(x, y);
      rowChecks[row] += 1;
      columnChecks[col] += 1;
      if (ok) {
        rowHits[row] += 1;
        columnHits[col] += 1;
      }
    }
  }
  for (let index = 0; index < boardSize; index += 1) {
    rowFractions[index] = rowChecks[index] ? rowHits[index] / rowChecks[index] : -1;
    columnFractions[index] = columnChecks[index] ? columnHits[index] / columnChecks[index] : -1;
  }
  let total = 0;
  let crossed = 0;
  for (let index = 0; index < boardSize; index += 1) {
    total += rowChecks[index];
    crossed += rowHits[index];
  }
  return {
    support: total ? crossed / total : 0,
    rowFractions,
    columnFractions,
  };
};

export interface GridWindowQuality {
  /** true = 只算到「仅依赖线剖面的前四道硬门」就返回了（后面的交点网格/边框/延伸
   *  扫描全跳过）。这种窗口必然已被淘汰，`evaluateCandidate` 见到它就只报这四道门，
   *  不再检查后面的指标——排名只看 `failures.length`，所以提前返回与全算等价。 */
  earlyOut?: boolean;
  score: number;
  lineCoverage: number;
  continuity: number;
  spatialCoverage: number;
  fullLineShare: number;
  intersectionSupport: number;
  outerFrameShare: number;
  validRowCount: number;
  validColumnCount: number;
  rowContinuity: number;
  columnContinuity: number;
  externalContinuation: number;
  externalLineCount: number;
  strokeBeyondSides: number;
  crossAxisBalance: number;
  starSupport: number;
  borderContext: number;
  texture: number;
  colorCoherence: number;
  edgeSupport: number;
  sizeRatio: number;
}

/** Score a candidate grid only inside its own square window.
 *
 * Full phone screenshots often contain several independent stacks of lines:
 * cards, tables, toolbars and the actual board. The old detector scored every
 * line across the whole image, so a candidate could mix a board's lines with
 * UI lines and still look like a valid 15x15 comb. A real board has all of its
 * horizontal and vertical lines in the same square window, with a consistent
 * cell interior and visible outer edges. */
/** 前四道硬门只由线剖面决定，放在这里让 `scoreGridWindow` 的提前返回与
 *  `evaluateCandidate` 的判定共用同一组阈值（改一处即可，不会漂移）。 */
const GRID_GATE_CONTINUITY = 0.55;
const GRID_GATE_LINE_COVERAGE = 0.12;
const GRID_GATE_SPATIAL_COVERAGE = 0.3;
const GRID_GATE_FULL_LINE_SHARE = 0.35;

// （2026-10-11 撤销记录）这里曾加过 `HIGH_PLY_REVIEW_FROM`：把「子数 > 100 时全子交
// 数字头复核」当成高段图读号弱的解法。实测**无效**——中间量确实变了
// （scanner digitCenters 19→188、headReadsByIndex 155→268），但端到端读号正确数
// **逐位不变**（3 张高段图 281/604，开关两态相同）。
// 真因不在这里：把同一批图的**应用 grid**（origin 132.8,252.7）拿去喂 combo45，
// 逐格读号是 **188/188 = 100%**；而走应用链却只有 79%（模板）——说明丢读数发生在
// 更下游（装配/奇偶门控），不是「没交给数字头」。要动就得连装配一起动，
// 那属于改应用识谱的红线范围，证据不足不应当上。

export const scoreGridWindow = (
  image: SampledImage,
  originX: number,
  originY: number,
  spacingX: number,
  spacingY: number,
  boardSize: number,
): GridWindowQuality | null => {
  moveOrderPerf.gridWindows += 1;
  const { gray, width, height } = image;
  const endX = originX + (boardSize - 1) * spacingX;
  const endY = originY + (boardSize - 1) * spacingY;
  if (originX < 0 || originY < 0 || endX >= width || endY >= height) return null;

  const lineProfile = (fixed: number, alongX: boolean, start: number, end: number) => {
    const span = alongX ? width : height;
    const from = Math.max(1, Math.floor(start));
    const to = Math.min(span - 2, Math.ceil(end));
    if (to <= from) return { support: 0, spatial: 0 };
    let weightedHits = 0;
    let samples = 0;
    const segmentHits = new Uint16Array(Math.max(1, boardSize - 1));
    const segmentSamples = new Uint16Array(segmentHits.length);
    // fixed is constant for the whole call: hoist Math.round and the three
    // row/column base offsets out of the sample loop (bit-identical indexes,
    // lineProfile was ~20% of recognition time, 2026-09-11 profile).
    // The two directions are now expressed as strides — a horizontal line
    // advances by 1 and steps across by width, a vertical line the reverse —
    // which removes the per-sample `alongX` branch and the per-sample offset
    // validity test from the innermost loop while indexing exactly the pixels
    // the previous two-branch body read (lineProfile is the single biggest
    // hotspot, ~22% of recognition time). The ±1 offsets are filtered once per
    // call, in the same order, so the sample set is unchanged.
    const alongStride = alongX ? 1 : width;
    const crossStride = alongX ? width : 1;
    const fixedCenter = Math.round(fixed);
    const crossLimit = (alongX ? height : width) - 1;
    const bases: number[] = [];
    const wideOk: boolean[] = [];
    for (let offset = -1; offset <= 1; offset += 1) {
      const rounded = fixedCenter + offset;
      if (rounded <= 0 || rounded >= crossLimit) continue;
      bases.push(alongX ? rounded * width : rounded);
      wideOk.push(rounded - 2 > 0 && rounded + 2 < crossLimit);
    }
    const baseCount = bases.length;
    const segmentCount = segmentHits.length;
    const segmentSpan = Math.max(1, to - from + 1);
    for (let index = from; index <= to; index += 2) {
      let evidence = 0;
      // Permit a small subpixel/antialiasing offset, but require evidence at
      // this longitudinal position. Circle rims only light up a few cells;
      // genuine grid lines continue through most cells of the board.
      // Stride 2 along the line + offsets ±1: grid lines are continuous and
      // the phase-polish pass below realigns subpixel drift, so the cheaper
      // probe keeps the same statistics (lineProfile was ~35% of total
      // recognition time, 2026-09-11).
      const indexBase = index * alongStride;
      for (let b = 0; b < baseCount; b += 1) {
        const base = bases[b];
        const center = gray[base + indexBase];
        const above = gray[base + indexBase - crossStride];
        const below = gray[base + indexBase + crossStride];
        const contrast = Math.abs(center - (above + below) / 2);
        const neighbourDelta = Math.abs(above - below);
        if (contrast > 7 && neighbourDelta < 65 && contrast > neighbourDelta * 0.18) {
          const value = Math.min(1.5, contrast / 22);
          if (value > evidence) evidence = value;
        } else if (wideOk[b]) {
          // Same defence as collectLineScores: when a line's dark core covers
          // two pixels, one of the ±1 neighbours sits ON the line and this
          // probe reads nothing. That contradiction is measurable — a window
          // whose intersections are all valid (mesh 1.0, rows and columns
          // 15/15) still reported rowContinuity 0 and was rejected — so sample
          // two pixels out as well. A lighting gradient keeps the outer pair
          // far apart, so the guard still holds.
          const wideAbove = gray[base + indexBase - 2 * crossStride];
          const wideBelow = gray[base + indexBase + 2 * crossStride];
          const wideContrast = Math.abs(center - (wideAbove + wideBelow) / 2);
          const wideNeighbourDelta = Math.abs(wideAbove - wideBelow);
          if (wideContrast > 7 && wideNeighbourDelta < 65 && wideContrast > wideNeighbourDelta * 0.18) {
            const value = Math.min(1.5, wideContrast / 22);
            if (value > evidence) evidence = value;
          }
        }
      }
      const segment = Math.min(
        segmentCount - 1,
        Math.max(0, Math.floor((index - from) * segmentCount / segmentSpan)),
      );
      segmentSamples[segment] += 1;
      if (evidence > 0) segmentHits[segment] += 1;
      weightedHits += evidence;
      samples += 1;
    }
    const activeSegments = Array.from(segmentHits).filter((hits, index) => (
      hits / Math.max(1, segmentSamples[index]) >= 0.14
    )).length;
    return {
      support: samples ? weightedHits / samples : 0,
      spatial: activeSegments / segmentHits.length,
    };
  };

  const rowProfiles = Array.from({ length: boardSize }, (_, row) => (
    lineProfile(originY + row * spacingY, true, originX, endX)
  ));
  const columnProfiles = Array.from({ length: boardSize }, (_, col) => (
    lineProfile(originX + col * spacingX, false, originY, endY)
  ));
  const rowSupports = rowProfiles.map((profile) => profile.support);
  const columnSupports = columnProfiles.map((profile) => profile.support);
  const allSupports = [...rowSupports, ...columnSupports];
  const allSpatial = [...rowProfiles, ...columnProfiles].map((profile) => profile.spatial);
  const lineCoverage = allSupports.reduce((sum, value) => sum + Math.min(1, value * 3.2), 0) / allSupports.length;
  const continuity = allSupports.filter((value) => value >= 0.045).length / allSupports.length;
  // Per-axis continuity, kept separate because the comb fits of one axis can
  // be polluted by UI texture: a real board needs fifteen supported lines on
  // BOTH axes inside the same window.
  const rowContinuity = rowSupports.filter((value) => value >= 0.045).length / boardSize;
  const columnContinuity = columnSupports.filter((value) => value >= 0.045).length / boardSize;
  const spatialCoverage = allSpatial.reduce((sum, value) => sum + value, 0) / allSpatial.length;
  const fullLineShare = allSpatial.filter((value) => value >= 0.55).length / allSpatial.length;
  // 提前返回：这四道门**只由线剖面决定**，任何一道不过这个窗口必被淘汰，后面的
  // 交点网格 / 边框厚度 / 四边延伸 / 笔画 / 星位扫描（本函数的大头）就都不用算。
  // 2026-10-06 实测：每张图要评 ~1820 个窗口、网格段 4.5~5.8s，而绝大多数候选
  // 在第一道门前就该出局——全算完是给注定淘汰的窗口花钱。
  if (continuity < GRID_GATE_CONTINUITY || lineCoverage < GRID_GATE_LINE_COVERAGE
    || spatialCoverage < GRID_GATE_SPATIAL_COVERAGE || fullLineShare < GRID_GATE_FULL_LINE_SHARE) {
    moveOrderPerf.wEarly += 1;
    return {
      earlyOut: true, score: 0, lineCoverage, continuity, spatialCoverage, fullLineShare,
      intersectionSupport: 0, outerFrameShare: 0, validRowCount: 0, validColumnCount: 0,
      rowContinuity, columnContinuity, externalContinuation: 0, externalLineCount: 0,
      strokeBeyondSides: 0, crossAxisBalance: 0, starSupport: 0, borderContext: 0,
      texture: 0, colorCoherence: 0, edgeSupport: 0, sizeRatio: 0,
    };
  }
  const mesh = intersectionMesh(image, originX, originY, spacingX, spacingY, boardSize);
  const intersectionSupport = mesh.support;
  // A window whose OUTERMOST line is the board's thick decorative frame
  // (3.5px+ of line-coloured pixels) rather than a thin grid line is anchored
  // on the frame — one row/column short of the real grid. Measured as the
  // median run of pixels differing from the board colour 6px inward.
  const outerThicknessShare = (fixed: number, from: number, to: number, alongX: boolean, inwardSign: number) => {
    let thick = 0;
    const samples = 20;
    for (let i = 0; i < samples; i += 1) {
      const along = Math.round(from + (to - from) * (i + 0.5) / samples);
      const linePos = Math.round(fixed);
      const boardPos = Math.round(fixed + inwardSign * 6);
      if (boardPos < 0 || boardPos >= (alongX ? height : width)) continue;
      const boardL = alongX ? gray[boardPos * width + along] : gray[along * width + boardPos];
      // Run measured in a ±2 window: on themes with a small frame-to-grid
      // margin a wider window catches the real grid line next to the frame
      // and flags every window; a genuine thick frame fills ±2 completely.
      let run = 0;
      for (let d = -2; d <= 2; d += 1) {
        const l = alongX
          ? gray[(linePos + d) * width + along]
          : gray[along * width + (linePos + d)];
        if (Math.abs(l - boardL) >= 30) run += 1;
      }
      if (run >= 4) thick += 1;
    }
    return thick / samples;
  };
  const outerFrameShare = Math.max(
    outerThicknessShare(originY, originX, endX, true, 1),
    outerThicknessShare(endY, originX, endX, true, -1),
    outerThicknessShare(originX, originY, endY, false, 1),
    outerThicknessShare(endX, originY, endY, false, -1),
  );
  // A window that only partially overlaps the real board keeps a decent mean
  // support but loses complete border rows at once. Requiring nearly every
  // row AND column to be mostly valid is what rejects those partial windows.
  // 0.6, not 0.5: a window that mixes real board rows with texture rows can
  // still average well, but its junk rows stay far below while a real board
  // line reaches ~1.0 (empty crossings plus stone blobs). 0.6 accommodates
  // dark-on-dark stones whose occluded crossings cap the line fraction.
  const validRowCount = mesh.rowFractions.filter((fraction) => fraction >= 0.6).length;
  const validColumnCount = mesh.columnFractions.filter((fraction) => fraction >= 0.6).length;
  const edgeSupport = Math.min(
    1,
    (rowSupports[0] + rowSupports[rowSupports.length - 1]
      + columnSupports[0] + columnSupports[columnSupports.length - 1]) / 0.32,
  );

  // Reject a grid window cut from the middle of a larger same-period grid.
  // This matters for complete phone screenshots: a candidate may use 11-13
  // genuine board lines, then borrow similarly spaced page/background edges to
  // make up the remaining teeth. Global one-dimensional comb scores cannot
  // reliably distinguish that mixture. Here every outside probe is measured
  // only across the candidate board span, so two or more continued teeth are
  // strong evidence that the proposed outer line is not the board boundary.
  const continuationStrength = (profile: { support: number; spatial: number }) => (
    Math.min(1, profile.support * 3.2) * 0.55 + profile.spatial * 0.45
  );
  const outsideSides = [
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(originY - spacingY * (index + 1), true, originX, endX)
    )),
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(endY + spacingY * (index + 1), true, originX, endX)
    )),
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(originX - spacingX * (index + 1), false, originY, endY)
    )),
    Array.from({ length: 3 }, (_, index) => (
      lineProfile(endX + spacingX * (index + 1), false, originY, endY)
    )),
  ];
  const outsideWeights = [1, 0.78, 0.56];
  // An outside line only counts as a board continuation when the perpendicular
  // mesh continues through it. Noise backgrounds (stone-texture wallpaper) and
  // one-directional table separators otherwise look like continuation lines:
  // on the second user screenshot that false positive rejected the real board
  // while the true mesh evidence was discarded.
  const outsideCrossings = outsideSides.map((profiles, sideIndex) => profiles.map((profile, lineIndex) => {
    if (!profile.spatial && !profile.support) return 0;
    const alongX = sideIndex < 2;
    const fixed = sideIndex === 0 ? originY - spacingY * (lineIndex + 1)
      : sideIndex === 1 ? endY + spacingY * (lineIndex + 1)
        : sideIndex === 2 ? originX - spacingX * (lineIndex + 1)
          : endX + spacingX * (lineIndex + 1);
    // Strict continuation probe: the perpendicular line must pass through the
    // outside line AND continue half a cell beyond it on both sides. Texture
    // and page separators cannot satisfy the aligned multi-probe test.
    const meshReach = Math.min(6, Math.max(3, Math.min(spacingX, spacingY) * 0.13));
    const meshHalf = Math.min(spacingX, spacingY) * 0.42;
    let sum = 0;
    for (let index = 0; index < boardSize; index += 1) {
      const along = alongX ? originX + index * spacingX : originY + index * spacingY;
      sum += lineThroughEvidence(
        gray,
        width,
        height,
        alongX ? along : fixed,
        alongX ? fixed : along,
        alongX,
        [-meshReach, meshReach, -meshHalf, meshHalf],
      );
    }
    return sum / boardSize;
  }));
  const continuationMeshWeight = (crossing: number) => 0.22 + 0.78 * Math.min(1, crossing * 1.6);
  const outsideSideScores = outsideSides.map((profiles, sideIndex) => (
    profiles.reduce((sum, profile, index) => (
      sum + continuationStrength(profile) * outsideWeights[index] * continuationMeshWeight(outsideCrossings[sideIndex][index])
    ), 0) / outsideWeights.reduce((sum, value) => sum + value, 0)
  ));
  const outsideStrongCounts = outsideSides.map((profiles, sideIndex) => profiles.filter((profile, index) => (
    profile.support >= 0.045
    && profile.spatial >= 0.42
    && continuationStrength(profile) >= 0.34
    && outsideCrossings[sideIndex][index] >= 0.4
  )).length);
  const externalContinuation = Math.max(...outsideSideScores);
  const externalLineCount = Math.max(...outsideStrongCounts);

  // A board's strokes run about half a cell past the outer intersection line
  // and then stop. When the perpendicular strokes still survive 0.9 spacing
  // beyond a candidate's outer line, that line sits INSIDE the real board:
  // the window borrowed a margin or frame line as its edge, shifting every
  // intersection by one row/column. Measured as the share of intersections
  // whose stroke evidence survives at the 0.9 probe — frame edges and page
  // texture carry no perpendicular strokes there, so they stay silent. Soft
  // score penalty, never a gate: dense backgrounds can legitimately echo it.
  const strokeBeyondShare = (probe: number, from: number, to: number, alongX: boolean) => {
    const span = alongX ? height : width;
    if (probe < 2 || probe > span - 3) return 0;
    let hits = 0;
    for (let index = 0; index < boardSize; index += 1) {
      const along = Math.round(alongX ? originX + index * spacingX : originY + index * spacingY);
      let best = 0;
      for (let phase = -1; phase <= 1; phase += 1) {
        const fixed = Math.round(probe) + phase;
        const px = alongX ? along : fixed;
        const py = alongX ? fixed : along;
        if (px < 2 || px >= width - 2 || py < 2 || py >= height - 2) continue;
        const center = gray[py * width + px];
        const sideA = alongX ? gray[py * width + px - 2] : gray[(py - 2) * width + px];
        const sideB = alongX ? gray[py * width + px + 2] : gray[(py + 2) * width + px];
        const contrast = Math.abs(center - (sideA + sideB) / 2);
        const neighbourDelta = Math.abs(sideA - sideB);
        if (contrast > 7 && neighbourDelta < 65 && contrast > neighbourDelta * 0.18) {
          best = Math.max(best, 1);
        }
      }
      hits += best;
    }
    return hits / boardSize;
  };
  const strokeBeyondSides = Math.round(
    (strokeBeyondShare(originY - spacingY * 0.9, originX, endX, true) >= 0.6 ? 1 : 0)
    + (strokeBeyondShare(endY + spacingY * 0.9, originX, endX, true) >= 0.6 ? 1 : 0)
    + (strokeBeyondShare(originX - spacingX * 0.9, originY, endY, false) >= 0.6 ? 1 : 0)
    + (strokeBeyondShare(endX + spacingX * 0.9, originY, endY, false) >= 0.6 ? 1 : 0),
  );

  // Sample cell interiors rather than intersections. Stones occupy the
  // intersections, while a board's cell background remains comparatively
  // coherent even when the board has wood grain or a light texture. UI cards
  // and analysis tables tend to have much higher local variation.
  const interiorSamples: number[] = [];
  const interiorColors: Rgb[] = [];
  for (let row = 0; row < boardSize - 1; row += 2) {
    for (let col = 0; col < boardSize - 1; col += 2) {
      const x = Math.round(originX + (col + 0.5) * spacingX);
      const y = Math.round(originY + (row + 0.5) * spacingY);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = y * width + x;
      interiorSamples.push(gray[index]);
      interiorColors.push([image.data[index * 4], image.data[index * 4 + 1], image.data[index * 4 + 2]]);
    }
  }
  const interiorMedian = median(interiorSamples);
  const interiorMad = interiorSamples.length
    ? median(interiorSamples.map((value) => Math.abs(value - interiorMedian)))
    : 255;
  const texture = Math.max(0, Math.min(1, 1 - interiorMad / 52));
  const interiorColor: Rgb = interiorColors.length
    ? [
        median(interiorColors.map((color) => color[0])),
        median(interiorColors.map((color) => color[1])),
        median(interiorColors.map((color) => color[2])),
      ]
    : [0, 0, 0];
  const colorDistanceMedian = interiorColors.length
    ? median(interiorColors.map((color) => rgbDistance(color, interiorColor)))
    : 255;
  const coherentColors = interiorColors.filter((color) => rgbDistance(color, interiorColor) <= 42).length;
  const colorCoherence = interiorColors.length
    ? Math.max(0, Math.min(1, coherentColors / interiorColors.length - colorDistanceMedian / 180))
    : 0;
  const sampleColor = (x: number, y: number): Rgb | null => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    const index = py * width + px;
    return [image.data[index * 4], image.data[index * 4 + 1], image.data[index * 4 + 2]];
  };
  const sideColors: Rgb[][] = [[], [], [], []];
  for (let index = 0; index < boardSize - 1; index += 2) {
    const x = originX + (index + 0.5) * spacingX;
    const y = originY + (index + 0.5) * spacingY;
    const samples = [
      sampleColor(x, originY - spacingY * 0.48),
      sampleColor(x, endY + spacingY * 0.48),
      sampleColor(originX - spacingX * 0.48, y),
      sampleColor(endX + spacingX * 0.48, y),
    ];
    samples.forEach((color, side) => {
      if (color) sideColors[side].push(color);
    });
  }
  const sideMedian = (colors: Rgb[]): Rgb => colors.length
    ? [
        median(colors.map((color) => color[0])),
        median(colors.map((color) => color[1])),
        median(colors.map((color) => color[2])),
      ]
    : interiorColor;
  const sideScores = sideColors.map((colors) => (
    Math.max(0, Math.min(1, 1 - rgbDistance(sideMedian(colors), interiorColor) / 95))
  ));
  // A real board normally includes a margin or frame just outside all four
  // outer grid lines. A shifted comb may still use 13 genuine lines, but one
  // outside side then lands in the app/page background and differs sharply.
  const borderContext = median(sideScores);
  const sizeRatio = Math.max(0, Math.min(1, Math.min(
    ((boardSize - 1) * spacingX) / width,
    ((boardSize - 1) * spacingY) / height,
  )));
  const horizontalSlack = Math.max(1, width - (endX - originX));
  const verticalSlack = Math.max(1, height - (endY - originY));
  const horizontalBalance = Math.max(0, Math.min(1,
    1 - Math.abs(originX - (width - endX)) / horizontalSlack,
  ));
  const verticalBalance = Math.max(0, Math.min(1,
    1 - Math.abs(originY - (height - endY)) / verticalSlack,
  ));
  // On portrait phone screenshots the board is normally centred across the
  // screen width but intentionally not centred vertically because controls sit
  // above/below it. Landscape screenshots use the analogous vertical axis.
  const crossAxisBalance = width <= height ? horizontalBalance : verticalBalance;
  const patchLight = (cx: number, cy: number, radius: number) => {
    const left = Math.max(0, Math.floor(cx - radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));
    let total = 0;
    let count = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
        total += gray[y * width + x];
        count += 1;
      }
    }
    return count ? total / count : 0;
  };
  const starInset = boardSize >= 13 ? 3 : Math.max(1, Math.floor(boardSize / 4));
  const starFar = boardSize - 1 - starInset;
  const starMiddle = Math.floor(boardSize / 2);
  const starPoints = [
    [starInset, starInset],
    [starInset, starFar],
    [starMiddle, starMiddle],
    [starFar, starInset],
    [starFar, starFar],
  ];
  const starScores = starPoints.map(([row, col]) => {
    const x = originX + col * spacingX;
    const y = originY + row * spacingY;
    const radius = Math.max(1.5, Math.min(spacingX, spacingY) * 0.1);
    const center = patchLight(x, y, radius);
    const offsetX = spacingX * 0.24;
    const offsetY = spacingY * 0.24;
    const surroundings = [
      patchLight(x - offsetX, y - offsetY, radius),
      patchLight(x + offsetX, y - offsetY, radius),
      patchLight(x - offsetX, y + offsetY, radius),
      patchLight(x + offsetX, y + offsetY, radius),
    ];
    const background = median(surroundings);
    // Star dots are normally dark, but some themes use bright or coloured
    // dots. Absolute local contrast also treats an occupied star as valid.
    const occupiedContrast = Math.abs(center - background);
    // 2026-10-07 木刻棋盘实测的翻盘条款：只比对角邻域会把**任何普通线交叉**都算成
    // 星位（交叉点中心是线=暗、对角是干净木面=亮，对比同样很大）。整格相位错的窗
    // 因为 5 个「星位」全落在普通交叉上拿到 1.00，而真值窗（真星点、其中一个还被
    // 棋子压住）只有 0.80——星位项权重 18，3.6 分的差把整盘翻了过去（真值窗在
    // 线覆盖 1.00 vs 0.96、有效行列 15/15 vs 14/15、交点 0.98 vs 0.92 全占优）。
    // 这里加一条「与同一条线上离它半格处的普通位置」的对比：真星点是一块比线更大
    // 更黑的圆点 ⇒ 中心明显不同；普通交叉 ⇒ 两者都是线、对比≈0 ⇒ 不再冒充星位。
    const alongLine = [
      patchLight(x - spacingX * 0.5, y, radius),
      patchLight(x + spacingX * 0.5, y, radius),
      patchLight(x, y - spacingY * 0.5, radius),
      patchLight(x, y + spacingY * 0.5, radius),
    ];
    const dotContrast = Math.abs(center - median(alongLine));
    return Math.max(0, Math.min(1, (Math.max(dotContrast, occupiedContrast) - 7) / 32));
  });
  const starSupport = starScores.reduce((sum, value) => sum + value, 0) / starScores.length;

  return {
    // Window-local structure is deliberately dominant. The intersection mesh
    // is the strongest single discriminator between a real board and periodic
    // page texture, so it outranks every purely one-dimensional evidence.
    // Same-period lines beyond an edge are NOT penalised: high-frequency
    // backgrounds contain aligned thin lines that rival real continuation, so
    // the penalty only punished boards sitting next to such texture while
    // shifted windows (surrounded by the board itself) escaped it. The
    // strict per-axis validity gates carry the anti-shift job instead.
    score: lineCoverage * 20
      + continuity * 12
      + spatialCoverage * 58
      + fullLineShare * 32
      + crossAxisBalance * 52
      + intersectionSupport * 85
      + starSupport * 18
      + borderContext * 26
      + edgeSupport * 12
      + texture * 8
      + colorCoherence * 54
      + sizeRatio * 18,
    lineCoverage,
    continuity,
    spatialCoverage,
    fullLineShare,
    intersectionSupport,
    outerFrameShare,
    validRowCount,
    validColumnCount,
    rowContinuity,
    columnContinuity,
    externalContinuation,
    externalLineCount,
    strokeBeyondSides,
    crossAxisBalance,
    starSupport,
    borderContext,
    texture,
    colorCoherence,
    edgeSupport,
    sizeRatio,
  };
};

/** Locate the grid directly from complete row/column combs. Pairing the two
 * axes is part of the fit so a decorative repeated pattern on one axis cannot
 * win unless its spacing agrees with the actual square grid on the other. */
/** 归一化（0-1）棋盘区域提示：用户框选/对齐时传给识别器作先验——
 * 帮助网格窗口选择与 fallback 定位，并排除棋盘外的误判点（多子主因）。 */
export interface BoardRoi { x: number; y: number; w: number; h: number }

/** 网格窗与用户框选区域的相对重叠（0-1）——窗与框越吻合分越高，
 * 让「棋盘外 UI 上的错窗」在同分候选中落选。ROI 是提示不是硬约束，
 * 框偏了也不会否决正确窗（加分幅度有限，硬门槛不变）。 */
const roiOverlapBonus = (roi: { x: number; y: number; w: number; h: number }, originX: number, originY: number, spacingX: number, spacingY: number, boardSize: number): number => {
  const x0 = originX, y0 = originY;
  const x1 = originX + (boardSize - 1) * spacingX, y1 = originY + (boardSize - 1) * spacingY;
  const ix0 = Math.max(x0, roi.x), iy0 = Math.max(y0, roi.y);
  const ix1 = Math.min(x1, roi.x + roi.w), iy1 = Math.min(y1, roi.y + roi.h);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const inter = (ix1 - ix0) * (iy1 - iy0);
  const union = (x1 - x0) * (y1 - y0) + roi.w * roi.h - inter;
  if (union <= 0) return 0;
  return Math.min(1, inter / union) * 30;
};

/**
 * 自动路数检测（实验功能，2026-09-16）。
 *
 * 背景：应用此前只导入 15 路——识别器底层支持 5–30 路，但调用方写死 15。冒然放开
 * 会让「选错档位」的代价从「多一颗子」变成「整盘重排」，所以做成显式实验开关。
 *
 * 判据为什么不能直接用 fitCombSeries 的 score：那个分数里 insideSupport 是 N 条线
 * 的支撑之和，**必然随 N 增大而增大**——15 路总能"赢"过 9 路。所以这里改用三个
 * 可跨路数比较的量：
 *
 *   coverage    被支撑的齿数占比（与 N 无关，0~1）
 *   edgeScore   首末两条线的支撑（真棋盘的边框线通常最强；与 N 无关）
 *   outsideGap  提议的棋盘之外还有没有同周期的强线。这是**排除项**：若 9 路是
 *               真的、15 路只是把同一个棋盘切细，那 15 路的间距会小到让外围
 *               全是强线（outsideGap 高）；反之若 15 路是真的、9 路是把两块
 *               棋盘拼在一起，9 路的外围反而会命中。
 *
 *    regularity  齿间距的变异系数（真棋盘线等距，拼凑的候选参差）
 *
 * 打分 = coverage + edgeScore*0.3 - outsideGap*1.2 - regularity*0.8。
 * 三个量的量级都经过实测标定（见 scripts/.tmp-boardsize-detect.mjs）。
 */
export interface BoardSizeDetection {
  boardSize: number;
  spacing: number;
  originX: number;
  originY: number;
  confidence: number;
  /** 每个候选路数的原始分数，用于诊断与阈值调参。 */
  scores: Array<{ size: number; score: number; coverage: number; edge: number; outside: number; regularity: number }>;
}

// 15 路优先以保持手机端常态速度；26–30 路只在图像确实包含更密网格时参与竞争。
// 排序本身不会影响固定路数识别，只影响 boardSize=0 的自动识别。
const BOARD_SIZE_CANDIDATES = [15, 13, 19, 9, 11, 17, 21, 7, 5, 23, 25, 26, 27, 28, 29, 30];

/**
 * 从图像的线强度信号推断路数。只做「候选路数各拟合一次」的比较，不改变任何
 * 既有判定路径——调用方在实验开关打开时才走这里。
 */
export const detectBoardSize = async (
  image: SampledImage,
  acc: RecognitionAccelerator,
  options: { sizes?: number[]; minSpacing?: number } = {},
): Promise<BoardSizeDetection | null> => {
  const sizes = options.sizes ?? BOARD_SIZE_CANDIDATES;
  const minSpacing = options.minSpacing ?? Math.max(5, Math.min(image.width, image.height) * 0.015);
  // 每个候选路数各跑一次行、列线梳拟合（一次交给加速器并行）。
  const queries: CombQuery[] = [];
  for (const size of sizes) {
    queries.push({ alongX: true, innerStart: 1, boardSize: size, spacingRange: { minimum: minSpacing }, limits: { pool: 120, seeds: 60, output: 24 } });
    queries.push({ alongX: false, innerStart: 1, boardSize: size, spacingRange: { minimum: minSpacing }, limits: { pool: 120, seeds: 60, output: 24 } });
  }
  const fits = await acc.fitCombs(queries);
  // 线强度信号各算一次，用于「棋盘之外还有没有同周期的强线」这一项。
  const rowSignal = collectLineScores(image.gray, image.width, image.height, true);
  const columnSignal = collectLineScores(image.gray, image.width, image.height, false);
  const prepSignal = (scores: Float32Array) => {
    const baseline = scoreQuantile(scores, 0.55);
    let peak = 0;
    for (const value of scores) if (value > peak) peak = value;
    const cap = Math.max(baseline + 1, peak);
    return { baseline, scale: Math.max(1, cap - baseline) };
  };
  const rowPrep = prepSignal(rowSignal);
  const columnPrep = prepSignal(columnSignal);
  /**
   * 线峰统计：在强度信号里找局部极大值（合并 3px 内的相邻峰），返回峰数与相邻
   * 间距中位数。这是「棋盘真实有几条线、线间距多少」的直接测量，用于把候选路数
   * 与抽稀出来的伪栅格区分开（见下面 pitchRatio 的注释）。
   *
   * 为什么用中位间距而不是平均值：盘外的 UI 线条（工具栏分隔线、卡片边框）会
   * 混进峰列表，平均值被它们拉偏；中位数对少量离群值稳健。
   */
  const measurePeaks = (scores: Float32Array, prep: { baseline: number; scale: number }) => {
    const span = scores.length;
    const threshold = prep.baseline + prep.scale * 0.25;
    const peaks: number[] = [];
    for (let index = 1; index < span - 1; index += 1) {
      if (scores[index] < threshold) continue;
      if (scores[index] < scores[index - 1] || scores[index] <= scores[index + 1]) continue;
      if (peaks.length && index - peaks[peaks.length - 1] < 3) {
        peaks[peaks.length - 1] = (peaks[peaks.length - 1] + index) / 2;
        continue;
      }
      peaks.push(index);
    }
    if (peaks.length < 2) return { count: peaks.length, pitch: 0 };
    const gaps: number[] = [];
    for (let index = 1; index < peaks.length; index += 1) gaps.push(peaks[index] - peaks[index - 1]);
    gaps.sort((left, right) => left - right);
    return { count: peaks.length, pitch: gaps[Math.floor(gaps.length / 2)] };
  };
  const rowPeaks = measurePeaks(rowSignal, rowPrep);
  const columnPeaks = measurePeaks(columnSignal, columnPrep);
  const rowSignalPitch = rowPeaks.pitch;
  const columnSignalPitch = columnPeaks.pitch;
  const rowPeakCount = rowPeaks.count;
  const columnPeakCount = columnPeaks.count;
  /**
   * 线信号的**真实周期**（自相关法，2026-09-16）。
   *
   * 为什么不能只用峰间距中位数：中位数被抗锯齿噪声（相邻 3px 内的伪峰）和盘外
   * 刻度线拉偏。而路数判定的关键恰恰是「候选齿距必须正好等于线的真实周期」——
   * 实测 19 路盘上，真候选齿距 = 周期 sp（19 齿全部落在真线上），而错误的 21 路
   * 候选齿距 = 0.9sp（把 19 条真线映射到自己的偶数齿上，剩余齿靠盘外线补齐），
   * 两者的覆盖率只差 0.002（0.974 vs 0.976），靠覆盖率永远分不开。
   *
   * 自相关在整段信号上做，抗单点噪声：把 scores 与其平移 lag 后的内积归一化，
   * 取第一个显著峰的位置即为主周期。实测这个值对每个真路数都很稳定。
   */
  const autocorrelationPitch = (scores: Float32Array, prep: { baseline: number; scale: number }, minimum: number) => {
    const span = scores.length;
    const centered = new Float32Array(span);
    for (let index = 0; index < span; index += 1) centered[index] = Math.max(0, scores[index] - prep.baseline) / prep.scale;
    const maxLag = Math.min(Math.floor(span / 3), Math.floor(span / 3));
    let bestLag = 0;
    let bestValue = 0;
    let zero = 0;
    for (let index = 0; index < span; index += 1) zero += centered[index] * centered[index];
    if (zero <= 0) return 0;
    for (let lag = Math.max(4, Math.floor(minimum)); lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let index = 0; index + lag < span; index += 1) sum += centered[index] * centered[index + lag];
      const value = sum / zero;
      if (value > bestValue) { bestValue = value; bestLag = lag; }
    }
    return bestLag;
  };
  const rowAutoPitch = autocorrelationPitch(rowSignal, rowPrep, 6);
  const columnAutoPitch = autocorrelationPitch(columnSignal, columnPrep, 6);
  /**
   * 候选路数与「量到的线峰数」的差距（归一化到 0~1）。
   *
   * 标定依据（2026-09-16 实测 18 张非 15 路语料，见 scripts/.tmp-boardsize-eval2.mjs）：
   *   真 9 路 → 列峰 13~14
   *   真 13 路 → 列峰 17~19
   *   真 19 路 → 列峰 24~34
   * 三档完全不重叠，所以峰数是**区分路数的有效信号**；但它总是**大于**真路数
   * （盘外的坐标标注、棋盘外框也被算成峰），且超出量不稳定（9 路多 4~5、19 路多 5~15）。
   * 因此判据不是「相等」，而是「候选路数应落在 [峰数×0.55, 峰数] 这个带里」——
   * 峰数减去它自身的 45% 作为下限（19 路 24 峰时下限 13，真值 19 在内；21 路也
   * 勉强在内，所以这一项只能作为**加权证据**，不能单独定论，最终仍由覆盖率与
   * 外围延续共同决定）。
   *
   * 列方向权重更高：整屏截图的工具栏/卡片主要是水平线，行峰被污染得更厉害
   * （实测 19 路图的行峰可达 39，跨界进 13 路的区间）。
   */
  const countMismatch = (size: number, rowCount: number, columnCount: number) => {
    // 落在带内为 0；偏离带越远越大（用带自身的宽度归一，使不同峰数可比）。
    const bandMiss = (count: number, candidate: number) => {
      if (count <= 0) return 0;
      const lower = count * 0.55;
      if (candidate >= lower && candidate <= count) return 0;
      const width = Math.max(3, count * 0.45);
      return Math.min(1, (candidate < lower ? lower - candidate : candidate - count) / width);
    };
    return bandMiss(rowCount, size) * 0.35 + bandMiss(columnCount, size) * 0.65;
  };
  /** 某个位置附近的线强度（0~1 归一，用该轴的对比度标定）。 */
  const lineStrengthAt = (scores: Float32Array, prep: { baseline: number; scale: number }, span: number, position: number, radius: number) => {
    const center = Math.round(position);
    let peak = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = center + offset;
      if (index < 0 || index >= span) continue;
      if (scores[index] > peak) peak = scores[index];
    }
    return Math.max(0, Math.min(1, (peak - prep.baseline) / prep.scale));
  };
  const scored: BoardSizeDetection["scores"] = [];
  const details: Array<{ size: number; row: CombFit; column: CombFit; score: number }> = [];
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    const rows = fits[index * 2] ?? [];
    const columns = fits[index * 2 + 1] ?? [];
    if (!rows.length || !columns.length) continue;
    const row = rows[0];
    const column = columns[0];
    // 两轴的间距必须接近（真棋盘是正方形网格），否则这个候选作废。
    const ratio = Math.min(row.spacing, column.spacing) / Math.max(row.spacing, column.spacing);
    if (ratio < 0.9) continue;
    const coverage = (row.coverage + column.coverage) / 2;
    // 外围延续（2026-09-16 修正）：探测点**从第 2 个齿距起**，不再看紧邻第 1 个。
    //
    // 为什么要跳过第 1 齿：应用自己的棋盘在网格外紧邻着画坐标刻度与外框，实测
    // 19 路图的列峰多达 24~34 个（真线只有 19 条，多出的正是刻度与外框）。候选
    // 网格若正好贴合真棋盘，其外侧第 1 齿就会撞上外框而被判「棋盘外还有延续线」
    // 扣重分——反过来，一个往外多扩两格的**错误**候选（如 19 路盘上判成 21 路）
    // 反而因采样点落到更远处而蒙混过关。实测这正是 19 路被系统性判成 21 路的根因
    // （21 路 cov 0.976 > 真 19 路 0.974，反常的覆盖率排名就是这条惩罚造成的）。
    // 跳过紧邻齿后，判定的是「更远处还有没有**成片**的线」，那才是真正的错误信号。
    const outsideOf = (fit: CombFit, signal: Float32Array, prep: { baseline: number; scale: number }, span: number) => {
      const radius = Math.min(5, Math.max(1, Math.round(fit.spacing * 0.09)));
      const end = fit.origin + (size - 1) * fit.spacing;
      const strengths: number[] = [];
      for (const distance of [2, 3]) {
        const before = fit.origin - fit.spacing * distance;
        const after = end + fit.spacing * distance;
        if (before >= 0) strengths.push(lineStrengthAt(signal, prep, span, before, radius));
        if (after <= span - 1) strengths.push(lineStrengthAt(signal, prep, span, after, radius));
      }
      if (!strengths.length) return 0;
      return Math.min(...strengths);
    };
    const outside = Math.max(
      outsideOf(row, rowSignal, rowPrep, image.width),
      outsideOf(column, columnSignal, columnPrep, image.height),
    );
    // 决定性判据：**齿距必须等于棋盘的最小线间距**。
    //
    // 2026-09-16 实测发现的坑：同一个棋盘上存在多个「自洽的子栅格」——19 路盘上取
    // 每隔一格的一条线，就得到一个完全等距、覆盖率 100%、外围也无延续的 10 路栅格；
    // 取每隔两格就是 7 路、每隔三格就是 5 路。于是 5/7/11 路候选全都拿到满分，
    // 分不出真路数（基线实测里正是这些候选在抢榜首，路数判对只有 10/18）。
    //
    // 真棋盘上「相邻两条线」的间距就是最小间距，任何子栅格都是它的整数倍。所以用
    // 图像自身的线峰间距（实测：×9 路→列峰间距 37~45px、13 路→26~30、19 路→14~21，
    // 与真路数一一对应）作为标尺：齿距明显大于最小间距的候选，是把真实网格抽稀。
    //
    // 门槛取 1.6：实测真路数的比值落在 1.26~1.36（拟合出的齿距比峰间距略大是正常的
    // ——峰间距用的是粗量化的中位数），而抽稀候选是 2.5~6.4（隔一条取一条至少 2 倍）。
    // 1.6 落在两者之间的宽阔空隙里；最初取 1.35 时，真 9 路（1.36）被自己的门卡掉，
    // 正是「门槛贴着真值分布」的典型翻车，故留出足够余量。
    const minPitch = Math.min(rowSignalPitch, columnSignalPitch);
    const pitchRatio = minPitch > 0 ? Math.max(row.spacing, column.spacing) / minPitch : 1;
    // 只在确实量到了线峰间距时才启用这条门（minPitch=0 表示信号里没找到峰，
    // 此时退回纯覆盖率打分，不让噪声决定路数）。
    if (minPitch > 0 && pitchRatio > 1.6) continue;
    // 线数接近度：候选路数应接近该方向量到的线峰数。这一项是区分**相邻路数**
    // （19 vs 21、13 vs 15）的主力——它们的 pitchRatio 都在合法带内（相邻路数的
    // 齿距只差 ~10%，1.6 的阈值拦不住，也不该拦），但「盘上到底有几条线」量得出来：
    // 实测 9 路→列峰 13~16、13 路→17~20、19 路→24~34，从未重合。
    // 列方向权重更高：整屏截图的工具栏/卡片主要是水平线，行峰被污染得更厉害。
    const countPenalty = countMismatch(size, rowPeakCount, columnPeakCount);
    // 齿距必须等于线的真实周期（自相关测得）。这是区分相邻路数的决定性判据：
    // 真候选齿距/周期 ≈ 1.0，而「把真线映射到自己每隔一格」的错误候选是 0.9 或
    // 1.1 倍——覆盖率看不到这个差别（两者都 ~0.975），齿距看得到。
    // 惩罚用相对偏差的平方，偏差 5% 即有 0.25 量级的扣分，足够把错误候选压下去。
    const pitchFitOf = (fit: CombFit, autoPitch: number) => {
      if (autoPitch <= 0) return 0;
      const deviation = Math.abs(fit.spacing - autoPitch) / autoPitch;
      return Math.min(1, (deviation / 0.08) ** 2);
    };
    const pitchFit = pitchFitOf(row, rowAutoPitch) * 0.35 + pitchFitOf(column, columnAutoPitch) * 0.65;
    const score = coverage * 1.0 - outside * 1.2 - countPenalty * 1.15 - pitchFit * 1.4;
    scored.push({
      size,
      score: Math.round(score * 1000) / 1000,
      coverage: Math.round(coverage * 1000) / 1000,
      edge: Math.round(pitchRatio * 1000) / 1000,
      outside: Math.round(outside * 1000) / 1000,
      regularity: Math.round(countPenalty * 1000) / 1000,
    });
    details.push({ size, row, column, score });
  }
  if (!details.length) return null;
  details.sort((left, right) => right.score - left.score);
  scored.sort((left, right) => right.score - left.score);
  const winner = details[0];
  const runnerUp = details[1];
  // 置信度：领先第二名多少。差距小就说明这个判断不可靠，调用方应据此提示用户。
  const margin = runnerUp ? winner.score - runnerUp.score : winner.score;
  const confidence = Math.max(0.2, Math.min(0.95, 0.5 + margin * 0.35));
  return {
    boardSize: winner.size,
    spacing: (winner.row.spacing + winner.column.spacing) / 2,
    originX: winner.column.origin,
    originY: winner.row.origin,
    confidence,
    scores: scored,
  };
};

/**
 * 网格估计缓存（2026-10-08 提速）：导入与复原是**两次独立的识别调用**（App 先导入出局面，
 * 用户点「复原手序」再跑一次），同一张图、同样的路数与框选，网格检测会把同一个结论
 * 再原样算一遍——实测每次 3.8–4.6 秒（占复原总耗时约四分之一）。这里按「画布尺寸 +
 * 路数 + 框选 + 稀疏像素校验和」缓存上一次的结论，命中即**原样返回同一份数值**：
 * 不参与任何判定、不改变任何结果，只是不再重算。
 *
 * 键为什么要带像素校验和：不同图可能尺寸与路数完全相同（同型号手机连拍），只按尺寸会
 * 串图。校验和与数字头扫描缓存（digit-head.ts 的 scanCacheKey）同款思路，采样 512 个
 * 位置足以把不同图分开。
 */
const gridEstimateCache = new Map<string, GridEstimate | null>();
const GRID_ESTIMATE_CACHE_LIMIT = 4;
const sampledImageChecksum = (image: SampledImage): number => {
  let hash = 2166136261;
  const total = image.width * image.height * 4;
  const stride = Math.max(4, Math.floor(total / 512 / 4) * 4);
  for (let index = 0; index < total; index += stride) {
    hash ^= image.data[index] + image.data[index + 1] * 3 + image.data[index + 2] * 7 + index;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * 「修正既有网格」的采纳余量（相对分，2026-10-13）。
 *
 * 为什么需要：两处网格修正（±2 格平移、满盘重定位）原来都是「严格更高分就采纳」
 * （`> current + 1e-9`）。但**满盘的网格在周期上本来就有歧义**——整盘平移整数格后，
 * 棋子依然压在交叉点上，窗口评分几乎不变，于是噪声级的反超会把正确网格换掉。
 *
 * 实测（用户那张智子截屏，864×1920、179 子满盘）：
 *   正确相位 y=323 得 **359.7** → 被平移 2 格后的 y=414 得 **360.0**，只高 **0.08%**，
 *   却被采纳；整盘手序因此全部错位 2 行（用放大图逐格核对：判出来的 (0,1)=56 其实
 *   是 (2,1)，而正确网格的那一版 25/25 全对）。
 *
 * 真需要修正的图，差距是**百分比级**——仓库既有实测：386.6 vs 380.6（+1.6%）、
 * 386.6 vs 352.9（+9.5%）。所以 1% 的余量落在两者之间：噪声级反超挡在外面，
 * 真正的修正照旧通过。门槛（evaluateCandidate 的四道硬门）一个没动。
 */
const GRID_CORRECTION_MARGIN = 0.01;
/** 补位（两条路径：静态补位 / 读号补位）要求的最低「对角线墨迹占比」（2026-10-15）。
 *  含义：真子的盘边会落在对角方向上；只有棋盘线/粗边框穿过时对角线是干净的。
 *  实测两侧：白底 89 手图 44 个**合法**补位子 ≥ 0.098；边框/线画出来的假子
 *  （黄底棋盘贴边那 3 颗、书谱 a10、书谱小尺寸版 j8）全是 0.000 —— 取 0.05，两边各留一倍余量。
 *  注：同源判据在判色阶梯里是 `diagonalShare >= 0.18`（挡空交叉点），这里取更松的 0.05 是因为
 *  合法补位子本身就在淡白子那一档（对角墨迹天然更少）。 */
const FILL_MIN_DIAGONAL_SHARE = 0.05;

const detectGrid = async (
  image: SampledImage,
  boardSize: number,
  roi: BoardRoi | undefined,
  acc: RecognitionAccelerator,
): Promise<GridEstimate | null> => {
  const cacheKey = `${image.width}x${image.height}|${boardSize}|${roi ? `${roi.x.toFixed(4)},${roi.y.toFixed(4)},${roi.w.toFixed(4)},${roi.h.toFixed(4)}` : "-"}|${sampledImageChecksum(image)}`;
  const hit = gridEstimateCache.get(cacheKey);
  if (hit !== undefined) return hit ? { ...hit } : null;
  const result = await detectGridUncached(image, boardSize, roi, acc);
  if (gridEstimateCache.size >= GRID_ESTIMATE_CACHE_LIMIT) gridEstimateCache.clear();
  gridEstimateCache.set(cacheKey, result ? { ...result } : null);
  return result ? { ...result } : null;
};

const detectGridUncached = async (
  image: SampledImage,
  boardSize: number,
  roi: BoardRoi | undefined,
  acc: RecognitionAccelerator,
): Promise<GridEstimate | null> => {
  const { width: side, height } = image;
  // ROI 转像素坐标；仅在调用方给了框选时参与评分，缺省路径与旧版完全一致。
  const roiPx = roi && roi.w > 0 && roi.h > 0
    ? { x: roi.x * side, y: roi.y * height, w: roi.w * side, h: roi.h * height }
    : null;
  // A readable board screenshot never shows a fifteen-tooth comb narrower than
  // ~1.5% of the image width per cell; anything below that is text baselines
  // or icon rows. The floor keeps dense UI texture out of the global candidate
  // pools, where it previously outranked the real board rows. The reference
  // must be the SHORT side: wide banner screenshots (status-bar crops) carry
  // a small board whose line pitch is far below 1.5% of the image width, and
  // using the width there rejected every real board comb (2026-09-11).
  const globalMinSpacing = Math.max(5, Math.min(side, height) * 0.015);
  // 行/列两条全局线梳彼此独立，一次交给加速器（串行时就是逐条调用原函数）。
  const tComb0 = performance.now();
  const globalFits = await acc.fitCombs([
    { alongX: true, innerStart: 1, boardSize, spacingRange: { minimum: globalMinSpacing } },
    { alongX: false, innerStart: 1, boardSize, spacingRange: { minimum: globalMinSpacing } },
  ]);
  moveOrderPerf.combMs = Math.round(performance.now() - tComb0);
  const rowFits = globalFits[0];
  const columnFits = globalFits[1];
  const debug = (globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__;
  if (debug) console.info("[banbu-image-fits]", JSON.stringify({
    rows: rowFits.slice(0, 5),
    columns: columnFits.slice(0, 5),
  }));
  if (debug && columnFits.length) {
    const column = columnFits[0];
    const spanY = (boardSize - 1) * column.spacing;
    const phaseSamples = Array.from({ length: Math.max(0, Math.floor((height - spanY) / column.spacing) + 1) }, (_, index) => {
      const originY = index * column.spacing;
      return {
        originY,
        quality: scoreGridWindow(image, column.origin, originY, column.spacing, column.spacing, boardSize),
      };
    })
      .filter((item) => item.originY >= side * 0.2 && item.originY <= height - spanY)
      .sort((left, right) => (right.quality?.score ?? -1) - (left.quality?.score ?? -1))
      .slice(0, 12);
    console.info("[banbu-image-phases]", JSON.stringify(phaseSamples));
  }
  let best: { row: CombFit; column: CombFit; score: number; window: GridWindowQuality } | null = null;
  let cleanBest: { row: CombFit; column: CombFit; score: number; window: GridWindowQuality } | null = null;
  // Debug-only rejection ledger: when nothing passes, this explains which
  // hard gate killed the strongest candidates, in evaluation order.
  const rejected: Array<Record<string, unknown>> = [];
  // 候选评分被拆成两半：evaluateCandidate 是纯函数（参数相同则结果相同，因此
  // 可以丢进 worker 并行算），applyCandidate 是顺序归约（谁最优、就近平手取谁、
  // rejected 台账的插入顺序），永远留在主线程按原顺序执行。多核与单线程因此
  // 得到完全相同的网格——加速器换的只是「算」的执行者，不是判定规则。
  type Candidate = { row: CombFit; column: CombFit; localBonus: number };
  const spacingRatioOf = (row: CombFit, column: CombFit) =>
    Math.min(row.spacing, column.spacing) / Math.max(row.spacing, column.spacing);
  const evaluateCandidate = (candidate: Candidate, window: GridWindowQuality | null): { failures: string[]; pairedScore: number } => {
    const { row, column, localBonus } = candidate;
    if (!window) return { failures: ["outOfBounds"], pairedScore: 0 };
    const failures: string[] = [];
    if (window.continuity < GRID_GATE_CONTINUITY) failures.push("continuity");
    if (window.lineCoverage < GRID_GATE_LINE_COVERAGE) failures.push("lineCoverage");
    if (window.spatialCoverage < GRID_GATE_SPATIAL_COVERAGE) failures.push("spatialCoverage");
    if (window.fullLineShare < GRID_GATE_FULL_LINE_SHARE) failures.push("fullLineShare");
    // 线剖面四道门没过就已经淘汰，后面的指标压根没算（`scoreGridWindow` 提前返回），
    // 这里就照实报这四道门，不去用 0 冒充「颜色/边框也不合格」。
    if (window.earlyOut) return { failures, pairedScore: 0 };
    if (window.colorCoherence < 0.36) failures.push("colorCoherence");
    if (window.borderContext < 0.38) failures.push("borderContext");
    if (window.intersectionSupport < 0.55) failures.push("intersectionSupport");
    // A window anchored on a DECORATIVE frame sits one row/column short of the
    // real grid, and that shortfall is already what the row/column counts
    // below measure — so the thickness test only adds information when those
    // counts are short too. Boards that draw their own border thick (printed
    // and notation-paper diagrams use a 3-4px frame) are complete on both
    // counts and must not be rejected for their border weight.
    if (window.outerFrameShare >= 0.5
      && (window.validRowCount < boardSize || window.validColumnCount < boardSize)) failures.push("outerFrame");
    if (window.validRowCount < boardSize - 1) failures.push("validRowCount");
    if (window.validColumnCount < boardSize - 1) failures.push("validColumnCount");
    if (window.rowContinuity < 0.68) failures.push("rowContinuity");
    if (window.columnContinuity < 0.68) failures.push("columnContinuity");
    // Continuation of same-period lines beyond an edge is only a soft penalty,
    // not a hard gate: high-frequency backgrounds (stone walls, dense tables)
    // genuinely contain aligned thin lines that pass even the strict mesh
    // probe. The intersection validity gates above already reject windows cut
    // from inside a larger grid far more reliably.
    if (window.sizeRatio >= 0.72 && window.crossAxisBalance < 0.42) failures.push("crossAxisBalance");
    if (failures.length) return { failures, pairedScore: 0 };
    // 求和顺序必须与拆分前逐字一致：浮点加法不满足结合律，换顺序就会在
    // 平手边界上换出一个不同的网格。
    // 「15 条线全部有效」加分（2026-10-07）：validRow/ColumnCount == boardSize 是
    // 「这个窗真的压在棋盘网格上」的直接证据——相位错一格的窗必然有几条线落到棋盘
    // 外（坐标标签带、背景石纹），有效线数更少。实测木刻棋盘（智子风格截图）：
    // 真值窗 15/15、窗内交点 0.98、线覆盖 1.00，却因轴评分被背景纹理抬高而输给
    // 错两格的窗（14/15）——整盘因此错位两行、底部还落到坐标标签上。这条加分
    // 只在「全域有效」时给，等于把这条证据从「影响很小」提到「能翻平手」的量级。
    const fullValidityBonus = window.validRowCount >= boardSize && window.validColumnCount >= boardSize ? boardSize * 1.2 : 0;
    const pairedScore = window.score
      + (row.score + column.score) * 0.035
      + localBonus
      + fullValidityBonus
      + (roiPx ? roiOverlapBonus(roiPx, column.origin, row.origin, column.spacing, row.spacing, boardSize) : 0)
      - (1 - spacingRatioOf(row, column)) * boardSize * 2.4;
    return { failures, pairedScore };
  };
  const applyCandidate = (candidate: Candidate, window: GridWindowQuality | null): string[] | null => {
    const { row, column } = candidate;
    const { failures, pairedScore } = evaluateCandidate(candidate, window);
    if (failures.length) {
      // 越界候选在原实现里就是「评分函数返回 null」的早退，不进台账。
      if (!window) return failures;
      const record = {
        x: Math.round(column.origin * 10) / 10,
        y: Math.round(row.origin * 10) / 10,
        sx: Math.round(column.spacing * 100) / 100,
        failed: failures,
        mesh: Math.round(window.intersectionSupport * 1000) / 1000,
        rowsValid: window.validRowCount,
        colsValid: window.validColumnCount,
        rowCont: Math.round(window.rowContinuity * 1000) / 1000,
        colCont: Math.round(window.columnContinuity * 1000) / 1000,
        score: Math.round(window.score * 10) / 10,
      };
      if (rejected.length < 48) rejected.push(record);
      else {
        let weakest = 0;
        for (let index = 1; index < rejected.length; index += 1) {
          if ((rejected[index].score as number) < (rejected[weakest].score as number)) weakest = index;
        }
        if ((record.score as number) > (rejected[weakest].score as number)) rejected[weakest] = record;
      }
      return failures;
    }
    if (!best || pairedScore > best.score) best = { row, column, score: pairedScore, window: window as GridWindowQuality };
    if ((window as GridWindowQuality).strokeBeyondSides === 0
      && (!cleanBest || pairedScore > cleanBest.score)) {
      cleanBest = { row, column, score: pairedScore, window: window as GridWindowQuality };
    }
    return null;
  };
  // 一批候选：先剔掉间距比不合格的（原实现在评分前就返回，无副作用、不进台账），
  // 其余的交给加速器批量评分，再按原顺序重放归约。
  // 候选去重——2026-10-08 量过，**不需要**：同一 (origin, spacing, localBonus) 的重复候选
  // 实测为 0 个（1704 窗全部是不同的几何），所以去重只是空转。同一窗口确实会从多个来源
  // 进入候选池（全局配对 / 局部拟合 / 相位枚举 / 精修），但各来源产生的几何互不重复。
  const considerBatch = async (batch: readonly Candidate[]): Promise<void> => {
    const tBatch = performance.now();
    const scorable: Candidate[] = [];
    const queries: GridWindowQuery[] = [];
    for (const candidate of batch) {
      if (spacingRatioOf(candidate.row, candidate.column) < 0.92) continue;
      scorable.push(candidate);
      queries.push({
        originX: candidate.column.origin,
        originY: candidate.row.origin,
        spacingX: candidate.column.spacing,
        spacingY: candidate.row.spacing,
        boardSize,
      });
    }
    if (!scorable.length) return;
    const windows = await acc.scoreWindows(queries);
    scorable.forEach((candidate, index) => applyCandidate(candidate, windows[index]));
    moveOrderPerf.gridBatchMs += performance.now() - tBatch;
    moveOrderPerf.gridBatchWindows += scorable.length;
  };

  // 三个候选来源按原顺序拼成一批：全局配对 → 锁定一列的局部行 → 锁定一行的
  // 局部列。顺序不能变：同分时谁先被考虑决定谁留在 best / cleanBest 上。
  const candidates: Candidate[] = [];
  // First consider pairs found across the complete image. This is the fast and
  // accurate path for already-cropped board images.
  //
  // 配对池上限（2026-10-09 提速；2026-10-11 **修正为「先 12 后 36」两档**）：
  // 36×36 = 1296 窗是网格检测的最大单项（单窗 0.5～1.5ms）。原先直接砍成 12×12
  // 并声称「网格与盘面逐值不变」——那是**只在 27 张基线图上量的**，而那批图没有
  // 柔化变体。空心颜色门禁一跑就露馅：
  //
  //   paper02.jpg + blur(0.8px)：K=12 → 30 颗、网格 (51.2,51.2) sp59.19（错）；
  //                              K=36 → 43 颗、网格 (80.8,80.6) sp54.89（对）
  //
  // 原因是柔化会把**最外侧那条边框线**削弱，于是行线梳的 coverage 从 1.0 掉到
  // 0.867、最佳相位整体挪一格（82 → 136），正确的那一对行列拟合**排到了 12 名之外**。
  // K=12 时它连被评分的机会都没有，于是某个质心更「好看」的错窗胜出——不是评分错，
  // 是候选根本没进池。
  //
  // 修正做法：**不再固定小池**，改成两级——先用 K=12 评一遍；若这一轮**没有任何候选
  // 通过全部硬门**（`applyCandidate` 没留下 selected），说明正确解可能被池子挡在外面，
  // 再用 K=36 补评一轮。这样：
  //   · 正常图（12 名内就有解）只花 12×12 的代价 —— 提速照旧；
  //   · 病态图（柔化/低对比导致相位漂移）自动退回旧行为 —— 与 HEAD 逐值一致。
  // QA 仍可用 __BANBU_PAIR_TOPK__ 覆盖（0 = 直接全量 36，负值 = 关掉第二档）。
  const pairTopK = Number((globalThis as typeof globalThis & { __BANBU_PAIR_TOPK__?: number }).__BANBU_PAIR_TOPK__ ?? 12);
  const poolFor = (fits: CombFit[], k: number) => (k > 0 ? fits.slice(0, k) : fits.slice(0, 36));
  const pushPairs = (rowList: CombFit[], columnList: CombFit[]) => {
    for (const row of rowList) {
      for (const column of columnList) candidates.push({ row, column, localBonus: 0 });
    }
  };
  pushPairs(poolFor(rowFits, pairTopK), poolFor(columnFits, pairTopK));

  // For full-screen UI screenshots, one global axis is often correct while the
  // other is polluted by toolbar/card/table lines. Lock the reliable axis,
  // restrict the perpendicular scan to that square, and fit the missing axis
  // again. Thus both combs must belong to the same physical board region.
  const localLimits = { pool: 48, seeds: 20, output: 16 };
  const columnSeeds = columnFits.slice(0, 12);
  const localRowFits = await acc.fitCombs(columnSeeds.map((column) => ({
    alongX: true,
    innerStart: column.origin - column.spacing * 0.35,
    innerEnd: column.origin + (boardSize - 1) * column.spacing + column.spacing * 0.35,
    boardSize,
    limits: localLimits,
    spacingRange: { minimum: column.spacing * 0.88, maximum: column.spacing * 1.12 },
  })));
  columnSeeds.forEach((column, index) => {
    localRowFits[index].forEach((row) => candidates.push({ row, column, localBonus: 4 }));
  });
  const rowSeeds = rowFits.slice(0, 12);
  const localColumnFits = await acc.fitCombs(rowSeeds.map((row) => ({
    alongX: false,
    innerStart: row.origin - row.spacing * 0.35,
    innerEnd: row.origin + (boardSize - 1) * row.spacing + row.spacing * 0.35,
    boardSize,
    limits: localLimits,
    spacingRange: { minimum: row.spacing * 0.88, maximum: row.spacing * 1.12 },
  })));
  rowSeeds.forEach((row, index) => {
    localColumnFits[index].forEach((column) => candidates.push({ row, column, localBonus: 4 }));
  });
  // 廉价网格预筛——2026-10-08 试过，**行不通**，不要重走：这一批候选 1680 个窗口
  // （全局 36×36 配对占 1296 个）确实是网格检测的最大单项（实测占 63%、约 2.8 秒），
  // 本想用便宜的 meshSupports(sampleStep 2) 先把「没有网格证据」的候选取掉再跑完整
  // 窗口评分。但实测 renjuportal 两张图上 1680 个候选**全部** mesh ≥ 0.4（筛掉 0 个，
  // 白付 0.3–0.6 秒）——同一棋盘的线梳任意相位配对都给出高 mesh（两轴的线本来就在，
  // 交点自然密），这个量区分不了相位。要剪这一批，得先找到比窗口评分更便宜、且真能
  // 分辨相位的代理量。
  await considerBatch(candidates);

  // 第二档（2026-10-11）：第一轮 12×12 若**一个候选都没过全部硬门**（`best` 仍空），
  // 说明正确解可能被池子挡在外面——柔化/低对比会把最外侧边框线削弱，行线梳最佳相位
  // 整体挪一格，真解掉到 12 名之外（paper02+blur 实测：12×12 全灭、36×36 命中）。
  // 用 K=36 补一轮；已经选出解时**完全不跑**，正常图的提速不受影响。
  // `__BANBU_PAIR_TOPK__` 传 0 可退回旧的全量 36（对照用）。
  if (!best && pairTopK > 0 && pairTopK < 36) {
    const extra: Candidate[] = [];
    for (const row of rowFits.slice(0, 36)) {
      for (const column of columnFits.slice(0, 36)) extra.push({ row, column, localBonus: 0 });
    }
    // 去掉第一轮已评过的组合，避免重复计分（同分时顺序也必须保持原样）
    const seen = new Set(candidates.map((c) => `${c.row.origin}|${c.row.spacing}|${c.column.origin}|${c.column.spacing}`));
    const fresh = extra.filter((c) => !seen.has(`${c.row.origin}|${c.row.spacing}|${c.column.origin}|${c.column.spacing}`));
    await considerBatch(fresh);
  }

  // The one-dimensional comb score cannot separate the board's own rows from
  // stronger periodic UI texture (analysis tables, text baselines) sharing the
  // same spacing, so a correct row comb may never reach the candidate pools at
  // all. Instead of trusting those rankings, enumerate row phases directly
  // from the most trusted column combs (and vice versa) and pre-filter them
  // with cheap two-direction mesh evidence: only the real board has a dense
  // intersection mesh, texture and tables stay near zero.
  const enumeratePhases = async (fixed: CombFit, alongRows: boolean): Promise<Array<{ origin: number; mesh: number }>> => {
    const tPhase = performance.now();
    const span = (boardSize - 1) * fixed.spacing;
    const bound = alongRows ? height : side;
    // Phase enumeration cost scales with the image; the kept phases are
    // re-polished over ±1px below, so a coarser sweep step is safe
    // (enumeratePhases is a top hotspot on full-screen screenshots).
    const step = Math.max(3, fixed.spacing * 0.11);
    // 整个相位扫描是一串互相独立的网格证据探针（每张图数百次），一次性交给
    // 加速器；排序与「保留彼此相距半格以上的前 4 个」的筛选保持原样。
    const sweepOrigins: number[] = [];
    for (let origin = 0; origin <= bound - span + 0.001; origin += step) sweepOrigins.push(origin);
    const sweepMeshes = await acc.meshSupports(sweepOrigins.map((origin) => ({
      originX: alongRows ? fixed.origin : origin,
      originY: alongRows ? origin : fixed.origin,
      spacingX: fixed.spacing,
      spacingY: fixed.spacing,
      boardSize,
      sampleStep: 2,
    })));
    const phases = sweepOrigins.map((origin, index) => ({ origin, mesh: sweepMeshes[index] }));
    phases.sort((left, right) => right.mesh - left.mesh);
    const kept: Array<{ origin: number; mesh: number }> = [];
    for (const phase of phases) {
      if (kept.some((item) => Math.abs(item.origin - phase.origin) < fixed.spacing * 0.5)) continue;
      kept.push(phase);
      if (kept.length >= 4) break;
    }
    // The enumeration step reaches 2px, which at small spacings costs enough
    // subpixel alignment to drop borderline rows or columns below the strict
    // validity threshold. Polish each kept phase over ±1px and pick by the
    // FULL window score: raw mesh support is bistable at the subpixel level
    // (a 0.5px phase move flips borderline rows), while the window score
    // integrates every piece of evidence and ranks stably.
    const polishPlan: Array<{ index: number; origin: number }> = [];
    for (let index = 0; index < kept.length; index += 1) {
      polishPlan.push({ index, origin: kept[index].origin });
      for (const delta of [-1, -0.5, 0.5, 1]) {
        const origin = kept[index].origin + delta;
        if (origin < 0 || origin > bound - span) continue;
        polishPlan.push({ index, origin });
      }
    }
    const polishWindows = await acc.scoreWindows(polishPlan.map((item) => ({
      originX: alongRows ? fixed.origin : item.origin,
      originY: alongRows ? item.origin : fixed.origin,
      spacingX: fixed.spacing,
      spacingY: fixed.spacing,
      boardSize,
    })));
    let cursor = 0;
    for (let index = 0; index < kept.length; index += 1) {
      let best = kept[index];
      let bestScore = polishWindows[cursor]?.score ?? -1;
      cursor += 1;
      for (const delta of [-1, -0.5, 0.5, 1]) {
        const origin = kept[index].origin + delta;
        if (origin < 0 || origin > bound - span) continue;
        const score = polishWindows[cursor]?.score ?? -1;
        cursor += 1;
        if (score > bestScore) {
          bestScore = score;
          best = { origin, mesh: kept[index].mesh };
        }
      }
      kept[index] = best;
    }
    moveOrderPerf.gridPhaseMs += performance.now() - tPhase;
    moveOrderPerf.gridPhaseWindows += sweepOrigins.length + polishPlan.length;
    if (debug) {
      console.info("[banbu-image-mesh]", JSON.stringify({
        alongRows,
        fixedOrigin: fixed.origin,
        spacing: fixed.spacing,
        kept,
      }));
    }
    return kept;
  };
  // Faint-line boards (minimal/pale materials, heavy glow) can fail the
  // one-dimensional comb fit entirely, leaving only junk seeds and mesh
  // scores of zero. Geometric square seeds — a centred, near-full-width
  // board — do not depend on any comb being found: they cover the realistic
  // lattice directly and still need real mesh evidence to pass.
  const geometricSeeds: CombFit[] = [];
  if (height >= side * 1.15) {
    for (const spanRatio of [0.84, 0.88, 0.92, 0.96]) {
      const span = side * spanRatio;
      geometricSeeds.push({
        origin: (side - span) / 2,
        spacing: span / (boardSize - 1),
        score: 0,
        coverage: 0.75,
      });
    }
  }
  // 相位枚举出来的候选同样攒成一批：先按原顺序把 (列→行相位)、(行→列相位)
  // 两段跑完，再统一批量评分、按原顺序重放。
  const phaseCandidates: Candidate[] = [];
  for (const column of [...columnFits.slice(0, 3), ...geometricSeeds]) {
    for (const phase of await enumeratePhases(column, true)) {
      if (phase.mesh < 0.3) break;
      const candidate: Candidate = { row: { origin: phase.origin, spacing: column.spacing, score: 0, coverage: 1 }, column, localBonus: 6 };
      phaseCandidates.push(candidate);
      if (debug) {
        const meshFull = intersectionMesh(image, column.origin, phase.origin, column.spacing, column.spacing, boardSize);
        const windowFull = scoreGridWindow(image, column.origin, phase.origin, column.spacing, column.spacing, boardSize);
        console.info("[banbu-image-phase-window]", JSON.stringify({
          y: Math.round(phase.origin * 10) / 10,
          x: Math.round(column.origin * 10) / 10,
          mesh: Math.round(phase.mesh * 1000) / 1000,
          failures: evaluateCandidate(candidate, windowFull).failures,
          rows: meshFull.rowFractions.map((fraction) => Math.round(fraction * 100) / 100),
          cols: meshFull.columnFractions.map((fraction) => Math.round(fraction * 100) / 100),
        }));
        if (windowFull) {
          console.info("[banbu-image-phase-scores]", JSON.stringify({
            y: Math.round(phase.origin * 10) / 10,
            extLine: windowFull.externalLineCount,
            extCont: Math.round(windowFull.externalContinuation * 1000) / 1000,
            border: Math.round(windowFull.borderContext * 1000) / 1000,
            star: Math.round(windowFull.starSupport * 1000) / 1000,
            score: Math.round(windowFull.score * 10) / 10,
          }));
        }
      }
    }
  }
  for (const row of rowFits.slice(0, 3)) {
    for (const phase of await enumeratePhases(row, false)) {
      if (phase.mesh < 0.3) break;
      phaseCandidates.push({ row, column: { origin: phase.origin, spacing: row.spacing, score: 0, coverage: 1 }, localBonus: 6 });
    }
  }
  await considerBatch(phaseCandidates);

  // Mobile screenshots usually show the board as a large, horizontally
  // centred square while controls occupy the space above/below it. When the
  // global detector is confused by those controls, seed several realistic
  // full-width board spans, find the horizontal comb inside each span, then
  // refine both axes inside the resulting square. These are only geometric
  // seeds: they cannot win unless real grid lines validate the complete area.
  if (height >= side * 1.15) {
    const screenLimits = { pool: 32, seeds: 12, output: 10 };
    // 两级依赖：先并行的 4 条整宽横向线梳，再并行的每个 (span, 行) 纵向精修，
    // 最后攒成一批候选。顺序（span → 行 → 居中种子优先于精修列）保持不变。
    const spans = [0.84, 0.87, 0.9, 0.93].map((spanRatio) => {
      const span = side * spanRatio;
      return { origin: (side - span) / 2, span, spacing: span / (boardSize - 1) };
    });
    const spanRowFits = await acc.fitCombs(spans.map((item) => ({
      alongX: true,
      innerStart: item.origin,
      innerEnd: item.origin + item.span,
      boardSize,
      limits: screenLimits,
      spacingRange: { minimum: item.spacing * 0.88, maximum: item.spacing * 1.12 },
    })));
    const refinePlan: Array<{ spanIndex: number; row: CombFit }> = [];
    spans.forEach((_, spanIndex) => {
      spanRowFits[spanIndex].slice(0, 6).forEach((row) => refinePlan.push({ spanIndex, row }));
    });
    const refinedFits = await acc.fitCombs(refinePlan.map(({ row }) => ({
      alongX: false,
      innerStart: row.origin - row.spacing * 0.35,
      innerEnd: row.origin + (boardSize - 1) * row.spacing + row.spacing * 0.35,
      boardSize,
      limits: screenLimits,
      spacingRange: { minimum: row.spacing * 0.88, maximum: row.spacing * 1.12 },
    })));
    const screenCandidates: Candidate[] = [];
    refinePlan.forEach(({ spanIndex, row }, index) => {
      // Also retain the centred seed when vertical grid lines are faint; the
      // window scorer still requires distributed line evidence on both axes.
      const seededColumn: CombFit = { origin: spans[spanIndex].origin, spacing: spans[spanIndex].spacing, score: 0, coverage: 0.75 };
      screenCandidates.push({ row, column: seededColumn, localBonus: 5 });
      refinedFits[index].slice(0, 8).forEach((column) => screenCandidates.push({ row, column, localBonus: 8 }));
    });
    await considerBatch(screenCandidates);
  }
  // A borrowed-edge winner (strokes still running 0.9 cells past an outer
  // line) has anchored one row/column off the real board and borrowed a
  // margin or frame line. When an unborrowed candidate scored within 10
  // points — the decoys and the true board tie inside that window — prefer
  // the clean one. Deliberately a selection tie-break, never a score term or
  // gate: photo texture (wood grain, page rules) can fire the beyond-probe on
  // a correct window, and reordering every candidate by it broke real-photo
  // recognition while a near-tie swap only arbitrates the anchored decoys.
  type GridCandidate = { row: CombFit; column: CombFit; score: number; window: GridWindowQuality };
  if (best && (best as GridCandidate).window.strokeBeyondSides > 0
    && cleanBest && (cleanBest as GridCandidate).score >= (best as GridCandidate).score - 10) {
    best = cleanBest;
  }
  // TypeScript does not track assignments performed inside consider() across
  // the callback-based local searches above, so retain the explicit runtime
  // union here instead of allowing it to narrow the value to never.
  let selected = best as { row: CombFit; column: CombFit; score: number; window: GridWindowQuality } | null;

  /**
   * 整格平移纠偏（2026-10-09，满盘图网格错位的修复）。
   *
   * 现场：**满盘棋盘**（几乎每格都有子）上，横线被棋子圆盘遮挡到线梳拟合不出来
   * （实测 `fitCombs(alongX:true)` 返回**空数组**，列方向也从 coverage 1.0 退化到 0.73）。
   * 两轴缺一条 → 选出的网格**整体偏一格**，而且 spacing 有时也错：
   *
   *   真值 (134, 254) sp 66.57  vs  识别 (66, 186) sp 66.81   ← 偏 -1 格
   *   真值 (134, 254) sp 66.57  vs  识别 (66, 166) sp 76.29   ← 偏 -1 格且 spacing 错 15%
   *   （低占用图 19/47/58 手全部正确——横线没被压住）
   *
   * 为什么偏的是「整格」而不是随机值：线梳在满盘上挑中了**棋子团的边缘**而不是真正的
   * 棋盘线，而棋子是**照格距排布**的，所以错误解与正确解恰好差整数格。
   *
   * 为什么这个后处理是安全的：它**不碰任何评分门槛**（那属于放松验收），只是拿着已有
   * 网格在 ±2 格范围内再问一次 `scoreGridWindow`，**只有严格更高分才采纳**。
   * 实测（高段位语料 self-001@1200）：
   *
   *   识别 (66,186) score 386.6 → 平移 (+1,+1) 得 (133,253) score **386.6**，rows=15 cols=15
   *                                                                ↑ 完整网格，且高于邻位
   *   （同组其它平移：k=(1,0) 380.6 / k=(1,2) 380.6 / k=(2,1) 352.9，均低于正确解）
   *
   * 即：正确解在候选函数里**本来就能评出来**，失败只在候选生成那一环（线梳空数组）。
   * 这里补上的正是「拿不到行/列线梳时，仍能把网格挪到正确相位」的那一条路。
   *
   * 代价：9 个候选 × 1 次窗口评分（<10ms），只在**仍有问题**的图上才可能改变结果。
   */
  if (selected) {
    const { row, column } = selected;
    const shifts: Array<{ row: CombFit; column: CombFit }> = [];
    for (let kx = -2; kx <= 2; kx += 1) {
      for (let ky = -2; ky <= 2; ky += 1) {
        if (kx === 0 && ky === 0) continue;
        const originX = column.origin + kx * column.spacing;
        const originY = row.origin + ky * row.spacing;
        // 平移后整块网格必须仍在画布内，否则窗口评分会给越界劣解。
        const spanX = (boardSize - 1) * column.spacing;
        const spanY = (boardSize - 1) * row.spacing;
        if (originX < 0 || originY < 0) continue;
        if (originX + spanX >= side || originY + spanY >= height) continue;
        shifts.push({
          row: { origin: originY, spacing: row.spacing, score: row.score, coverage: row.coverage },
          column: { origin: originX, spacing: column.spacing, score: column.score, coverage: column.coverage },
        });
      }
    }
    if (shifts.length) {
      const shiftWindows = await acc.scoreWindows(shifts.map((candidate) => ({
        originX: candidate.column.origin,
        originY: candidate.row.origin,
        spacingX: candidate.column.spacing,
        spacingY: candidate.row.spacing,
        boardSize,
      })));
      let bestShift = -1;
      for (let index = 0; index < shifts.length; index += 1) {
        const window = shiftWindows[index];
        if (!window) continue;
        // 只在「同样通过全部硬门」的候选之间比分数：平移解若连门都过不了，
        // 说明它不是真网格，不能因为一个虚高的分数把好的结果换掉。
        const candidate = { row: shifts[index].row, column: shifts[index].column, localBonus: 0 };
        if (evaluateCandidate(candidate, window).failures.length) continue;
        if (window.score > selected.window.score * (1 + GRID_CORRECTION_MARGIN)
          && (bestShift < 0 || window.score > (shiftWindows[bestShift]?.score ?? -1))) {
          bestShift = index;
        }
      }
      if (bestShift >= 0) {
        const window = shiftWindows[bestShift] as GridWindowQuality;
        if (debug) {
          console.info("[banbu-image-shift-fix]", JSON.stringify({
            from: { x: Math.round(column.origin), y: Math.round(row.origin), score: Math.round(selected.window.score * 10) / 10 },
            to: { x: Math.round(shifts[bestShift].column.origin), y: Math.round(shifts[bestShift].row.origin), score: Math.round(window.score * 10) / 10 },
          }));
        }
        selected = { row: shifts[bestShift].row, column: shifts[bestShift].column, score: window.score, window };
      }
    }
  }

  /**
   * 满盘图重定位（2026-10-09，第二段修复：spacing 也错的那一类）。
   *
   * 触发条件：**行方向线梳给不出候选**（`rowFits` 为空）或选出的网格行数明显不足。
   * 这正是满盘棋的特征：横线被棋子压住 → 行方向零候选 → 选出来的网格不仅偏相位，
   * spacing 也常错（实测 76.29 vs 真值 66.57，差 14.6%）。上面那段「整格平移」只能在
   * **spacing 正确**时救相位，救不了 spacing。
   *
   * 做法：既然**列方向的 spacing 是准的**（实测 66.53 vs 真值 66.57，误差 0.06%），
   * 就用它当**正方形网格的 spacing**（棋盘两轴等距），在整幅图上两阶段扫相位——
   * 先粗扫（步长 spacing/4）再在最优附近细扫（步长 spacing/12）。
   *
   * 为什么这样是安全的（与整格平移同一纪律）：
   *   · **门槛一律不动**，候选必须通过**全部硬门**（`evaluateCandidate` 零 failures）；
   *   · 只接受**分数严格更高**的解；
   *   · 实测真值网格在这类图上是**满分且稳定**的（score 389 / continuity·lineCoverage·
   *     spatialCoverage·fullLineShare 全 1.0，±2px 邻域内都是 388–389），
   *     而错误解分数显著更低——所以「取最高分」在这里有明确的可分性。
   *
   * 代价：仅在「行线梳为空」这类已经出问题的图上才跑（粗扫约 20×17 + 细扫 9×9 个窗口）；
   * 正常图（行线梳非空且行数够）**一次都不跑**，对既有 27 张基线图零影响。
   *
   * 2026-10-10 补：**两轴线梳全空**的图（实测 self-004：`rowFits=0` 且 `colFits=0`，
   * 而真值网格评分 389）原来会被 `columnFits.length` 这个前置条件挡住、整段不跑。
   * 现在两轴都空时改用**几何估计**的 spacing：按「棋盘占据画面宽度的大部分」这一
   * 常见构图，取 `side * spanRatio / (boardSize - 1)`，`spanRatio` 扫 [0.72, 0.98] 若干档，
   * 每档都走同一套（全门过滤 + 严格更高分）流程。这仍然不改任何门槛，
   * 只是把「候选生成的 seed」从线梳换成常见构图假设——多扫几档即可，代价可忽略
   * （只在两轴线梳都空时才发生）。
   */
  const needsRefine = !selected
    || rowFits.length === 0
    || selected.window.validRowCount < boardSize - 1
    || selected.window.rowContinuity < 0.68;
  // 候选 spacing：优先用列方向线梳（实测最准，误差 0.06%）；两轴都空时退回几何估计。
  const spacingSeeds: number[] = [];
  if (columnFits.length) spacingSeeds.push(columnFits[0].spacing);
  if (!spacingSeeds.length) {
    // 两轴线梳都空（满盘最极端的情况，实测 self-004/007/012）：
    // 用「棋盘占据画面短边的大部分」这一常见构图做几何估计，扫几档 spanRatio。
    const spanRatios = [0.72, 0.78, 0.84, 0.88, 0.92, 0.96, 0.98];
    for (const ratio of spanRatios) {
      const span = Math.min(side, height) * ratio;
      spacingSeeds.push(span / (boardSize - 1));
    }
    // 识别出来的（可能 spacing 错的）网格也当一档：防止把本来对的图改坏。
    if (selected) spacingSeeds.push(selected.column.spacing);
  }
  if (needsRefine && spacingSeeds.length) {
    for (const sp of spacingSeeds) {
      const span = (boardSize - 1) * sp;
      const maxX = side - span;
      const maxY = height - span;
      if (!(sp > 0 && maxX > 0 && maxY > 0)) continue;
      const phasePlan: Array<{ x: number; y: number }> = [];
      const coarseX = Math.max(1, Math.round(sp / 4));
      const coarseY = Math.max(1, Math.round(sp / 4));
      for (let x = 0; x <= maxX; x += coarseX) {
        for (let y = 0; y <= maxY; y += coarseY) phasePlan.push({ x, y });
      }
      for (const origin of [maxX]) if (Math.abs(origin - (phasePlan[phasePlan.length - 1]?.x ?? -1)) > 1) {
        for (let y = 0; y <= maxY; y += coarseY) phasePlan.push({ x: origin, y });
      }
      const coarseWindows = await acc.scoreWindows(phasePlan.map((p) => ({
        originX: p.x, originY: p.y, spacingX: sp, spacingY: sp, boardSize,
      })));
      let bestPhase: { x: number; y: number; window: GridWindowQuality } | null = null;
      for (let index = 0; index < phasePlan.length; index += 1) {
        const window = coarseWindows[index];
        if (!window) continue;
        const candidate = { row: { origin: phasePlan[index].y, spacing: sp, score: 0, coverage: 1 }, column: { origin: phasePlan[index].x, spacing: sp, score: 0, coverage: 1 }, localBonus: 0 };
        if (evaluateCandidate(candidate, window).failures.length) continue;
        if (!bestPhase || window.score > bestPhase.window.score) bestPhase = { ...phasePlan[index], window };
      }
      if (bestPhase) {
        // 细扫：在粗扫最优附近 ±sp/4，步长 sp/12，锁定亚格精度。
        const fineStep = Math.max(1, Math.round(sp / 12));
        const radius = Math.max(fineStep, Math.round(sp / 4));
        const finePlan: Array<{ x: number; y: number }> = [];
        for (let dx = -radius; dx <= radius; dx += fineStep) {
          for (let dy = -radius; dy <= radius; dy += fineStep) {
            const x = bestPhase.x + dx, y = bestPhase.y + dy;
            if (x < 0 || y < 0 || x > maxX || y > maxY) continue;
            finePlan.push({ x, y });
          }
        }
        const fineWindows = finePlan.length
          ? await acc.scoreWindows(finePlan.map((p) => ({ originX: p.x, originY: p.y, spacingX: sp, spacingY: sp, boardSize })))
          : [];
        let bestFine: { x: number; y: number; window: GridWindowQuality } | null = bestPhase;
        for (let index = 0; index < finePlan.length; index += 1) {
          const window = fineWindows[index];
          if (!window) continue;
          const candidate = { row: { origin: finePlan[index].y, spacing: sp, score: 0, coverage: 1 }, column: { origin: finePlan[index].x, spacing: sp, score: 0, coverage: 1 }, localBonus: 0 };
          if (evaluateCandidate(candidate, window).failures.length) continue;
          if (window.score > bestFine!.window.score) bestFine = { ...finePlan[index], window };
        }
        // 仍只在**严格更高分**时替换（与整格平移同一纪律；余量见 GRID_CORRECTION_MARGIN）。
        // selected 为 null（检测整体失败）时，这一档就是纯粹的「救回来」——
        // 没有任何既有解可比，只要它通过了全部硬门就采纳。
        const currentScore = selected ? selected.window.score : -Infinity;
        if (bestFine && bestFine.window.score > currentScore * (1 + GRID_CORRECTION_MARGIN)) {
          if (debug) {
            console.info("[banbu-image-refine-fix]", JSON.stringify({
              from: selected
                ? { x: Math.round(selected.column.origin), y: Math.round(selected.row.origin), sp: Math.round(selected.column.spacing * 100) / 100, score: Math.round(selected.window.score * 10) / 10 }
                : null,
              to: { x: Math.round(bestFine.x), y: Math.round(bestFine.y), sp: Math.round(sp * 100) / 100, score: Math.round(bestFine.window.score * 10) / 10 },
            }));
          }
          selected = {
            row: { origin: bestFine.y, spacing: sp, score: 0, coverage: 1 },
            column: { origin: bestFine.x, spacing: sp, score: 0, coverage: 1 },
            score: bestFine.window.score,
            window: bestFine.window,
          };
        }
      }
    }
  }

  if (debug && rejected.length) {
    console.info("[banbu-image-rejected]", JSON.stringify(rejected.slice(0, 48)));
  }
  if (debug && selected) {
    const w = selected.window;
    console.info("[banbu-image-selected]", JSON.stringify({
      score: Math.round(selected.score * 10) / 10,
      mesh: Math.round(w.intersectionSupport * 1000) / 1000,
      extLine: w.externalLineCount,
      extCont: Math.round(w.externalContinuation * 1000) / 1000,
      borrowed: w.strokeBeyondSides,
      border: Math.round(w.borderContext * 1000) / 1000,
      star: Math.round(w.starSupport * 1000) / 1000,
      texture: Math.round(w.texture * 1000) / 1000,
      color: Math.round(w.colorCoherence * 1000) / 1000,
      spatial: Math.round(w.spatialCoverage * 1000) / 1000,
      lineCov: Math.round(w.lineCoverage * 1000) / 1000,
      full: Math.round(w.fullLineShare * 1000) / 1000,
      x: Math.round(selected.column.origin * 10) / 10,
      y: Math.round(selected.row.origin * 10) / 10,
    }));
  }
  // Phase-seeded combs carry no honest one-dimensional coverage, so validate
  // the selected window by its measured per-axis evidence instead.
  if (!selected
    || selected.window.rowContinuity < 0.68
    || selected.window.columnContinuity < 0.68
    || selected.window.validRowCount < boardSize - 1
    || selected.window.validColumnCount < boardSize - 1) return null;
  return {
    originX: selected.column.origin,
    originY: selected.row.origin,
    spacingX: selected.column.spacing,
    spacingY: selected.row.spacing,
    quality: Math.min(
      1,
      Math.min(selected.window.rowContinuity, selected.window.columnContinuity) * 0.7
        + selected.window.continuity * 0.3,
    ),
  };
};

const meanPatchGray = (image: SampledImage, x: number, y: number, radius: number, excludeRadius = 0) => {
  const { gray, width, height } = image;
  const left = Math.max(0, Math.floor(x - radius));
  const top = Math.max(0, Math.floor(y - radius));
  const right = Math.min(width - 1, Math.ceil(x + radius));
  const bottom = Math.min(height - 1, Math.ceil(y + radius));
  let light = 0, saturation = 0, red = 0, green = 0, blue = 0, count = 0;
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      if (Math.hypot(px + 0.5 - x, py + 0.5 - y) > radius) continue;
      if (excludeRadius && Math.hypot(px + 0.5 - x, py + 0.5 - y) < excludeRadius) continue;
      const index = py * width + px;
      light += gray[index];
      const r = image.data[index * 4], g = image.data[index * 4 + 1], b = image.data[index * 4 + 2];
      red += r; green += g; blue += b;
      saturation += Math.max(r, g, b) - Math.min(r, g, b);
      count += 1;
    }
  }
  return {
    light: count ? light / count : 0,
    saturation: count ? saturation / count : 0,
    red: count ? red / count : 0,
    green: count ? green / count : 0,
    blue: count ? blue / count : 0,
    count,
  };
};

type Rgb = [number, number, number];

export interface IntersectionFeatures {
  stoneLike: boolean;
  markerLike: boolean;
  score: number;
  foregroundLight: number;
  foregroundColor: Rgb;
  backgroundLight: number;
  // Diagnostics for threshold tuning (surfaced only through the debug flag):
  // shape coverages per radial band plus the local decision thresholds.
  coreShare: number;
  middleShare: number;
  outerShare: number;
  discShare: number;
  ringShare: number;
  diagonalShare: number;
  /** 四象限里「changed 像素最大半径」的最小值（单位：线距）。用途：分辨「横线×竖线的
   *  十字交叉」与「有墨迹的块」——2026-09-15 实测它**不足以**单独判「真子 vs 误判」：
   *  真子 dr 0.44~0.48（书谱 heavyborder 里有一颗真子只有 0.131），而整屏语料里多出来的
   *  那几颗有 0.35~0.43；只有 fp-014 那类**纯线交叉**是 0.12。留作诊断量。 */
  diagonalReach: number;
  foregroundSaturation: number;
  foregroundDarkColor: Rgb;
  differenceThreshold: number;
  backgroundSpread: number;
  voidShare: number;
  voidMedian: Rgb;
  voidSpread: number;
  stubCount: number;
  darkDiscShare: number;
  darkBelowShare: number;
  discCoreSpread: number;
  discCoreDistance: number;
  discRawFillShare: number;
  /** 圆盘内「纸色/近底色」像素占比（亮度距底色 <40）：空心白子的内部
   *  （尽管中央印着序号）依然透光占多数，实心黑子趋近 0。2026-10-02
   *  为书谱空心白子召回新增（基准实测 blackRecall 100% / whiteRecall 4%）。 */
  interiorLightShare: number;
  /** 环闭合度：环带 (r 0.40~0.55) 按角度分 8 扇区，含墨扇区的占比。
   *  真环（空心白子）全角度闭合 ≈ 8/8；粗边框邻格只有贴边一侧 1~4/8、
   *  空线交叉只有轴向 4/8——这是把「环形证据」和「一侧有线」分开的唯一几何维度。 */
  ringSectorCoverage: number;
}

const median = (values: number[]) => {
  const count = values.length;
  if (!count) return 0;
  if (count === 1) return values[0];
  // In-place quickselect on a copy returns the exact same order statistics
  // as the previous full sort (same multiset ranks, identical float values),
  // without the sort's allocations — median(+comparator) was ~19% of
  // recognition time and a major GC driver (2026-09-11 profile).
  const work = values.slice();
  const select = (rank: number) => {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (work[mid] < work[lo]) { const t = work[mid]; work[mid] = work[lo]; work[lo] = t; }
      if (work[hi] < work[lo]) { const t = work[hi]; work[hi] = work[lo]; work[lo] = t; }
      if (work[hi] < work[mid]) { const t = work[hi]; work[hi] = work[mid]; work[mid] = t; }
      const pivot = work[mid];
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (work[i] < pivot) i += 1;
        while (work[j] > pivot) j -= 1;
        if (i <= j) { const t = work[i]; work[i] = work[j]; work[j] = t; i += 1; j -= 1; }
      }
      if (rank <= j) hi = j;
      else if (rank >= i) lo = i;
      else break;
    }
    return work[rank];
  };
  const lower = select((count - 1) >> 1);
  if (count % 2) return lower;
  return (lower + select(count >> 1)) / 2;
};

const rgbDistance = (left: Rgb, right: Rgb) => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
);

/**
 * Classify one grid intersection from its local structure instead of global
 * black/white thresholds. The diagonal annulus is just outside a normal
 * Gomoku stone and therefore estimates the board colour at this exact point,
 * even on gradient, dark or strongly coloured boards. A real stone changes a
 * broad part of the outer disc; grid lines, star points and board labels only
 * change a narrow centre stroke. This also recognises non-round notebook
 * crosses/checks because their ink reaches the outer band.
 */
/**
 * 「强饱和笔画标记」的共同判据（2026-10-07 木刻棋盘实测）：前景饱和 ≥90（黑白棋子
 * 到不了这个量级——实测真黑子 3–10、真白子 8–25、玉/雪白 30–45，而彩色字母/标注
 * 120+），同时又得是**真笔画**：中心占比 ≥0.7（墨迹集中在中心）且盘内有可见墨
 * ≥0.35（不是与背景同色的淡子）。整盘实心（盘内 ≥0.9）的饱和圆盘是彩色棋子材质，
 * 不算标记。白底照片上淡白子的 JPEG 彩边会被饱和这一条骗到（100+），但中心只有
 * 0.40–0.55、盘内 0.17–0.23，被后两条挡住——实测 remote-image2 上 32 格淡白子
 * 曾因此被误判成标记、整批补位被拦。
 */
export const isVividGlyphMarker = (foregroundSaturation: number, coreShare: number, discShare: number): boolean =>
  foregroundSaturation >= 90 && coreShare >= 0.7 && discShare >= 0.35 && discShare < 0.9;

export const analyzeIntersection = (image: SampledImage, x: number, y: number, spacing: number): IntersectionFeatures => {
  const { data, gray, width, height } = image;
  const safeSpacing = Math.max(10, spacing);
  const sampleRadius = safeSpacing * 0.68;
  const left = Math.max(0, Math.floor(x - sampleRadius));
  const top = Math.max(0, Math.floor(y - sampleRadius));
  const right = Math.min(width - 1, Math.ceil(x + sampleRadius));
  const bottom = Math.min(height - 1, Math.ceil(y + sampleRadius));
  const backgroundPixels: Rgb[] = [];
  const discPixels: Array<{ radius: number; dx: number; dy: number; rgb: Rgb; light: number }> = [];
  const ringPixels: Array<{ dx: number; dy: number; radius: number; rgb: Rgb; light: number }> = [];
  const annulusPixels: Array<{ angle: number; light: number }> = [];

  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      const dx = (px + 0.5 - x) / safeSpacing;
      const dy = (py + 0.5 - y) / safeSpacing;
      const radius = Math.hypot(dx, dy);
      const index = py * width + px;
      const rgb: Rgb = [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]];
      // Avoid the horizontal/vertical grid lines when learning the local
      // board colour. Diagonal samples also stay clear of adjacent stones.
      if (radius >= 0.48 && radius <= 0.66 && Math.abs(dx) > 0.16 && Math.abs(dy) > 0.16) {
        backgroundPixels.push(rgb);
      }
      if (radius <= 0.48) discPixels.push({ radius, dx, dy, rgb, light: gray[index] });
      if (radius >= 0.36 && radius <= 0.58 && Math.abs(dx) > 0.12 && Math.abs(dy) > 0.12) {
        ringPixels.push({ dx, dy, radius, rgb, light: gray[index] });
      }
      if (radius >= 0.4 && radius <= 0.55) annulusPixels.push({ angle: Math.atan2(dy, dx), light: gray[index] });
    }
  }

  if (backgroundPixels.length < 8 || discPixels.length < 20) {
    return {
      stoneLike: false,
      markerLike: false,
      score: 0,
      foregroundLight: 0,
      foregroundColor: [0, 0, 0],
      backgroundLight: 0,
      coreShare: 0,
      middleShare: 0,
      outerShare: 0,
      discShare: 0,
      ringShare: 0,
      diagonalShare: 0,
      diagonalReach: 0,
      foregroundSaturation: 0,
      foregroundDarkColor: [0, 0, 0] as Rgb,
      differenceThreshold: 0,
      backgroundSpread: 0,
      voidShare: 0,
      voidMedian: [0, 0, 0] as Rgb,
      voidSpread: 0,
      stubCount: 0,
      darkDiscShare: 0,
      darkBelowShare: 0,
      discCoreSpread: 0,
      discCoreDistance: 0,
      discRawFillShare: 0,
      interiorLightShare: 0,
      ringSectorCoverage: 0,
    };
  }

  const background: Rgb = [
    median(backgroundPixels.map((pixel) => pixel[0])),
    median(backgroundPixels.map((pixel) => pixel[1])),
    median(backgroundPixels.map((pixel) => pixel[2])),
  ];
  const backgroundSpread = median(backgroundPixels.map((pixel) => rgbDistance(pixel, background)));
  // Raw (threshold-free) statistics of the intersection's inner disc. The
  // adaptive change threshold is texture-driven and can exceed the contrast of
  // a subtle real stone; these medians see the fill colour directly. The core
  // band stays inside the fill (r<0.16) so outline strokes cannot pollute the
  // median, and the raw fill share demands stone-sized coverage so small solid
  // badges (move-number dots) never qualify.
  const corePixels = discPixels.filter((pixel) => pixel.radius < 0.16);
  const discCoreMedian: Rgb = corePixels.length >= 4
    ? [
        median(corePixels.map((pixel) => pixel.rgb[0])),
        median(corePixels.map((pixel) => pixel.rgb[1])),
        median(corePixels.map((pixel) => pixel.rgb[2])),
      ]
    : background;
  const discCoreSpread = corePixels.length >= 4
    ? median(corePixels.map((pixel) => rgbDistance(pixel.rgb, discCoreMedian)))
    : 0;
  const discCoreDistance = rgbDistance(discCoreMedian, background);
  const discPixelsFull = discPixels.filter((pixel) => pixel.radius < 0.43);
  const discRawFillShare = discPixelsFull.length
    ? discPixelsFull.filter((pixel) => rgbDistance(pixel.rgb, background) >= 22).length
      / discPixelsFull.length
    : 0;
  // 22 filters antialiased grid lines. The adaptive part tolerates textured
  // boards and camera noise without letting a noisy background become a stone.
  const differenceThreshold = Math.min(66, Math.max(22, backgroundSpread * 2.6 + 10));
  const changed = discPixels.map((pixel) => ({ ...pixel, changed: rgbDistance(pixel.rgb, background) > differenceThreshold }));
  // 对角触达（2026-09-15）：真棋子的圆盘会覆盖**四个对角方向**；而「横线×竖线」的十字交叉
  // 只在两条轴附近有墨迹，对角方向上是空白盘面。取四个象限里「changed 像素能到达的最大半径」
  // 的最小值（单位：线距）。这是分辨「淡色软子」与「纯线交叉」的判据——两者的径向占比几乎
  // 重叠（实测真子 out 0.39/mid 0.50 vs 交叉 0.36/0.45，卡在门槛上靠巧合），但这一项
  // 量级相差很大（真子 ~0.45，交叉 ~0.1）。
  const diagonalReach = (() => {
    let reachMin = Infinity;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as Array<[number, number]>) {
      let far = 0;
      for (const pixel of changed) {
        if (!pixel.changed) continue;
        if (pixel.dx * sx <= 0.06 || pixel.dy * sy <= 0.06) continue;
        if (pixel.radius > far) far = pixel.radius;
      }
      if (far < reachMin) reachMin = far;
    }
    return Number.isFinite(reachMin) ? reachMin : 0;
  })();
  const changedRing = ringPixels.map((pixel) => ({
    ...pixel,
    changed: rgbDistance(pixel.rgb, background) > differenceThreshold,
  }));
  // Diagonal samples one half-cell BEYOND a full-size stone: a real stone
  // ends near 0.48 of the spacing, so this band shows plain board, while the
  // interior of a sprawling light overlay (the victory banner pill) is still
  // overlay colour clear out to here and beyond.
  const voidPixels: Array<{ rgb: Rgb; changed: boolean }> = [];
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      const dx = (px + 0.5 - x) / safeSpacing;
      const dy = (py + 0.5 - y) / safeSpacing;
      const radius = Math.hypot(dx, dy);
      if (radius >= 0.55 && radius <= 0.72 && Math.abs(dx) > 0.2 && Math.abs(dy) > 0.2) {
        const index = py * width + px;
        voidPixels.push({
          rgb: [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]],
          changed: false,
        });
        voidPixels[voidPixels.length - 1].changed =
          rgbDistance(voidPixels[voidPixels.length - 1].rgb, background) > differenceThreshold;
      }
    }
  }
  const voidShare = voidPixels.length
    ? voidPixels.filter((pixel) => pixel.changed).length / voidPixels.length
    : 0;
  // Fraction of the disc clearly DARKER than the local board (40+ luminance).
  // A dark stone under a bright overlay keeps a large dark share; the body of
  // a bright overlay itself has none, whatever the board tone is.
  const darkThreshold = luminance(background[0], background[1], background[2]) - 40;
  const darkDiscPixels = discPixels.filter((pixel) => pixel.light < darkThreshold);
  const darkDiscShare = discPixels.length
    ? darkDiscPixels.length / discPixels.length
    : 0;
  // Dark pixels huddled on ONE side of the disc (the pill's drop shadow sits
  // below it) instead of around the centre (a real dark stone).
  const darkBelowShare = darkDiscPixels.length
    ? darkDiscPixels.filter((pixel) => pixel.dy > 0.1).length / darkDiscPixels.length
    : 0;
  const voidMedian: Rgb = voidPixels.length
    ? [
        median(voidPixels.map((pixel) => pixel.rgb[0])),
        median(voidPixels.map((pixel) => pixel.rgb[1])),
        median(voidPixels.map((pixel) => pixel.rgb[2])),
      ]
    : [0, 0, 0];
  const voidSpread = voidPixels.length
    ? median(voidPixels.map((pixel) => rgbDistance(pixel.rgb, voidMedian)))
    : 0;
  // Grid-line stubs: a real stone interrupts the grid but the lines re-emerge
  // just outside its rim along the board axes (off-board axes are skipped).
  // Overlay elements floating ON the board — the victory pill and its badge —
  // hide the lines completely, so zero stubs marks a floating object.
  const stubDistance = safeSpacing * 0.66;
  let stubCount = 0;
  const stubPoints: Array<[number, number, boolean]> = [
    [x, y - stubDistance, true],
    [x, y + stubDistance, true],
    [x - stubDistance, y, false],
    [x + stubDistance, y, false],
  ];
  for (const [sx, sy, alongX] of stubPoints) {
    if (sx < 2 || sy < 2 || sx >= width - 2 || sy >= height - 2) continue;
    if (directionalLineEvidence(gray, width, height, sx, sy, alongX) >= 0.35) stubCount += 1;
  }
  const share = (minimum: number, maximum: number) => {
    const band = changed.filter((pixel) => pixel.radius >= minimum && pixel.radius < maximum);
    return band.length ? band.filter((pixel) => pixel.changed).length / band.length : 0;
  };
  const coreShare = share(0, 0.24);
  const middleShare = share(0.24, 0.36);
  const outerShare = share(0.36, 0.48);
  const discShare = share(0, 0.43);
  const ringShare = changedRing.length
    ? changedRing.filter((pixel) => pixel.changed).length / changedRing.length
    : 0;
  const ringSectors = new Set(
    changedRing
      .filter((pixel) => pixel.changed)
      .map((pixel) => Math.floor((Math.atan2(pixel.dy, pixel.dx) + Math.PI) * 8 / Math.PI) % 16),
  ).size;
  const diagonalRing = changedRing.filter((pixel) => Math.abs(Math.abs(pixel.dx) - Math.abs(pixel.dy)) < 0.17);
  const diagonalShare = diagonalRing.length
    ? diagonalRing.filter((pixel) => pixel.changed).length / diagonalRing.length
    : 0;
  const diagonalQuadrants = new Set(
    diagonalRing
      .filter((pixel) => pixel.changed && Math.abs(pixel.dx) > 0.1 && Math.abs(pixel.dy) > 0.1)
      .map((pixel) => `${pixel.dx < 0 ? 0 : 1}${pixel.dy < 0 ? 0 : 1}`),
  ).size;
  const foreground = changed.filter((pixel) => pixel.changed && pixel.radius < 0.4);
  const markerSaturation = foreground.length
    ? median(foreground.map((pixel) => Math.max(...pixel.rgb) - Math.min(...pixel.rgb)))
    : 0;
  // The test matrix deliberately places a red circle and a blue letter on
  // empty intersections. They are compact, highly saturated marks with no
  // broad outer disc; identify that shape before low-contrast stone rules can
  // promote it to a dark stone.
  // Annotation marks are SMALL: their ink never reaches the outer band and
  // the whole mark stays under half the disc. Colored stone materials (the
  // notebook check marks are fully saturated red) share the saturation, so a
  // generous 0.35/0.62 boundary kept flipping them to "marker".
  const compactMarker = markerSaturation >= 34
    && coreShare >= 0.42
    && outerShare < 0.32
    && ringShare < 0.18
    && discShare < 0.52;

  // Outer-band coverage is the strongest discriminator: across the built-in
  // round, jewel, kawaii, aurora, snow, terminal and notebook materials a
  // stone occupies at least half of this band, while lines/labels stay narrow.
  const broadStone = outerShare >= 0.38
    && discShare >= 0.54
    && (coreShare >= 0.5 || middleShare >= 0.55);
  // Bright ice/porcelain rims can make the local background estimate noisy;
  // their centre contrast drops, but the outer stone ring remains dominant.
  const rimStone = outerShare >= 0.6
    && discShare >= 0.5
    && Math.max(coreShare, middleShare) >= 0.38;
  // Grid fitting can be a few raster pixels off on very dark boards whose
  // lines blend into the background. In that case one side of the outer band
  // misses the stone, but the core and total disc remain densely covered.
  // Empty intersections never cover this much of the complete disc.
  const offsetStone = outerShare >= 0.28
    && discShare >= 0.62
    && coreShare >= 0.72
    && middleShare >= 0.55;
  // Notebook crosses/checks are intentionally sparse rather than circular.
  // Their ink fills the core and middle bands but only part of the outer ring.
  // Notebook crosses/checks are intentionally sparse rather than circular.
  // Their ink fills the core and most of the middle band but only part of the
  // outer ring; 0.62 excluded the check-mark material by two hundredths.
  const strokeStone = outerShare >= 0.2
    && discShare >= 0.56
    && coreShare >= 0.6
    && middleShare >= 0.58;
  // Dark classic/black-gold stones can have a board-coloured interior and only
  // a thin illuminated perimeter. Terminal X stones are sparse too, but their
  // four diagonal arms reach the same outer band. Both patterns are much more
  // structured than a star point or a single coloured annotation stroke.
  // Keep the perimeter rule deliberately strict. A nearby stone can bleed
  // into a loose annulus when the fitted phase is a fraction of a pixel off;
  // requiring a nearly complete ring and enough inner evidence avoids turning
  // that bleed into a second stone.
  const terminalRingStone = ringShare >= 0.21
    && ringSectors >= 14
    && outerShare >= 0.47
    && coreShare >= 0.14;
  const metalRingStone = ringShare >= 0.17
    && ringSectors >= 14
    && outerShare >= 0.38
    && middleShare >= 0.17
    && (coreShare >= 0.1 || diagonalShare >= 0.2);
  // On a black-gold board, classic and Yun black stones may have almost no
  // visible perimeter. Their filled centre and middle band are still broad,
  // unlike star points or thin annotations.
  // Ink/snow-outline stones are HOLLOW: a light fill with a grey-blue rim.
  // Their centre matches the board (low core), while the rim lights up the
  // middle band, outer band and diagonal ring at once — a combination an
  // empty intersection or a star dot never produces.
  const hollowStone = coreShare >= 0.15
    && coreShare < 0.4
    && middleShare >= 0.5
    && outerShare >= 0.44
    && ringShare >= 0.25
    && diagonalShare >= 0.3;  const extendedForeground = foreground.length >= 4
    ? foreground
    : changedRing.filter((pixel) => pixel.changed && pixel.radius < 0.56);
  const foregroundLight = foreground.length
    ? median(foreground.map((pixel) => pixel.light))
    : extendedForeground.length
      ? median(extendedForeground.map((pixel) => pixel.light))
    : median(discPixels.filter((pixel) => pixel.radius < 0.24).map((pixel) => pixel.light));
  const foregroundColor: Rgb = extendedForeground.length
    ? [
        median(extendedForeground.map((pixel) => pixel.rgb[0])),
        median(extendedForeground.map((pixel) => pixel.rgb[1])),
        median(extendedForeground.map((pixel) => pixel.rgb[2])),
      ]
    : background;
  const foregroundSaturation = extendedForeground.length
    ? median(extendedForeground.map((pixel) => Math.max(...pixel.rgb) - Math.min(...pixel.rgb)))
    : 0;
  // Colour of the darkest 30% of the foreground: on glow-heavy boards the
  // median of a dark stone's foreground mixes in halo pixels and drifts teal,
  // which then clusters the stone with the pale materials. The dark quartile
  // recovers the stone's own colour; for bright stones it is unused.
  const foregroundDarkColor: Rgb = extendedForeground.length
    ? (() => {
        const ordered = extendedForeground.slice().sort((left, right) => left.light - right.light);
        const darkest = ordered.slice(0, Math.max(2, Math.ceil(ordered.length * 0.3)));
        return [
          median(darkest.map((pixel) => pixel.rgb[0])),
          median(darkest.map((pixel) => pixel.rgb[1])),
          median(darkest.map((pixel) => pixel.rgb[2])),
        ];
      })()
    : background;
  // On a black-gold board, classic and Yun black stones may have almost no
  // visible perimeter. Their filled centre and middle band are still broad,
  // unlike star points or thin annotations. Real dark stones are strongly
  // desaturated (black ≈ 10-20, navy ink ≈ 18-21, dark green ≈ 35); the
  // outline-cased annotation letters land around 45-55.
  // Terminal O stones are a LARGE thin ring parked in the outer band: the
  // centre and the middle band stay empty while the outer band and diagonal
  // ring light up. Annotation circles render smaller (their ring crosses the
  // middle band), so the near-empty middle band is what separates them.
  const outerRingStone = coreShare < 0.2
    && middleShare <= 0.2
    && outerShare >= 0.42
    && ringShare >= 0.25
    && diagonalShare >= 0.25;
  const darkBoard = luminance(background[0], background[1], background[2]) < 110;
  const darkSolidStone = darkBoard
    && foregroundSaturation < 40
    && coreShare >= 0.3
    && middleShare >= 0.24
    && discShare >= 0.22
    && outerShare < 0.28;
  const backgroundLightValue = luminance(background[0], background[1], background[2]);
  // 内部透光占比（2026-10-02）：圆盘内亮度接近底色的像素占比。空心白子的内部
  // 就是纸色（中央序号笔画只是少数），实心黑子趋近 0；实心浅色子同样高，但
  // 颜色分类交给下游——检测只关心「透光圆盘 + 环」这个几何。
  const interiorLightShare = discPixels.length
    ? discPixels.filter((pixel) => Math.abs(pixel.light - backgroundLightValue) < 40).length / discPixels.length
    : 0;
  // 环闭合度（2026-10-02）：环带按角度分 16 桶，取**最长连续含墨弧**占比。
  // 扇区计数在粗线盘上被轴线+边角渗染凑满（实测 heavyborder 空交叉 5~8/8），
  // 分不开「真环」与「轴线拼盘」；连续弧不会：空心白子的环是一条闭合曲线
  // （≈0.9~1.0），线交叉的墨只在 4 个轴向段（≈0.25~0.5）。
  const BINS = 16;
  const binInk = new Uint8Array(BINS);
  const binTot = new Uint8Array(BINS);
  for (const pixel of annulusPixels) {
    const bin = Math.min(BINS - 1, Math.max(0, Math.floor(((pixel.angle + Math.PI) / (Math.PI * 2)) * BINS)));
    binTot[bin] += 1;
    if (Math.abs(pixel.light - backgroundLightValue) > 25) binInk[bin] += 1;
  }
  const binHit = new Uint8Array(BINS);
  let inkedTotal = 0;
  for (let b = 0; b < BINS; b += 1) {
    if (binTot[b] > 0 && binInk[b] / binTot[b] >= 0.25) { binHit[b] = 1; inkedTotal += 1; }
  }
  let ringSectorCoverage = 0;
  if (inkedTotal) {
    // 环形最长连续段：复制一份绕回起点处理环形回绕。
    const doubled = Uint8Array.from([...binHit, ...binHit]);
    let run = 0;
    let best = 0;
    for (let i = 0; i < doubled.length; i += 1) {
      run = doubled[i] ? run + 1 : 0;
      if (run > best) best = run;
      if (best >= BINS) { best = BINS; break; }
    }
    ringSectorCoverage = Math.min(1, best / BINS);
  }
  // Printed / notation-paper white stones: a thin dark circle outline with a
  // paper-lit interior, and — the reason every detector above misses them — a
  // dark MOVE NUMBER printed inside. The numeral lifts the core's dark share
  // to 0.3-0.6, so outerRingStone's `coreShare < 0.2` and hollowStone's
  // `middleShare >= 0.5` both fail even though the outer band carries a
  // complete ring. Identify them by the pairing instead: the middle band stays
  // empty (nothing fills the stone), while the outer band and the diagonals
  // both catch the outline. Empty crossings measure outerShare ≈ 0.06, and a
  // solid black stone fills the middle band (> 0.9), so neither can reach here.
  // Thresholds stay strict here; the slack for weaker captures lives in the
  // neighbour-gated rescue after the candidate scan.
  const printedHollowStone = !darkBoard
    && middleShare <= 0.26
    && outerShare >= 0.36
    && ringShare >= 0.17
    && diagonalShare >= 0.2;
  // 内部透光的空心/浅色环子（2026-10-02 基准实测：书谱空心白子召回 4%）：
  // printedHollowStone 的 middleShare ≤ 0.26 会被「中央印的大号序号笔画」
  // 打破——书谱棋子中央的数字把中带墨迹占比顶到 0.3~0.5，旧判据整批漏掉。
  // 改判「纸色透光占多数 + 外带环 + 对角可见」：序号笔画在环带之外，
  // 注释字母没有完整外环，轴线十字交叉没有对角墨迹，三者都进不来。
  const lightHollowStone = !darkBoard
    // At small raster sizes the printed numeral clips a few paper pixels from
    // the interior.  The complete annulus/diagonal gates below remain strict,
    // so lowering this geometric share from 0.55 to 0.52 only rescues softened
    // hollow whites; empty crossings and solid dark stones still fail by a wide
    // margin.
    && interiorLightShare >= 0.52
    && outerShare >= 0.3
    && ringShare >= 0.15
    && diagonalShare >= 0.18
    && ringSectorCoverage >= 0.75
    && darkDiscShare < 0.65
    && foregroundSaturation < 60;
  // Pale-fill stones (jade/snow bright materials on mid-tone boards) fade
  // out before the outer band: the bright core and middle band carry the
  // signal, and the fill must be clearly LIGHTER than the local board. The
  // ring requirement keeps centre-cased annotation letters (whose ink never
  // reaches the ring band at all) out; a real fill always grazes it.
  const brightStone = coreShare >= 0.75
    && middleShare >= 0.5
    && (discShare >= 0.54 || (differenceThreshold >= 35 && discShare >= 0.5))
    && outerShare < 0.45
    && ringShare >= 0.1
    && foregroundLight - backgroundLightValue >= 25;
  // Soft-edged pale fills on textured light boards (notebook cream stones):
  // the paper noise caps the difference threshold, so the disc coverage stays
  // partial. Requires a clearly BRIGHTER fill reaching the core and a ring
  // presence (annotation letters have neither).
  // 2026-09-15 记录（「恰好多一颗子」那一类，100 图整屏诚实成绩里 9 例、8 例 dpr1）：
  // 暗盘 + **亮网格线**的主题（aurora/emerald/jade 等）上，一条横线与一条竖线的十字交叉
  // 也会满足下面这组占比，被读成一颗并不存在的淡色软子（ASCII 逐格已确认那些地方只有线）。
  // 试过在这里补一条「外圈 ≥0.5 或中带 ≥0.6」把它们挡掉：整屏语料确实多对 4 例，
  // **但审计发现它同时吃掉了 heavyborder.png 上一颗真白子**（I11：out=0.39、mid=0.50，
  // 而线交叉是 out=0.36、mid=0.45 —— 两者几乎重叠，这个阈值是巧合不是判据），故已回退。
  // 要真正分开这两类，得换一个维度：**对角方向上的墨迹长度**。注意不能用量轴向——
  // 交叉点上沿 ±x/±y 走恰好是顺着那两条线走，长度一样很长，分不开；而对角（45°/135°…）
  // 在交叉点上是空盘面（离两条线都有 ~0.3×线距的垂直距离），真棋子则被直径 ≈0.8~0.9×线距
  // 的实心圆盘覆盖。所以从格心沿四个对角方向量「连续超过自适应阈值的长度」，取最小值/线距：
  // 真子 ≈0.4+，纯线交叉 ≈0（顶多 1~2px 的线宽重叠）。量级差开一个数量级，是可用的判据。
  const paleSoftStone = coreShare >= 0.6
    && middleShare >= 0.35
    && discShare >= 0.45
    && ringShare >= 0.15
    && foregroundSaturation < 60
    && foregroundLight - backgroundLightValue >= 40;
  // Soft dark fills on light boards (snow/pale blue materials): the mirror of
  // paleSoftStone, with the middle band carrying the coverage.
  const softDarkStone = coreShare >= 0.55
    && middleShare >= 0.7
    && discShare >= 0.55
    && backgroundLightValue - foregroundLight >= 40;
  // Subtle filled discs that the adaptive change threshold never separates:
  // kawaii porcelain white on pink paper (~40 RGB units), blue-rimmed
  // porcelain whose fill stays under the texture-inflated threshold. The fill
  // is self-consistent while an empty intersection averages in grid-line ink
  // or page noise, and its colour sits clearly off the local board (~22+ RGB)
  // without annotation-level saturation. The raw fill share demands
  // stone-sized coverage — a real fill reaches the rim (0.9+ of the disc)
  // while the pill's badges and icons stop around 0.6-0.75. Textured paper
  // caps the self-consistency around 16-21, so a second tier admits up to 26
  // when the fill sits far enough off the board (30+); empty crossings never
  // reach that colour distance. Dark boards are excluded: their glow
  // gradients mimic a coherent shift.
  const coherentDiscStone = !darkBoard
    && discRawFillShare >= 0.8
    && foregroundSaturation < 50
    && voidShare <= 0.35
    && ((discCoreSpread <= 18 && discCoreDistance >= 22)
      || (discCoreSpread <= 26 && discCoreDistance >= 30));
  // Muted filled discs on light boards (notebook cream, porcelain yun): soft
  // grey fills whose ink lives in the middle band while the core blends back
  // toward the board, so the change-based shares hover just under the
  // hollowStone bar. The dark-disc share anchors them physically: a real muted
  // fill keeps ~40% of the disc clearly darker than the board, while an empty
  // crossing's grid ink stays near 0.2 and annotation strokes stay saturated.
  const mutedDiscStone = darkDiscShare >= 0.3
    && coreShare >= 0.1
    && coreShare < 0.4
    && middleShare >= 0.44
    && outerShare >= 0.42
    && ringShare >= 0.25
    && diagonalShare >= 0.3
    && foregroundSaturation < 50;
  const rawStoneLike = broadStone
    || rimStone
    || offsetStone
    || strokeStone
    || hollowStone
    || brightStone
    || paleSoftStone
    || softDarkStone
    || printedHollowStone
    || lightHollowStone
    || coherentDiscStone
    || mutedDiscStone
    || outerRingStone
    || terminalRingStone
    || metalRingStone
    || darkSolidStone;
  // Real pale stones (jade ≈ 40, snow ≈ 30-45) sit just above the old 34
  // threshold; actual coloured annotations are far more saturated (120+).
  // 强饱和标记（2026-10-07 木刻棋盘实测新增）：**黑白棋子的前景饱和到不了 90**
  // （实测真黑子 3–10、真白子 8–25；上面记的玉/雪白也在 30–45），而棋盘上的彩色
  // 字母/标记都在 120 以上。大号彩色标记会把下面那四条形状门**各差 0.01 擦过去**
  // ——实测红字「A」：饱和 142、盘内 0.64（门是 <0.52）、外带 0.32（门是 <0.32）、
  // 环带 0.19（门是 <0.18）、中心 0.94（门 ≥0.38 ✓），旧写法于是把它收进了
  // stoneLike（用户报「棋盘上的 A 被当成棋子」）。
  // 但判据必须要求**真笔画**：白底照片上「淡白子」的边缘在 JPEG 里带彩边，饱和
  // 也能到 100+，可它们中心占比只有 0.40–0.55、盘内墨迹 0.17–0.23（子面与白底
  // 几乎同色）——真正的彩色字母/标记则是中心 0.94、盘内 0.64。所以收成
  // 「中心 ≥0.7 且盘内有可见墨 ≥0.35」，把彩边噪声挡在门外（见 isVividGlyphMarker）。
  const vividMarker = isVividGlyphMarker(foregroundSaturation, coreShare, discShare);
  const coloredMarker = compactMarker || vividMarker || (foregroundSaturation >= 50
    && coreShare >= 0.38
    && outerShare < 0.32
    && ringShare < 0.18
    && (discShare < 0.52
      // On dark boards the board-coloured letter halo fattens the disc share
      // of axis labels past the light-board bar (walnut snow theme): the halo
      // is board-adjacent ink, not a stone fill, and the saturation plus the
      // thin ring still give it away.
      || (darkBoard && discShare < 0.65)));
  // A bright fill whose colour keeps going past the stone boundary half a
  // cell out is the interior of a sprawling overlay (the "five in a row"
  // victory pill), not a stone; real stones — however pale — end at their
  // rim and the band beyond shows the board. The band must also be
  // UNIFORMLY the fill colour: textured boards (notebook ruling) light their
  // void band up too, but as a mixture, not as one flat colour.
  const sprawlingLight = foregroundLight >= 195
    && voidShare >= 0.4
    && voidSpread < 28
    && rgbDistance(voidMedian, foregroundColor) < 30;
  // 棋盘边缘被切断的半圆亮斑（悬浮球/反光/木纹结疤）：圆盘占比明显低于完整
  // 棋子（真实白子 ≥0.96）、暗像素几乎全堆在下半部（上半亮下半暗=半圆结构）、
  // 但填充仍是实心亮色——不是棋子。实测用户整屏截图右上角稳定两颗假白子。
  const splitEdgeBlob = foregroundLight >= 180
    && discShare < 0.9
    && darkBelowShare > 0.8
    && discRawFillShare >= 0.85;
  const stoneLike = !coloredMarker && rawStoneLike && !sprawlingLight && !splitEdgeBlob;
  const markerLike = coloredMarker || (!stoneLike
    && coreShare >= 0.42
    && outerShare < 0.32
    && foregroundSaturation >= 34);
  const score = Math.max(0, Math.min(1,
    outerShare * 0.45
    + discShare * 0.25
    + Math.max(coreShare, middleShare) * 0.12
    + ringShare * 0.1
    + diagonalShare * 0.08,
  ));

  return {
    stoneLike,
    markerLike,
    score,
    foregroundLight,
    foregroundColor,
    backgroundLight: backgroundLightValue,
    coreShare,
    middleShare,
    outerShare,
    discShare,
    ringShare,
    diagonalShare,
    diagonalReach,
    foregroundSaturation,
    foregroundDarkColor,
    differenceThreshold,
    backgroundSpread,
    voidShare,
    voidMedian,
    voidSpread,
    stubCount,
    darkDiscShare,
    darkBelowShare,
    discCoreSpread,
    discCoreDistance,
    discRawFillShare,
    interiorLightShare,
    ringSectorCoverage,
  };
};

/**
 * 印谱空心白子：一圈细描边 + 纸面亮的圈内 + 盘面本来就亮。
 *
 * 为什么单独立一个谓词：这类子的 `foregroundColor`（前景墨色中值）统计到的正是
 * 那圈深色描边，所以**任何一个「前景够不够亮」的判据都会把它判成黑子**——线上
 * 手机就是这样（白子变黑子）：柔化后描边中值掉到 128 以下，而 2-means 聚类用的
 * 也是同一个前景色，同样把它拉向黑簇。桌面同一张图能对，只是因为清晰图上描边中值
 * 刚好还在阈值以上，属于运气，不是判据。
 *
 * 这个签名本身就是「白」的几何证据：实心黑子的暗面占比 0.8+、中带几乎全暗，
 * 两条都过不了中带门与 darkDiscShare 门（实测空心白子描边占 0.33）。所以命中
 * 签名的格子按白子处理，不再依赖聚类质量或设备的渲染亮度。
 */
const isHollowPrintedStone = (features: IntersectionFeatures): boolean =>
  features.backgroundLight >= 110
  && features.middleShare <= 0.28
  && features.outerShare >= 0.34
  && features.ringShare >= 0.15
  && features.diagonalShare >= 0.18
  && features.foregroundSaturation < 50
  && features.darkDiscShare < 0.5
  && !features.markerLike;

// A softened book capture can leave the printed ring just under the normal
// outer-band threshold (about 0.30 instead of 0.34).  A complete annulus and
// a paper-lit interior are stronger evidence than that small coverage loss;
// keep this stricter rescue separate so ordinary hollow/line-like candidates
// still use the neighbour gate below.
const isStrongPrintedHollowRescue = (features: IntersectionFeatures): boolean =>
  features.backgroundLight >= 110
  && features.interiorLightShare >= 0.7
  && features.outerShare >= 0.27
  && features.ringShare >= 0.15
  && features.diagonalShare >= 0.18
  && features.ringSectorCoverage >= 0.9
  && features.darkDiscShare < 0.5
  && features.foregroundSaturation < 130;

/**
 * Move-number recovery by analysis-by-synthesis. The app paints each number as
 * SVG text (App.tsx Board): font `700 …px ui-monospace, monospace`, size
 * max(8, 0.64r)·scale with r = 0.43·gap, text-anchor middle; on a 15-line
 * board the font is 0.2752·spacing. The newest move gets a stroked, tinted
 * variant. Because recognition runs in the same browser engine that rendered
 * the screenshot, we rasterize every candidate string with that exact font at
 * the observed size and score it with normalized cross-correlation against a
 * 4× supersampled window — a 5×7 dot-matrix collapses every small antialiased
 * glyph into "1", real font templates do not.
 *
 * Self-alignment: the grid anchor may be off by a few px (fallback geometry
 * drifts up to ±4 px toward the board edge) and the ink placement inside it is
 * only approximately known. So per stone we first locate the number's own ink
 * centroid (disc level from an annulus that never contains ink; peak from the
 * inner circle), then place each template by its ink centroid (identical font
 * ⇒ identical centroid) and search only a small residual offset. Candidates
 * are bounded by the number of stones on the board and box sums use integral
 * images, keeping the pass fast even on 117-stone screenshots.
 */
const MOVE_NUMBER_SUP = 4;                  // supersampling factor for matching
const MOVE_NUMBER_FONT_RATIO = 0.2752;      // font px per grid spacing (15路 geometry)
/** 盘内墨迹相对子面本体的最低对比差：低于它就认定「这颗子上没有印刷序号」。
 *  取值依据见 matchMoveNumbers 里用到它处的实测注释。 */
const MOVE_NUMBER_MIN_INK_SPREAD = 70;
interface MoveNumberTemplate {
  w: number; h: number;
  icx: number; icy: number;                 // ink centroid inside the bitmap, sup px
  ax: number; ay: number;                   // advance/baseline anchor, sup px
  bh: number;                               // full alpha>0 ink height, sup px
  ink: Int32Array;                          // coverage>=0.5 indices (row-major)
  inkX: Int16Array;                         // column/row of each ink pixel, precomputed
  inkY: Int16Array;                         // (scoreAt is the top hotspot; this removes
                                            //  a division and a floor per ink pixel)
  minX: number; maxX: number;               // ink bbox inside the bitmap. scoreAt uses it
  minY: number; maxY: number;               // to skip the per-pixel bounds check entirely
                                            // whenever the whole ink block lands inside the
                                            // window — the common case for every offset.
  mean: number; norm: number;
  /** 按窗口宽 `sw` 预存的墨迹线性偏移（2026-10-10）：`off[i] = inkY[i] * sw + inkX[i]`。
   *  scoreAt 是全管线最大热点（密盘 54 万次调用 × ~600 墨迹像素 ≈ 3.2 亿次内层迭代），
   *  内层原本每像素要一次乘法 + 两次数组读取，现在只剩一次加法 + 一次读取。
   *  **逐位不变**：off[i] 与原表达式的整数值相同，累加顺序与加数序列都不变
   *  （整数乘法无误差、浮点求和顺序未动）→ `dot` 逐位相同。
   *  sw 在同一张图内恒定，所以按 sw 缓存一次即可；用属性比较而非 Map 查找
   *  （54 万次调用的内层，一次哈希都是实打实的成本）。 */
  off?: Int32Array;
  offSw?: number;
}
const moveNumberTemplateCache = new Map<string, MoveNumberTemplate | null>();
// 一次扫描按 value=1..limit 逐个取模板（模板渲染要走 canvas + 字符串 key）。同一幅图里
// 每个 (family, size, bold) 会被上百颗子重复扫，所以再挂一层「按 value 直接下标」的行缓存：
// 全局缓存照旧管对象，行缓存只存引用，命中后热循环里不再有字符串拼接与 Map 查找。
// 惰性填充（取到才渲染），early-accept 提前退出的扫描不会为用不到的 value 付渲染成本。
const moveNumberSweepCache = new Map<string, Array<MoveNumberTemplate | null | undefined>>();
/**
 * 诊断用累计器：识谱分阶段耗时 + 序号扫描的工作量。批处理取证脚本
 * （`qa/.tmp-zcode-perf225.mjs`）读它来定位「225 手要几十秒」到底花在哪一段，
 * 正常识别只付几次时间戳与整数自增的成本。每次 `recognizeBoardImage` 开头清零
 * （所以并发跑多张时这份计数互相覆盖，仅供单张取证使用）。
 */
export const moveOrderPerf = {
  decodeMs: 0, detectMs: 0, gridMs: 0, combMs: 0, cellFeatMs: 0, digitMs: 0, digitHeadMs: 0, boardScanMs: 0, assignMs: 0,
  gridWindows: 0, wEarly: 0,
  stones: 0, sweeps: 0, sweepValues: 0, templateBuilds: 0, rowClears: 0, flatClears: 0,
  probeMedian: -1, probeLegible: -1, probeSkipped: false,
  // 读号段内部分段（2026-10-09，真机「复原几十秒」定位）：读号段（digitMs）里模型
  // 读号只有几毫秒，其余几乎全是模板匹配。这里把它再切成三块，供剪枝定靶：
  //   renderMs = 模板**渲染**（canvas + fillText + getImageData，只在缓存未命中时发生）；
  //   sweepMs  = 模板**评分**（scoreAt 的点积与积分图查询）；
  //   scoreCalls = scoreAt 调用次数（= 扫描次数 × 值域 × 偏移组合数）。
  renderMs: 0, sweepMs: 0, scoreCalls: 0, templateCalls: 0, distinctSizes: 0,
  /** 模板段并行（2026-10-10）：并行回填耗时与并行处理的棋子数。
   *  用于确认「并行真的发生了」以及量化收益（对照 sweepMs 的下降）。 */
  parallelScoreMs: 0, parallelScoreStones: 0,
  /** 逐级升格各自跑了几次扫描（2026-10-09，回答「上一轮砍的家族上限为什么没效果」）：
   *  下标 0=首查（tryFamily 名义尺度）、1=族投票、2=第二阶段宽尺度、3=第三阶段换族逃逸、
   *  4=第四阶段加粗。上一轮把「族池上限 6」只加在**投票**上，若主要成本在 3（逃逸）
   *  就完全没被削到——这个计数器就是用来摊开这件事的。 */
  sweepsByStage: [0, 0, 0, 0, 0],
  sweepStage: 0,
  // 网格检测内部分段（2026-10-08，为「导入最大的单项」定位剪枝点）：
  // 候选批次（考虑 considerBatch 的窗评分）与相位枚举（enumeratePhases 的网格普查+精修），
  // 以及各自评分的窗口数。剩下的就是线梳拟合、局部种子与相位精修。
  gridBatchMs: 0, gridBatchWindows: 0, gridPhaseMs: 0, gridPhaseWindows: 0,
};
// 密集盘的序号探针：先只读前若干颗子，用它们的首选匹配分中位数判断「这条通道还有
// 没有产出」，读不动就停下来。2026-10-05 满盘实测：169 子时序号段 76.6s、读出 0 个号
// （相邻子的墨迹落进采样窗，NCC 全线塌掉）——76 秒换一句「没认出来」是不合格的。
// 探针只花 12/n 的预算，且只在子数很多时才允许生效（小盘本来就不贵，不值得冒险）。
// 阈值可由 `__BANBU_MOVE_PROBE_FLOOR__` 覆盖，只为了同一份构建上做 A/B 取证。
const MOVE_PROBE_SAMPLES = 12;
const MOVE_PROBE_MIN_STONES = 40;
// 占用率门：探针只在「棋盘真的挤」时生效。2026-10-06 真实图回归证明只看子数会误伤——
// paper02.jpg / user-99-43.jpg 各 43 子（占 225 格不到 20%），前 12 颗采样恰好落在没印号
// 的区域，被探针判成「读不出」，把本来能读的 6 个号也丢了。满盘那种 169~176 子
// （占用 0.75+）才是邻子墨迹互相污染、序号通道整体失效的场景。
const MOVE_PROBE_MIN_OCCUPANCY = 0.5;
const MOVE_PROBE_DEFAULT_FLOOR = 0.55;
/** 取（必要时建）某个 (family, size, bold) 在本次 limit 下的模板行。行内单元是惰性填的：
 *  `undefined`＝还没取过，`null`＝渲染失败（与全局缓存同样的语义）。 */
const moveNumberTemplateRow = (family: string, size: number, bold: boolean, limit: number) => {
  const key = `${family}|${size.toFixed(2)}|${bold ? "b" : ""}|${limit}`;
  let row = moveNumberSweepCache.get(key);
  if (!row) {
    if (moveNumberSweepCache.size > 300) { moveNumberSweepCache.clear(); moveOrderPerf.rowClears += 1; }
    row = new Array<MoveNumberTemplate | null | undefined>(limit);
    moveNumberSweepCache.set(key, row);
  }
  return row;
};

// Screenshots usually come from this very app on the same device, so the
// default family is exact. But a shot taken on another phone (or an older
// WebView) renders ui-monospace as a different face (Droid Sans Mono /
// Roboto Mono on Android, SF Mono on iOS, Cascadia on Windows). To stay
// useful across devices, the first stones of each image VOTE for the mono
// family that best explains the digits, and every later stone matches with
// that family first (weak stones still escape to the others).
// Family 0 must be the app's OWN CSS stack: canvas resolves
// `ui-monospace, monospace` to exactly the same face the app's SVG text
// renders on the same device (verified by advance-width probe), so
// same-device screenshots match pixel-perfectly. The remaining entries name
// the real faces other platforms map ui-monospace to (Cascadia/Consolas on
// Windows, Roboto/Droid Sans Mono on Android, SF Mono/Menlo on Apple,
// DejaVu/Noto on Linux, Courier New as the thick classic) — a screenshot
// taken on a different device escalates to the family that fits it. Unknown
// names in a stack just skip to the next entry, so each stack is safe
// everywhere.
const MOVE_NUMBER_FAMILIES = [
  "ui-monospace, monospace",
  "Cascadia Mono, Consolas, monospace",
  "Roboto Mono, Droid Sans Mono, monospace",
  "SF Mono, Menlo, monospace",
  "DejaVu Sans Mono, Noto Sans Mono, monospace",
  "Consolas, monospace",
  "Courier New, monospace",
  // 比例字体（2026-10-02 基准实测：书谱/外部 App 的序号多不是等宽体，
  // 7 个等宽族对它们全部 0 命中——paper10 0/66 的根因）。族投票会在
  // 前 3 颗子内锁定，这里多出的族只在投票期多付几次扫描。
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  "Arial, Helvetica, sans-serif",
  // Keep the generic CSS families themselves: external diagrams often use
  // `sans-serif`/`serif` directly, and a named fallback can resolve to a
  // different installed face on Android or the headless benchmark browser.
  "sans-serif",
  "'DejaVu Sans', 'Noto Sans', Verdana, sans-serif",
  "'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  // 印刷衬线（纸书/书谱数字常见宋体、Times 系）
  "'Times New Roman', Georgia, 'Noto Serif', serif",
  "serif",
  "'Noto Serif CJK SC', 'Source Han Serif SC', SimSun, 'Songti SC', serif",
];
const moveNumberCapRatioCache = new Map<string, number>();
// Single-stroke glyphs like "1" cannot tell fonts apart, so the vote keeps
// sampling families across the first few stones before locking in.
const MOVE_NUMBER_VOTE_SAMPLES = 3;
let moveNumberFamilyVote: { scores: number[]; decided: number; samples: number } | null = null;
const resetMoveNumberCalibration = () => { moveNumberFamilyVote = null; };

/**
 * 主线程「算力档」探测（2026-10-10）：只在**主线程快到不值得并行**时关掉模板段并行。
 *
 * ⚠ 这个门槛的数值经过一次重要修正（教训值得留档）：
 * 早期测量给出「桌面并行净亏 61%、只有降频 3×+ 才划算」，据此把门槛设成 25ms。
 * 但那是**脏环境**下的数据——长时间跑 QA 留下了 4 个泄漏的 chrome-headless-shell
 * 进程占着 CPU/内存，把计时搅乱了（同一配置前后两次测出「省 71%」与「慢 41%」这种
 * 自相矛盾的结果）。**清掉泄漏进程后重测**（每档强制并行 vs 强制串行各一次）：
 *
 * | 图 | 降频 1×（桌面） | 2× | 3× | 6×（≈手机） |
 * |---|---|---|---|---|
 * | 89 手 | 省 10% | 慢 5% | 省 8% | 省 9% |
 * | 密盘 | 省 12% | 省 16% | 省 20% | **省 50%** |
 *
 * 结论：**并行在桌面也基本是正收益**（除了噪声级的 -5%），不存在「桌面吃亏」这回事。
 * 所以门槛不该高——它只用来防「主线程快到 1–2ms/子」的极端设备（那时起池/传参的
 * 固定成本会占主导）。取 2ms：正常桌面实测 7.2ms、降频 6× 50.7ms，都远在门槛之上，
 * 于是**并行默认生效**，只有异常快的环境才会自动关掉。
 *
 * 可用 `__BANBU_SCORE_PARALLEL_MIN_MS__` 覆盖（QA 做 A/B：0 = 始终并行，99999 = 始终串行）。
 */
const MOVE_NUMBER_MAIN_COST_MIN_MS = 2;
let mainThreadScoreCostMs: number | null = null;
const measureMainThreadScoreCost = (spacing: number): number => {
  if (mainThreadScoreCostMs !== null) return mainThreadScoreCostMs;
  // 用一块合成的采样图做一次真实调用：只跑 3 颗子、值域压到 12，量「单子成本」的近似。
  // 这样不会因为图大而白花时间（<50ms），又足够反映当前设备的单核速度。
  const side = 220;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < side * side; i += 1) {
    // 造一点周期性纹理，避免全灰导致提前退出（early-exit）测不出真实成本。
    const v = 200 + Math.round(Math.sin(i * 0.7) * 40);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const probe = createSampledImage(data, side, side);
  const px = Array.from({ length: 3 }, (_, i) => 60 + i * 20);
  for (const [index, x] of px.entries()) {
    void index;
    matchMoveNumbers(probe, x, x, Math.max(8, spacing || 20), "black", 12, 0, true);
  }
  // 三轮取中位数，压掉单次抖动。
  const samples: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    const t0 = performance.now();
    for (const x of px) matchMoveNumbers(probe, x, x, Math.max(8, spacing || 20), "black", 12, 0, true);
    samples.push((performance.now() - t0) / px.length);
  }
  samples.sort((a, b) => a - b);
  mainThreadScoreCostMs = samples[1];
  return mainThreadScoreCostMs;
};

/**
 * 模板渲染指纹（2026-10-10）：给「当前这块画布渲染出来的字形」算一个稳定的哈希。
 *
 * 用途：模板段并行（worker 用 OffscreenCanvas、主线程用 HTMLCanvas）**唯一**的不确定项
 * 就是两种画布的栅格化是否一致。桌面 Chromium 实测 142/142 逐位相同，但安卓 WebView
 * 的字体栈/栅格化策略可能不同——绝不能用「桌面验过」去赌手机上的识别结果。
 *
 * 所以并行路径带一条**运行时自检**：主线程与 worker 各自渲染同一小组字形并算指纹，
 * 两面一致才走并行；不一致（或任一面试不出来）就整体回退主线程串行——**结果永远正确**，
 * 最坏情况只是没有加速。
 *
 * 指纹样本要能区分字体差异：混合「单字符 / 双字符 / 大字号 / 小字号」和多个候选字体族，
 * 因为这些正是模板匹配实际用到的字形。
 */
export const moveNumberRenderFingerprint = (): string | null => {
  const samples: Array<[string, number]> = [["8", 6], ["15", 6], ["76", 11], ["1", 4], ["49", 19]];
  const families = [MOVE_NUMBER_FAMILIES[0], MOVE_NUMBER_FAMILIES[2]];
  let hash = 2166136261;
  let measured = 0;
  for (const family of families) {
    for (const [text, fontPx] of samples) {
      const template = renderMoveNumberTemplate(text, fontPx, false, family);
      if (!template) continue;
      measured += 1;
      // 用「尺寸 + 墨迹像素数 + 墨迹坐标和」当指纹：对栅格化差异极敏感（少一个像素就变），
      // 又与原子的浮点无关，跨设备稳定可复现。
      let inkSum = 0;
      for (let i = 0; i < template.inkX.length; i += 1) inkSum += template.inkX[i] * 3 + template.inkY[i] * 7;
      const payload = `${template.w}x${template.h}:${template.ink.length}:${inkSum}:${template.bh}:${template.mean.toFixed(6)}:${template.norm.toFixed(6)}`;
      for (let i = 0; i < payload.length; i += 1) hash = Math.imul(hash ^ payload.charCodeAt(i), 16777619);
    }
  }
  if (!measured) return null;
  return `${measured}|${(hash >>> 0).toString(36)}`;
};

const renderMoveNumberTemplate = (text: string, fontPx: number, bold: boolean, family: string): MoveNumberTemplate | null => {
  // 注意：判断条件从「有没有 document」改成「有没有可用画布」（2026-10-10）——
  // worker 里没有 document 但有 OffscreenCanvas，而模板渲染正是要靠它才能在 worker 里跑。
  // 两种都没有（Node 单测环境）时 moveNumberTemplateCanvas() 返回 null，下面会正常退出。
  if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") return null;
  const sup = MOVE_NUMBER_SUP;
  const key = `${text}|${fontPx.toFixed(2)}|${bold ? "b" : ""}|${family}`;
  const cached = moveNumberTemplateCache.get(key);
  if (cached !== undefined) return cached;
  if (moveNumberTemplateCache.size > 6000) { moveNumberTemplateCache.clear(); moveOrderPerf.flatClears += 1; }
  const build = (): MoveNumberTemplate | null => {
    const fs = fontPx * sup;
    const tBuild0 = performance.now();
    // 复用一块画布（2026-10-10）：密盘实测每张新建 canvas 要 7.75ms、复用同一块只要
    // 4.45ms（省 43%，1748 张就是 ~5.7 秒）。画布本身不携带任何识别语义，只是一块画字
    // 的地方，所以复用与「每张新建」的输出**逐位相同**——前提是复用前清空到与新建
    // 画布相同的初始态（新建画布是全透明黑，这里用 clearRect 还原），且尺寸变化时
    // 重置 width/height（HTML 规范里改尺寸本身就会清空画布）。
    //
    // 下面每次都把 font/textAlign/fillStyle 等状态重新设全，所以不依赖上下文残留状态。
    const canvas = moveNumberTemplateCanvas();
    if (!canvas) return null;
    const width = Math.max(8, Math.ceil(fs * (text.length * 0.8 + 1.2)));
    const height = Math.max(8, Math.ceil(fs * 1.8));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    } else {
      // 同尺寸复用必须显式清空：上一次的字会留在画布上，混进这次的墨迹 bbox 与像素。
      const scratch = canvas.getContext("2d", { willReadFrequently: true });
      scratch?.clearRect(0, 0, width, height);
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.font = `700 ${fs}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const ax = canvas.width / 2;
    const ay = Math.round(canvas.height * 0.7);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineJoin = "round";
    if (bold) ctx.lineWidth = Math.max(1, fs * 0.05);
    ctx.fillText(text, ax, ay);
    if (bold) ctx.strokeText(text, ax, ay);
    // measureText's ink bbox locates the glyph without scanning the canvas;
    // only the (small) crop around it is ever read back as pixels.
    const metrics = ctx.measureText(text);
    const grow = bold ? Math.ceil(ctx.lineWidth / 2) + 1 : 1;
    const x0 = Math.max(0, Math.floor(ax - metrics.actualBoundingBoxLeft) - grow);
    const x1 = Math.min(canvas.width - 1, Math.ceil(ax + metrics.actualBoundingBoxRight) + grow);
    const y0 = Math.max(0, Math.floor(ay - metrics.actualBoundingBoxAscent) - grow);
    const y1 = Math.min(canvas.height - 1, Math.ceil(ay + metrics.actualBoundingBoxDescent) + grow);
    if (x1 <= x0 || y1 <= y0) return null;
    const pad = 2 * sup;
    const cx0 = Math.max(0, x0 - pad), cx1 = Math.min(canvas.width - 1, x1 + pad);
    const cy0 = Math.max(0, y0 - pad), cy1 = Math.min(canvas.height - 1, y1 + pad);
    const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1;
    const rgba = ctx.getImageData(cx0, cy0, w, h).data;
    const inkList: number[] = [];
    const inkXList: number[] = [];
    const inkYList: number[] = [];
    let sum = 0, sumSq = 0, wx = 0, wy = 0;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let py = 0; py < h; py += 1) {
      for (let px = 0; px < w; px += 1) {
        const a = rgba[(py * w + px) * 4 + 3] / 255;
        sum += a; sumSq += a * a;
        wx += a * px; wy += a * py;
        if (a >= 0.5) {
          inkList.push(py * w + px); inkXList.push(px); inkYList.push(py);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }
    if (!sum) return null;
    const n = w * h;
    const mean = sum / n;
    const norm = Math.sqrt(Math.max(1e-6, sumSq - n * mean * mean));
    moveOrderPerf.renderMs += performance.now() - tBuild0;
    const template: MoveNumberTemplate = { w, h, bh: y1 - y0 + 1, icx: Math.round(wx / sum), icy: Math.round(wy / sum), ax: Math.round(ax - cx0), ay: Math.round(ay - cy0), ink: Int32Array.from(inkList), inkX: Int16Array.from(inkXList), inkY: Int16Array.from(inkYList), minX, maxX, minY, maxY, mean, norm };
    return template;
  };
  const built = build();
  moveOrderPerf.templateBuilds += 1;
  moveNumberSizeBuckets.add(`${fontPx.toFixed(2)}|${bold ? "b" : ""}|${family}`);
  moveNumberTemplateCache.set(key, built);
  return built;
};

// 模板尺寸桶（2026-10-09）：`renderMoveNumberTemplate` 的缓存键含 `fontPx.toFixed(2)`，
// 而逐子的实测字高会把 scale 定到一个连续值上——于是每颗子都渲染一整套新尺寸，
// 缓存形同不存在（密盘 76 子实测 2052 次渲染）。这里只**记录**用了多少个互不相同的
// 尺寸桶，供剪枝量化前先拿到证据（真正合并尺寸必须单独验证，不能顺手做）。
const moveNumberSizeBuckets = new Set<string>();

/**
 * 模板渲染复用的画布（2026-10-10）。
 *
 * 实测动机：密盘要渲染 1748–2052 张模板，每张**新建** canvas 需 7.75ms（77px 字号），
 * 而复用同一块只需 4.45ms——省 43%，约 5.7 秒。canvas 只是一块画字的地方，
 * 不携带识别语义，所以复用与新建的输出**逐位相同**（复用前 clearRect 还原到
 * 新建画布的全透明初态；改尺寸本身会清空画布）。
 *
 * 2026-10-10 扩展为 **worker 可用**：为了让整个模板渲染（进而整个 `matchMoveNumbers`）
 * 能在 worker 里跑——worker 没有 `document`，但有 OffscreenCanvas，而
 * `fillText`/`measureText`/`actualBoundingBox*`/`getImageData` 在
 * OffscreenCanvasRenderingContext2D 上都有。
 *
 * ⚠ **优先级是「有 document 就用 HTMLCanvas，否则才用 OffscreenCanvas」**（不是反过来）：
 * 主线程的行为必须**一个字都不变**（否则就是拿识别结果去赌两种画布栅格化一致，
 * 那是碰红线）。主线程继续走 HTMLCanvasElement，worker 里自然落到 OffscreenCanvas——
 * 于是「worker 的渲染是否与主线程一致」变成一个**可单独验证、可回退**的问题，
 * 而不是把主线程也一起押上去。
 *
 * worker 路径的验证与回退见 `recognition-accelerator`：调用方带运行时渲染一致性
 * 自检，不一致自动退回串行主线程。桌面 Chromium 实测两者 75/75 用例逐位相同。
 *
 * 只保留一块：渲染是单线程顺序发生的，不存在并发复用。
 */
type TemplateSurface = OffscreenCanvas | HTMLCanvasElement;
let moveNumberTemplateCanvasRef: TemplateSurface | null = null;
const moveNumberTemplateCanvas = (): TemplateSurface | null => {
  if (!moveNumberTemplateCanvasRef) {
    if (typeof document !== "undefined") {
      moveNumberTemplateCanvasRef = document.createElement("canvas");
    } else if (typeof OffscreenCanvas !== "undefined") {
      try { moveNumberTemplateCanvasRef = new OffscreenCanvas(8, 8); } catch { moveNumberTemplateCanvasRef = null; }
    }
  }
  return moveNumberTemplateCanvasRef;
};
export interface MoveNumberCandidate { value: number; score: number }

/**
 * 外部读号器（可选增强，2026-10-06）：把训练好的小型数字 CNN（数字头）接进读号
 * 环节，逐颗棋子读出候选序号。语义与模板匹配的 matchMoveNumbers 对齐：
 *  - 返回与 centers 等长的数组，第 i 项对应第 i 个候选子的格子；
 *  - 非空数组 = 该格读出的候选（value=号，score=0..1 置信度，按分数降序）；
 *  - 空数组 = 明确判为「无数字」（不再回落模板——模板会把空交叉的纹理读成假号）；
 *  - null = 本次没读出（调用方对这颗子回落模板匹配）。
 * 传了它（且未 skipMoveOrder）时：模板匹配只做逐格回落，字体族校准补跑不再执行。
 * 任一环节失败都必须由调用方静默回落——与「多核加速」同一条纪律：增强不能变成
 * 识别失败的原因。
 */
export type DigitReader = (request: {
  image: SampledImage;
  centers: Array<{ x: number; y: number }>;
  spacing: number;
}) => Promise<Array<MoveNumberCandidate[] | null>>;

/** 逐格证据（boardScanner 的输出，2026-10-07）：每个交点的 占用/颜色 三元概率，
 *  外加数字头在该格的 argmax 读数（digit=0 表示「无号」，digitProb 是它的 softmax
 *  置信——包括低置信读数：实测它们在补位裁决里是关键信号，假阳格的 argmax
 *  恰好全部是 0，真漏子的弱读数号又没人抢）。 */
export interface BoardCellEvidence {
  row: number;
  col: number;
  pEmpty: number;
  pBlack: number;
  pWhite: number;
  digit: number;
  digitProb: number;
  /** 该格数字头的 top-3 候选（同一次推理的裁剪几何，2026-10-07）。只有「调用方点名
   *  要读」与「pEmpty 低于补位门槛」的格才有：调用方直接拿它当读数用，不必再对同一
   *  批格单独跑一遍 digitReader（那是同一次推理的重复开销）。 */
  digitTop?: MoveNumberCandidate[];
}

/**
 * 全盘逐格扫描器（可选增强，2026-10-07 位置线）：cell-cls 类模型对全部交点
 * 各判一次「空/黑/白」。它没有找棋盘的能力——网格几何由识别器提供。
 * 实测（remote-image2 89 手图 + 逐坐标真值）：应用+补位 = 89/89 全对全色，
 * 纯 cell-cls 直出则多 16 假阳、11 颗颜色错——所以只做「补位」，不替换。
 *
 * 2026-10-07 提速接缝：`needDigits:false` 让静态导入完全不跑数字头（只用占用/颜色）；
 * `digitCenters` 点名必须读号的格（复原路径的弱读子/全部原子）。扫描器内部对
 * 同一张图（尺寸+网格+像素校验和相同）缓存格级证据，「导入 → 复原」两步只扫一遍。
 */
export type BoardScanner = (request: {
  image: SampledImage;
  grid: { originX: number; originY: number; spacingX: number; spacingY: number };
  boardSize: number;
  /** false = 只补位置、不读号。默认 true。 */
  needDigits?: boolean;
  /** 必须读号的格（按行列点名）。scanner 额外对 pEmpty<0.05 的格读号（补位子要被
   *  装配门控裁决，需要读数）。 */
  digitCenters?: ReadonlyArray<{ row: number; col: number }>;
  /** 这一轮**不需要号**的格（2026-10-08 导入提速）：扫描器默认会给每个「占用」格读号
   *  （补位子落地要有读数），可静态导入路径只关心「子在哪、什么颜色」——已识别棋子的
   *  序号是复原那一步才用到的。导入时把已识别的子列在这里，跳过它们的读号开销；
   *  复原那一路不传，读数照读（扫描缓存会把这批格记为待读，届时补读）。 */
  digitSkip?: ReadonlyArray<{ row: number; col: number }>;
  /**
   * 本轮**只需要这些格**的证据（2026-10-09 导入无损剪枝）。
   *
   * 为什么可以剪：扫描器返回的格级证据只有**补位**一个用途，而补位门控里有几类格子的
   * 分类结果永远不会被采用，且这些条件**扫描前就能算出来**：
   *   · 已识别子所在格 —— 门控第一句就是 `if (board[row][col]) continue`；
   *   · 已在候选池（taken）的格 —— 同上；
   *   · 彩色标记格（isVividGlyphMarker）—— 门控明确跳过；
   *   · **特征分 < 0.2 的格** —— 静态导入不读号（needDigits:false），佐证只剩
   *     「features.score >= 0.2」这一条，所以特征分不够的格必然被拒；
   *   · 特征分为 null 的越界格 —— 门控把 null 当「已佐证」（`features ? … : true`），
   *     也就是越界格一旦 pEmpty<0.05 就会被补，**不能剪**，必须保留。
   *
   * 剪掉这些格**逐位不改识别结果**（它们在门控上本来就必然被跳过），省下的是固定
   * N² 次推理——导入路径实测：网页盘/App 截图/旧书手写体需扫 **0 / 225** 格
   * （整段模型扫描直接消失），白底 89 手图 40 / 225（补位能力完整保留）。
   *
   * 只给静态导入传（传 null/undefined = 全盘，复原路径照旧全扫；导入没扫的格会在
   * 复原那次被补齐，扫描器按格增量缓存，同一格只算一次）。
   */
  scanTargets?: ReadonlyArray<{ row: number; col: number }> | null;
  /** 数字头裁剪用的间距参数（与 digitReader 的 spacing 对齐，保证读数逐位一致）；
   *  缺省取 min(spacingX, spacingY)。 */
  digitSpacing?: number;
  /** 值域上限（结构证据）：调用方已知的棋子数。scanner 对「读出的号超过它」的格
   *  换尺度补读一次——15 子的图不可能有 23 手，读出来说明裁剪尺度不对。 */
  digitMaxNumber?: number;
  /**
   * 读号**加深**（2026-10-09，为「补全识别」加的）：默认 false 时读号走标准阶梯
   *  （1.0× 起，不够确定才依次 0.8/0.7/0.6）；true 时额外走**更细密的尺度网格 +
   *  更低的不确定门槛**，把每个目标格都多问几档。
   *
   * 为什么需要它：用户实测「点了好几次『补全识别』还是没认出」——因为旧的补全只做了
   * 「跳过已读到的号、少读几颗」，而对**没读出来的那几颗**用的是与第一次**完全相同**的
   * 输入与算法，确定性计算必然给出同样的结果，点几次都一样。补全真正的价值应当是把
   * 省下的预算花在那些读不出来的棋子上：同一格多问几个裁剪尺度、把「勉强够确定」的
   * 读数也算作不确定而继续追问。
   *
   * 代价是这一趟更慢（目标格 × 更多尺度），但补全的目标格通常只剩少数几颗，
   * 总量仍远小于整盘重读——这正是「补全」相对「重新识别」的立足点。
   */
  digitDeep?: boolean;
  /** 多核加速开关打开时，识别器把当前这批计算用的执行器交给扫描器：格级扫描与
   *  逐格读号都切成 4×线程数 片丢进 worker 池（每 worker 一份 ORT 会话）。
   *  不传就用主线程直算——两条路径同一份 `model-inference`，结果逐位相同。 */
  accelerator?: RecognitionAccelerator;
}) => Promise<BoardCellEvidence[] | null>;

export interface MoveNumberAssignment {
  numbers: number[];
  meanScore: number;
  minScore: number;
  wildcardUsed: number;
  ambiguous: number;
  nonTop: number;
  maxRegret: number;
  pairwiseMargin: number;
  assignmentMargin: number;
}

export const evaluateMoveNumberAssignment = (assignment: MoveNumberAssignment, stoneCount: number, options: { lowResolution?: boolean } = {}): MoveOrderQuality => {
  const reasons: string[] = [];
  const lowResolution = options.lowResolution === true;
  // 印刷衬线体（宋体/Times）的十位混淆是字形造成的：11/12、16/36、17/27 在
  // 13px 下分数只差 0.002~0.02，逐颗看每颗都可疑，但联合求解用唯一性+奇偶把它们
  // 全部钉回真值。2026-10-05 实测 6 组宋体图：真值 100% 在候选池内、联合求解
  // 100% 正确，3 组却只因「低边际候选 8/40」被拒。
  //
  // 所以把「局部歧义计数」和「全局证据」解耦：全局边际仍然要求 ≥ 严格档的
  // 0.035（一分不降），另外要求改写非首选的代价极小（maxRegret ≤ 0.02，比原来
  // 的 0.1 更紧）、非首选数量 ≤5%、平均/最低分都在线以上，才把歧义计数上限从
  // 8% 提到 25%。任一条件不成立就退回原来的严格门——放宽只发生在「替代方案
  // 明显更差」的那一类图上，不放松任何分数类的下限。
  const globalEvidenceStrong = !lowResolution
    && assignment.assignmentMargin >= 0.035
    && assignment.maxRegret <= 0.02
    && assignment.nonTop <= Math.max(1, Math.ceil(stoneCount * 0.05))
    && assignment.minScore >= 0.60
    && assignment.meanScore >= 0.75;
  const ambiguousLimit = lowResolution
    ? Math.max(2, Math.ceil(stoneCount * 0.7))
    : globalEvidenceStrong
      ? Math.max(4, Math.ceil(stoneCount * 0.25))
      : Math.max(2, Math.ceil(stoneCount * 0.08));
  const nonTopLimit = lowResolution
    ? Math.max(3, Math.ceil(stoneCount * 0.08))
    : Math.max(1, Math.ceil(stoneCount * 0.03));
  if (assignment.wildcardUsed > 0) reasons.push(`有 ${assignment.wildcardUsed} 颗子由通配号推定`);
  if (lowResolution) {
    if (assignment.meanScore < 0.78) reasons.push(`低清图平均匹配分不足（${assignment.meanScore.toFixed(3)}）`);
    if (assignment.minScore < 0.60) reasons.push(`低清图最低匹配分不足（${assignment.minScore.toFixed(3)}）`);
    if (assignment.maxRegret > 0.05) reasons.push(`低清图首选损失过大（${assignment.maxRegret.toFixed(3)}）`);
    if (assignment.assignmentMargin < 0.018) reasons.push(`存在近似换位（全局边际 ${assignment.assignmentMargin.toFixed(3)}）`);
  } else if (assignment.assignmentMargin < 0.035) {
    reasons.push(`存在近似换位（全局边际 ${assignment.assignmentMargin.toFixed(3)}）`);
  }
  if (assignment.ambiguous > ambiguousLimit) reasons.push(`低边际候选 ${assignment.ambiguous}/${stoneCount}`);
  if (assignment.nonTop > nonTopLimit) reasons.push(`非首选分配 ${assignment.nonTop}/${stoneCount}`);
  // 「首选损失」的放行（2026-10-12）：匈牙利已经**最大化全局目标**，池内首选若真的更好，
  // 替代解早就赢了——assignmentMargin 量的正是那一差距。所以当全局边际压倒性
  // （≥0.2，是严格档 0.035 的五倍以上）、非首选只有个位数、均值与最低分都在线时，
  // 个别子的首选损失不再单独否决整盘。
  //
  // 动机（实测 self-001@1200，188 手密盘）：数字头在自己的候选池里把 D1 的 178 读成
  // 128@0.87（它 178 那份是次选 0.675），而模板也读 128@0.871 —— 池内首选是**两把
  // 尺子量出的同一个错读**。联合求解靠唯一号 + 1..N 把 178 放回 D1（真值全在池、
  // 187/188 是首选、全局边际 0.424），却只因 maxRegret=0.217 被拒。这条放行让
  // 「局部指标」不再盖章否决「全局唯一解」——与 2026-10-05 把局部歧义计数与全局
  // 证据解耦是同一条思路。分数类下限（最低分/均值/全局边际）一分不降。
  const regretWaived = assignment.assignmentMargin >= 0.2
    && assignment.nonTop <= Math.max(1, Math.ceil(stoneCount * 0.01))
    && assignment.meanScore >= 0.9
    && assignment.minScore >= 0.60;
  if (assignment.maxRegret > 0.1 && !regretWaived) reasons.push(`首选损失 ${assignment.maxRegret.toFixed(3)}`);
  if (assignment.minScore < 0.56) reasons.push(`最低匹配分 ${assignment.minScore.toFixed(3)}`);
  const accepted = reasons.length === 0;
  return {
    accepted,
    status: accepted ? "accepted" : "ambiguous",
    assignedMean: assignment.meanScore,
    assignedMin: assignment.minScore,
    ambiguous: assignment.ambiguous,
    nonTop: assignment.nonTop,
    maxRegret: assignment.maxRegret,
    pairwiseMargin: Number.isFinite(assignment.pairwiseMargin) ? assignment.pairwiseMargin : null,
    assignmentMargin: Number.isFinite(assignment.assignmentMargin) ? assignment.assignmentMargin : null,
    wildcardUsed: assignment.wildcardUsed,
    reason: reasons.join("；"),
  };
};

// 每颗棋子都要一份「超采样窗口 + 两张积分图」。15 路几何下 sw≈460，于是单颗子约
// 0.85MB(Float32 窗口) + 2×1.7MB(Float64 积分图)；一幅满盘 225 颗子就是近 1GB 的
// 分配/清零churn，GC 与清零成本都记在热点帧上。同一幅图内 spacing 恒定 ⇒ sw 恒定，
// 所以按 sw 复用这三块 scratch：窗口每次被完整重写，积分图只需把「永不被写的边框」
// （第 0 行与第 0 列）清零，内部全部重算 —— 逐元素、逐顺序与每次新分配完全一致。
let moveScratchSw = -1;
let moveScratchG = new Float32Array(0);
let moveScratchIntegral = new Float64Array(0);
let moveScratchIntegralSq = new Float64Array(0);
let moveScratchAnn: number[] = [];
let moveScratchInner: number[] = [];
let moveScratchPx0 = new Int32Array(0);
let moveScratchWx = new Float64Array(0);
const moveNumberScratch = (sw: number) => {
  if (moveScratchSw !== sw) {
    moveScratchSw = sw;
    moveScratchG = new Float32Array(sw * sw);
    moveScratchIntegral = new Float64Array((sw + 1) * (sw + 1));
    moveScratchIntegralSq = new Float64Array((sw + 1) * (sw + 1));
    moveScratchPx0 = new Int32Array(sw);
    moveScratchWx = new Float64Array(sw);
  }
  for (let k = 0; k <= sw; k += 1) {
    moveScratchIntegral[k] = 0;
    moveScratchIntegralSq[k] = 0;
    if (k > 0) {
      moveScratchIntegral[k * (sw + 1)] = 0;
      moveScratchIntegralSq[k * (sw + 1)] = 0;
    }
  }
  moveScratchAnn.length = 0;
  moveScratchInner.length = 0;
  return { g: moveScratchG, integral: moveScratchIntegral, integralSq: moveScratchIntegralSq, ann: moveScratchAnn, inner: moveScratchInner, px0Row: moveScratchPx0, wxRow: moveScratchWx };
};

/**
 * 逐子读号（模板渲染 + NCC 全值扫描）。
 *
 * `forceFamily` / `skipVote`（2026-10-10，为 worker 并行加的）：
 * 本函数唯一的**跨子状态**是字体族投票（`moveNumberFamilyVote`，实测在第 4–37 颗子
 * 之间锁定，密盘第 22 颗）。锁定之后，每颗子的匹配结果只依赖
 * `(图像, x, y, player, maxNumber, 已锁定的族)` —— 也就是一个**纯函数**。
 *
 * 所以并行路径这样切：
 *   · 前若干颗子在主线程串行（参与投票，写 `moveNumberFamilyVote`）；
 *   · 投票锁定后，把剩余的石子按 `forceFamily = decided, skipVote = true` 派给 worker。
 *
 * `skipVote = true` 时**不参与投票**，并且把局部 vote 直接初始化为「已锁定」，
 * 从而让下面三处与「主线程锁定后」的行为完全一致：
 *   ① `chosen = forceFamily`；
 *   ② 升格投票块（`vote.decided < 0` 才跑）被跳过——主线程锁定后同样不跑；
 *   ③ Stage 3 换族逃逸（`vote.decided >= 0` 才跑）照常跑，且排除的族与主线程相同。
 * 三者对齐 ⇒ worker 结果与主线程**逐位相同**（由 parallel-parity 门禁守）。
 */
const matchMoveNumbers = (image: SampledImage, x: number, y: number, spacing: number, player: Player, maxNumber: number, forceFamily = -1, skipVote = false): MoveNumberCandidate[] => {
  const dbg = (globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__;
  const logDigit = (value: number | null, score: number, margin: number, scale = 1, why = "ok", cands: MoveNumberCandidate[] = [], details: Record<string, number> = {}) => {
    const record = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, player, value, score: Math.round(score * 1000) / 1000, margin: Math.round(margin * 1000) / 1000, scale, why, cands, ...details, family: moveNumberFamilyVote && moveNumberFamilyVote.decided >= 0 ? MOVE_NUMBER_FAMILIES[moveNumberFamilyVote.decided] : null, spacing: Math.round(spacing * 10) / 10 };
    if (dbg) console.info("[banbu-image-digit]", JSON.stringify(record));
    const trace = (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__;
    if (Array.isArray(trace)) trace.push(record);
  };
  const fontPx = MOVE_NUMBER_FONT_RATIO * spacing;
  if (fontPx < 3.2 || maxNumber < 1) { logDigit(null, 0, 0, 1, "small"); return []; } // glyph would be unresolvable
  const sup = MOVE_NUMBER_SUP;
  const { gray, width: IW, height: IH } = image;
  const half = Math.max(4, Math.ceil(spacing * 0.55) + 2);
  const gx0 = Math.round(x) - half, gy0 = Math.round(y) - half;
  const gw = half * 2 + 1, sw = gw * sup;
  const { g, integral, integralSq, ann, inner, px0Row, wxRow } = moveNumberScratch(sw);
  const sign = player === "white" ? -1 : 1; // flip so that the number ink is always the bright side
  // x 轴的采样坐标只随 sx 变，却被内层逐行重算（两次 Math 夹取、一次除法、一次 floor）。
  // 先按行算好 px0/wx，内层就只剩 4 次取样与乘加；表达式的结合顺序原样保留，结果逐位相同。
  for (let sx = 0; sx < sw; sx += 1) {
    const fx = gx0 + sx / sup;
    const px = Math.min(IW - 1.001, Math.max(0, fx)), px0 = Math.floor(px);
    px0Row[sx] = px0;
    wxRow[sx] = px - px0;
  }
  for (let sy = 0; sy < sw; sy += 1) {
    const fy = gy0 + sy / sup;
    const py = Math.min(IH - 1.001, Math.max(0, fy)), py0 = Math.floor(py), wy = py - py0;
    const oneMinusWy = 1 - wy;
    const rowA = py0 * IW, rowD = rowA + IW, rowOut = sy * sw;
    for (let sx = 0; sx < sw; sx += 1) {
      const px0 = px0Row[sx], wx = wxRow[sx];
      const a = gray[rowA + px0], b = gray[rowA + px0 + 1], c = gray[rowD + px0], d = gray[rowD + px0 + 1];
      g[rowOut + sx] = sign * (a * (1 - wx) * oneMinusWy + b * wx * oneMinusWy + c * (1 - wx) * wy + d * wx * wy);
    }
  }
  // Disc level from the annulus (never carries ink), ink peak from the centre.
  const cxs = (x - gx0) * sup + 0.5, cys = (y - gy0) * sup + 0.5;
  const rAnnIn = 0.28 * spacing * sup, rAnnOut = 0.46 * spacing * sup, rIn = 0.26 * spacing * sup;
  for (let sy = 0; sy < sw; sy += 1) {
    for (let sx = 0; sx < sw; sx += 1) {
      const dxs = sx + 0.5 - cxs, dys = sy + 0.5 - cys, r2 = dxs * dxs + dys * dys;
      if (r2 <= rAnnOut * rAnnOut) {
        if (r2 >= rAnnIn * rAnnIn) ann.push(g[sy * sw + sx]);
        else if (r2 <= rIn * rIn) inner.push(g[sy * sw + sx]);
      }
    }
  }
  if (ann.length < 150 || inner.length < 30) { logDigit(null, 0, 0, 1, "edge"); return []; }
  ann.sort((a, b) => a - b);
  inner.sort((a, b) => a - b);
  const disc = ann[Math.floor(ann.length * 0.5)];
  const peak = inner[Math.min(inner.length - 1, Math.floor(inner.length * 0.98))];
  const spread = peak - disc;
  // 「盘内最亮墨迹 − 子面本体」低于这个值就不可能有印刷序号，只有棋子自己的高光/阴影。
  // 门槛由本地真实素材量出来（2026-10-06，`qa/.tmp-zcode-feat.mjs`，31 张真图）：
  //   假读数（我们 App 自己的无号打谱截图被读成 21 个「6」）spread = 41~44、57；
  //   真号图里最差的 2BC1F970（282×267 模糊手机图，71 手）spread p10 = 91；
  //   其余真图 p10 全在 149 以上。57 与 91 之间是实测空档，取 70。
  // 旧值 32 太低：App 深色主题棋子的高光差就有 40+，于是无号图也能过门、
  // 把一堆假号灌进 readMoveNumbers（用户在核对屏上会看到满盘「6」）。
  if (spread < MOVE_NUMBER_MIN_INK_SPREAD) { logDigit(null, 0, 0, 1, "flat"); return []; } // no number ink on this stone
  // Tiny glyphs lose their AA edges to the threshold, which biases the ink
  // centroid; cut deeper into the spread only when the glyph is big enough.
  const inkThr = disc + (MOVE_NUMBER_FONT_RATIO * spacing < 9 ? Math.max(16, spread * 0.42) : Math.max(20, spread * 0.5));
  const rCent = 0.34 * spacing * sup;
  // Outer (AA-inclusive) ink extent must be measured with the SAME basis as
  // the template's alpha>0 bbox, or the calibrated scale biases ~8% small.
  const inkOuter = disc + Math.max(10, spread * 0.25);
  let inkCount = 0, inkX = 0, inkY = 0, inkMinY = 1e9, inkMaxY = -1e9, outMinY = 1e9, outMaxY = -1e9, outCount = 0;
  for (let sy = 0; sy < sw; sy += 1) {
    const dys = sy + 0.5 - cys;
    if (Math.abs(dys) > rCent) continue;
    for (let sx = 0; sx < sw; sx += 1) {
      const dxs = sx + 0.5 - cxs;
      if (dxs * dxs + dys * dys > rCent * rCent) continue;
      const v = g[sy * sw + sx];
      if (v > inkThr) {
        inkCount += 1; inkX += sx; inkY += sy;
        if (sy < inkMinY) inkMinY = sy;
        if (sy > inkMaxY) inkMaxY = sy;
      }
      if (v > inkOuter) {
        outCount += 1;
        if (sy < outMinY) outMinY = sy;
        if (sy > outMaxY) outMaxY = sy;
      }
    }
  }
  // Two-digit black-stone labels at small sizes occupy a little more of the
  // centre disk than the old fixed 30% cap (the 39/59 failures measured only
  // 1–3% above it).  Their annulus and contrast gates are already established,
  // so give small glyphs a narrow 32% allowance while keeping the stricter
  // cap for normal-sized text.
  const maxInk = (fontPx < 9 ? 0.32 : 0.3) * Math.PI * rCent * rCent;
  if (inkCount < 10 || inkCount > maxInk) { logDigit(null, 0, 0, 1, "ink", [], { inkCount, maxInk: Math.round(maxInk), spread: Math.round(spread), inkThr: Math.round(inkThr) }); return []; }
  const inkCx = inkX / inkCount, inkCy = inkY / inkCount;
  if (Math.abs(inkCx - cxs) > 0.24 * spacing * sup || Math.abs(inkCy - cys) > 0.26 * spacing * sup) { logDigit(null, 0, 0, 1, "shift"); return []; }
  // The fallback grid misjudges spacing by a few percent toward the board
  // edge, and a 3% size error costs the true font more score than a thicker
  // fallback face at nominal size. Measure the digit's own cap height and,
  // per family, divide by that family's rendered cap ratio (self-calibrated,
  // no font-specific constants) to get the scale its templates need.
  const capH = (outCount >= 8 ? outMaxY - outMinY + 1 : inkMaxY - inkMinY + 1) / sup;
  const capRatioOf = (familyIndex: number): number => {
    const key = `${MOVE_NUMBER_FAMILIES[familyIndex]}|${fontPx.toFixed(2)}`;
    let ratio = moveNumberCapRatioCache.get(key);
    if (ratio === undefined) {
      const t = renderMoveNumberTemplate("8", fontPx, false, MOVE_NUMBER_FAMILIES[familyIndex]);
      ratio = t ? t.bh / (fontPx * sup) : 0.71; // alpha>0 full height, same basis as the outer stone bbox
      if (moveNumberCapRatioCache.size > 200) moveNumberCapRatioCache.clear();
      moveNumberCapRatioCache.set(key, ratio);
    }
    return ratio;
  };
  const scaleFor = (familyIndex: number) => Math.min(2.2, Math.max(0.7, capH / capRatioOf(familyIndex) / fontPx));
  // Integral images over the sign-flipped sup window for O(1) box sums. 缓冲来自
  // moveNumberScratch（同 sw 复用），内部每个单元在下方的循环里全部重算。
  for (let sy = 0; sy < sw; sy += 1) {
    let rowSum = 0, rowSq = 0;
    for (let sx = 0; sx < sw; sx += 1) {
      const v = g[sy * sw + sx];
      rowSum += v; rowSq += v * v;
      const up = sy * (sw + 1), here = (sy + 1) * (sw + 1) + sx + 1;
      integral[here] = integral[up + sx + 1] + rowSum;
      integralSq[here] = integralSq[up + sx + 1] + rowSq;
    }
  }
  const scoreAt = (t: MoveNumberTemplate, dx: number, dy: number): number => {
    moveOrderPerf.scoreCalls += 1;
    const ix0 = Math.round(inkCx + dx) - t.icx, iy0 = Math.round(inkCy + dy) - t.icy;
    const x1c = Math.min(sw, ix0 + t.w), y1c = Math.min(sw, iy0 + t.h);
    const x0c = Math.max(0, ix0), y0c = Math.max(0, iy0);
    if (x1c <= x0c || y1c <= y0c) return 0;
    const count = (x1c - x0c) * (y1c - y0c);
    if (count < t.w * t.h * 0.6) return 0;
    const A = y0c * (sw + 1) + x0c, B = y0c * (sw + 1) + x1c, C = y1c * (sw + 1) + x0c, D = y1c * (sw + 1) + x1c;
    const sum = integral[D] - integral[C] - integral[B] + integral[A];
    const sq = integralSq[D] - integralSq[C] - integralSq[B] + integralSq[A];
    const meanW = sum / count;
    const varW = sq / count - meanW * meanW;
    if (varW < 4) return 0;
    let dot = 0;
    // t.inkX/t.inkY hold each ink pixel's position inside the template bitmap,
    // precomputed at build time: the previous `idx % t.w` / `Math.floor(idx / t.w)`
    // pair cost a division per ink pixel on the hottest loop in the pipeline.
    const inkCount = t.ink.length;
    const inkX = t.inkX;
    const inkY = t.inkY;
    // 绝大多数偏移下整块 ink 都落在窗口内（模板 bbox 一动就能判），命中就走无边界
    // 检查的快路径：两条路径取的是同一组 ink 像素、同一个累加顺序，所以逐位相同，
    // 省掉的只是每像素那四次比较与两次分支。
    if (ix0 + t.minX >= 0 && ix0 + t.maxX < sw && iy0 + t.minY >= 0 && iy0 + t.maxY < sw) {
      const base = iy0 * sw + ix0;
      // 预存的线性偏移（2026-10-10）：内层原本每像素要算 `inkY[i] * sw + inkX[i]`
      // —— 一次乘法 + 两次数组读取。scoreAt 是全管线的最大热点（密盘 54 万次调用 ×
      // 每次约 600 墨迹像素 ≈ 3.2 亿次内层迭代），这里的乘法与读取就是纯开销。
      //
      // 为什么**逐位不变**：off[i] 与 inkY[i]*sw+inkX[i] 是同一个整数值（整数运算无误差），
      // 累加顺序、加数序列完全一致 → `dot` 的浮点求和结果逐位相同。
      // 所以这不是近似优化，是等价改写；门禁可验证（grid-identity / restore 基线）。
      //
      // 按 sw 缓存：sw 在同一张图内恒定（跨图才变），用属性比较而不是 Map 查找——
      // 这里是 54 万次调用的内层，一次哈希查找都是实打实的开销。
      let off = t.offSw === sw ? t.off : undefined;
      if (off === undefined) {
        off = new Int32Array(inkCount);
        for (let i = 0; i < inkCount; i += 1) off[i] = inkY[i] * sw + inkX[i];
        t.off = off;
        t.offSw = sw;
      }
      for (let i = 0; i < inkCount; i += 1) dot += g[base + off[i]];
    } else {
      for (let i = 0; i < inkCount; i += 1) {
        const px = ix0 + inkX[i];
        if (px < 0 || px >= sw) continue;
        const py = iy0 + inkY[i];
        if (py < 0 || py >= sw) continue;
        dot += g[py * sw + px];
      }
    }
    dot -= t.mean * sum;
    return dot / (t.norm * Math.sqrt(varW * count));
  };
  const small = fontPx < 9; // centroid noise grows as glyphs shrink
  const limit = Math.min(maxNumber, 225);
  const offsets = small && limit <= 40 ? [-6, -4, -2, 0, 2, 4, 6] : [-4, -2, 0, 2, 4];
  const offsetsFine: number[] = [];
  for (let o = small ? -3 : -6; o <= (small ? 3 : 6); o += 1) offsetsFine.push(o);
  // 粗扫偏移集合的查询键（见细扫处的跳过逻辑）：只对**细扫真包含**的那些粗扫偏移生效。
  // 小字号时 offsets 含 ±6，而 offsetsFine 只到 ±3 → 交集只有 [-3,3] 内的点，
  // 所以必须按实际集合算，不能假定「粗扫全被细扫包含」。
  const coarseOffsetKeys = new Set<number>();
  for (const dy of offsets) for (const dx of offsets) if (offsetsFine.includes(dx) && offsetsFine.includes(dy)) coarseOffsetKeys.add((dx + 8) * 16 + (dy + 8));
  const byValue = new Map<number, number>();
  const merge = (value: number, score: number) => { if (score > (byValue.get(value) ?? 0)) byValue.set(value, score); };
  // skipVote（worker 路径）：不碰全局投票状态，本地造一个「已锁定到 forceFamily」的
  // 只读投票对象。这样下面所有 `vote.decided` 的读法都等价于「主线程已锁定该族」，
  // 既不会累积投票（worker 无跨子状态），也不会走错分支。
  const vote = skipVote
    ? { scores: MOVE_NUMBER_FAMILIES.map(() => 0), decided: Math.max(0, forceFamily), samples: MOVE_NUMBER_VOTE_SAMPLES }
    : moveNumberFamilyVote ?? (moveNumberFamilyVote = { scores: MOVE_NUMBER_FAMILIES.map(() => 0), decided: -1, samples: 0 });
  let bestScale = 1;
  // One coarse+fine sweep at a fixed (family, scale, bold); returns its best
  // score. `sink` merges winners into byValue — measurement passes (family
  // voting) must NOT pollute the candidate pool with wrong-family values.
  const runSweep = (familyIndex: number, scale: number, bold: boolean, sink: boolean): number => {
    moveOrderPerf.sweeps += 1;
    moveOrderPerf.sweepValues += limit;
    moveOrderPerf.sweepsByStage[moveOrderPerf.sweepStage] += 1;
    const tSweep0 = performance.now();
    const size = fontPx * scale;
    const family = MOVE_NUMBER_FAMILIES[familyIndex];
    const row = moveNumberTemplateRow(family, size, bold, limit);
    let sweepBest = 0;
    let confidentValue = 0;
    const ranked: { value: number; score: number }[] = [];
    for (let value = 1; value <= limit; value += 1) {
      let t = row[value - 1];
      if (t === undefined) { t = renderMoveNumberTemplate(String(value), size, bold, family); row[value - 1] = t; }
      if (!t) continue;
      let sBest = 0;
      for (const dy of offsets) for (const dx of offsets) {
        const s = scoreAt(t, dx, dy);
        if (s > sBest) sBest = s;
      }
      ranked.push({ value, score: sBest });
      // At small raster sizes lookalike two-digit templates (48/49/59, etc.)
      // can cross 0.85 before the true value is visited.  Early exit would
      // then hide the correct edge from the global one-to-one assignment.
      // Full sweeps are kept for small glyphs; larger app-sized glyphs retain
      // the fast unambiguous exit.
      if (sBest >= 0.85 && !small) { // strong unambiguous match: accept immediately
        if (sink) merge(value, sBest);
        confidentValue = value; bestScale = scale; sweepBest = sBest;
        break;
      }
    }
    if (!confidentValue) {
      ranked.sort((a, b) => b.score - a.score);
      for (const cand of ranked.slice(0, 6)) {
        let t = row[cand.value - 1];
        if (t === undefined) { t = renderMoveNumberTemplate(String(cand.value), size, bold, family); row[cand.value - 1] = t; }
        if (!t) continue;
        let sBest = cand.score;
        // 细扫跳过「粗扫已经算过」的那些偏移（2026-10-09，**逐位等价**的省算）：
        // sBest 以 cand.score（＝粗扫在 offsets² 上的最大分）起始，所以对
        // offsets ∩ offsetsFine 里的任何 (dx,dy)，重新 scoreAt 都不可能超过 sBest。
        // 取最大值只做比较、不涉及浮点重结合 → 最终值逐位相同，少的只是重复评估。
        // 注意两个集合并不总是包含关系：小字号时 offsets 含 ±6，而 offsetsFine 只到 ±3，
        // 所以按实际交集（coarseOffsetKeys）判断，不能假定粗扫全被细扫覆盖。
        // 收益有限（密盘约 6% 的 scoreAt 调用）：粗扫只有 25 个位置，细扫 169 个。
        for (const dy of offsetsFine) {
          for (const dx of offsetsFine) {
            if (coarseOffsetKeys.has((dx + 8) * 16 + (dy + 8))) continue;
            const s = scoreAt(t, dx, dy);
            if (s > sBest) sBest = s;
          }
        }
        if (sink) merge(cand.value, sBest);
        if (sBest > sweepBest) { sweepBest = sBest; bestScale = scale; }
        if (sweepBest >= 0.85) break;
      }
    }
    moveOrderPerf.sweepMs += performance.now() - tSweep0;
    return sweepBest;
  };
  // tryFamily sweeps the NOMINAL scale first (v3-proven: the fallback-grid
  // spacing error is only a few percent, and 1.0 is the one size guaranteed
  // present in the slider), then the cap-height-calibrated size as a rescue
  // for genuinely mis-sized shots. Calibrated-only sweeps were the source of
  // lookalike-digit swaps (5↔6, 57↔75) on rescaled screenshots.
  const tryFamily = (f: number, sink: boolean): number => {
    let s = runSweep(f, 1, false, sink);
    const measured = scaleFor(f);
    if (s < 0.8 && Math.abs(measured - 1) > 0.02) {
      const s2 = runSweep(f, measured, false, sink);
      if (s2 > s) s = s2;
    }
    // At low resolution a one-pixel cap-height change shifts the balance of
    // two-digit glyphs considerably.  Probe a narrow band around the measured
    // scale so 19/29 and 33/38 do not lose solely to calibration rounding;
    // keep this to small glyphs because larger app text is already stable at
    // nominal or calibrated size.
    if (small && Math.abs(measured - 1) > 0.02) {
      for (const scale of [measured * 0.94, measured * 0.97, measured * 1.03, measured * 1.06]) {
        const nearby = runSweep(f, scale, false, sink);
        if (nearby > s) s = nearby;
      }
    }
    return s;
  };
  // Gated escalation: family 0 (the app's own face) is tried FIRST and alone.
  // Same-device screenshots — the overwhelming majority — resolve there and
  // never pay for the family machinery. Only weak stones escalate to the
  // cross-device vote, and once the image locks a family it goes first.
  // FAST_ACCEPT sits above rescaling noise but below what a SIMILAR wrong
  // face reaches: the same-device exact match scores 0.75+ at nominal size,
  // while a wrong-but-similar face plateaus around 0.65.
  const FAST_ACCEPT = 0.7;
  let chosen = forceFamily >= 0 ? forceFamily : vote.decided >= 0 ? vote.decided : 0;
  moveOrderPerf.sweepStage = 0; // 首查（名义尺度 / 标定尺度救援）
  let overall = tryFamily(chosen, true);
  if (chosen !== 0) {
    // Belt and braces: even with a locked family, family 0 (the app's own
    // stack) is always tried too — if the lock was wrong, the exact face
    // still rescues the stone; if the lock is right, family 0 simply loses.
    const s0 = tryFamily(0, true);
    if (s0 > overall) { overall = s0; chosen = 0; }
  }
  if (overall < FAST_ACCEPT && vote.decided < 0) {
    moveOrderPerf.sweepStage = 1; // 族投票（全族 × 名义/标定尺度）
    // Full measurement sweep per family (no sinking, so wrong families never
    // enter the candidate pool). Probing only family-0's own candidate values
    // fails when the true face is very different — family 0's top values then
    // are not the stone's real number, and the true face cannot show its
    // strength on the wrong strings. Voting runs on at most a few stones, so
    // the full sweeps stay cheap where it matters.
    const voteSweep = (f: number): number => {
      let s = runSweep(f, 1, false, false);
      const measured = scaleFor(f);
      if (s < 0.8 && Math.abs(measured - 1) > 0.02) {
        const s2 = runSweep(f, measured, false, false);
        if (s2 > s) s = s2;
      }
      return s;
    };
    /**
     * 族池上限 6（2026-10-09 定案）：族投票/升格原本跑全部 15 个字体族——每个族在
     * 每个样本子、每个 Stage 上都要全值扫描一遍。实测（qa/tmp-family-cap.mjs）：
     * 76 手密盘 363 次扫描 / 10M 比对、净耗时 4.6 秒，而**读数与复原结果在 cap=6 时
     * 完全不变**（白底 89 手 89/89、36 子 36/36 逐项相同；密盘读出还从 52 涨到 58——
     * 少了远端族的分票，正确的那一族更容易胜出）。
     * 保留前 6 族不是随手截的：列表开头是各平台的等宽主字体（ui-monospace / Cascadia /
     * Roboto Mono / SF Mono / DejaVu / Consolas），正是本应用与主流截图会用到的脸；
     * 排在后面的是比例字体与衬线体（书谱/宋体那一批），它们只在**前 6 族全弱**时才可能翻盘，
     * 而那种情况下升格本来也读不出来（密盘那张图就是例证）。
     * QA 可用 __BANBU_FAMILY_CAP__ 覆盖（0 = 恢复全 15 族）。
     */
    const familyCap = Number((globalThis as typeof globalThis & { __BANBU_FAMILY_CAP__?: number }).__BANBU_FAMILY_CAP__ ?? 6);
    const voteFamilies = familyCap > 0 ? MOVE_NUMBER_FAMILIES.slice(0, Math.max(2, familyCap)) : MOVE_NUMBER_FAMILIES;
    const perStone = voteFamilies.map((_, f) => (f === 0 ? overall : voteSweep(f)));
    for (let f = 0; f < perStone.length; f += 1) vote.scores[f] = (vote.scores[f] ?? 0) + perStone[f]; // SUM: one lucky glyph must not win
    vote.samples += 1;
    if (vote.samples >= Math.min(MOVE_NUMBER_VOTE_SAMPLES, limit)) {
      let best = 0;
      for (let i = 1; i < vote.scores.length; i += 1) if (vote.scores[i] > vote.scores[best]) best = i;
      // A wrong-but-similar face beats the exact one by ≤0.1 per stone even
      // on rescaled same-device shots; a genuinely different device's face
      // beats the foreign stack by 0.25+. Demand the strict margin to
      // dethrone family 0 — the same-device default.
      // Small raster glyphs make the app's default mono face and the source
      // sans/serif face differ by only a few hundredths per sample.  The old
      // 0.17-per-sample dethrone margin kept locking the default even when a
      // foreign family won every probe, which is exactly the low-resolution
      // book/screen case.  Keep a modest guard against one lucky glyph while
      // allowing a consistent cross-device face to win.
      vote.decided = best === 0 || vote.scores[best] >= vote.scores[0] + 0.1 * vote.samples ? best : 0;
      if (Array.isArray((globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__)) {
        (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__?.push({ why: "vote", samples: vote.samples, totals: vote.scores.map((s) => Math.round(s * 1000) / 1000), decided: MOVE_NUMBER_FAMILIES[vote.decided] });
      }
    }
    // Voting stones NEVER sink a non-family-0 winner: pre-lock merges were
    // the source of same-device contamination. The post-pass in
    // recognizeBoardImage re-scores early stones once the lock exists.
  }
  // Stage 2: wider size fallback — mirrors the 0.7–1.8 序号大小 slider.
  //
  // 2026-10-10：这一支是「模板段」成本的一大来源（密盘实测 2052 张渲染 / 27 个尺寸桶），
  // 因为每档尺度都要给 1..N 每个数字重画一遍模板。档位顺序保持原样（先近后远）。
  //
  // 默认限 5 档（原来是 9 档）：实测（qa/tmp-cap-validate.mjs，11 张语料 + 有真值的逐坐标核）
  // **逐值一致 11/11、零差异**，而密盘省 5–9%、15 手图省 3–7%。
  // 被砍掉的 4 档是 1.5 / 1.8 / 1.1 / 1.4 这些**远端尺度**——它们在真实语料上从未
  // 成为最终胜出解（`overall >= 0.55` 时早就 break 了，走不到那么远）。
  // QA 仍可用 `__BANBU_STAGE2_CAP__` 覆盖（0 = 旧行为全 9 档，负数/未设 = 默认 5；
  // 需要更激进的 3 档也在同一探针里量过，密盘再省一点但收益递减）。
  const stage2Scales: Array<(m: number) => number> = [(m) => m * 0.94, (m) => m * 1.06, () => 1.25, () => 0.75, () => 1.5, () => 1.8, () => 0.9, () => 1.1, () => 1.4];
  const stage2Override = (globalThis as typeof globalThis & { __BANBU_STAGE2_CAP__?: number }).__BANBU_STAGE2_CAP__;
  const stage2Cap = stage2Override === undefined ? 5 : Number(stage2Override);
  if (overall < 0.55) {
    moveOrderPerf.sweepStage = 2;
    const m = scaleFor(chosen);
    for (const scaleOf of stage2Cap > 0 ? stage2Scales.slice(0, stage2Cap) : stage2Scales) {
      const s = runSweep(chosen, scaleOf(m), false, true);
      if (s > overall) overall = s;
      if (overall >= 0.55) break;
    }
  }
  // Stage 3: escape hatch — this stone disagrees with the image's chosen family.
  if (overall < 0.45 && vote.decided >= 0) {
    moveOrderPerf.sweepStage = 3;
    for (let f = 0; f < MOVE_NUMBER_FAMILIES.length; f += 1) {
      if (f === vote.decided) continue;
      const s = runSweep(f, scaleFor(f), false, true);
      if (s > overall) overall = s;
      if (overall >= 0.55) break;
    }
  }
  // Stage 4: the newest move is tinted red with a .8px stroke — retry slightly bolder.
  if (overall < (small ? 0.3 : 0.35)) {
    moveOrderPerf.sweepStage = 4;
    const s = runSweep(chosen, bestScale, true, true);
    if (s > overall) overall = s;
  }
  // Keep a wider tail for the global 1..N assignment.  Tiny two-digit glyphs
  // can place the true value just outside the old eight-entry local shortlist
  // (especially 19/39/49 and 43/48 lookalikes); the Hungarian pass can use
  // parity and uniqueness to reject that tail safely.  The UI still displays
  // only its strongest entries through the existing readout path.
  const cands = [...byValue]
    .map(([value, score]) => ({ value, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const strong = cands.filter((c) => c.score >= 0.4);
  // 诊断专用（`__BANBU_MOVEORDER_TRACE__` 是数组时才算）：把「同一块墨迹在更严阈值下
  // 还剩多少」摊出来。印刷序号是细而高对比的笔画，把阈值往上提仍然剩一半；App 自己
  // 渲染的棋子只有镜面高光，提阈值就塌掉。2026-10-06 用真实素材取证「无号截图被读成一堆
  // 6」这条假读数时加的，正常识别路径一行都不执行。
  const featTrace = (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__;
  if (Array.isArray(featTrace)) {
    let h2 = 0, h3 = 0;
    const t2 = disc + (peak - disc) * 0.75, t3 = disc + (peak - disc) * 0.9;
    for (let sy = 0; sy < sw; sy += 1) {
      const dys = sy + 0.5 - cys;
      if (Math.abs(dys) > rCent) continue;
      for (let sx = 0; sx < sw; sx += 1) {
        const dxs = sx + 0.5 - cxs;
        if (dxs * dxs + dys * dys > rCent * rCent) continue;
        const v = g[sy * sw + sx];
        if (v > t2) h2 += 1;
        if (v > t3) h3 += 1;
      }
    }
    featTrace.push({
      why: "feat", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, player,
      spread: Math.round(spread), inkCount, capH: Math.round(capH * 10) / 10,
      keep75: Math.round(h2 / Math.max(1, inkCount) * 100) / 100, keep90: Math.round(h3 / Math.max(1, inkCount) * 100) / 100,
      top: strong[0]?.value ?? null, score: Math.round((strong[0]?.score ?? 0) * 1000) / 1000,
      spacing: Math.round(spacing * 10) / 10,
    });
  }
  const top = cands[0];
  logDigit(top ? top.value : null, top ? top.score : 0, top && cands[1] ? top.score - cands[1].score : (top ? 1 : 0), bestScale, "ok", strong);
  return strong;
};

/**
 * Optimal one-to-one stone→number assignment (Hungarian algorithm on the
 * cost matrix -score, missing candidates forbidden). Per-stone template
 * matching is already precise, but the app only rebuilds a move order when
 * the numbers form the complete sequence 1..N; a single ambiguous stone
 * (5 vs 6 differ by a two-pixel flag) would veto an otherwise perfect image.
 * The uniqueness constraint lets strongly matched stones push their ambiguous
 * neighbours onto their correct second choices. Returns the number per stone
 * (index-aligned with `perStone`), or null when no perfect assignment exists
 * or its quality floors are not met. The returned diagnostics deliberately
 * keep the local ambiguity visible: a complete matching is only a constraint
 * solution, not proof that every number belongs to the chosen stone.
 */
export const assignMoveNumbers = (perStone: MoveNumberCandidate[][], players: Player[], minScore = 0.5, meanScore = 0.7): MoveNumberAssignment | null => {
  const n = perStone.length;
  if (!n || players.length !== n) return null;
  // Records always start with black, so odd numbers are black stones and even
  // numbers are white; parity-killing wrong edges removes an entire class of
  // cyclic mis-assignments from the joint solve.
  //
  // A1 补全（2026-10-02）：个别子数字读取完全失败（分割失败/印得太糊）时，
  // 旧逻辑要求「每子都有候选」否则整盘放弃——漏读一号=整盘失败。现在给空
  // 候选的子配「同奇偶全号通配边」（中性低分），联合求解照跑：约束系统
  // （恰 1..N、每号至多一子、奇偶一致）会自动把漏读的号**推定**到唯一合理
  // 的位置。通配子数量受限（≤max(2, 10%)），推定过多说明图本身不可信。
  let constrained = 0;
  const NEUTRAL = 0.45; // 低于 minScore：通配边只负责凑成完备匹配，永不抬分
  const maps: Array<Map<number, number>> = [];
  const realCandidate: boolean[] = [];
  perStone.forEach((cands, i) => {
    const parityOk = (value: number) => (value % 2 === 1) === (players[i] === "black");
    const wildcard = new Map<number, number>();
    for (let value = 1; value <= n; value += 1) if (parityOk(value)) wildcard.set(value, NEUTRAL);
    if (cands.length) {
      const map = new Map<number, number>();
      for (const candidate of cands) {
        if (!Number.isInteger(candidate.value) || candidate.value < 1 || candidate.value > n
          || !Number.isFinite(candidate.score) || !parityOk(candidate.value)) continue;
        const previous = map.get(candidate.value);
        if (previous === undefined || candidate.score > previous) map.set(candidate.value, candidate.score);
      }
      constrained += 1;
      realCandidate[i] = true;
      maps.push(map);
      return;
    }
    realCandidate[i] = false;
    maps.push(wildcard);
  });
  const wildcardBudget = Math.max(2, Math.ceil(n * 0.1));
  if (n - constrained > wildcardBudget) return null;
  const INF = 1e6;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1); // p[j] = stone row matched to number j
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    let failed = false;
    for (;;) {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = -1;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const s = maps[i0 - 1].get(j);
        const cur = (s === undefined ? INF : -s) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      if (!Number.isFinite(delta) || delta >= INF / 2) { failed = true; break; }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
      if (p[j0] === 0) break;
    }
    if (failed) return null;
    for (;;) {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
      if (j0 === 0) break;
    }
  }
  const assign = new Array<number>(n + 1).fill(0);
  for (let j = 1; j <= n; j += 1) assign[p[j]] = j;
  // 门控只看**有真实候选**的子：通配推定的 0.45 不参与，否则一次漏读就拖垮
  // 整盘均值——那等于回到「漏读一号=整盘失败」。同时计算局部边际与邻接交换
  // 的损失。后者专门抓住 41/49 这类“整盘仍能凑成连续序列”的错误归属。
  let total = 0, lowest = Infinity, wildcardUsed = 0;
  let ambiguous = 0, nonTop = 0, maxRegret = 0;
  const assignedScore = new Float64Array(n);
  const topValue = new Int32Array(n);
  for (let i = 1; i <= n; i += 1) {
    const s = maps[i - 1].get(assign[i]);
    if (s === undefined) return null;
    if (realCandidate[i - 1]) {
      total += s;
      if (s < lowest) lowest = s;
      const ranked = [...maps[i - 1].entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length) {
        topValue[i - 1] = ranked[0][0];
        const topScore = ranked[0][1];
        const secondScore = ranked.length > 1 ? ranked[1][1] : topScore - 1;
        const regret = Math.max(0, topScore - s);
        assignedScore[i - 1] = s;
        maxRegret = Math.max(maxRegret, regret);
        if (topValue[i - 1] !== assign[i]) nonTop += 1;
        if (topScore - secondScore < 0.045) ambiguous += 1;
      }
    } else {
      wildcardUsed += 1;
    }
  }
  if (lowest < minScore || total / Math.max(1, constrained) < meanScore) return null;
  let pairwiseMargin = Infinity;
  for (let left = 0; left < n; left += 1) {
    if (!realCandidate[left]) continue;
    for (let right = left + 1; right < n; right += 1) {
      if (!realCandidate[right]) continue;
      const swappedLeft = maps[left].get(assign[right]);
      const swappedRight = maps[right].get(assign[left]);
      if (swappedLeft === undefined || swappedRight === undefined) continue;
      const loss = assignedScore[left] + assignedScore[right] - swappedLeft - swappedRight;
      pairwiseMargin = Math.min(pairwiseMargin, loss);
    }
  }
  // A different perfect matching decomposes into alternating cycles. Reduced
  // costs from the Hungarian dual are nonnegative; the shortest such cycle is
  // exactly the score gap to the second-best complete assignment, including
  // three-way and longer rotations that pairwise swap checks cannot see.
  const direct = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  for (let left = 0; left < n; left += 1) {
    for (let right = 0; right < n; right += 1) {
      if (left === right) continue;
      const value = assign[right + 1];
      const s = maps[left].get(value);
      if (s !== undefined) direct[left][right] = Math.max(0, -s - u[left + 1] - v[value]);
    }
  }
  const distance = direct.map((row, index) => {
    const copy = row.slice();
    copy[index] = 0;
    return copy;
  });
  for (let via = 0; via < n; via += 1) {
    for (let left = 0; left < n; left += 1) {
      if (!Number.isFinite(distance[left][via])) continue;
      for (let right = 0; right < n; right += 1) {
        const cost = distance[left][via] + distance[via][right];
        if (cost < distance[left][right]) distance[left][right] = cost;
      }
    }
  }
  let assignmentMargin = Infinity;
  for (let left = 0; left < n; left += 1) {
    for (let right = 0; right < n; right += 1) {
      if (left === right) continue;
      assignmentMargin = Math.min(assignmentMargin, direct[left][right] + distance[right][left]);
    }
  }
  return {
    numbers: assign.slice(1),
    meanScore: total / Math.max(1, constrained),
    minScore: lowest,
    wildcardUsed,
    ambiguous,
    nonTop,
    maxRegret,
    pairwiseMargin,
    assignmentMargin,
  };
};

/**
 * Recognizes a board position from a screenshot. The grid is located by
 * detecting the near-full-length dark lines instead of assuming margins, so
 * cropped, framed and zoomed screenshots still align. The input is treated as
 * a position, not a move record: analysis labels (green/blue points) never
 * become invented moves, and legible move numbers are reported separately.
 */
// ---------------------------------------------------------------------------
// 多核识谱（用户 09-14：把手机的处理器与内存用起来）
//
// 识别管线里真正吃时间的几段都是「图像 + 参数 → 结果」的纯函数：
//   1) 全局线梳拟合（行/列各一次）
//   2) 候选网格窗口评分（36×36 = 1296 次 scoreGridWindow，最大头 42%）
//   3) 局部线梳拟合（锁定一轴后重拟合另一轴）
//   4) 每个交点的特征分析（225 格）
// 这些批次彼此独立，可以分片到多个 worker 并行；而**顺序归约**（谁最优、
// 谁先达分、rejected 台账顺序）全部留在主线程按原顺序重放，所以开不开多核
// 的识别结果逐位相同——门禁 qa/recognition-parallel-parity.mjs 在语料上
// 逐张对照串行/并行两种模式的完整输出。
//
// 序号匹配（matchMoveNumbers）**不并行**：它依赖模块级的字体族投票校准状态
// （moveNumberFamilyVote），且模板渲染需要 canvas——worker 里 document 不存在，
// 字体栈解析结果可能不同，而那正是识谱里最脆的一环。它留在主线程。
// ---------------------------------------------------------------------------
export interface GridWindowQuery { originX: number; originY: number; spacingX: number; spacingY: number; boardSize: number }
export interface CombQuery {
  alongX: boolean;
  innerStart: number;
  innerEnd?: number;
  boardSize: number;
  limits?: { pool: number; seeds: number; output: number };
  spacingRange?: { minimum: number; maximum?: number };
}
export interface CellQuery { x: number; y: number; spacing: number }
/** 模型推理的坐标（2026-10-07）：行列为空时也允许（分片后顺序即身份，由派发方回收）。 */
/**
 * 识别池预热（2026-10-14）。从这里再导出一遍，而不是让调用方直接 import
 * recognition-accelerator：加速器在本文件里是动态 import 的，dev server 给被改过的文件
 * 加 `?t=` 时间戳，两条不同的 specifier 会解析成**两个模块实例**（两份 sharedPool），
 * 于是「预热建好的池识别器看不见」，白白重建（qa 探针踩过这个坑，现象离奇）。
 * 用**动态** import 转一手，走的解析路径与识别器内部那条完全一致 → 同一个实例；
 * 注意不能写成静态 `export ... from`——accelerator 静态 import 本模块，那就成环了
 * （dev server 里本模块的请求会整片挂住，实测踩过）。
 */
export const prewarmRecognitionPool = async (): Promise<boolean> => {
  const mod = await import("./features/recognition/recognition-accelerator");
  return mod.prewarmRecognitionPool();
};

export interface CellScanQuery { x: number; y: number; row?: number; col?: number }
/** cell-cls 的逐格占用/颜色（与 BoardCellEvidence 的前三项同义，无读数）。 */
export interface CellClass { pEmpty: number; pBlack: number; pWhite: number }
/** digit-head 的单次（单尺度）读数。 */
export interface DigitRead { digit: number; digitProb: number; digitTop: MoveNumberCandidate[] }
export interface MeshQuery {
  originX: number;
  originY: number;
  spacingX: number;
  spacingY: number;
  boardSize: number;
  sampleStep?: number;
}

/** 批处理执行器。主线程直算与 worker 池是同一种形状，调用点只有一条代码
 * 路径；两种实现的返回值必须逐位一致（否则并行就成了另一种识别器）。
 * 2026-10-07 起多了两件模型推理（scanCells/readDigits）：多核开关打开时它们
 * 在 worker 里跑（每 worker 一份 ORT 会话），关掉或池子失败时主线程直算。 */
export interface RecognitionAccelerator {
  scoreWindows(queries: readonly GridWindowQuery[]): Promise<Array<GridWindowQuality | null>>;
  meshSupports(queries: readonly MeshQuery[]): Promise<number[]>;
  fitCombs(queries: readonly CombQuery[]): Promise<CombFit[][]>;
  cellFeatures(queries: readonly CellQuery[]): Promise<IntersectionFeatures[]>;
  /** cell-cls 逐格占用/颜色；模型不可用时返回空数组（调用方按「没有补充」处理）。 */
  scanCells(queries: readonly CellScanQuery[], half: number, options?: ModelScanOptions): Promise<Array<CellClass | null>>;
  /** digit-head 单尺度读号；模型不可用时返回空数组。 */
  readDigits(queries: readonly CellScanQuery[], half: number, options?: ModelScanOptions): Promise<Array<DigitRead | null>>;
  /**
   * 手数序号逐子匹配（2026-10-10，模板段并行）：复原路径的最大单项。
   * 返回与 queries 等长的候选数组（每颗子一个 top-N 候选列表）。
   *
   * ⚠ 调用方必须保证：**只派字体族已锁定的子**，且 query 里带 `forceFamily`。
   * 因为族投票（本函数唯一的跨子状态）实测在第 4–37 颗子之间才锁定，锁定前必须在
   * 主线程串行跑。worker 侧走 `skipVote`，不写也不读全局投票状态。
   */
  matchMoveNumbers(queries: readonly MoveNumberQuery[]): Promise<MoveNumberCandidate[][]>;
  /**
   * worker 侧的模板渲染指纹（2026-10-10）：用于「两种画布栅格化是否一致」的运行时自检。
   * 主线程算 `moveNumberRenderFingerprint()`，与这个比对；两值相同才允许模板段并行。
   * 单线程加速器（`localAccelerator`）直接返回主线程的同一算法结果——它本来就在同一边。
   */
  renderFingerprint(): Promise<string | null>;
  /**
   * 预热模型会话（2026-10-14）：把每个 worker 里那份 ORT 编译 + 模型装载**提前**做掉。
   * 页面首次识别要等的那十几秒几乎全在这里（实测池#1 板面扫描 18.8s、池#2 仅 1.1s），
   * 所以 App 在「用户还在看首页 / 正在系统相册选图」时调用它来预热，真正识别时只需重发图像。
   * 只预热、不算任何东西，也不改变任何判定。可选：单线程直算的加速器没有这件事。
   */
  prewarmModels?(): Promise<boolean>;
  dispose(): void;
}

/** 一颗子的序号匹配请求（在主线程侧组装；见 RecognitionAccelerator.matchMoveNumbers）。 */
export interface MoveNumberQuery {
  row: number;
  col: number;
  x: number;
  y: number;
  player: Player;
  maxNumber: number;
  forceFamily: number;
  spacing: number;
}

/** 模型推理的可选参数（QA 指定 wasm 目录/线程数/模型地址；生产留空）。 */
export interface ModelScanOptions {
  wasmPaths?: string;
  threads?: number;
  cellModelUrl?: string;
  digitModelUrl?: string;
}

/** 单线程直算：逐条调用原函数、按原顺序返回，等价于接入加速器之前的代码。
 * 多核不可用（老 WebView、worker 构造失败、分片超时）时也回落用它。 */
/** 单线程直算时的一批查询上限。整批同步跑完会把主线程连同导入进度卡片一起冻住
 *  （iOS / 无法开 worker 的环境下就是「点了没反应」的观感，实测进度条甚至不动）。
 *  分块执行不改变任何计算、也不改变结果顺序，只是每块之间让出一次宏任务，
 *  界面得以重绘。分片从 worker 进来时每片通常远小于这个值，等于不额外开销。 */
const LOCAL_YIELD_EVERY = 256;
const mapWithYield = async <TItem, TResult>(
  items: readonly TItem[],
  run: (item: TItem) => TResult,
): Promise<TResult[]> => {
  const results = new Array<TResult>(items.length);
  for (let start = 0; start < items.length; start += LOCAL_YIELD_EVERY) {
    const end = Math.min(items.length, start + LOCAL_YIELD_EVERY);
    for (let index = start; index < end; index += 1) results[index] = run(items[index]);
    if (end < items.length) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
  return results;
};

export const localAccelerator = (image: SampledImage): RecognitionAccelerator => ({
  scoreWindows: (queries) => mapWithYield(
    queries,
    (q) => scoreGridWindow(image, q.originX, q.originY, q.spacingX, q.spacingY, q.boardSize),
  ),
  meshSupports: (queries) => mapWithYield(
    queries,
    (q) => intersectionMesh(image, q.originX, q.originY, q.spacingX, q.spacingY, q.boardSize, q.sampleStep ?? 1).support,
  ),
  fitCombs: (queries) => mapWithYield(
    queries,
    (q) => fitCombSeries(
      collectLineScores(image.gray, image.width, image.height, q.alongX, q.innerStart, q.innerEnd),
      q.boardSize,
      q.limits,
      q.spacingRange,
    ),
  ),
  cellFeatures: (queries) => mapWithYield(queries, (q) => analyzeIntersection(image, q.x, q.y, q.spacing)),
  // 模型推理（2026-10-07）：单线程直算时就在主线程跑同一份 model-inference；
  // 模型加载失败/环境不支持 → 返回 null 占位（调用方把它当「这一格没有补充」）。
  // 与 worker 上的实现共用 `model-inference.ts`，因此并行与串行结果逐位相同。
  scanCells: async (queries, half, options) => {
    const values = await classifyCells(image, queries, half, options);
    return queries.map((_, index) => values?.[index] ?? null);
  },
  readDigits: async (queries, half, options) => {
    const values = await readDigitCandidates(image, queries, half, options);
    return queries.map((_, index) => values?.[index] ?? null);
  },
  // 手数序号逐子匹配（2026-10-10）：主线程直算版。worker 侧同一份实现（本函数就是
  // 那个实现），只是渲染落到 OffscreenCanvas——实测与主线程 HTMLCanvas 逐位相同。
  // 注意 `skipVote = true`：这一条永远不参与族投票（投票只在主线程串行段发生），
  // 于是单线程与多线程的返回值完全一致。
  matchMoveNumbers: async (queries) => mapWithYield(
    queries,
    (q) => matchMoveNumbers(image, q.x, q.y, q.spacing, q.player, q.maxNumber, q.forceFamily, true),
  ),
  // 单线程加速器与调用方同在主线程、同一块画布：指纹必然相同（恒等）。
  renderFingerprint: async () => moveNumberRenderFingerprint(),
  dispose: () => { /* 无资源可释放 */ },
});

const recognizeBoardImageOnce = async (file: File, boardSize: number, opts: RecognizeOptions = {}): Promise<ImageRecognitionResult> => {
  // boardSize = 0 是「自动识别路数」的哨兵（实验功能）：真正的路数在解码出图像、
  // 建好加速器之后才检测得出，所以这里只放行 0，不校验为合法路数。
  if (boardSize !== 0 && !isSupportedBoardSize(boardSize)) throw new Error("棋盘尺寸必须在 5–30 路之间");
  const loaded = await loadRasterImage(file);
  const { image } = loaded;
  // 声明在 try 之外：无论识别成功还是抛错，finally 都要把 worker 池收掉。
  let accelerator: RecognitionAccelerator | null = null;
  try {
    Object.assign(moveOrderPerf, { decodeMs: 0, detectMs: 0, gridMs: 0, combMs: 0, cellFeatMs: 0, digitMs: 0, digitHeadMs: 0, boardScanMs: 0, assignMs: 0, gridWindows: 0, wEarly: 0, stones: 0, sweeps: 0, sweepValues: 0, templateBuilds: 0, rowClears: 0, flatClears: 0, probeMedian: -1, probeLegible: -1, probeSkipped: false, gridBatchMs: 0, gridBatchWindows: 0, gridPhaseMs: 0, gridPhaseWindows: 0, renderMs: 0, sweepMs: 0, scoreCalls: 0, templateCalls: 0, distinctSizes: 0, sweepsByStage: [0, 0, 0, 0, 0], sweepStage: 0, parallelScoreMs: 0, parallelScoreStones: 0 });
    moveNumberSizeBuckets.clear();
    const tDecode0 = performance.now();
    const sourceWidth = image.width;
    const sourceHeight = image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("图片没有有效尺寸");

    // Keep the whole frame (no crop): the grid detector locates the board by
    // its lines wherever it sits. Long side is capped for memory; tiny images
    // are upscaled to a 320px long side with the ASPECT RATIO PRESERVED.
    //
    // 2026-10-02 修：旧写法对两个轴各自 `Math.max(320, ...)`，把 217×241 的
    // 小图硬拉成 320×320（x 放大 1.47 倍、y 1.33 倍）——棋盘被拉得不成正方形，
    // 小尺寸书谱扫描件上棋子检测大面积失控（实测一张 10 子的茶馆图读出 62 子，
    // 成片假白子）。旧注释自己都写了「不成比例」，这次真正改成等比。
    const longSide = Math.max(sourceWidth, sourceHeight);
    const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
    const canvasWidth = Math.max(1, Math.round(sourceWidth * scale));
    const canvasHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("当前浏览器不支持图片识谱");
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, canvasWidth, canvasHeight);
    const data = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
    const sampled = createSampledImage(data, canvasWidth, canvasHeight);
    const gray = sampled.gray;
    moveOrderPerf.decodeMs = Math.round(performance.now() - tDecode0);
    const tDetect0 = performance.now();

    // 多核加速（设置「可选增强功能 · 识谱多核加速」）：按设备核心数与可用
    // 内存起一个 worker 池并行算那几段纯函数批次。任何一步失败都静默回落
    // 单线程直算——加速是优化，绝不能变成识别失败的原因。
    if (opts.parallel) {
      try {
        const { createParallelAccelerator } = await import("./features/recognition/recognition-accelerator");
        // 传了 boardScanner 意味着这批识别要跑模型扫描（补位/读号）——那些分片在
        // worker 里各持一份 ORT 会话与模型，池大小按内存算时要把它计进去
        // （见 planRecognitionPool 的 withModelSessions）。
        accelerator = await createParallelAccelerator(sampled, { modelSessions: Boolean(opts.boardScanner) });
      } catch (error) {
        console.warn("[banbu-image-accelerator] 多核识谱不可用，回落单线程", error);
        accelerator = null;
      }
    }
    const acc = accelerator ?? localAccelerator(sampled);
    /**
     * 模板段并行的**运行时准入**（2026-10-10）：两种画布的字体栅格化一致才允许并行。
     *
     * 为什么必须自检而不是信桌面实测：worker 里只有 OffscreenCanvas，而它的文字
     * 栅格化在安卓 WebView 上未必与 HTMLCanvas 一致（字体栈/子像素策略可能不同）。
     * 桌面 Chromium 实测 142/142 逐位相同，但那不能代替真机证据——**识别结果不能赌**。
     *
     * 做法：识别器在 worker 里算一次 `moveNumberRenderFingerprint()`，与主线程的比对；
     * 一致 → 走并行；不一致或算不出来 → 静默回退串行（结果永远正确，最坏只是不加速）。
     * 只在真的要跑模板段时开销一次，且带缓存（同一进程内只问一次池）。
     */
    let scoreParallelEnabled = false;
    if (!opts.skipMoveOrder && accelerator) {
      try {
        const main = moveNumberRenderFingerprint();
        const workerFp = await accelerator.renderFingerprint();
        // 两道门缺一不可：① 两种画布栅格化一致（结果正确性）；② 主线程确实慢（值不值得）。
        // 第②道是实测逼出来的：桌面不降频时并行**净亏 61%**（worker 重建模板缓存 +
        // 与模型扫描争 CPU，见 measureMainThreadScoreCost 的表格），而手机（降频 3×+）
        // 才净赚 51–71%。门槛让桌面自动走串行（不退步）、手机自动走并行（拿收益）。
        const gateOverride = (globalThis as typeof globalThis & { __BANBU_SCORE_PARALLEL_MIN_MS__?: number }).__BANBU_SCORE_PARALLEL_MIN_MS__;
        const threshold = gateOverride === undefined ? MOVE_NUMBER_MAIN_COST_MIN_MS : Number(gateOverride);
        // localSpacing 要等网格定了才算得出来，而这里（网格之前）就要判是否并行。
        // 探测用一个典型格距（40px ≈ 常见截图的 2/3）——它只影响探测时用的裁剪窗口大小，
        // 对「这台机器单核快不快」的判断无实质影响（实测 20/40/70px 三档的结论一致）。
        const mainCost = threshold > 0 ? measureMainThreadScoreCost(40) : 0;
        const slowEnough = threshold <= 0 || mainCost >= threshold;
        scoreParallelEnabled = Boolean(main) && main === workerFp && slowEnough;
        if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
          console.info("[banbu-score-parallel]", JSON.stringify({
            main, workerFp, mainCostMs: Math.round(mainCost * 10) / 10, threshold, slowEnough, enabled: scoreParallelEnabled,
          }));
        }
      } catch (error) {
        // 自检失败一律当「不许并行」——宁慢不错（与多核加速同一纪律）。
        scoreParallelEnabled = false;
        console.warn("[banbu-score-parallel] 渲染一致性自检失败，模板段走串行", error);
      }
    }

    // 自动路数（实验功能，2026-09-16）：boardSize = 0 表示「不限 15 路」。检测出
    // 路数后，boardSize 变量改由检测结果决定，下面的网格探测、逐格分析、序号匹配
    // 全部按这个路数走——它们本来就与路数无关（只依赖 boardSize 参数）。
    // 检测失败（返回 null）时回落到 15 路：宁可给一个可能不对的默认，也不要让导入
    // 直接失败；note 里会说明。
    let detectedBoardSize: number | null = null;
    let autoSizeNote = "";
    if (boardSize === 0) {
      boardSize = 15;
      const detection = await detectBoardSize(sampled, acc);
      if (detection) {
        boardSize = detection.boardSize;
        detectedBoardSize = detection.boardSize;
        autoSizeNote = `自动识别为 ${detection.boardSize} 路（把握 ${Math.round(detection.confidence * 100)}%）`;
        if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
          console.info("[banbu-image-boardsize]", JSON.stringify(detection));
        }
      } else {
        autoSizeNote = "路数未能自动识别，按 15 路处理";
      }
    }

    // 复用上一次的网格几何（2026-10-09：「复原手序」复用「导入」那一次的结果）。
    // 同一张图、同一画布缩放 → 网格必然逐值相同，重探测纯属白花时间
    // （实测 5～7.6 秒，占导入的一半）。只跳过探测这一步，后面全部照旧。
    //
    // 安全门：复用前按当前画布做一次边界体检——跨版本升级后 canvas 上限可能变过，
    // 旧几何可能越界；那种情况一律回落到重新探测（宁慢不错）。
    const reusedGrid = (() => {
      if (!opts.knownGrid) return null;
      const { originX, originY, spacingX, spacingY } = opts.knownGrid;
      if (!(spacingX > 0) || !(spacingY > 0)) return null;
      if (originX < 0 || originY < 0) return null;
      if (originX + (boardSize - 1) * spacingX >= canvasWidth) return null;
      if (originY + (boardSize - 1) * spacingY >= canvasHeight) return null;
      return { originX, originY, spacingX, spacingY, quality: 1 };
    })();
    let grid = reusedGrid ?? await detectGrid(sampled, boardSize, opts.roi, acc);
    // Fallback: legacy fixed-inset geometry, still better than failing hard.
    // 用户框选（ROI）存在时以框为中心生成网格——整屏截图（含状态栏/UI）在
    // 网格探测失败时，标准边距会落在页面中间的错误位置，框选直接救回。
    const fallback = !grid;
    if (!grid) {
      if (opts.roi && opts.roi.w > 0 && opts.roi.h > 0) {
        const roiW = opts.roi.w * canvasWidth, roiH = opts.roi.h * canvasHeight;
        const side = Math.max(32, Math.min(roiW, roiH));
        const span = side * 0.94;
        const centerX = (opts.roi.x + opts.roi.w / 2) * canvasWidth;
        const centerY = (opts.roi.y + opts.roi.h / 2) * canvasHeight;
        const spacing = span / (boardSize - 1);
        grid = { originX: centerX - span / 2, originY: centerY - span / 2, spacingX: spacing, spacingY: spacing, quality: 0.45 };
      } else {
        const inset = canvasWidth * 0.055;
        const span = canvasWidth - inset * 2;
        const spacing = span / (boardSize - 1);
        grid = { originX: inset, originY: canvasHeight * 0.5 - span / 2, spacingX: spacing, spacingY: spacing, quality: 0.5 };
      }
    }
    // 相位校正（2026-09-11）：无坐标/弱外框的棋盘，15 线梳齿拟合可能整体偏移
    // 一格，识别出的子整体错位一行。用户实测（2026-09-11 拍板）：识别出的子
    // 比真实位置「整体上移一格」——即拟合网格比真实棋盘高一格，修正是把
    // 网格下移一格（dy=+1，识别标签 +1）。
    // 证据模式（repro.jpg 实测）：拟合线 0 空白（棋盘上缘留白）、真实顶线
    // 落在拟合线 1 处且为最强线；下半线常因 2~3px 累积漂移测不到证据
    // （前置度 frontLoad≤12），并非图里真的缺线。
    // 正则性门控：棋盘内部线条强度应均匀（std/mean<0.25）；「顶线外侧有
    // 一条超强线」且内部参差（user-crop-test 实测，34%）是 UI 分隔线诱饵——
    // 修正前网格才对，不得校正（dy=-1/两向 dx 方向零实证已被移除）。
    //
    // 2026-09-15 追加（手机精度轮）：这条校正**在整屏截图上有已知的误判面**
    // ——102 张真机截图语料实测（p360x3/整屏）它把本来正确的拟合又下移一格，
    // 于是识别出的盘「子数对、位置整体错一格、颜色全对」，而且置信度照样 0.8，
    // 用户看不出问题（同一盘棋的棋盘裁切图没有这个误判，因为棋盘上方是干净的
    // 盘面）。这根证据链（顶线弱、次线强、下界外无证据）**同时**对「真错一格」
    // 与「顶线只是没测到」成立，靠现有信号无法区分，故作不动几何、只做透明：
    // 触发过校正就把这件事写进 note，让用户去核对行列。
    let phaseShifted = false;
    if (!fallback && grid) {
      const strengthAt = (fixed: number, alongX: boolean): number => {
        const span = alongX ? canvasWidth : canvasHeight;
        const inner = alongX ? canvasHeight : canvasWidth;
        const f = Math.round(fixed);
        if (f <= 0 || f >= span - 1) return 0;
        let hits = 0, samples = 0;
        for (let i = 1; i < inner - 2; i += 1) {
          const center = alongX ? gray[f * canvasWidth + i] : gray[i * canvasWidth + f];
          const a = alongX ? gray[(f - 1) * canvasWidth + i] : gray[i * canvasWidth + f - 1];
          const b = alongX ? gray[(f + 1) * canvasWidth + i] : gray[i * canvasWidth + f + 1];
          const contrast = Math.abs(center - (a + b) / 2);
          const nd = Math.abs(a - b);
          if (contrast > 10 && nd < 55 && contrast > nd * 0.22) hits += 1;
          samples += 1;
        }
        return samples ? hits / samples : 0;
      };
      let dy = 0;
      const oy = grid.originY, sy = grid.spacingY;
      // 粗线（棋盘最外圈外框）探针：`strengthAt` 用的是「中心比 ±1 邻域暗」的**细线**
      // 签名，而外框线连 ±1 邻域一起暗，contrast 很小 —— 它**量不到外框**。
      // 这正是「顶线弱」的另一种成因：拟合线 0 本来就是棋盘外框，拟合本来是对的，
      // 但被读成「真顶线在下一格」于是把网格整体下推一格（102 张真机截图语料实测，
      // p360x3 整屏大面积如此，同一盘棋的裁切图不受影响）。这里改测「以该行为中心的
      // 暗带」：中心窗口明显暗于两侧窗口即为一条线（粗线也算），用它判断拟合线 0
      // 到底是「棋盘外框」还是「上缘留白」。
      const bandAt = (fixed: number): number => {
        const f = Math.round(fixed);
        if (f - 5 <= 0 || f + 5 >= canvasHeight - 1) return 0;
        let hits = 0, samples = 0;
        for (let i = 1; i < canvasWidth - 2; i += 1) {
          let center = 0;
          for (let d = -2; d <= 2; d += 1) center += gray[(f + d) * canvasWidth + i];
          center /= 5;
          let outer = 0;
          for (const d of [-5, -4, -3, 3, 4, 5]) outer += gray[(f + d) * canvasWidth + i];
          outer /= 6;
          if (outer - center > 12) hits += 1;
          samples += 1;
        }
        return samples ? hits / samples : 0;
      };
      const topBand = bandAt(oy);
      const top = strengthAt(oy, true);
      const second = strengthAt(oy + sy, true);
      const below = strengthAt(oy + 15 * sy, true);
      let frontLoadRows = 0;
      const rowVals: number[] = [];
      for (let k = 1; k <= 14; k += 1) {
        const v = strengthAt(oy + k * sy, true);
        rowVals.push(v);
        if (v > second * 0.4) frontLoadRows = k;
      }
      const interior = rowVals.filter((v) => v > second * 0.4);
      let uniform = false;
      if (interior.length >= 4) {
        const mean = interior.reduce((s, v) => s + v, 0) / interior.length;
        const std = Math.sqrt(interior.reduce((s, v) => s + (v - mean) * (v - mean), 0) / interior.length);
        uniform = mean > 0 && std / mean < 0.25;
      }
      // A shift is only meaningful while the corrected board still lies inside
      // the image. An edge-crowded top row (stones sitting on the border line
      // hide it, so `top` measures weak while the next line down measures
      // strong) made this fire on a board whose fitted origin was already
      // correct: the shift pushed the bottom line past the frame — originY
      // 113.7 with spacing 57.6 on a 916px image, i.e. the whole position read
      // exactly one row low. Requiring the shifted window to fit keeps the
      // genuine case the correction was built for (a real top margin, where the
      // board still ends on its own bottom line after the shift).
      const shiftedBottom = oy + boardSize * sy;
      const shiftFits = shiftedBottom <= canvasHeight - 1;
      // `topBand >= 0.25`＝拟合线 0 上确实压着一条线（粗线也算，很可能是棋盘外框）
      // → 拟合本来就是对的，顶线「弱」只是细线签名量不到粗线，不得下推。
      // 上缘留白（真顶线在下一格）时 line 0 落在空白上，topBand 接近 0，照旧允许校正。
      if (uniform && shiftFits && top < second * 0.6 && second > 0.08 && topBand < 0.25 && (below > second * 0.6 || frontLoadRows <= 12)) dy = 1;
      if (dy) {
        grid = { ...grid, originY: oy + dy * sy, quality: Math.min(0.65, grid.quality + 0.06) };
        phaseShifted = true;
        if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
          console.info("[banbu-image-phase-fix]", JSON.stringify({ dy, strengths: { top, second, below }, frontLoadRows, uniform }));
        }
      }
    }
    if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
      console.info("[banbu-image-grid]", JSON.stringify({
        file: file.name,
        canvasWidth,
        canvasHeight,
        fallback,
        grid,
      }));
    }
    const board: Cell[][] = Array.from({ length: boardSize }, () => Array<Cell>(boardSize).fill(null));
    let numberedMoves: Array<Position & { player: Player; number: number }> = [];
    const numberCandidates: MoveNumberCandidate[][] = [];
    /** 模板原始候选池的快照（逐子并行于 numberCandidates）：读数合并只改池子、不动它，
     *  逐子清单按它决定「显示模板的读数还是数字头的读数」（见 rebuildNumberedMoves）。 */
    const templatePools: MoveNumberCandidate[][] = [];
    const numberStones: Array<{ row: number; col: number; player: Player }> = [];
    // 与 numberStones 平行的画布像素中心：数字头批量读号按它裁格（补位子不在
    // candidates 里，没有 x/y，只能从这里拿）。
    const stoneCenters: Array<{ x: number; y: number }> = [];
    let moveOrderQuality: MoveOrderQuality | undefined;
    let autoSequenceRejected = false;
    /** 「多认了一颗子」补救时被排除编号的那颗子（见装配段的 extra-stone 补救）；只用于 note/trace。 */
    let droppedClaim: { row: number; col: number; value: number } | null = null;
    let candidates: Array<{ row: number; col: number; x: number; y: number; features: IntersectionFeatures; hollowRescue?: boolean }> = [];
    let ignoredColoredMarkers = 0;
    let hollowLikeCount = 0;
    const localSpacing = Math.min(grid.spacingX, grid.spacingY);
    const debugPoints: Array<Record<string, unknown>> = [];
    // Every intersection's features, kept so the hollow-stone rescue below can
    // look at a cell's neighbours.
    const featureGrid: Array<Array<{ features: IntersectionFeatures; x: number; y: number } | null>> = [];

    // 逐格特征分析（225 格）彼此独立，攒成一批交给加速器并行；填格仍按原来的
    // 逐行逐列顺序重放，所以 featureGrid / candidates / debugPoints 的顺序不变。
    const cellQueries: CellQuery[] = [];
    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        const x = grid.originX + col * grid.spacingX;
        const y = grid.originY + row * grid.spacingY;
        if (x < 3 || y < 3 || x > canvasWidth - 4 || y > canvasHeight - 4) continue;
        cellQueries.push({ x, y, spacing: localSpacing });
      }
    }
    moveOrderPerf.gridMs = Math.round(performance.now() - tDetect0);
    const tCell0 = performance.now();
    const cellFeatures = await acc.cellFeatures(cellQueries);
    moveOrderPerf.cellFeatMs = Math.round(performance.now() - tCell0);
    let cellCursor = 0;
    for (let row = 0; row < boardSize; row += 1) {
      featureGrid.push([]);
      for (let col = 0; col < boardSize; col += 1) {
        const x = grid.originX + col * grid.spacingX;
        const y = grid.originY + row * grid.spacingY;
        if (x < 3 || y < 3 || x > canvasWidth - 4 || y > canvasHeight - 4) { featureGrid[row].push(null); continue; }
        const features = cellFeatures[cellCursor];
        cellCursor += 1;
        featureGrid[row].push({ features, x, y });
        // Printed-diagram signature: a thin dark outline around a paper-lit
        // middle with a mostly-light disc. Counted here because the balance
        // filter below must not run on such a board (see there).
        if (features.middleShare <= 0.26 && features.outerShare >= 0.36 && features.ringShare >= 0.17
          && features.diagonalShare >= 0.2 && features.darkDiscShare < 0.5) hollowLikeCount += 1;
        if (features.stoneLike) candidates.push({ row, col, x, y, features });
        else if (features.markerLike) ignoredColoredMarkers += 1;
        debugPoints.push({
          rc: `${String.fromCharCode(65 + col)}${boardSize - row}`,
          s: features.stoneLike ? 1 : 0,
          c: features.foregroundColor,
          l: Math.round(features.foregroundLight),
          b: Math.round(features.backgroundLight),
          core: Math.round(features.coreShare * 100) / 100,
          mid: Math.round(features.middleShare * 100) / 100,
          out: Math.round(features.outerShare * 100) / 100,
          disc: Math.round(features.discShare * 100) / 100,
          ring: Math.round(features.ringShare * 100) / 100,
          dg: Math.round(features.diagonalShare * 100) / 100,
          dr: Math.round(features.diagonalReach * 1000) / 1000,
          sat: Math.round(features.foregroundSaturation),
          th: Math.round(features.differenceThreshold),
          sp: Math.round(features.backgroundSpread),
          vd: Math.round(features.voidShare * 100) / 100,
          st: features.stubCount,
          dd: Math.round(features.darkDiscShare * 100) / 100,
          db: Math.round(features.darkBelowShare * 100) / 100,
          cs: Math.round(features.discCoreSpread),
          cd: Math.round(features.discCoreDistance),
          rf: Math.round(features.discRawFillShare * 100) / 100,
          il: Math.round(features.interiorLightShare * 100) / 100,
          rs: Math.round(features.ringSectorCoverage * 100) / 100,
          fl: Math.round(features.foregroundLight),
          fg: features.foregroundColor,
          vds: Math.round(features.voidSpread),
          hres: isStrongPrintedHollowRescue(features),
          ml: features.markerLike,
        });
      }
    }
    if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
      console.info("[banbu-image-points]", JSON.stringify(debugPoints));
    }

    // Hollow-stone rescue, gated on neighbours. A printed white stone is a thin
    // dark ring around a paper-lit middle, and the same board measures that ring
    // a little lower in one capture than in another: a phone capture of a book
    // diagram lost F5/E4/I2 this way while the desktop copy of the same board
    // kept all 43 stones, two of the lost ones white. Granting the slack to
    // every cell costs false positives wherever a UI page draws circles
    // (measured 9 extra "stones" on a screenshot asset), so it is granted only
    // inside a stone cluster — a cell with at least two occupied neighbours,
    // which is what a diagram stone nearly always has and a stray page circle
    // does not. Two, not three: on a softened capture the two rescued white
    // stones measured only two occupied neighbours because the surrounding
    // cells had also weakened. Off-board neighbours do not count, or an edge
    // would supply them for free.
    const occupiedKeys = new Set(candidates.map((candidate) => `${candidate.row},${candidate.col}`));
    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        const key = `${row},${col}`;
        if (occupiedKeys.has(key)) continue;
        const cell = featureGrid[row]?.[col];
        if (!cell) continue;
        const features = cell.features;
        // 空心白子签名与下面的颜色判定共用同一个谓词（见 isHollowPrintedStone）：
        // 救回来的子必须和「它为什么是白的」用同一套几何证据，否则会出现
        // 救回了子、却把它涂成黑色（线上手机的实测现象）。
        const strongRescue = isStrongPrintedHollowRescue(features);
        if (!strongRescue && !isHollowPrintedStone(features)) continue;
        let neighbours = 0;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (!dr && !dc) continue;
            const r = row + dr, c = col + dc;
            if (r < 0 || c < 0 || r >= boardSize || c >= boardSize) continue;
            if (occupiedKeys.has(`${r},${c}`)) neighbours += 1;
          }
        }
        // Fully closed, paper-lit rings are distinctive enough to accept on
        // their own.  Weaker signatures retain the original two-neighbour
        // cluster gate, which protects screenshots containing isolated UI
        // circles or decorative marks.
        if (!strongRescue && neighbours < 2) continue;
        candidates.push({ row, col, x: cell.x, y: cell.y, features, hollowRescue: strongRescue });
        occupiedKeys.add(key);
        if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
          console.info("[banbu-image-hollow-rescue]", JSON.stringify({
            rc: `${String.fromCharCode(65 + col)}${boardSize - row}`,
            ring: Math.round(features.ringShare * 100) / 100,
            diagonal: Math.round(features.diagonalShare * 100) / 100,
            outer: Math.round(features.outerShare * 100) / 100,
            middle: Math.round(features.middleShare * 100) / 100,
            neighbours,
            strong: strongRescue,
          }));
        }
      }
    }

    // A cropped board can make the outer border look like a broad stone: the
    // grid frame supplies the dark disc and the clipped side supplies the
    // apparent fill, but there is no closed annulus around the intersection.
    // Only apply this to dense positions; sparse positions may legitimately
    // contain a real edge stone whose ring is partly outside the photo.
    if (candidates.length >= 20) {
      // 阈值取 0.75 而不是「子盘半径 0.46」：2026-10-06 量过本地全部外部真值图，
      // 四边距都 >0.75 格（hires-test 1.02~2.3、paper10 1.27、user-99-43 1.5、
      // numbered.png 3.2），所以这道门对**外部素材**从未触发；而放宽到 0.46 的
      // 唯一实测效果，是让真被裁切的手机图（2BC1F970，左边距 0.60）多出 2 个
      // 纸色团块假子。放宽的收益只出现在自家渲染的 boardsize-corpus 上，
      // 那类主题不是适配目标（用户 2026-10-06 指示：识谱要吃的是外部图）。
      // 要重开这条线，先在外部素材上找到「盘边真子被这道门删掉」的实例。
      const edgeMargin = (margin: number) => margin >= 0 && margin < 0.75;
      const leftCropped = edgeMargin(grid.originX / grid.spacingX);
      const rightCropped = edgeMargin((canvasWidth - grid.originX - (boardSize - 1) * grid.spacingX) / grid.spacingX);
      const topCropped = edgeMargin(grid.originY / grid.spacingY);
      const bottomCropped = edgeMargin((canvasHeight - grid.originY - (boardSize - 1) * grid.spacingY) / grid.spacingY);
      candidates = candidates.filter((candidate) => {
        const croppedEdge = (candidate.col === 0 && leftCropped)
          || (candidate.col === boardSize - 1 && rightCropped)
          || (candidate.row === 0 && topCropped)
          || (candidate.row === boardSize - 1 && bottomCropped);
        return !croppedEdge || candidate.features.ringSectorCoverage >= 0.25;
      });
    }

    // 用户框选（ROI）时，把网格交叉点里落在框外（外扩 25%）的候选直接排除——
    // 整屏截图里网格窗若错位到状态栏/文字上，这些假子正是「多子」的来源。
    if (opts.roi && opts.roi.w > 0 && opts.roi.h > 0) {
      const roiX0 = opts.roi.x * canvasWidth, roiY0 = opts.roi.y * canvasHeight;
      const roiX1 = (opts.roi.x + opts.roi.w) * canvasWidth, roiY1 = (opts.roi.y + opts.roi.h) * canvasHeight;
      const pad = Math.max(roiX1 - roiX0, roiY1 - roiY0) * 0.25;
      candidates = candidates.filter((candidate) => {
        const px = grid!.originX + candidate.col * grid!.spacingX;
        const py = grid!.originY + candidate.row * grid!.spacingY;
        return px >= roiX0 - pad && px <= roiX1 + pad && py >= roiY0 - pad && py <= roiY1 + pad;
      });
    }

    // The app draws its "five in a row" victory pill over the top-centre of
    // the board. Its body reaches the second grid row, so the two top rows
    // need targeted checks; everything else keeps its normal classification.
    // Both top rows use the same test. The pill is a horizontal BAND: at a cell
    // it covers, the band continues outside the stone's disc, so the void band
    // stays overlay-coloured (voidShare 0.41-0.44 on a rendered win) while a
    // real stone sits in its own cell with board around it (0.06-0.14) —
    // including WHITE stones, whose stub count measures an unreliable 1 for
    // both classes. Row 0 previously demanded two stubs instead, which deleted
    // genuine top-row stones (a 54-stone rendered record lost its stone and 13
    // move numbers) and still admitted band blobs with three stubs.
    const boardCenterCol = (boardSize - 1) / 2;
    candidates = candidates.filter((candidate) => {
      if (candidate.row > 1 || Math.abs(candidate.col - boardCenterCol) > 3.2) return true;
      const features = candidate.features;
      // The overlay body is BRIGHTER than the board on every theme, so a disc
      // that is overwhelmingly darker than the board cannot be the pill: a dark
      // stone under the pill edge is DARKER than the board, and its disc still
      // holds the stone's own dark pixels whatever the overlay does.
      if (features.darkDiscShare >= 0.3) return true;
      if (
        features.voidShare >= 0.4
        && features.coreShare >= 0.65
        && features.foregroundLight >= features.backgroundLight + 20
      ) return false;
      return true;
    });

    if (!candidates.length) throw new Error("没有找到可靠棋子，请确保棋盘完整可见并提高图片清晰度");

    // Separate materials in RGB space, not luminance alone. Pink/teal kawaii
    // stones and blue/gold jewel stones can have overlapping brightness near
    // highlights, while their colour centroids remain clearly distinct.
    // Plain 2-means WITHOUT a forced half/half split: detection legitimately
    // misses stones of one material, and forcing the balance then recolours
    // correctly found stones to fill the quota.
    const sortedCandidates = candidates.slice().sort((left, right) => left.features.foregroundLight - right.features.foregroundLight);
    const lights = sortedCandidates.map((candidate) => candidate.features.foregroundLight);
    const lightRange = lights[lights.length - 1] - lights[0];
    const clusteredPlayers = new Map<typeof candidates[number], Player>();
    if (candidates.length >= 2) {
      const seedCount = Math.max(1, Math.ceil(candidates.length * 0.2));
      const colorMedian = (items: typeof candidates): Rgb => [
        median(items.map((candidate) => candidate.features.foregroundColor[0])),
        median(items.map((candidate) => candidate.features.foregroundColor[1])),
        median(items.map((candidate) => candidate.features.foregroundColor[2])),
      ];
      let blackCentroid = colorMedian(sortedCandidates.slice(0, seedCount));
      let whiteCentroid = colorMedian(sortedCandidates.slice(-seedCount));
      let blackCandidates: typeof candidates = [];
      let whiteCandidates: typeof candidates = [];
      for (let iteration = 0; iteration < 6; iteration += 1) {
        blackCandidates = [];
        whiteCandidates = [];
        for (const candidate of candidates) {
          // A dark stone under the victory-pill edge keeps a glow-polluted
          // median colour (teal) that lands it in the pale cluster; its own
          // colour lives in the darkest quartile of the foreground.
          const color = candidate.features.darkDiscShare >= 0.3
            ? candidate.features.foregroundDarkColor
            : candidate.features.foregroundColor;
          if (rgbDistance(color, whiteCentroid) - rgbDistance(color, blackCentroid) >= 0) {
            blackCandidates.push(candidate);
          } else {
            whiteCandidates.push(candidate);
          }
        }
        if (!blackCandidates.length || !whiteCandidates.length) break;
        blackCentroid = colorMedian(blackCandidates);
        whiteCentroid = colorMedian(whiteCandidates);
      }
      const materialSeparation = rgbDistance(blackCentroid, whiteCentroid);
      if ((materialSeparation >= 12 || lightRange >= 10) && blackCandidates.length && whiteCandidates.length) {
        blackCandidates.forEach((candidate) => clusteredPlayers.set(candidate, "black"));
        whiteCandidates.forEach((candidate) => clusteredPlayers.set(candidate, "white"));
      }
    }

    let score = 0;
    moveOrderPerf.detectMs = Math.round((performance.now() - tDecode0 - moveOrderPerf.decodeMs) * 10) / 10;
    moveOrderPerf.stones = candidates.length;
    const tDigit0 = performance.now();
    // 探针状态：必须「子数多 **且** 占用率高」才启用，前 12 颗子读数决定后面还扫不扫。
    // 见 MOVE_PROBE_SAMPLES / MOVE_PROBE_MIN_OCCUPANCY 处的说明与真实图回归教训。
    const denseOccupancy = boardSize >= 5 ? candidates.length / (boardSize * boardSize) : 0;
    let probeDecided = !(candidates.length >= MOVE_PROBE_MIN_STONES && denseOccupancy >= MOVE_PROBE_MIN_OCCUPANCY);
    let moveOrderSkipped = false;
    let probeLegible = 0;
    const probeTops: number[] = [];
    /**
     * 模板段并行（2026-10-10）：待并行处理的棋子队列。
     *
     * 设计：`matchMoveNumbers` 唯一的跨子状态是字体族投票（实测第 4–37 颗子锁定，
     * 且 `vote.decided` 一旦 >= 0 就**再也不会变**——写入只发生在 `decided < 0` 的守卫里）。
     * 所以逐子循环天然分成两段：
     *   · **投票期**：必须主线程串行（要写投票状态），一边跑一边把**这颗子的所需信息**
     *     攒进 `pendingScore`；
     *   · **锁定后**：`vote.decided >= 0`，此时每颗子是纯函数（图像 + 坐标 + player +
     *     limit + forceFamily），可以整批丢给 worker 池并行。
     *
     * 为什么攒「信息」而不是「结果」：投票期的子已经跑完了，没必要重跑；攒的是
     * **之后新遇到的子**的坐标。第一颗子遇到时若已锁定，就直接进 pending，等循环
     * 走完一次性并行（避免边走边发导致的分片碎片化）。
     */
    const pendingScore: MoveNumberQuery[] = [];
    /** pendingScore 里第 i 条对应的 numberCandidates 下标（回填用）。 */
    const pendingSlot: number[] = [];
    /** 是否允许把锁定后的子交给 worker（由识别器按环境决定，见 scoreParallelEnabled）。 */
    const scoreParallel = !opts.skipMoveOrder && accelerator !== null && scoreParallelEnabled;
    /**
     * `knownBoard` 覆盖（2026-10-13 真正实现；接口 2026-10-09 就声明了但一直是空壳，
     * App 也从没传过）。语义：**只在这些格上读号**——位置与颜色以调用方给的棋盘为准。
     *
     * 为什么必须有：核对屏的「去子/改色」只存在组件内部，复原那一趟却是拿原文件**重新
     * 找子**，于是用户刚删掉的那颗（多半是补位假阳）又冒出来；而复原成功会锁住编辑，
     * 他连再删一次都做不到（用户 2026-10-13 报的原话：「去掉识谱多出来的那个子的时候，
     * 再复原手序，那个子又跟着冒出来了」）。
     *
     * 覆盖生效时：补位（cell-cls 找漏子）与「黑白均衡修复」都不跑——用户已经判过一遍，
     * 不该再替他改；越界格（图上没有的那些）不参与编号。尺寸不符（换图/换路数）时
     * 整份忽略、回到正常检测（宁慢不错）。
     */
    const overrideBoard = opts.knownBoard && opts.knownBoard.length === boardSize
      && opts.knownBoard.every((line) => Array.isArray(line) && line.length === boardSize)
      ? opts.knownBoard
      : null;
    if (overrideBoard) {
      const kept: typeof candidates = [];
      for (let row = 0; row < boardSize; row += 1) {
        for (let col = 0; col < boardSize; col += 1) {
          if (!overrideBoard[row][col]) continue;
          const entry = featureGrid[row]?.[col];
          if (!entry) continue;
          kept.push({ row, col, x: entry.x, y: entry.y, features: entry.features });
        }
      }
      candidates = kept;
      moveOrderPerf.stones = candidates.length;
    }
    resetMoveNumberCalibration(); // family voting is per screenshot
    // 「补全识别」的已读号索引（2026-10-09）：键 "row,col" → 号。命中的格不跑模板扫描，
    // 直接以单候选入池（见 RecognizeOptions.knownNumbers 的说明）。
    const knownNumberAt = new Map<string, number>();
    if (opts.knownNumbers) for (const entry of opts.knownNumbers) knownNumberAt.set(`${entry.row},${entry.col}`, entry.number);
    // 补全识别（传了 knownNumbers）时读号走**加深档**：把省下来的预算花在没读出来的
    // 那些子上（更多裁剪尺度），而不是把同一套算法再跑一遍。见 BoardScanner.digitDeep。
    const digitDeep = knownNumberAt.size > 0;
    let knownNumberHits = 0;
    /** 被 knownNumbers 钉住的子下标：这些子是「上一趟读准的」，本趟不再交给数字头复核
     *  （复核会往池里并进竞争候选，反而可能把钉住的那个正确号挤掉）。 */
    const pinnedIndices = new Set<number>();
    candidates.forEach((candidate) => {
      const { row, col, x, y, features, hollowRescue } = candidate;
      let player: Player;
      // knownBoard 覆盖时颜色以调用方为准（用户可能手工改过色），下面整套判色启发式不再跑。
      const forced = overrideBoard ? overrideBoard[row][col] : null;
      // 空心印谱白子定色：空心签名 + 前景中值不暗于盘面太多，两条同时成立才判白。
      //
      // 为什么必须在这里拦一道：这类子的「前景」统计到的是那圈细描边（深色），
      // 于是柔化/异设备只要让 darkDiscShare 越过 0.3，上面的聚类输入就会从
      // 「前景中值（亮，≈220）」切成「最暗四分位（≈描边，深）」——白子被判进黑簇。
      // 实测 paper02 清晰 22黑/21白 → 1px 柔化 24黑/19白 的两格（E4/I2）正是这样
      // 翻的，与线上手机「白子变黑子」同一机制。
      //
      // 光有签名不够，**带白色序号的实心黑子**（盘内被白字挖空）同样命中中带/暗面
      // 占比签名（heavyborder.png 实测 34 格）。两类只能靠「前景中值有多亮」分开，
      // 而这一条要同时满足两件相反的事，所以是「绝对够亮 或 相对盘面不算暗」：
      //
      //   foregroundLight >= 128        ← 原本的绝对阈值，清晰到中度柔化都靠它
      //   foregroundLight - backgroundLight >= -80  ← 整图变暗时兜底（b 同向下降）
      //
      // 实测（paper02 空心白子 / heavyborder 黑子挖白字 / numbered-full J11）：
      //   空心白子   l 203–236，变暗到 brightness 0.65 后 l≈121 但 l-b≈-44；
      //   黑子挖白字 l 18–34，l-b -169 ~ -185；
      //   numbered-full 里那颗几何与白子一致、亮度居中的子（J11）l=102、l-b=-102。
      // 取 -80：白子最差 -50 仍有 30 点余量，J11 差 22 点落在外（保持既有判定，
      // 我对它的真实颜色没有独立证据，不能拿它赌），黑子挖白字差 89 点。
      if (forced) {
        player = forced;
      } else if ((isHollowPrintedStone(features) || (hollowRescue && isStrongPrintedHollowRescue(features)))
        && (features.foregroundLight >= 128 || features.foregroundLight - features.backgroundLight >= -80)) {
        player = "white";
      } else if (features.interiorLightShare >= 0.52 && features.outerShare >= 0.3 && features.ringShare >= 0.15 && features.diagonalShare >= 0.18 && features.ringSectorCoverage >= 0.75 && features.darkDiscShare < 0.65 && features.foregroundSaturation < 60) {
        // 内部透光的空心白子（2026-10-02 基准实测：书谱风白子召回 4%）。上面
        // 两个亮度条件统计的 foregroundLight 是「描边+序号笔画」的中值——书谱子
        // 中央的大号数字把前景拉到全黑（fgLight 17~44），两条全灭，聚类再把它
        // 拉向黑簇（白子变黑子）。内部透光占比 ≥0.55 是「纸面从笔画间透出来」
        // 的几何铁证；darkDiscShare < 0.65 挡住 heavyborder 那类**实心黑子挖白字**
        // （暗面 0.8+、白字像素同样落在底色 40 内）——回归套件实测误伤过。
        // diagonalShare ≥ 0.18 挡住**空交叉点**：轴线给外带/环带墨迹但对角干净，
        // 没有这道门 heavyborder 的空格会整批变白（黑 36→1 实测翻车）。
        player = "white";
        const whitePath = (globalThis as typeof globalThis & { __BANBU_WHITEPATH__?: unknown[] }).__BANBU_WHITEPATH__;
        if (Array.isArray(whitePath)) {
          whitePath.push({ rc: `${row},${col}`, interior: Math.round(features.interiorLightShare * 100) / 100, sec: Math.round(features.ringSectorCoverage * 100) / 100, darkDisc: Math.round(features.darkDiscShare * 100) / 100, outer: Math.round(features.outerShare * 100) / 100, ring: Math.round(features.ringShare * 100) / 100, diag: Math.round(features.diagonalShare * 100) / 100, mid: Math.round(features.middleShare * 100) / 100, core: Math.round(features.coreShare * 100) / 100, fg: Math.round(features.foregroundLight), bg: Math.round(features.backgroundLight) });
        }
      } else if (features.interiorLightShare >= 0.7 && features.middleShare <= 0.05 && features.ringSectorCoverage <= 0.25
        && features.darkDiscShare < 0.65 && features.foregroundSaturation < 60) {
        // **线稿白子 + 印着黑字**（2026-10-15 用户报「白的被识别成黑的」的真根因）。
        //
        // 场景：智子那种白底线稿棋盘上，白子是「白圆 + 黑描边」，编号又是黑字压在子中央。
        // 结果 `foregroundLight`（描边 + 字迹的中值亮度）掉到 64–89，上面那条
        // `foregroundLight >= 128` 判白的分支过不去，一路落到最后的兜底 `black`——
        // 同一局面在智子截图里判白（差 1、合法），在这张线稿里判黑（黑 24/白 19、差 5，
        // 应用自己都会报「黑白数量异常」）。
        //
        // 逐格实测（用户源图 931×931，`qa/diag-zhizi-extra-why.mjs`）：
        //   误判的两格 e4/i2：interior 0.815/0.807、middle 0.016/0.022、ringSec 0.125、darkDisc 0.18/0.19
        //   真白四格        ：interior 0.807–0.877、middle 0.009–0.022、ringSec 0.125
        //   真黑三格        ：interior 0.153–0.201、middle 1.0、ringSec 0.625–0.688
        // 两边的间隔极大（interior 0.8 vs 0.15、middle 0.02 vs 1.0），所以判据取 0.7 / 0.05 / 0.25。
        // `darkDiscShare < 0.65` 沿用上面那条分支的同款护栏，挡「实心黑子挖白字」；
        // `foregroundSaturation < 60` 挡彩色标注。**cell-cls 在这两格也判白（0.82）**，与此判据一致。
        player = "white";
      } else if (clusteredPlayers.has(candidate)) {
        player = clusteredPlayers.get(candidate)!;
      } else if (candidates.length === 1) {
        // A legal single-stone position starts with black.
        player = "black";
      } else if (features.foregroundLight >= 128) {
        player = "white";
      } else if (features.backgroundLight < 95 && features.foregroundLight > features.backgroundLight + 18) {
        player = "white";
      } else {
        player = "black";
      }
      board[row][col] = player;
      score += features.score;
      // 序号匹配（模板渲染 + NCC 全值扫描）是整个识别管线最重的部分。只做
      // 静态局面导入（App 的默认通道/对齐探针）时完全用不到 numberedMoves，
      // 由调用方传 skipMoveOrder 跳过，识别直接省掉一大截耗时。
      if (!opts.skipMoveOrder && !moveOrderSkipped) {
        // ── 模板扫描能不能被「数字头强读」替掉？2026-10-08 试过，**结论：暂时不能** ──
        // 动机：这一段是复原路径最贵的部分（实测 7.6–18.2 秒，占总时间 2/3），钱几乎全
        // 花在**字体族逐级升格**上（每颗子 4–16 次扫描），而这条升格在「字体不是模板
        // 认识的那几族」的图上注定白跑——网页/App 渲染体正是这种图。既然数字头对这些
        // 图读得更好（renjuportal 密盘实测：数字头 65/76、模板 56/76），很自然会想
        // 「数字头强读就不扫模板」。两条闸门判据都试过，都不成立：
        //   ① 「用样本的模板首选分中位数判断模板认不认识这条字体」：实测两个域**重叠**
        //      ——模板域 remote-image2 0.717 / paper10 0.771，屏幕域 rp-score-02 0.788 /
        //      rp-score-10 0.784 / rp-score-04 0.807。原因是 NCC 对错号也能打到 0.78，
        //      分数高低并不等于「模板认识这条字体」。
        //   ② 「样本用前 N 颗子」：纸面题图里没印号的子得分天然接近 0，会把书本域误判成
        //      屏幕域（实测 paper02 读出 6 → 4）。改成只拿「数字头强读的格子」当样本
        //      就没这个问题，但判据 ① 本身不成立，样本怎么取都没用。
        // 更要紧的是：数字头在旧书手写体域是**自信读错**（paper02 真值 6 读成 5@0.90，
        // 该图全 6 个子 0/6），也就是说没有任何单一来源能在所有域上赢；「跳过模板」等于
        // 把整个书本域押给数字头。要再往下走，需要的是**按真值标定出来的逐格仲裁规则**
        // （两份读数量纲不同，不能直接比大小），标定接口见 headReadsByIndex 与
        // qa/tmp-move-source.mjs、qa/tmp-probe-median.mjs（这两个探针就是为它准备的）。
        // 补全识别（2026-10-09）：这颗子上一次已经读准了 → 钉住它、跳过整段模板扫描。
        // 单候选以 score=1 入池，仍要过装配器的唯一号/1..N/奇偶/边际门控——钉错的号
        // 会让这一趟如实失败，不会伪造成完整手序。
        const known = knownNumberAt.get(`${row},${col}`);
        let cands: MoveNumberCandidate[];
        if (known !== undefined) {
          cands = [{ value: known, score: 1 }];
        // 并行延后的另一个前提：**探针必须先有结论**（`probeDecided`）。
        // 探针取前 12 颗子的首选分中位数决定「整盘还扫不扫」，而延后的子当轮没有候选
        // （空数组占位）——若让它们参与探针，会把 0 分算进去、可能误判「读不出」而整盘跳过。
        // `probeDecided` 初值就是「探针不适用（子少/不密）→ true」，所以这个条件是安全的：
        // 适用时最多延迟前 12 颗子，之后全线并行。
        } else if (scoreParallel && probeDecided && moveNumberFamilyVote && moveNumberFamilyVote.decided >= 0) {
          // 已锁定字体族（`decided` 是吸收态，锁定后永不变）→ 这颗子是纯函数，攒起来并行。
          // 放一个占位数组进 numberCandidates，保持所有平行数组下标对齐；
          // 循环结束后统一回填（顺序按 pendingSlot，与逐子顺序一致）。
          cands = [];
          pendingScore.push({ row, col, x, y, player, maxNumber: candidates.length, forceFamily: moveNumberFamilyVote.decided, spacing: localSpacing });
          pendingSlot.push(numberCandidates.length);
        } else {
          // 投票期（或未启用并行）：主线程串行，参与族投票。
          cands = matchMoveNumbers(sampled, x, y, localSpacing, player, candidates.length);
        }
        if (known !== undefined) { knownNumberHits += 1; pinnedIndices.add(numberCandidates.length); }
        const stoneDebug = (globalThis as typeof globalThis & { __BANBU_STONE_DEBUG__?: unknown[] }).__BANBU_STONE_DEBUG__;
        if (Array.isArray(stoneDebug)) stoneDebug.push({ row, col, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        numberCandidates.push(cands);
        templatePools.push(cands);
        numberStones.push({ row, col, player });
        stoneCenters.push({ x, y });
        // 逐子清单不在这里定稿：数字头回填之后由 rebuildNumberedMoves() 统一重建
        // （2026-10-07，见该函数注释）——清单规则与原判定一致。
        if (!probeDecided) {
          // 延后的子候选为空（上面已用 probeDecided 把关，这里再兜一道）：
          // 空数组不参与探针统计，避免把「还没算」当成「读不出」。
          const top = cands[0];
          if (!cands.length) {
            // 延后中：不计入探针样本。
          } else {
            probeTops.push(top ? top.score : 0);
            if (top && top.score >= 0.55) probeLegible += 1;
            if (probeTops.length >= MOVE_PROBE_SAMPLES) {
              probeDecided = true;
              const ranked = probeTops.slice().sort((left, right) => left - right);
              const median = ranked[Math.floor(ranked.length / 2)];
              moveOrderPerf.probeMedian = Math.round(median * 1000) / 1000;
              moveOrderPerf.probeLegible = probeLegible;
              const floor = Number((globalThis as typeof globalThis & { __BANBU_MOVE_PROBE_FLOOR__?: number }).__BANBU_MOVE_PROBE_FLOOR__ ?? MOVE_PROBE_DEFAULT_FLOOR);
              // 两条同时成立才停：中位数低于门槛 **且** 样本里一颗可读数都没有。
              // 后一条专门保护「终局图只标最后 k 手」这条书谱约定——那种图前若干颗子
              // 本来就没号，但后段有；只要样本里读到过一颗，就照原样把整盘扫完。
              moveOrderSkipped = median < floor && probeLegible === 0;
              if (moveOrderSkipped) moveOrderPerf.probeSkipped = true;
            }
          }
        }
      }
    });
    /**
     * 回填并行延后的候选（2026-10-10）。
     *
     * 到这一步，`moveOrderFamilyVote.decided` 已经确定且不会再变——延后的每颗子都用
     * 同一个 `forceFamily` 跑，与「主线程在锁定后串行跑」**逐位相同**（worker 侧同一份
     * `matchMoveNumbers`，只多了 `skipVote = true`；三处 vote 分支的取值都与锁定态一致）。
     *
     * 顺序：`pendingSlot` 记录的是原始逐子下标，回填按它就位，与串行结果的位置一一对应。
     * 失败/降级时 `accelerator.dispatch` 会把未完成分片回主线程重算，所以这里不会
     * 出现空洞；真出异常就整体回退（下面 catch 里逐条主线程补算）。
     */
    if (pendingScore.length) {
      const tScore0 = performance.now();
      let filled: MoveNumberCandidate[][] | null = null;
      try {
        filled = await acc.matchMoveNumbers(pendingScore);
      } catch (error) {
        console.warn("[banbu-score-parallel] 并行匹配失败，回落主线程补算", error);
        filled = null;
      }
      if (filled && filled.length === pendingScore.length) {
        filled.forEach((cands, index) => {
          const slot = pendingSlot[index];
          // 空结果也要回填（与串行返回 [] 一致），不能留占位。
          numberCandidates[slot] = cands ?? [];
          templatePools[slot] = numberCandidates[slot];
        });
      } else {
        // 回退：逐条主线程补算，结果与串行完全一致（只是慢）。
        for (let index = 0; index < pendingScore.length; index += 1) {
          const q = pendingScore[index];
          const slot = pendingSlot[index];
          const cands = matchMoveNumbers(sampled, q.x, q.y, q.spacing, q.player, q.maxNumber, q.forceFamily);
          numberCandidates[slot] = cands;
          templatePools[slot] = cands;
        }
      }
      moveOrderPerf.parallelScoreMs = Math.round(performance.now() - tScore0);
      moveOrderPerf.parallelScoreStones = pendingScore.length;
    }
    // Post-pass: when the family vote locked a NON-default face, the early
    // stones (voted before the lock) only carry family-0 candidates — give
    // the weak ones a second pass with the winning family so the joint
    // assignment sees full coverage. Same-device images never get here.
    if (!opts.skipMoveOrder && !moveOrderSkipped && moveNumberFamilyVote && moveNumberFamilyVote.decided > 0) {
      for (let i = 0; i < candidates.length; i += 1) {
        if (pinnedIndices.has(i)) continue; // 钉住的子不重扫（补全识别的已知号）
        const prev = numberCandidates[i];
        if (prev && prev.length && prev[0].score >= 0.55) continue;
        const cand = candidates[i];
        const rerun = matchMoveNumbers(sampled, cand.x, cand.y, localSpacing, numberStones[i].player, candidates.length, moveNumberFamilyVote.decided);
        if (rerun.length && (!prev?.length || rerun[0].score > prev[0].score)) numberCandidates[i] = rerun;
      }
    }
    // 数字头补漏 + cell-cls 补位（可选增强，2026-10-06/07）：一次合并批读。
    //  - 数字头只补「模板仍没有可信候选」的格子（逐格混合：旧书小号字上数字头会
    //    自信读错，模板强的格子绝不动——管线内对比实测逼出来的策略）；
    //  - boardScanner（cell-cls 逐格占用/颜色）专补**位置**：应用 CV 漏掉的子
    //    （实测白底 89 手图 45→89 召回 100%）。补位子必须拿到读号才落地——
    //    假阳格（页眉/网格纹理）全部读不出号（16/16），真漏子 39/44 有强读数，
    //    这一条天然把假阳挡在门外；没读数的真漏子交给装配的通配补号推定。
    // 任何失败静默回落（与「多核加速」同一纪律：增强不能变成识别失败的原因）。
    //
    // 静态识谱的补位（2026-10-07 用户要求）：单纯「图片识谱」也走 cell-cls 补漏子，
    // 但**只补有子判定、不读号**（省时间，且静态路径没有 1..N 装配门控兜底）。
    // 因为没有读号交叉验证，占用阈值比复原路径更严：pEmpty<0.05，**并且**要有一条
    // 独立佐证（见下）。实测校准（remote-image2 逐坐标真值）：补位 37 颗全是真子、
    // 假阳 0、颜色 37/37 全对。
    if (opts.boardScanner && opts.skipMoveOrder) {
      try {
        const tScan0 = performance.now();
        // needDigits:false —— 静态导入只用占用/颜色，不读号。数字头在 225 格上要花
        // 单线程 5-6 秒（正是「识别变慢 3-5 倍」的大头），这条路径一次都不跑。
        //
        // 2026-10-09 无损剪枝：这条路径的格级证据只有补位一个用途，而补位门控里有几类
        // 格子的结果永远不会被采用（判据见 BoardScanner.scanTargets 的注释）。这里把
        // 「可能被采用」的格算出来只扫这些——实测网页盘/App 截图/旧书手写体是 0 格
        // （整段模型扫描消失），白底 89 手图 40/225（补位能力不变）。
        // 注意「特征分为 null 的越界格」必须保留：门控把 null 当已佐证，那种格一旦
        // pEmpty<0.05 就会被补。
        const scanTargets: Array<{ row: number; col: number }> = [];
        for (let row = 0; row < boardSize; row += 1) {
          for (let col = 0; col < boardSize; col += 1) {
            if (board[row][col]) continue;                          // 已识别子：门控必跳过
            const entry = featureGrid[row]?.[col];
            if (!entry) { scanTargets.push({ row, col }); continue; }  // 越界格：门控视为已佐证，保留
            if (entry.features.score < 0.2) continue;                // 特征分不够：不读号时必然被拒
            if (isVividGlyphMarker(entry.features.foregroundSaturation, entry.features.coreShare, entry.features.discShare)) continue;
            scanTargets.push({ row, col });
          }
        }
        // 格级扫描是逐格推理、天生可切分 —— 多核开关打开时丢进 worker 池
        // （每 worker 一份会话），主线程只等结果；开关关掉就在这里直算。
        const evidence = await opts.boardScanner({ image: sampled, grid, boardSize, needDigits: false, accelerator: accelerator ?? undefined, scanTargets });
        // 累加（同一张图会调两次以上：静态补位一次、读号一次、值域扩展/二轮再一次），
        // 只记最后一次会让诊断看到「扫描 76ms」而真实开销被藏进相邻阶段。
        moveOrderPerf.boardScanMs = Math.round(moveOrderPerf.boardScanMs + (performance.now() - tScan0));
        if (evidence && evidence.length === boardSize * boardSize) {
          const taken = new Set(candidates.map((candidate) => `${candidate.row},${candidate.col}`));
          for (const cell of evidence) {
            if (cell.pEmpty >= 0.05) continue;
            if (board[cell.row][cell.col]) continue;
            if (taken.has(`${cell.row},${cell.col}`)) continue;
            // 独立佐证（2026-10-07 木刻棋盘实测新增）：棋盘**边角**（外框 + 坐标标签 +
            // 背景石纹叠在一起）会被 cell-cls 判成「白子 pWhite=1.00、pEmpty=0.004」，
            // 光看占用就会补出 A15 那种假子。要求两者之一：
            //   ① 本项目自己的格特征分 ≥0.2（features.score——同一张图上真子的分数
            //      都在 0.8+，木纹白底图的漏子 0.179–0.25 也在线上）；
            //   ② 该格读过号（digit>0，数字头 argmax 不是「无号」类）——白底图最弱的
            //      那 4 颗漏子（特征分 0.179–0.196）正是靠这条通道留下来。
            // 边角假子两条都不满足（特征分 0.137、digit=0）。
            const features = featureGrid[cell.row]?.[cell.col]?.features;
            // 标记不是棋子：CV 判为「强饱和笔画标记」的格（如棋盘上的红字「A」）不许
            // 补位再把它拉回来——实测该格 cell-cls 也认成白子（pEmpty 极低），两条路都要拦。
            // 这里**只认窄判据**（isVividGlyphMarker），不能用宽 markerLike：白底照片上
            // 淡白子的 JPEG 彩边会被宽判据标成标记，整批补位会被拦（实测误挡 32 格）。
            if (features && isVividGlyphMarker(features.foregroundSaturation, features.coreShare, features.discShare)) continue;
            // 对角线干净 = 只有线/边框、没有盘（与读号那条补位同一判据，见 FILL_MIN_DIAGONAL_SHARE 注释）。
            // 2026-10-15 实测：书谱那张的小尺寸版（282×267）上 a10（走读号那条）与 j8（走这条）
            // 都是 diag=0 的假子，只拦一条会漏一颗。
            if (features && features.diagonalShare < FILL_MIN_DIAGONAL_SHARE) continue;
            const corroborated = (features ? features.score >= 0.2 : true) || cell.digit > 0;
            if (!corroborated) continue;
            board[cell.row][cell.col] = cell.pBlack >= cell.pWhite ? "black" : "white";
          }
        }
      } catch {
        /* 补位失败：保留原识别结果，流程照常 */
      }
    }
    // 逐子清单（numberedMoves）在数字头回填**之后**统一重建（2026-10-07）：
    // 旧实现把清单在回填之前就定好，于是数字头读出来的号（黑子白字这类模板读不动
    // 的，实测用户那张 15 手图整列黑子只认出一颗）只在联合装配成功时才露面——
    // 装配一失败（例如图里最后一手是红字，模板与数字头都读不出），用户在核对屏上
    // 只看得到模板读的那一半。重建规则与原逐子判定逐字一致，值域上限 = 总子数
    // （15 子的图不可能有 23 手），数字头参与过时同号只留最高分（避免两颗子报同号）。
    let headMerged = false;
    /** 「数字头读数足以顶掉自信模板」的置信门槛（0..1 softmax 概率）。
     *
     *  原为 0.85，2026-10-12 降到 0.7。依据是两条实测：
     *   · self-001@1200（188 手密盘）装配池逐格取证：模板自信（0.86）但读错的格上，
     *     数字头读出的是**真值**（181@0.753、153@0.788）——0.85 门槛把它们全挡在池外，
     *     于是那两颗黑子的池子里只剩奇偶不可能的号（模板读 8/5，偶数对黑子无解），
     *     匈牙利出现无边子 → **整盘 188 手如实拒绝**。降到 0.7 后真值全进池。
     *   · 冲突分桶（qa/tmp-move-source.mjs）：模板自信且与数字头不一致的格里，
     *     数字头置信 [0.7,0.85) 的 6 行**数字头全对、模板全错**。
     *  门槛只决定「并入」（并集，模板那份仍在池里），不是「顶替」，所以装配器仍按
     *  唯一号 + 1..N + 奇偶 + 边际裁决；现有验收门（evaluateMoveNumberAssignment）
     *  继续负责「宁缺毋滥」。 */
    const DIGIT_MERGE_STRONG = 0.7;
    /** 数字头参与过读号的子数（用于判断「还有没有没读过的子」→ 是否需要二轮补读）。 */
    let headReadCount = 0;
    /** 数字头逐子首选读（值 + 置信度）。两个用途：
     *  ① 「模板首选与次选贴太近」的格子在清单里原本会被丢掉（见 rebuildNumberedMoves
     *     里的确认规则）——数字头独立读出同一个号时把它补收回来；
     *  ② QA 标定「模板 vs 数字头该信谁」要逐格数据（`__BANBU_MOVE_SOURCE_DEBUG__`）。
     *  只记录，不改判定。 */
    const headReadsByIndex = new Map<number, { value: number; prob: number }>();
    /** 补位候选（cell-cls 高置信漏子）；二轮补读前的判断也要用，故在块外声明。 */
    let fillCells: BoardCellEvidence[] = [];
    /** 扫描器证据（格级占用/颜色/读数）；二轮补读时按它判断已读过的格。 */
    let evidence: BoardCellEvidence[] | null = null;
    /** 候选合并：同一号取最高分，按分数降序。数字头读数并入模板池、不顶替（见调用处）。
     *
     *  `promote`（2026-10-12）：数字头**强读**的那个号在合并后排到该子首位。
     *  为什么要这一步：两份读数的分数不可比（模板是字形相似度、数字头是 softmax），
     *  于是「模板自信读错、数字头读对」的格子上，装配器虽然靠唯一号 + 1..N 找出了
     *  正解，验收门却按池内**分数排名**算「首选损失 maxRegret」——把错的模板读数当
     *  参照，得出 0.197 的损失并拒掉整盘（实测 self-001@1200：188 手全对、全局边际
     *  0.41，只因这一条被拒）。把强读排到首位，等于让验收门拿**数字头那把尺子**
     *  当参照——已在本域标定过它更准（见 DIGIT_MERGE_STRONG）。
     *  注意这是**排序**而非删候选：模板那一份仍在池里，数字头读错时正解依旧可被装配器
     *  选中（只是会记成「非首选」并触发验收门的如实拒绝，不会变成悄悄复原错手序）。 */
    const mergeInto = (existing: MoveNumberCandidate[] | undefined, read: MoveNumberCandidate[], promote?: number): MoveNumberCandidate[] => {
      const merged = new Map<number, number>();
      for (const candidate of existing ?? []) merged.set(candidate.value, candidate.score);
      for (const candidate of read) merged.set(candidate.value, Math.max(merged.get(candidate.value) ?? 0, candidate.score));
      if (promote !== undefined && merged.has(promote)) {
        const top = Math.max(...merged.values());
        merged.set(promote, top >= 1 ? 1 : Math.min(1, top + 0.02));
      }
      return [...merged.entries()].map(([value, score]) => ({ value, score })).sort((left, right) => right.score - left.score);
    };
    /**
     * 读数并入模板池的取舍（2026-10-07）：
     * 两个读号器的分数不可直接比较，所以「模板自信（首选 ≥0.6）而数字头整份读数
     * 都没有硬理由」时**不并入**——否则一条 0.80 的误读会顶掉模板手里 0.686 的
     * 正确首选（实测用户那张图 I8：数字头读 3、模板读 5，真值是 5），还会让装配的
     * 「非首选/首选损失」指标误报，把整盘对解按歧义拒掉。
     * 有硬理由就并入，两条任一即可（**整体判断，不只看首选**——实测 remote-image2
     * 的真值 51：数字头读出 [41:0.58, 51:0.50, 81:0.34]，首选 41 是误读、真值在
     * 第二位，只看首选就会把 51 挡在池外，装配器再也凑不出 1..89）：
     *  ① 读数里出现 ≥DIGIT_MERGE_STRONG 的强读（原为 0.85，2026-10-12 降到 0.7，
     *     依据见该常量）；
     *  ② 读数里出现 > templateMax 的值——模板的值域上限就是识别到的子数
     *     （matchMoveNumbers 的 maxNumber），超过它说明模板结构上不可能读对
     *     （remote-image2 的 46+ 手全靠这条）。
     */
    const mergeReadInto = (index: number, read: MoveNumberCandidate[], templateMax: number): boolean => {
      const existing = numberCandidates[index];
      const templateConfident = Boolean(existing && existing.length && existing[0].score >= 0.6);
      const strongHead = read.find((candidate) => candidate.score >= DIGIT_MERGE_STRONG);
      const worthMerging = !templateConfident
        || Boolean(strongHead)
        || read.some((candidate) => candidate.value > templateMax);
      if (!worthMerging) return false;
      numberCandidates[index] = mergeInto(existing, read, strongHead?.value);
      return true;
    };
    const rebuildNumberedMoves = () => {
      numberedMoves = [];
      const bestByNumber = new Map<number, number>();
      for (let i = 0; i < numberCandidates.length; i += 1) {
        const stone = numberStones[i];
        if (!stone) continue;
        // 清单的读数取哪一份（2026-10-07）：模板自信（首选 ≥0.55）时用**模板那一份**——
        // 数字头在旧书小字域会自信读错（paper02 的 6 个号被读成别的），旧实现把清单
        // 定在回填之前正是这个效果，用户的核对屏因此看到的是模板的 6/6。模板没把握
        // （弱读/无候选）时才用合并池/数字头读出来的那份（用户那张图的黑子全靠这条）。
        // 注意：装配成功时整份清单会被联合解覆盖，所以这里只影响「读不全、如实拒绝
        // 复原」那类图上的显示。
        //
        // 2026-10-13 加一条前提：**模板首选越界（> 子数）时不得让它赢**。模板的值域上限
        // 就是识别到的子数（结构上不可能读对更大的号），这类读数是坏读数；旧写法照样
        // 让它在清单里胜出，而下面 `top.value > numberStones.length` 又把它整颗剔掉——
        // 结果是**数字头读得 100% 准的那颗子被一起扔掉**。实测用户那张模糊书谱
        // （282×267、71 手）：15 颗子的数字头读数都是 ~1.0 的真值（70/15/46/14/40/42/
        // 13/28/19/44/3/51/5/6/54），全被这条链丢掉，清单只报出 57/71，用户看到的就是
        // 「复原不全」。改成越界就回退到合并池/数字头那份。
        const templatePool = templatePools[i];
        const templateInRange = Boolean(templatePool && templatePool.length && templatePool[0].value >= 1 && templatePool[0].value <= numberStones.length);
        const cands = templatePool && templatePool.length && templatePool[0].score >= 0.55 && templateInRange ? templatePool : numberCandidates[i];
        const headReadDebug = (globalThis as typeof globalThis & { __BANBU_MOVE_SOURCE_DEBUG__?: unknown[] }).__BANBU_MOVE_SOURCE_DEBUG__;
        if (headReadDebug) {
          headReadDebug.push({
            row: stone.row, col: stone.col, player: stone.player,
            template: templatePool?.length ? { value: templatePool[0].value, score: Math.round(templatePool[0].score * 1000) / 1000, second: templatePool[1] ? Math.round(templatePool[1].score * 1000) / 1000 : null } : null,
            head: headReadsByIndex.get(i) ? { value: headReadsByIndex.get(i)!.value, prob: Math.round(headReadsByIndex.get(i)!.prob * 1000) / 1000 } : null,
            merged: numberCandidates[i]?.[0] ? { value: numberCandidates[i][0].value, score: Math.round(numberCandidates[i][0].score * 1000) / 1000 } : null,
            source: cands === templatePool ? "template" : "merged",
            picked: cands?.[0]?.value ?? 0,
          });
        }
        if (!cands || !cands.length) continue;
        const top = cands[0];
        if (!top || top.score < 0.55) continue;
        // 「领先第二名不足 0.05」原本一律丢掉这颗子（门槛是防错号设的）。2026-10-08
        // 加一条**确认规则**：数字头独立读出**同一个号**时照常收录——两个独立来源
        // 一致就是充分证据。实测动机（renjuportal 密盘 rp-score-10）：71 手图里
        // 有 8 颗子的模板首选分够、但领先次选只有 0.03–0.05，被这条门槛挡在清单外，
        // 而数字头对这 8 格全部读对。
        //
        // 2026-10-13 再把「数字头读的是**别的**号」这一支补上：模板在近分候选之间
        // 摇摆（边际 <0.05）本来就是「模板自己也不确定」的信号，此时数字头的**强读**
        // 应当接管，而不是把整颗子丢掉。丢掉正是用户报的「复原不全」的成因之一——
        // 实测那张模糊书谱（282×267、71 手）有 14 颗子走这条：模板首选全是错的
        // （10/18/40/14/1/8/64…）、边际只有 0.001–0.026，而数字头读出的是真值且置信
        // ≥0.997，结果 14 个号全部被丢弃，清单只报 57/71。
        // 阈值 0.9 是按真值标定的（qa/tmp-conflict-rows.mjs）：同一个判据在旧书小字域
        // （paper02）不会误伤——那里 3 个冲突格的模板边际 ≥0.125、数字头最高才 0.91
        // 且**读错**，两条合起来一个都不满足。只改这一支，其余判定一字不动。
        let pickedValue = top.value;
        let pickedScore = top.score;
        if (!(cands.length === 1 || top.score - cands[1].score >= 0.05)) {
          const headRead = headReadsByIndex.get(i);
          if (headRead && headRead.value !== top.value && headRead.prob >= 0.9) {
            pickedValue = headRead.value;
            pickedScore = headRead.prob;
          } else if (!headRead || headRead.value !== top.value || headRead.prob < 0.5) {
            continue;
          }
        }
        if (pickedValue < 1 || pickedValue > numberStones.length) continue;
        if (headMerged) {
          const best = bestByNumber.get(pickedValue);
          if (best !== undefined && best >= pickedScore) continue;
          bestByNumber.set(pickedValue, pickedScore);
          numberedMoves = numberedMoves.filter((move) => move.number !== pickedValue);
        }
        numberedMoves.push({ row: stone.row, col: stone.col, player: stone.player, number: pickedValue });
      }
    };
    if (opts.digitReader || opts.boardScanner || !opts.skipMoveOrder) {
      // 注意（2026-10-07）：这个条件意味着**静态导入路径也走这一整块**（只要调用方
      // 注入了 boardScanner）。这是有意的：补位两档口径（pEmpty<0.05 直接落地；
      // 中间带要对得上 features.score≥0.2 且拿得到读数）本身带三层假阳过滤，
      // 静态路径同样吃得到——实测 remote-image2 导入即 89/89（逐坐标真值，0 假阳）、
      // paper10 63→66（正是期望的 66 颗）。此前的注释说「静态路径只补 pEmpty<0.05、
      // 不读号」，那是 19 节的老口径，已经被这版取代。
      // 「奇偶全灭」预检：候选与该子颜色全面矛盾（颜色判错或读数全错）时，
      // 装配器的奇偶门会把它的边杀光 → 匈牙利出现无边子 → 整盘失败。把它
      // 一并交给数字头重读，读出的强号再反推颜色（见回填处）。
      const parityDead = (cands: MoveNumberCandidate[], player: Player) =>
        cands.length > 0 && !cands.some((cand) => (cand.value % 2 === 1) === (player === "black"));
      // 奇偶约定提示：按模板首选多数派投票（与末尾 parityConsistent 同一口径）。
      // 首选与「序号奇偶 = 棋子颜色」矛盾 = 模板自信但读错的典型（用户那张图的
      // J10 黑子读成 8，偶数对黑子结构性不可能），需要数字头复核。
      let oddBlackVotes = 0, oddWhiteVotes = 0;
      for (let i = 0; i < numberCandidates.length; i += 1) {
        const top = numberCandidates[i]?.[0];
        const stone = numberStones[i];
        if (!top || !stone || top.score < 0.55) continue;
        if ((top.value % 2 === 1) === (stone.player === "black")) oddBlackVotes += 1; else oddWhiteVotes += 1;
      }
      const oddIsBlackHint = oddBlackVotes >= oddWhiteVotes;
      const stoneParityOk = (value: number, player: Player) => (value % 2 === 1) === (oddIsBlackHint ? player === "black" : player === "white");
      const weakIndices: number[] = [];
      for (let i = 0; i < numberCandidates.length; i += 1) {
        // 钉住的子（补全识别的已知号）不参与复核：它们是这一趟的输入，不是待验证的读法。
        if (pinnedIndices.has(i)) continue;
        const prev = numberCandidates[i];
        // 单边候选（模板只认一个号）也要数字头复核：错读的单边会在装配里挤占
        // 真号的候选池，形成「N+1 子 N 号」的结构性死锁（2026-10-07 实测踩过，
        // remote-image2 的 K10 错读 35 挤掉了 33/35 池里最后一个空位）。
        if (!prev || !prev.length || prev.length === 1 || prev[0].score < 0.55 || parityDead(prev, numberStones[i].player)
          || !stoneParityOk(prev[0].value, numberStones[i].player)) weakIndices.push(i);
      }
      // cell-cls 补位候选（两档口径，2026-10-07 实测标定）：
      //  ① 高置信占用 pEmpty<0.05 —— 三种域（外部 App 截图 / 白底比赛图 / 书页）
      //     里真漏子的 pEmpty 全 ≤0.02、假阳 0；这一档不需要读数就能落地。
      //  ② 中间带 0.05≤pEmpty<0.3 —— 需要读数佐证才落地（强读 / 弱读两通道）。
      //     这一带「真漏子」与「假阳」在**本项目自己的格特征分**上分得开：实测
      //     remote-image2 的 7 颗真漏子 features.score 全 ≥0.20，而用户那张外部
      //     截图 192 个假阳全 ≤0.196、白底图 16 个假阳全 ≤0.065。所以中间带只对
      //     features.score≥0.2 的格点名读号——7 格 vs 192 格，这就是「复原比前一版
      //     慢 3-5 倍」里那块 5 秒级读号开销的去处：假阳格一个都不读。
      const FILL_BAND_PEMPTY = 0.3;
/** 「pEmpty 极低、但只靠弱读号作证」的格要求的最低 CV 特征分（2026-10-15）。
 *  依据见 fillCells 门控里的注释：白底真漏子 ≥0.181、智子假子 0.096。 */
const FILL_DIGIT_SCORE_FLOOR = 0.15;
      const FILL_PRIOR_SCORE = 0.2;
      fillCells = [];
      evidence = null;
      const evidenceByKey = new Map<string, BoardCellEvidence>();
      const indexEvidence = (list: BoardCellEvidence[] | null) => {
        evidenceByKey.clear();
        if (list) for (const cell of list) evidenceByKey.set(`${cell.row},${cell.col}`, cell);
      };
      /** 与 digitReader 同一条门槛的逐格读数（argmax=0 或不够确定 → null 交回模板）。 */
      const readOfEvidence = (cell: BoardCellEvidence, maxValue: number): MoveNumberCandidate[] | null => {
        if (!cell.digitTop || !cell.digitTop.length) return null;
        if (cell.digit <= 0 || cell.digitProb < 0.5) return null;
        return cell.digitTop.filter((candidate) => candidate.value <= maxValue);
      };
      const takenKeys = new Set(candidates.map((candidate) => `${candidate.row},${candidate.col}`));
      const fillPrior = new Set<string>();
      for (let row = 0; row < boardSize; row += 1) {
        for (let col = 0; col < boardSize; col += 1) {
          const key = `${row},${col}`;
          if (board[row][col] || takenKeys.has(key)) continue;
          const entry = featureGrid[row]?.[col];
          if (entry && entry.features.score >= FILL_PRIOR_SCORE) fillPrior.add(key);
        }
      }
      if (opts.boardScanner) {
        try {
          const tScan0 = performance.now();
          // 一次搞定：格级占用/颜色 + 点名格（弱读子 + 中间带预选）的读号。
          // 静态导入（skipMoveOrder）多一句：**已识别的子这轮不用读号**——导入只要
          // 「子在哪、什么颜色」，序号是复原那一步的事；扫描器默认会给每个占用格读号
          // （补位子落地要有读数），实测那批读号占了导入里模型扫描的大头。补位候选
          // （fillPrior / pEmpty<0.05 的漏子）仍需读数，它们不在 digitSkip 里。
          evidence = await opts.boardScanner({
            image: sampled,
            grid,
            boardSize,
            needDigits: true,
            digitCenters: [
              // 复原路径点名**全部棋子**读号（2026-10-12）：此前只点名「模板弱读」的子，
              // 没被点名的格靠扫描器自己的「pEmpty<0.05 顺带读」兜——但 cell-cls 在密盘上
              // 对约四成的占用格给不出 pEmpty<0.05，于是那些子**一个号都没读**，
              // 只能吃模板的读数（密盘上模板约 79% 对）。实测 self-001@1200（188 手）：
              // 点名全部子 → 187/188 全对；按旧口径只覆盖到 114 颗子。
              // 导入路径（skipMoveOrder）不受影响：它由 digitSkip 明确排除已识别子，
              // 仍然只读补位候选，静态导入不会因此变慢。
              // 「补全识别」钉住的已知号（knownNumberAt）同样排除：那一档的意义就是
              // 「已读准的号直接沿用、不重读」，点名它们既白花预算又会往池里加冗余候选。
              ...(opts.skipMoveOrder
                ? weakIndices.map((index) => ({ row: numberStones[index].row, col: numberStones[index].col }))
                : numberStones
                  .filter((stone) => !knownNumberAt.has(`${stone.row},${stone.col}`))
                  .map((stone) => ({ row: stone.row, col: stone.col }))),
              ...[...fillPrior].map((key) => ({ row: Number(key.split(",")[0]), col: Number(key.split(",")[1]) })),
            ],
            digitSkip: opts.skipMoveOrder ? candidates.map((candidate) => ({ row: candidate.row, col: candidate.col })) : undefined,
            digitSpacing: localSpacing,
            digitMaxNumber: numberStones.length + fillPrior.size,
            digitDeep: digitDeep || undefined,
            accelerator: accelerator ?? undefined,
          });
          moveOrderPerf.boardScanMs = Math.round(moveOrderPerf.boardScanMs + (performance.now() - tScan0));
          indexEvidence(evidence);
          // knownBoard 覆盖时不补位：用户已经判过一遍棋子，补位只会把他刚删掉的子找回来
          // （正是用户 2026-10-13 报的「删了又问出来」）。
          if (!overrideBoard && evidence && evidence.length === boardSize * boardSize) {
            const maxPlausible = numberStones.length + boardSize * boardSize;
            fillCells = evidence.filter((cell) => {
              if (board[cell.row][cell.col]) return false;
              if (takenKeys.has(`${cell.row},${cell.col}`)) return false;
              const features = featureGrid[cell.row]?.[cell.col]?.features;
              // 标记不是棋子（同静态路径）：只认窄判据 isVividGlyphMarker，别用宽 markerLike
              // ——白底淡白子的 JPEG 彩边会被宽判据标成标记，把整批补位拦掉。
              if (features && isVividGlyphMarker(features.foregroundSaturation, features.coreShare, features.discShare)) return false;
              // 「对角线干净」= 这一格只有线/边框、没有盘（2026-10-15 用户第二张报障图：黄底棋盘上
              // 贴着**粗黑边框**的那一行被补出 3 颗假子 h15/i15/j15，还把下排真子的号 41/38/36
              // 读到了它们身上 → 同一号出现两次；书谱那张的假子 a10、以及书谱小尺寸版（282×267）
              // 的 j8 同型）。判据与项目里既有的那条同源（`diagonalShare >= 0.18` 挡空交叉点：
              // 轴线给外带/环带墨迹，但对角干净）。
              //   ⚠ 必须放在**所有分支之前**：j8 的 pEmpty=0.031 走的是下面那条「强占用」分支，
              //     原来把它写在带状分支里 → j8 在强占用分支就 return true 了，判据根本没生效。
              // 本次两侧实测（内部 featureGrid）：白底 89 手图 44 个**合法**补位子 ≥ 0.098；
              // 上述 5 颗假子全是 0.000 —— 取 0.05，两边各留一倍余量。
              if (features && features.diagonalShare < FILL_MIN_DIAGONAL_SHARE) return false;
              if (cell.pEmpty < 0.05) {
                // 同静态路径的独立佐证门（见上方注释）：边角假子（外框+标签+石纹）
                // 会被 cell-cls 判成 pWhite=1.00，要求「自研特征分 ≥0.2 或读过号」。
                //
                // 2026-10-15 补下限：用户手机那张智子截屏（60 手的图）被识别成 61 颗，
                // 多出来的一格 h1 是「空木纹 + 棋盘下边印的坐标字母 H」。它走的就是
                // 右边这条「读过号」通道——模型在智子域误判 pEmpty=0.0028，数字头又给了
                // 一个弱而错的 argmax，于是**绕过了 0.2 这条线**。这两边实测分得很开：
                //   · 白底 89 手图里 44 个真漏子（靠这条通道救回来的）：CV 分 0.181–0.251；
                //   · 智子 h1 假子：0.096；同图空格对照 0.083。
                // 所以给弱读号通道加一条地板：CV 分至少 0.15（真漏子仍有 ~20% 余量，
                // 假子低 37%）。**不是放低判据，是把漏掉的判据补上**——见门禁
                // qa/order-zhizi-phone-truth.mjs（那条就是为这个假子立的）。
                return (features ? features.score >= 0.2 : true)
                  || (cell.digit > 0 && (features ? features.score >= FILL_DIGIT_SCORE_FLOOR : true));
              }
              if (cell.pEmpty >= FILL_BAND_PEMPTY) return false;
              if (!fillPrior.has(`${cell.row},${cell.col}`)) return false;
              const read = readOfEvidence(cell, maxPlausible);
              if (read && read.length) return true;
              return cell.digit > 0 && cell.digitProb >= 0.25;
            });
          }
        } catch {
          fillCells = [];
        }
      }
      // 值域扩展重读（2026-10-07）：模板读号的值域上限 = 识别到的子数（maxNumber
      // = candidates.length）。补位发生后总子数 > 原子数，真图的最大号可能远超
      // 原子数——模板在结构上不可能给出 46+ 的候选，任何真号 > 原子数的子都会
      // 卡死在 ≤原子数的错读上（实测 remote-image2：黑子模板全读成 13/23/33，
      // 而真号是 57/59/73）。所以发生过补位时，**全部原子**都用长头数字头复核
      // （值域 1..225），并把还没进过重读名单的原子一并纳入回填——第二次调用只补
      // 没读过的格（格级证据与已读号在扫描器缓存里，不重复付推理钱）。
      if (opts.boardScanner && evidence && fillCells.length > 0 && weakIndices.length < numberStones.length) {
        try {
          const widened = await opts.boardScanner({
            image: sampled,
            grid,
            boardSize,
            needDigits: true,
            // 不点名「补全识别」钉住的已知号（同二轮补读）。
            digitCenters: numberStones
              .filter((stone) => !knownNumberAt.has(`${stone.row},${stone.col}`))
              .map((stone) => ({ row: stone.row, col: stone.col })),
            digitSpacing: localSpacing,
            digitMaxNumber: numberStones.length,
            digitDeep: digitDeep || undefined,
            accelerator: accelerator ?? undefined,
          });
          if (widened && widened.length === boardSize * boardSize) {
            evidence = widened;
            indexEvidence(widened);
            for (let index = 0; index < numberStones.length; index += 1) if (!weakIndices.includes(index)) weakIndices.push(index);
          }
        } catch {
          /* 保持第一次的格级证据 */
        }
      }
      if (weakIndices.length > 0 || fillCells.length > 0) {
        try {
          const tHead0 = performance.now();
          const centers = [
            ...weakIndices.map((index) => stoneCenters[index]),
            ...fillCells.map((cell) => ({ x: grid.originX + cell.col * grid.spacingX, y: grid.originY + cell.row * grid.spacingY })),
          ];
          const maxPlausible = numberStones.length + boardSize * boardSize;
          // 读号优先用扫描器证据（同一次推理，正是「复原不再重读一遍」的接缝）；
          // 证据里没有该格的（扫描器缺失/失败）才回落单独的 digitReader。
          const reads: Array<MoveNumberCandidate[] | null> = weakIndices.map((index) => {
            const stone = numberStones[index];
            const cell = evidenceByKey.get(`${stone.row},${stone.col}`);
            return cell ? readOfEvidence(cell, maxPlausible) : null;
          });
          // 全子读数记录（2026-10-08，**只记录、不改池**）：扫描器本来就对每个占用格
          // 读过号（digit 目标 = digitCenters ∪ pEmpty<0.05），这些读数此前只在
          // weakIndices 上被取用。这里把它们**逐格记进 headReadsByIndex**，供清单的
          // 确认规则（模板首选与次选贴太近时，数字头独立读出同一个号就补收）与 QA
          // 标定使用。零额外推理成本：暖路径命中扫描缓存。
          //
          // 为什么不做「全子并入候选池」：实测（qa/renjuportal-bench.mjs 10 张网页棋盘）
          // 是一次**互换**——score-07 从 31 个正确读数、拒绝复原 → 38 个全对、复原成功；
          // score-06 反过来从 47 全对、复原成功 → 40 个、拒绝，总数一样（370/442），
          // 净收益为零，却让装配池多了一份无法判别的候选（增加「近似换位」类拒绝的
          // 风险）。真正缺的是「两份读数量纲不同、无法按分数比较」的**逐格仲裁规则**，
          // 在有按真值标定出来的规则之前不动池子（标定接口 qa/tmp-move-source.mjs）。
          if (evidenceByKey.size === boardSize * boardSize) {
            const weakSet = new Set(weakIndices);
            for (let index = 0; index < numberStones.length; index += 1) {
              if (weakSet.has(index) || headReadsByIndex.has(index)) continue;
              const stone = numberStones[index];
              // 补全识别钉住的号不动（见 BoardScanner 的 knownNumbers 说明）：它们以
              // score=1 单候选入池，是这一趟的**输入**，不该被本趟读数改写或加候选。
              if (knownNumberAt.has(`${stone.row},${stone.col}`)) continue;
              const cell = evidenceByKey.get(`${stone.row},${stone.col}`);
              if (!cell) continue;
              const read = readOfEvidence(cell, maxPlausible);
              if (!read || !read.length) continue;
              headReadsByIndex.set(index, { value: read[0].value, prob: read[0].score });
              // 非弱读子也走一遍「并入取舍」（2026-10-12）：此前这里**只记录不并入**，
              // 于是「模板自信但读错」的子留给装配器的只有模板那份错候选——装配器凑不出
              // 唯一 1..N，整盘如实拒绝（这正是「复原手序还不行」的直接成因）。
              // 取舍规则本身不动（mergeReadInto：模板不自信、或读数 ≥0.85、或读数超出
              // 模板值域时才并入），所以这不是「无差别全子并池」——旧口径里 0.85 这条
              // 硬理由本来就是为这种子写的，只是从来没被调用过。
              // 依据：现役 digit-head-combo46 在训练口径裁剪（半窗=格距）下实测自家渲染
              // 密盘 187/188、195/196 全对（qa/tmp-scanner-coverage.mjs），而模板在这类图
              // 上只有 ~79%（qa/tmp-move-source.mjs）。
              if (mergeReadInto(index, read, numberStones.length)) headMerged = true;
            }
          }
          const missingSlots: number[] = [];
          // 注（2026-10-09）：这里原本是**同一段循环写了两遍**（粘贴残留），于是每个
          // 缺格槽位在 missingSlots 里出现两次、下面的回落 digitReader 对同一批格读两遍
          // （第二次结果覆盖第一次，读数与后续合并结果逐位不变，只是白付一倍的推理）。
          // 删掉重复，结果不变。
          weakIndices.forEach((index, slot) => {
            const stone = numberStones[index];
            const cell = evidenceByKey.get(`${stone.row},${stone.col}`);
            if (!cell || !cell.digitTop) missingSlots.push(slot);
          });
          if (missingSlots.length && opts.digitReader) {
            const subReads = await opts.digitReader({ image: sampled, centers: missingSlots.map((slot) => stoneCenters[weakIndices[slot]]), spacing: localSpacing });
            missingSlots.forEach((slot, order) => { reads[slot] = subReads[order] ?? null; });
          }
          moveOrderPerf.digitHeadMs = Math.round(performance.now() - tHead0);
          // 候选合并（2026-10-07）：数字头的读数**并入**模板候选池，不再顶替。
          // 顶替会丢掉模板手里对的那份（用户那张图 J6 的模板候选 13 就被数字头的
          // 误读 23 挤掉，而 23 > 总子数 15、装配器直接判死）；两份都在池里时，
          // 联合装配用「唯一号 + 1..N + 奇偶」挑正确的那份。
          weakIndices.forEach((index, slot) => {
            const read = reads[slot];
            if (!read || !read.length) return;
            headReadsByIndex.set(index, { value: read[0].value, prob: read[0].score });
            if (!mergeReadInto(index, read, candidates.length)) return;
            headMerged = true;
            headReadCount += 1;
            // 数字头强读（≥0.7，实测 0.8 档零错）与该子颜色矛盾时信读数翻色：
            // 颜色错会让装配器的奇偶门杀光全部候选（见 parityDead），不翻色
            // 这颗子会把整盘拖进无边死锁。
            const top = read[0];
            if (top.score >= 0.7 && (top.value % 2 === 1) !== (numberStones[index].player === "black")) {
              const flipped: Player = top.value % 2 === 1 ? "black" : "white";
              board[numberStones[index].row][numberStones[index].col] = flipped;
              numberStones[index] = { ...numberStones[index], player: flipped };
            }
          });
          for (const cell of fillCells) {
            const read = readOfEvidence(cell, maxPlausible);
            // 补位子落地条件（假阳过滤）：占用置信极高 pEmpty<0.05（真漏子 37/44、
            // 假阳 0/16），或有数字头读数（强读数 0/16 假阳；弱读数 argmax≠0 是
            // 第三条通道——假阳的 argmax 恰好全是 0）。落地但没读号的子走空候选，
            // 由装配的通配补号按约束推定。
            const hasRead = Boolean(read && read.length);
            const weakRead = !hasRead && cell.digit > 0 && cell.digitProb >= 0.25;
            if (!hasRead && !weakRead && cell.pEmpty >= 0.05) continue;
            // 颜色判定：有读号（强/弱）的补位子直接用「读号奇偶」反推（黑先手
            // 棋里序号奇偶就是颜色，比颜色概率可靠——颜色判错会让奇偶门控杀光
            // 它的全部候选，匈牙利匹配出现无边子而整盘失败，实测踩过）。
            // 无读号的子退回 cell-cls 的黑白概率。
            const number = hasRead ? read![0].value : (weakRead ? cell.digit : 0);
            const player: Player = number > 0
              ? (number % 2 === 1 ? "black" : "white")
              : (cell.pBlack >= cell.pWhite ? "black" : "white");
            board[cell.row][cell.col] = player;
            numberCandidates.push(hasRead ? read! : (weakRead ? [{ value: cell.digit, score: cell.digitProb }] : []));
            numberStones.push({ row: cell.row, col: cell.col, player });
            stoneCenters.push({ x: grid.originX + cell.col * grid.spacingX, y: grid.originY + cell.row * grid.spacingY });
            if (hasRead) { headMerged = true; headReadCount += 1; }
          }
        } catch {
          /* 数字头/补位失败：保留模板读数与原棋盘，识别照常走完 */
        }
      }
    }
    if (!opts.skipMoveOrder && !moveOrderSkipped) rebuildNumberedMoves();
    moveOrderPerf.digitMs = Math.round(performance.now() - tDigit0);
    moveOrderPerf.renderMs = Math.round(moveOrderPerf.renderMs);
    moveOrderPerf.sweepMs = Math.round(moveOrderPerf.sweepMs);
    moveOrderPerf.distinctSizes = moveNumberSizeBuckets.size;
    const tAssign0 = performance.now();
    // Joint sequence consistency: when every stone carries candidates that can
    // form the unique complete 1..N assignment, trust it over the per-stone
    // margin rejections (an ambiguous stone is disambiguated by its peers).
    // 2026-10-02 A1 补全：个别子没有候选也不再放弃联合求解——assignMoveNumbers
    // 会用通配边把漏读的号按约束推定出来（数量超预算才放弃）。
    // 2026-10-07 补位后 numberCandidates/numberStones 可能比 candidates 长
    // （补位子不在 candidates 里），配对键改为 numberStones。
    if (!opts.skipMoveOrder && !moveOrderSkipped && numberStones.length >= 2 && numberCandidates.length === numberStones.length && numberCandidates.some((c) => c.length > 0)) {
      // 增强路径的池预过滤（2026-10-07）：装配器的验收门要求每颗真实候选子的分配
      // 分 ≥0.5，所以「最高分只有 0.4977 的边」一旦被分配就必然整盘 null。把它先删掉，
      // 那颗子就落进通配补号，由 1..N + 唯一 + 奇偶把号**推定**出来（这正是通配机制
      // 的设计意图）。实测用户那张 15 手图：K9 的 9 只有 0.4977，删边前整盘 null，
      // 删边后 K9 由通配推定、其余 14 颗按各自读数落位，完整复原 1..15。
      // 只对「数字头参与过」的路径生效——默认路径的动作与结果一字不变。
      const assemblyPools = headMerged
        ? numberCandidates.map((cands) => (cands.length ? cands.filter((candidate) => candidate.score >= 0.5) : cands))
        : numberCandidates;
      // 装配输入取证（只进 QA trace，正常识别不付成本）：复原失败时第一手要看的就是
      // 「每颗子的池子里到底有什么」。2026-10-07 加。
      const tracePools = (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__;
      if (Array.isArray(tracePools)) {
        tracePools.push({
          why: "assembly-pools",
          pools: assemblyPools.map((cands, index) => ({ stone: numberStones[index], pool: cands.slice(0, 4).map((candidate) => `${candidate.value}:${Math.round(candidate.score * 1000) / 1000}`) })),
        });
      }
      let assignment = assignMoveNumbers(assemblyPools, numberStones.map((s) => s.player), 0.5, 0.7);
      // 二轮补读（2026-10-07；2026-10-12 改成**加深档 + 全子点名 + 未验收也触发**）：
      // 第一轮装配失败 = 池子里有「结构上凑不成 1..N」的死结。实测用户那张 15 手图：
      // L6 的池子是 {1,7}，而 1/7 分别被 H8/G9 各逼一处；L6 的真号 11 只在数字头手里，
      // 但 L6 的模板读数 1@0.635 既够自信、奇偶也与黑子相符，第一轮压根没点名它。这时把
      // **全部原子**交给数字头读一遍（读数只并入不顶替），再装配一次。只有第一轮失败才付
      // 这份钱——能复原的图一字不动。
      //
      // 三处 2026-10-12 的改动，都指向「第一轮没成时的补救要真的换输入」：
      //  ① 去掉 `headReadCount < numberStones.length` 这个前置——全子都读过号也仍可能
      //     读错（实测 self-002@1200 的 E8：196 颗子全读过，只有 E8 把 177 读成 127，
      //     真值连候选池都进不去，Hall 条件破掉 → 整盘 196 手判无解）。读完 ≠ 读对，
      //     该重读的是「读得不够强」的格。
      //  ② `digitDeep: true`：旧写法沿用标准阶梯，而同一张图同一几何必然给出同一读数
      //     （确定性），第二轮等于白跑；加深档才是把「没读出/读不够准」的格换尺度再问
      //     （扫描器内按 best<0.85 挑格），这正是「补全识别」用的那套。于是用户点
      //     「复原手序」时，失败的那一趟已经自带一次补全，不必再手点「补全识别」。
      //  ③ 触发条件从「装配返回 null」扩到**「装配结果没通过验收门」**：结构上找到解、
      //     但被边际/首选损失/最低分拒掉的图，同样该再读一遍——那正是「读得不够准」
      //     的图（实测 self-011@1200 的 223 手满盘：装配成功、真值 223/223 在池、
      //     只因一颗子的读数只有 0.551 被拒；加深档补读后该格读数变强就过了）。
      //     验收门本身一分不降——救的是读数，不是放宽判据。
      const rejectAssignment = (value: typeof assignment, count = numberStones.length) => !value
        || !evaluateMoveNumberAssignment(value, count, { lowResolution: localSpacing < 28 }).accepted;
      if (rejectAssignment(assignment) && opts.boardScanner && evidence && fillCells.length === 0) {
        try {
          const tRetry0 = performance.now();
          const retry = await opts.boardScanner({
            image: sampled,
            grid,
            boardSize,
            needDigits: true,
            // 不点名「补全识别」钉住的已知号：它们以 score=1 入池、是本趟的输入，
            // 不重读（见 BoardScanner 的 knownNumbers 说明）。
            digitCenters: numberStones
              .filter((stone) => !knownNumberAt.has(`${stone.row},${stone.col}`))
              .map((stone) => ({ row: stone.row, col: stone.col })),
            digitSpacing: localSpacing,
            digitMaxNumber: numberStones.length,
            digitDeep: true,
            accelerator: accelerator ?? undefined,
          });
          moveOrderPerf.boardScanMs = Math.round(moveOrderPerf.boardScanMs + (performance.now() - tRetry0));
          if (retry && retry.length === boardSize * boardSize) {
            const retryByKey = new Map(retry.map((cell) => [`${cell.row},${cell.col}`, cell]));
            let mergedRound = 0;
            for (let index = 0; index < numberStones.length; index += 1) {
              const cell = retryByKey.get(`${numberStones[index].row},${numberStones[index].col}`);
              if (!cell || !cell.digitTop || !cell.digitTop.length) continue;
              if (cell.digit <= 0 || cell.digitProb < 0.5) continue;
              const read = cell.digitTop.filter((candidate) => candidate.value <= numberStones.length);
              if (!read.length) continue;
              headReadsByIndex.set(index, { value: read[0].value, prob: read[0].score });
              if (!mergeReadInto(index, read, candidates.length)) continue;
              headMerged = true;
              mergedRound += 1;
              const top = read[0];
              if (top.score >= 0.7 && (top.value % 2 === 1) !== (numberStones[index].player === "black")) {
                const flipped: Player = top.value % 2 === 1 ? "black" : "white";
                board[numberStones[index].row][numberStones[index].col] = flipped;
                numberStones[index] = { ...numberStones[index], player: flipped };
              }
            }
            if (mergedRound > 0) {
              rebuildNumberedMoves();
              const retryPools = numberCandidates.map((cands) => (cands.length ? cands.filter((candidate) => candidate.score >= 0.5) : cands));
              const retried = assignMoveNumbers(retryPools, numberStones.map((s) => s.player), 0.5, 0.7);
              // 只在「原来没过门、深读之后过门」时采纳。两份读数的量纲不同，深读也可能把
              // 原来过门的解换差——那就不动，补救只做加法，不拿掉已经验收通过的解。
              if (retried && rejectAssignment(assignment) && !rejectAssignment(retried)) assignment = retried;
              if (Array.isArray(tracePools)) tracePools.push({ why: "second-round", merged: mergedRound, accepted: Boolean(retried && !rejectAssignment(retried)) });
            }
          }
        } catch {
          /* 二轮补读失败：保持第一轮的结果（如实拒绝复原） */
        }
      }
      // 「多认了一颗子」的补救（2026-10-13）：识别到的子数比可用的号还多时，装配在
      // **数学上无解**——n 颗子要求恰好 1..n，而池子里最大的号 < n，匈牙利直接判失败，
      // 整盘如实拒绝。实测用户那张模糊书谱（282×267、真值 71 子）：识别出 72 子
      // （一颗边缘补位假阳，它的读数是从隔壁真子渗过来的同一个 42），于是 71 个号
      // 读得再准也复原不了——用户看到的就是「复原不全」。
      //
      // 补救只认**有据可查的信号**：同一个号被两颗子同时高置信声明 ⇒ 至少一处是错读
      // 或多认。把**较弱的那个声明所在子**排除后重装配：排除的是「这颗子这趟不参与
      // 编号」，不是把号猜给谁——剩下的号仍由唯一号 + 1..N + 奇偶联合推定，并且必须
      // 通过**同一套验收门**（分数类下限、边际、首选损失一个不降）才采纳，所以它救不回
      // 任何本来就不该复原的图。那颗粒子仍留在局面上（只是没有号），核对屏一眼能看到。
      if (rejectAssignment(assignment)) {
        const claims = new Map<number, Array<{ index: number; score: number }>>();
        assemblyPools.forEach((cands, index) => {
          const top = cands.find((candidate) => candidate.value >= 1 && candidate.value <= numberStones.length);
          if (!top) return;
          const list = claims.get(top.value) ?? [];
          list.push({ index, score: top.score });
          claims.set(top.value, list);
        });
        const losers: Array<{ index: number; score: number; value: number }> = [];
        for (const [value, list] of claims) {
          if (list.length < 2) continue;
          const ranked = [...list].sort((left, right) => right.score - left.score);
          for (const entry of ranked.slice(1)) losers.push({ ...entry, value });
        }
        if (losers.length) {
          losers.sort((left, right) => left.score - right.score);
          const weakest = losers[0];
          const keep = numberStones.map((_, index) => index).filter((index) => index !== weakest.index);
          const reduced = assignMoveNumbers(
            keep.map((index) => assemblyPools[index]),
            keep.map((index) => numberStones[index].player),
            0.5, 0.7,
          );
          if (reduced && !rejectAssignment(reduced, keep.length)) {
            const byStone = new Map<number, number>();
            keep.forEach((index, slot) => byStone.set(index, reduced.numbers[slot]));
            assignment = { ...reduced, numbers: numberStones.map((_, index) => byStone.get(index) ?? 0) };
            const droppedStone = numberStones[weakest.index];
            droppedClaim = { row: droppedStone.row, col: droppedStone.col, value: weakest.value };
            if (Array.isArray(tracePools)) tracePools.push({ why: "extra-stone-rescue", dropped: droppedClaim, kept: keep.length, score: Math.round(weakest.score * 1000) / 1000 });
          }
        }
      }
      if (assignment) {
        const gateCount = droppedClaim ? numberStones.length - 1 : numberStones.length;
        moveOrderQuality = evaluateMoveNumberAssignment(assignment, gateCount, { lowResolution: localSpacing < 28 });
        const trace = (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__;
        if (Array.isArray(trace)) trace.push({ why: "assignment", ...moveOrderQuality, moves: assignment.numbers.map((number, index) => ({ ...numberStones[index], number })) });
        if (moveOrderQuality.accepted) {
          // 被排除编号的那颗子 number=0，不进手序（它仍在局面上，只是没有号）。
          numberedMoves = assignment.numbers
            .map((number, index) => ({ ...numberStones[index], number }))
            .filter((move) => move.number >= 1)
            .sort((a, b) => a.number - b.number);
        } else {
          // Keep the individually legible numbers for the verification overlay,
          // but never let a low-margin global permutation unlock auto-restore.
          autoSequenceRejected = true;
        }
      } else {
        // 装配器返回 null 的诊断（通配预算击穿/匹配失败），只进 QA trace 不进 UI。
        const traceNull = (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__;
        if (Array.isArray(traceNull)) {
          const wildcards = numberCandidates.filter((c) => !c.length).length;
          const maxRead = Math.max(0, ...numberCandidates.map((c) => (c.length ? c[0].value : 0)));
          traceNull.push({ why: "assign-null", stones: numberStones.length, wildcards, wildcardBudget: Math.max(2, Math.ceil(numberStones.length * 0.1)), maxRead });
        }
        moveOrderQuality = {
          accepted: false,
          status: "incomplete",
          assignedMean: 0,
          assignedMin: 0,
          ambiguous: 0,
          nonTop: 0,
          maxRegret: 0,
          pairwiseMargin: null,
          assignmentMargin: null,
          wildcardUsed: 0,
          reason: "不存在满足奇偶与一一约束的完整匹配",
        };
        autoSequenceRejected = true;
      }
    }

    moveOrderPerf.assignMs = Math.round((performance.now() - tAssign0) * 10) / 10;
    const occupied = candidates.length;
    const confidence = Math.max(0.35, Math.min(0.99, (score / occupied) * (fallback ? 0.8 : 0.9 + grid.quality * 0.1)));
    // 黑白均衡修复（2026-09-11）：对局截图黑白差 ≤1，识别结果差 >2 几乎必然是
    // 误判（亮色 UI/文字→白、深色阴影/边框→黑）。把多数派中置信度最低的候选
    // 移除直到均衡——直接消掉「黑白数量不对等」现象；只在异常时触发，正常图
    // 一字不动。真·摆棋局面若被误删，note 会说明，可落子补回。
    let blackCount = 0, whiteCount = 0, removedFalse = 0;
    let majority: Player = "black";
    board.forEach((row) => row.forEach((player) => { if (player === "black") blackCount += 1; else if (player === "white") whiteCount += 1; }));
    // 带序号的谱（书籍/记谱纸图）本身就是权威：序号决定黑白奇偶，棋盘上的
    // 数量差来自图只截了一段，不是误判。此时若仍按「对局黑白差 ≤1」删子，
    // 会把真子整片删掉（实测一张 11 黑/7 白的编号图被删掉 5 枚真黑子）。
    // 所以只有序号证据稀薄（多数子没有号码，即整屏截图场景）才做均衡清理。
    // 印刷空心子（hollowLikeCount ≥2）同样跳过：它的颜色聚类在这种图上会
    // 把空心白子判成暗色，实测一张柔化的书谱图因此被删掉 3 枚真子
    // （I11 黑、E4/I2 白）——这正是用户报的「白棋总少识别」。
    const numberedShare = occupied > 0 ? numberedMoves.length / occupied : 0;
    const isPrintedDiagram = hollowLikeCount >= 2;
    // 失衡幅度闸门（2026-10-07 木刻棋盘实测新增）：这条修复只该处理**轻微**失衡
    // （对局截图本该 ≤1，判色抖两三个），差得更多的是**局面图/题图**——它们本来
    // 就一边倒（实测用户那张木刻棋盘：真值 24 黑 9 白，差 15）。旧写法只要 >2 就
    // 删「多数派里分最低的 5 颗」，于是把 E11/H11/E6/H5 四颗真黑子删掉了（用户的
    // 「识别不全」）；而且差 15 的时候删 5 颗也回不到均衡，等于纯损失。闸门设到 6：
    // 覆盖「判色抖动」的全部实测范围，放过一边倒的局面图。
    const imbalance = Math.abs(blackCount - whiteCount);
    // knownBoard 覆盖时不跑「黑白均衡修复」：那是替识别器纠错的启发式，用户判过的棋盘
    // 不该被它删子（他可能正好在摆一个黑白一边倒的局面）。
    if (!overrideBoard && imbalance > 2 && imbalance <= 6 && numberedShare < 0.5 && !isPrintedDiagram) {
      majority = blackCount > whiteCount ? "black" : "white";
      const excess = Math.min(5, imbalance - 2);
      const readKeys = new Set(numberedMoves.map((move) => `${move.row},${move.col}`));
      const removable = candidates
        .filter((candidate) => board[candidate.row][candidate.col] === majority && !readKeys.has(`${candidate.row},${candidate.col}`))
        .sort((left, right) => left.features.score - right.features.score)
        .slice(0, excess);
      for (const candidate of removable) {
        board[candidate.row][candidate.col] = null;
        if (majority === "black") blackCount -= 1; else whiteCount -= 1;
      }
      removedFalse = removable.length;
      if (removedFalse > 0) {
        const removedKeys = new Set(removable.map((candidate) => `${candidate.row},${candidate.col}`));
        numberedMoves = numberedMoves.filter((move) => !removedKeys.has(`${move.row},${move.col}`));
      }
    }
    const balanceWarning = imbalance > 2 && imbalance <= 6
      ? `；黑白数量异常（黑 ${blackCount} 白 ${whiteCount}），请核对或重新框选棋盘`
      : removedFalse > 0 ? `；已自动移除 ${removedFalse} 个疑似误判的${majority === "black" ? "黑" : "白"}子（黑白失衡）` : "";
    const ordered = numberedMoves.slice().sort((a, b) => a.number - b.number);
    const actualStones = blackCount + whiteCount;
    // 序号可信度自检（2026-09-14）：只有「每颗子一份、恰好 1..N、且奇偶与黑白
    // 一致」的序号才能拿去重建落子顺序——调用方（App 的「复原手序」）正是按
    // 「数量等于子数且恰好 1..N」判定的，但奇偶从来不查：一份完整却把奇偶配错
    // 的序号会重建出一盘错棋。这里先按多数派推定奇偶极性，剔除与极性矛盾的那
    // 些条目（剔完自然就不完整，调用方只会按局面导入），再判断是否完整。
    // 实测动机：一张 63 子的谱只认出 36 个（跳号 1..62）、另一张认出 6 个且奇偶
    // 冲突，而 note 却声称「已按序号恢复 N 手顺序」。
    const polarityVotes = { oddBlackOddWhite: 0, oddWhiteOddBlack: 0 };
    ordered.forEach((move) => {
      if (move.number % 2 === 1) {
        if (move.player === "black") polarityVotes.oddBlackOddWhite += 1;
        else polarityVotes.oddWhiteOddBlack += 1;
      } else if (move.player === "black") polarityVotes.oddWhiteOddBlack += 1;
      else polarityVotes.oddBlackOddWhite += 1;
    });
    const oddIsBlack = polarityVotes.oddBlackOddWhite >= polarityVotes.oddWhiteOddBlack;
    const parityConsistent = ordered.filter((move) => {
      const oddNumber = move.number % 2 === 1;
      const isOddColour = oddIsBlack ? move.player === "black" : move.player === "white";
      return oddNumber === isOddColour;
    });
    const parityDropped = ordered.length - parityConsistent.length;
    // ---------------------------------------------------------------------
    // 结构化补号（2026-09-15 · 带序号的图专项）
    //
    // 书谱终局图只标最后 k 手，读出的号天然是一段 1..k。个别号会因为「领先第二名
    // 不足 0.05」被上面的 per-stone 门槛挡掉——实测用户那张书谱图（= 门禁夹具
    // user-99-43）读出 1,2,4,5,6，缺的 3 其实分数 0.603、只领先 0.045。
    //
    // 这时**结构本身就是证据**：既然 1,2,4,5,6 都读到了，而且它们是 1..6 少一个，
    // 那么「3」只可能落在还没被采用的石头上。于是去这些石头的**第一候选**里找它，
    // 要求分数 ≥0.5 且黑白与奇偶一致——而不是放宽那个全局门槛（门槛是防错号设的）。
    //
    // 只在**明确是部分编号**时启用（maxRead < 子数），所以「整图每子带号、只漏了
    // 一个」的情形不会被顺手补成一个完整 1..N 去重建落子顺序（那是另一类判断，
    // 不想顺手带上「错号」的风险）。补号只影响读出的号本身与提示文案。
    if (actualStones > 0) {
      const seen = new Set(parityConsistent.map((move) => move.number));
      const maxRead = seen.size ? Math.max(...seen) : 0;
      const holes: number[] = [];
      for (let number = 1; number <= maxRead; number += 1) if (!seen.has(number)) holes.push(number);
      const isPartialNumbering = seen.size >= 3 && holes.length >= 1 && holes.length <= 2
        && maxRead === seen.size + holes.length && maxRead < actualStones;
      if (isPartialNumbering) {
        const adopted = new Set(parityConsistent.map((move) => `${move.row},${move.col}`));
        let filled = 0;
        for (const hole of holes) {
          let bestIndex = -1;
          for (let index = 0; index < numberCandidates.length; index += 1) {
            const stone = numberStones[index];
            if (!stone || adopted.has(`${stone.row},${stone.col}`)) continue;
            const candidate = numberCandidates[index]?.[0];
            if (!candidate || candidate.value !== hole || candidate.score < 0.5) continue;
            const oddNumber = hole % 2 === 1;
            const isOddColour = oddIsBlack ? stone.player === "black" : stone.player === "white";
            if (oddNumber !== isOddColour) continue;
            if (bestIndex < 0 || candidate.score > (numberCandidates[bestIndex]?.[0]?.score ?? 0)) bestIndex = index;
          }
          if (bestIndex >= 0) {
            parityConsistent.push({ ...numberStones[bestIndex], number: hole });
            adopted.add(`${numberStones[bestIndex].row},${numberStones[bestIndex].col}`);
            filled += 1;
          }
        }
        if (filled && (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__) {
          (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__?.push({ why: "prefix-fill", holes, filled });
        }
      }
    }
    // 完整序列的判定（2026-10-13）：被 extra-stone 补救排除编号的那颗子要从分母里扣掉
    // ——它本来就不该有号（疑似多认），否则一次成功的 71 手复原会被 `71 !== 72` 判成不完整。
    const numberedTarget = actualStones - (droppedClaim ? 1 : 0);
    const completeOrder = !autoSequenceRejected
      && parityConsistent.length >= 2
      && parityConsistent.length === numberedTarget
      && parityConsistent.every((move, index) => move.number === index + 1);
    const recoveredMoves = completeOrder ? parityConsistent : [];
    // 棋盘线距太小的图，序号本身就认不出来（实测线距 ~21px 时 54 张图里序号全对
    // 0 张，~24px 起恢复正常）。这种时候直说"图太小"，比笼统的"没认出来"有用。
    const linePitch = grid ? Math.min(grid.spacingX, grid.spacingY) : 0;
    // 书谱常见约定：终局图上**只标最后 k 手**（图里其余子不编号）。此时读出的序号天然
    // 凑不成 1..N，旧文案写成「序号不连续（仅认出 5/43 个）」——读起来像识别失败，而
    // 实际上图里就只有那几个号（用户 09-15 拿来的那张书谱图正是如此：全图只标 1..6，
    // 六个号全读对）。所以这里把**读出的具体序号**列出来，并区分「图里本来就只标了一小段」
    // 与「该读的没读全」。
    const readNumbers = [...parityConsistent.map((move) => move.number)].sort((a, b) => a - b);
    const isPrefixRun = readNumbers.length >= 2 && readNumbers.every((number, index) => number === index + 1);
    // 多认一颗子时把「哪颗、为什么」说清楚——用户据此决定删不删（去子在核对屏一按就行）。
    const droppedNote = droppedClaim
      ? `；另有 1 颗子（${String.fromCharCode(65 + droppedClaim.col)}${boardSize - droppedClaim.row}）疑似多认（它与别处声称同一个第 ${droppedClaim.value} 手），未参与编号，请在叠图上核对`
      : "";
    const numberingNote = opts.skipMoveOrder ? "" : completeOrder
      ? `已按序号恢复 ${recoveredMoves.length} 手顺序${droppedNote}`
      : moveOrderSkipped
        ? `棋子过密（${actualStones} 子），序号互相压叠读不出可靠数字，已按局面导入；如需手序请截取更清晰或更少的区域`
        : ordered.length === 0
        ? "未检测到可靠序号"
        : moveOrderQuality?.status === "ambiguous"
          ? `序号形式完整但坐标存在交换风险，未自动复原（${moveOrderQuality.reason || "需要人工核对"}）`
        : parityDropped > 0
          ? `序号不可靠（${ordered.length} 个中 ${parityDropped} 个与黑白不符），已按局面导入`
          : linePitch > 0 && linePitch < 24
            ? `序号难以辨认（棋盘线距仅 ${Math.round(linePitch)}px，读出 ${ordered.length} 个：${readNumbers.join(",")}），建议放大或只截取棋盘区域${droppedNote}`
            : isPrefixRun
              ? `图中只标注了 ${readNumbers.length} 个序号（1–${readNumbers.length}，已全部读出）；不是完整手序，未用于重建落子顺序`
              : `序号不完整（读出 ${ordered.length}/${actualStones} 个：${readNumbers.join(",")}），已按局面导入${droppedNote}`;
    const note = [
      fallback ? "未检测到网格线，已按标准边距识别，建议截取仅含棋盘的区域。" : "已自动定位棋盘网格。",
      autoSizeNote,
      `识别 ${actualStones} 子`,
      ignoredColoredMarkers ? `忽略 ${ignoredColoredMarkers} 个彩色标注` : "",
      numberingNote,
      balanceWarning,
      // 相位校正触发过就明说：这条校正对「真错一格」与「顶线没测到」两种情况
      // 会给出同一组证据，无法自辨，所以让用户核对一次行列，而不是默默给一个
      // 看起来正常、其实整体错位的盘。
      phaseShifted ? "网格相位曾自动校正过一格，请核对棋子行列是否与图一致" : "",
    ].filter(Boolean).join("；");
    return {
      boardSize,
      board,
      numberedMoves: recoveredMoves,
      moveOrderQuality,
      // 读出的号原样上报（哪怕拼不成完整手序）——见 ImageRecognitionResult.readMoveNumbers。
      // 注意取**补号之后**的 parityConsistent：09-15 的结构补号与本轮门槛诊断都汇入这份集合。
      readMoveNumbers: parityConsistent.slice(),
      numberedSkippedStone: droppedClaim ? { row: droppedClaim.row, col: droppedClaim.col } : null,
      confidence,
      ignoredColoredMarkers,
      note,
      gridFallback: fallback,
      imageWidth: sourceWidth,
      imageHeight: sourceHeight,
      gridCanvas: { width: canvasWidth, height: canvasHeight },
      grid: { originX: grid.originX, originY: grid.originY, spacingX: grid.spacingX, spacingY: grid.spacingY },
    };
  } finally {
    closeRasterImage(image, loaded.revoke);
    accelerator?.dispose();
  }
};
