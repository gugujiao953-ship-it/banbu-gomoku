import type { Cell, Position, Player } from "./types";
import { isSupportedBoardSize } from "./game";

export interface ImageRecognitionResult {
  boardSize: number;
  board: Cell[][];
  numberedMoves: Array<Position & { player: Player; number: number }>;
  confidence: number;
  ignoredColoredMarkers: number;
  note: string;
  /** 解码后原图的像素尺寸（缩放前）。调用方用它显示「手机到底交了多少像素」这类
   *  诊断信息——以前是在识别前先 createImageBitmap 一次只为拿尺寸，同一张图白解码
   *  两遍（iOS 上大图一次 100-400ms），所以由识别器顺带回报。 */
  imageWidth: number;
  imageHeight: number;
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
export const scoreGridWindow = (
  image: SampledImage,
  originX: number,
  originY: number,
  spacingX: number,
  spacingY: number,
  boardSize: number,
): GridWindowQuality | null => {
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
    return Math.max(0, Math.min(1, (Math.abs(center - background) - 7) / 32));
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

const detectGrid = async (
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
  const globalFits = await acc.fitCombs([
    { alongX: true, innerStart: 1, boardSize, spacingRange: { minimum: globalMinSpacing } },
    { alongX: false, innerStart: 1, boardSize, spacingRange: { minimum: globalMinSpacing } },
  ]);
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
    if (window.continuity < 0.55) failures.push("continuity");
    if (window.lineCoverage < 0.12) failures.push("lineCoverage");
    if (window.spatialCoverage < 0.3) failures.push("spatialCoverage");
    if (window.fullLineShare < 0.35) failures.push("fullLineShare");
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
    const pairedScore = window.score
      + (row.score + column.score) * 0.035
      + localBonus
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
  const considerBatch = async (batch: readonly Candidate[]): Promise<void> => {
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
  };

  // 三个候选来源按原顺序拼成一批：全局配对 → 锁定一列的局部行 → 锁定一行的
  // 局部列。顺序不能变：同分时谁先被考虑决定谁留在 best / cleanBest 上。
  const candidates: Candidate[] = [];
  // First consider pairs found across the complete image. This is the fast and
  // accurate path for already-cropped board images.
  for (const row of rowFits.slice(0, 36)) {
    for (const column of columnFits.slice(0, 36)) candidates.push({ row, column, localBonus: 0 });
  }

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
  await considerBatch(candidates);

  // The one-dimensional comb score cannot separate the board's own rows from
  // stronger periodic UI texture (analysis tables, text baselines) sharing the
  // same spacing, so a correct row comb may never reach the candidate pools at
  // all. Instead of trusting those rankings, enumerate row phases directly
  // from the most trusted column combs (and vice versa) and pre-filter them
  // with cheap two-direction mesh evidence: only the real board has a dense
  // intersection mesh, texture and tables stay near zero.
  const enumeratePhases = async (fixed: CombFit, alongRows: boolean): Promise<Array<{ origin: number; mesh: number }>> => {
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
  const selected = best as { row: CombFit; column: CombFit; score: number; window: GridWindowQuality } | null;
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
    || coherentDiscStone
    || mutedDiscStone
    || outerRingStone
    || terminalRingStone
    || metalRingStone
    || darkSolidStone;
  // Real pale stones (jade ≈ 40, snow ≈ 30-45) sit just above the old 34
  // threshold; actual coloured annotations are far more saturated (120+).
  const coloredMarker = compactMarker || (foregroundSaturation >= 50
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
interface MoveNumberTemplate {
  w: number; h: number;
  icx: number; icy: number;                 // ink centroid inside the bitmap, sup px
  ax: number; ay: number;                   // advance/baseline anchor, sup px
  bh: number;                               // full alpha>0 ink height, sup px
  ink: Int32Array;                          // coverage>=0.5 indices (row-major)
  inkX: Int16Array;                         // column/row of each ink pixel, precomputed
  inkY: Int16Array;                         // (scoreAt is the top hotspot; this removes
                                            //  a division and a floor per ink pixel)
  mean: number; norm: number;
}
const moveNumberTemplateCache = new Map<string, MoveNumberTemplate | null>();

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
];
const moveNumberCapRatioCache = new Map<string, number>();
// Single-stroke glyphs like "1" cannot tell fonts apart, so the vote keeps
// sampling families across the first few stones before locking in.
const MOVE_NUMBER_VOTE_SAMPLES = 3;
let moveNumberFamilyVote: { scores: number[]; decided: number; samples: number } | null = null;
const resetMoveNumberCalibration = () => { moveNumberFamilyVote = null; };

const renderMoveNumberTemplate = (text: string, fontPx: number, bold: boolean, family: string): MoveNumberTemplate | null => {
  if (typeof document === "undefined") return null;
  const sup = MOVE_NUMBER_SUP;
  const key = `${text}|${fontPx.toFixed(2)}|${bold ? "b" : ""}|${family}`;
  const cached = moveNumberTemplateCache.get(key);
  if (cached !== undefined) return cached;
  if (moveNumberTemplateCache.size > 6000) moveNumberTemplateCache.clear();
  const build = (): MoveNumberTemplate | null => {
    const fs = fontPx * sup;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(8, Math.ceil(fs * (text.length * 0.8 + 1.2)));
    canvas.height = Math.max(8, Math.ceil(fs * 1.8));
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
    for (let py = 0; py < h; py += 1) {
      for (let px = 0; px < w; px += 1) {
        const a = rgba[(py * w + px) * 4 + 3] / 255;
        sum += a; sumSq += a * a;
        wx += a * px; wy += a * py;
        if (a >= 0.5) { inkList.push(py * w + px); inkXList.push(px); inkYList.push(py); }
      }
    }
    if (!sum) return null;
    const n = w * h;
    const mean = sum / n;
    const norm = Math.sqrt(Math.max(1e-6, sumSq - n * mean * mean));
    // Integer anchors: scoreAt indexes Float32Array linearly and a fractional
    // (canvas.width/2 - cx0) silently yields undefined -> NaN -> zero scores.
    return { w, h, bh: y1 - y0 + 1, icx: Math.round(wx / sum), icy: Math.round(wy / sum), ax: Math.round(ax - cx0), ay: Math.round(ay - cy0), ink: Int32Array.from(inkList), inkX: Int16Array.from(inkXList), inkY: Int16Array.from(inkYList), mean, norm };
  };
  const built = build();
  moveNumberTemplateCache.set(key, built);
  return built;
};

interface MoveNumberCandidate { value: number; score: number }

const matchMoveNumbers = (image: SampledImage, x: number, y: number, spacing: number, player: Player, maxNumber: number, forceFamily = -1): MoveNumberCandidate[] => {
  const dbg = (globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__;
  const logDigit = (value: number | null, score: number, margin: number, scale = 1, why = "ok", cands: MoveNumberCandidate[] = []) => {
    const record = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, player, value, score: Math.round(score * 1000) / 1000, margin: Math.round(margin * 1000) / 1000, scale, why, cands, family: moveNumberFamilyVote && moveNumberFamilyVote.decided >= 0 ? MOVE_NUMBER_FAMILIES[moveNumberFamilyVote.decided] : null, spacing: Math.round(spacing * 10) / 10 };
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
  const g = new Float32Array(sw * sw);
  const sign = player === "white" ? -1 : 1; // flip so that the number ink is always the bright side
  for (let sy = 0; sy < sw; sy += 1) {
    const fy = gy0 + sy / sup;
    const py = Math.min(IH - 1.001, Math.max(0, fy)), py0 = Math.floor(py), wy = py - py0;
    for (let sx = 0; sx < sw; sx += 1) {
      const fx = gx0 + sx / sup;
      const px = Math.min(IW - 1.001, Math.max(0, fx)), px0 = Math.floor(px), wx = px - px0;
      const a = gray[py0 * IW + px0], b = gray[py0 * IW + px0 + 1], c = gray[(py0 + 1) * IW + px0], d = gray[(py0 + 1) * IW + px0 + 1];
      g[sy * sw + sx] = sign * (a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c * (1 - wx) * wy + d * wx * wy);
    }
  }
  // Disc level from the annulus (never carries ink), ink peak from the centre.
  const cxs = (x - gx0) * sup + 0.5, cys = (y - gy0) * sup + 0.5;
  const rAnnIn = 0.28 * spacing * sup, rAnnOut = 0.46 * spacing * sup, rIn = 0.26 * spacing * sup;
  const ann: number[] = [], inner: number[] = [];
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
  if (spread < 32) { logDigit(null, 0, 0, 1, "flat"); return []; } // no number ink on this stone
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
  const maxInk = 0.3 * Math.PI * rCent * rCent;
  if (inkCount < 10 || inkCount > maxInk) { logDigit(null, 0, 0, 1, "ink"); return []; }
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
  const scaleFor = (familyIndex: number) => Math.min(1.9, Math.max(0.7, capH / capRatioOf(familyIndex) / fontPx));
  // Integral images over the sign-flipped sup window for O(1) box sums.
  const integral = new Float64Array((sw + 1) * (sw + 1));
  const integralSq = new Float64Array((sw + 1) * (sw + 1));
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
    for (let i = 0; i < inkCount; i += 1) {
      const px = ix0 + inkX[i];
      if (px < 0 || px >= sw) continue;
      const py = iy0 + inkY[i];
      if (py < 0 || py >= sw) continue;
      dot += g[py * sw + px];
    }
    dot -= t.mean * sum;
    return dot / (t.norm * Math.sqrt(varW * count));
  };
  const small = fontPx < 9; // centroid noise grows as glyphs shrink
  const limit = Math.min(maxNumber, 225);
  const offsets = small && limit <= 40 ? [-6, -4, -2, 0, 2, 4, 6] : [-4, -2, 0, 2, 4];
  const offsetsFine: number[] = [];
  for (let o = small ? -3 : -6; o <= (small ? 3 : 6); o += 1) offsetsFine.push(o);
  const byValue = new Map<number, number>();
  const merge = (value: number, score: number) => { if (score > (byValue.get(value) ?? 0)) byValue.set(value, score); };
  const vote = moveNumberFamilyVote ?? (moveNumberFamilyVote = { scores: MOVE_NUMBER_FAMILIES.map(() => 0), decided: -1, samples: 0 });
  let bestScale = 1;
  // One coarse+fine sweep at a fixed (family, scale, bold); returns its best
  // score. `sink` merges winners into byValue — measurement passes (family
  // voting) must NOT pollute the candidate pool with wrong-family values.
  const runSweep = (familyIndex: number, scale: number, bold: boolean, sink: boolean): number => {
    const size = fontPx * scale;
    const family = MOVE_NUMBER_FAMILIES[familyIndex];
    let sweepBest = 0;
    let confidentValue = 0;
    const ranked: { value: number; score: number }[] = [];
    for (let value = 1; value <= limit; value += 1) {
      const t = renderMoveNumberTemplate(String(value), size, bold, family);
      if (!t) continue;
      let sBest = 0;
      for (const dy of offsets) for (const dx of offsets) {
        const s = scoreAt(t, dx, dy);
        if (s > sBest) sBest = s;
      }
      ranked.push({ value, score: sBest });
      if (sBest >= 0.85) { // strong unambiguous match: accept immediately
        if (sink) merge(value, sBest);
        confidentValue = value; bestScale = scale; sweepBest = sBest;
        break;
      }
    }
    if (!confidentValue) {
      ranked.sort((a, b) => b.score - a.score);
      for (const cand of ranked.slice(0, 6)) {
        const t = renderMoveNumberTemplate(String(cand.value), size, bold, family);
        if (!t) continue;
        let sBest = cand.score;
        for (const dy of offsetsFine) for (const dx of offsetsFine) {
          const s = scoreAt(t, dx, dy);
          if (s > sBest) sBest = s;
        }
        if (sink) merge(cand.value, sBest);
        if (sBest > sweepBest) { sweepBest = sBest; bestScale = scale; }
        if (sweepBest >= 0.85) break;
      }
    }
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
  let overall = tryFamily(chosen, true);
  if (chosen !== 0) {
    // Belt and braces: even with a locked family, family 0 (the app's own
    // stack) is always tried too — if the lock was wrong, the exact face
    // still rescues the stone; if the lock is right, family 0 simply loses.
    const s0 = tryFamily(0, true);
    if (s0 > overall) { overall = s0; chosen = 0; }
  }
  if (overall < FAST_ACCEPT && vote.decided < 0) {
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
    const perStone = MOVE_NUMBER_FAMILIES.map((_, f) => (f === 0 ? overall : voteSweep(f)));
    for (let f = 0; f < perStone.length; f += 1) vote.scores[f] += perStone[f]; // SUM: one lucky glyph must not win
    vote.samples += 1;
    if (vote.samples >= Math.min(MOVE_NUMBER_VOTE_SAMPLES, limit)) {
      let best = 0;
      for (let i = 1; i < vote.scores.length; i += 1) if (vote.scores[i] > vote.scores[best]) best = i;
      // A wrong-but-similar face beats the exact one by ≤0.1 per stone even
      // on rescaled same-device shots; a genuinely different device's face
      // beats the foreign stack by 0.25+. Demand the strict margin to
      // dethrone family 0 — the same-device default.
      vote.decided = best === 0 || vote.scores[best] >= vote.scores[0] + 0.17 * vote.samples ? best : 0;
      if (Array.isArray((globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__)) {
        (globalThis as typeof globalThis & { __BANBU_MOVEORDER_TRACE__?: unknown[] }).__BANBU_MOVEORDER_TRACE__?.push({ why: "vote", samples: vote.samples, totals: vote.scores.map((s) => Math.round(s * 1000) / 1000), decided: MOVE_NUMBER_FAMILIES[vote.decided] });
      }
    }
    // Voting stones NEVER sink a non-family-0 winner: pre-lock merges were
    // the source of same-device contamination. The post-pass in
    // recognizeBoardImage re-scores early stones once the lock exists.
  }
  // Stage 2: wider size fallback — mirrors the 0.7–1.8 序号大小 slider.
  if (overall < 0.55) {
    const m = scaleFor(chosen);
    for (const scale of [m * 0.94, m * 1.06, 1.25, 0.75, 1.5, 1.8, 0.9, 1.1, 1.4]) {
      const s = runSweep(chosen, scale, false, true);
      if (s > overall) overall = s;
      if (overall >= 0.55) break;
    }
  }
  // Stage 3: escape hatch — this stone disagrees with the image's chosen family.
  if (overall < 0.45 && vote.decided >= 0) {
    for (let f = 0; f < MOVE_NUMBER_FAMILIES.length; f += 1) {
      if (f === vote.decided) continue;
      const s = runSweep(f, scaleFor(f), false, true);
      if (s > overall) overall = s;
      if (overall >= 0.55) break;
    }
  }
  // Stage 4: the newest move is tinted red with a .8px stroke — retry slightly bolder.
  if (overall < (small ? 0.3 : 0.35)) {
    const s = runSweep(chosen, bestScale, true, true);
    if (s > overall) overall = s;
  }
  const cands = [...byValue]
    .map(([value, score]) => ({ value, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const strong = cands.filter((c) => c.score >= 0.4);
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
 * or its quality floors are not met.
 */
const assignMoveNumbers = (perStone: MoveNumberCandidate[][], players: Player[], minScore: number, meanScore: number): number[] | null => {
  const n = perStone.length;
  if (!n) return null;
  // Records always start with black, so odd numbers are black stones and even
  // numbers are white; parity-killing wrong edges removes an entire class of
  // cyclic mis-assignments from the joint solve.
  const maps = perStone.map((cands, i) => new Map(cands.filter((c) => (c.value % 2 === 1) === (players[i] === "black")).map((c) => [c.value, c.score] as const)));
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
      if (!Number.isFinite(delta)) { failed = true; break; } // no augmenting path without forbidden edges
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
  let total = 0, lowest = Infinity;
  for (let i = 1; i <= n; i += 1) {
    const s = maps[i - 1].get(assign[i]);
    if (s === undefined) return null;
    total += s;
    if (s < lowest) lowest = s;
  }
  if (lowest < minScore || total / n < meanScore) return null;
  return assign.slice(1);
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
export interface MeshQuery {
  originX: number;
  originY: number;
  spacingX: number;
  spacingY: number;
  boardSize: number;
  sampleStep?: number;
}

/** 批处理执行器。主线程直算与 worker 池是同一种形状，调用点只有一条代码
 * 路径；两种实现的返回值必须逐位一致（否则并行就成了另一种识别器）。 */
export interface RecognitionAccelerator {
  scoreWindows(queries: readonly GridWindowQuery[]): Promise<Array<GridWindowQuality | null>>;
  meshSupports(queries: readonly MeshQuery[]): Promise<number[]>;
  fitCombs(queries: readonly CombQuery[]): Promise<CombFit[][]>;
  cellFeatures(queries: readonly CellQuery[]): Promise<IntersectionFeatures[]>;
  dispose(): void;
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
  dispose: () => { /* 无资源可释放 */ },
});

export const recognizeBoardImage = async (file: File, boardSize = 15, opts: { skipMoveOrder?: boolean; roi?: BoardRoi; parallel?: boolean } = {}): Promise<ImageRecognitionResult> => {
  if (!isSupportedBoardSize(boardSize)) throw new Error("棋盘尺寸必须在 5–25 路之间");
  const loaded = await loadRasterImage(file);
  const { image } = loaded;
  // 声明在 try 之外：无论识别成功还是抛错，finally 都要把 worker 池收掉。
  let accelerator: RecognitionAccelerator | null = null;
  try {
    const sourceWidth = image.width;
    const sourceHeight = image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("图片没有有效尺寸");

    // Keep the whole frame (no crop): the grid detector locates the board by
    // its lines wherever it sits. Long side is capped for memory.
    // Keep the whole frame (no crop): the grid detector locates the board by
    // its lines wherever it sits. Long side is capped for memory.
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const canvasWidth = Math.max(320, Math.round(sourceWidth * scale));
    const canvasHeight = Math.max(320, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("当前浏览器不支持图片识谱");
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, canvasWidth, canvasHeight);
    const data = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
    const sampled = createSampledImage(data, canvasWidth, canvasHeight);
    const gray = sampled.gray;

    // 多核加速（设置「可选增强功能 · 识谱多核加速」）：按设备核心数与可用
    // 内存起一个 worker 池并行算那几段纯函数批次。任何一步失败都静默回落
    // 单线程直算——加速是优化，绝不能变成识别失败的原因。
    if (opts.parallel) {
      try {
        const { createParallelAccelerator } = await import("./features/recognition/recognition-accelerator");
        accelerator = await createParallelAccelerator(sampled);
      } catch (error) {
        console.warn("[banbu-image-accelerator] 多核识谱不可用，回落单线程", error);
        accelerator = null;
      }
    }
    const acc = accelerator ?? localAccelerator(sampled);

    let grid = await detectGrid(sampled, boardSize, opts.roi, acc);
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
      if (uniform && shiftFits && top < second * 0.6 && second > 0.08 && (below > second * 0.6 || frontLoadRows <= 12)) dy = 1;
      if (dy) {
        grid = { ...grid, originY: oy + dy * sy, quality: Math.min(0.65, grid.quality + 0.06) };
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
    const numberStones: Array<{ row: number; col: number; player: Player }> = [];
    let candidates: Array<{ row: number; col: number; x: number; y: number; features: IntersectionFeatures }> = [];
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
    const cellFeatures = await acc.cellFeatures(cellQueries);
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
        if (!isHollowPrintedStone(features)) continue;
        let neighbours = 0;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (!dr && !dc) continue;
            const r = row + dr, c = col + dc;
            if (r < 0 || c < 0 || r >= boardSize || c >= boardSize) continue;
            if (occupiedKeys.has(`${r},${c}`)) neighbours += 1;
          }
        }
        if (neighbours < 2) continue;
        candidates.push({ row, col, x: cell.x, y: cell.y, features });
        occupiedKeys.add(key);
        if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
          console.info("[banbu-image-hollow-rescue]", JSON.stringify({
            rc: `${String.fromCharCode(65 + col)}${boardSize - row}`,
            ring: Math.round(features.ringShare * 100) / 100,
            diagonal: Math.round(features.diagonalShare * 100) / 100,
            outer: Math.round(features.outerShare * 100) / 100,
            middle: Math.round(features.middleShare * 100) / 100,
            neighbours,
          }));
        }
      }
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
    resetMoveNumberCalibration(); // family voting is per screenshot
    candidates.forEach((candidate) => {
      const { row, col, x, y, features } = candidate;
      let player: Player;
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
      if (isHollowPrintedStone(features)
        && (features.foregroundLight >= 128 || features.foregroundLight - features.backgroundLight >= -80)) {
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
      if (!opts.skipMoveOrder) {
        const cands = matchMoveNumbers(sampled, x, y, localSpacing, player, candidates.length);
        const stoneDebug = (globalThis as typeof globalThis & { __BANBU_STONE_DEBUG__?: unknown[] }).__BANBU_STONE_DEBUG__;
        if (Array.isArray(stoneDebug)) stoneDebug.push({ row, col, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        numberCandidates.push(cands);
        numberStones.push({ row, col, player });
        const top = cands[0];
        if (top && top.score >= 0.55 && (cands.length === 1 || top.score - cands[1].score >= 0.05)) {
          numberedMoves.push({ row, col, player, number: top.value });
        }
      }
    });
    // Post-pass: when the family vote locked a NON-default face, the early
    // stones (voted before the lock) only carry family-0 candidates — give
    // the weak ones a second pass with the winning family so the joint
    // assignment sees full coverage. Same-device images never get here.
    if (!opts.skipMoveOrder && moveNumberFamilyVote && moveNumberFamilyVote.decided > 0) {
      for (let i = 0; i < candidates.length; i += 1) {
        const prev = numberCandidates[i];
        if (prev && prev.length && prev[0].score >= 0.55) continue;
        const cand = candidates[i];
        const rerun = matchMoveNumbers(sampled, cand.x, cand.y, localSpacing, numberStones[i].player, candidates.length, moveNumberFamilyVote.decided);
        if (rerun.length && (!prev?.length || rerun[0].score > prev[0].score)) numberCandidates[i] = rerun;
      }
    }
    // Joint sequence consistency: when every stone carries candidates that can
    // form the unique complete 1..N assignment, trust it over the per-stone
    // margin rejections (an ambiguous stone is disambiguated by its peers).
    if (!opts.skipMoveOrder && candidates.length >= 2 && numberCandidates.length === candidates.length && numberCandidates.every((c) => c.length > 0)) {
      const assignment = assignMoveNumbers(numberCandidates, numberStones.map((s) => s.player), 0.5, 0.7);
      if (assignment) {
        numberedMoves = assignment.map((number, index) => ({ ...numberStones[index], number })).sort((a, b) => a.number - b.number);
      }
    }

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
    if (Math.abs(blackCount - whiteCount) > 2 && numberedShare < 0.5 && !isPrintedDiagram) {
      majority = blackCount > whiteCount ? "black" : "white";
      const excess = Math.min(5, Math.abs(blackCount - whiteCount) - 2);
      const removable = candidates
        .filter((candidate) => board[candidate.row][candidate.col] === majority)
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
    const balanceWarning = occupied > 0 && Math.abs(blackCount - whiteCount) > 2
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
    const completeOrder = parityConsistent.length >= 2
      && parityConsistent.length === actualStones
      && parityConsistent.every((move, index) => move.number === index + 1);
    const recoveredMoves = completeOrder ? parityConsistent : [];
    // 棋盘线距太小的图，序号本身就认不出来（实测线距 ~21px 时 54 张图里序号全对
    // 0 张，~24px 起恢复正常）。这种时候直说"图太小"，比笼统的"没认出来"有用。
    const linePitch = grid ? Math.min(grid.spacingX, grid.spacingY) : 0;
    const numberingNote = opts.skipMoveOrder ? "" : completeOrder
      ? `已按序号恢复 ${recoveredMoves.length} 手顺序`
      : ordered.length === 0
        ? "未检测到可靠序号"
        : parityDropped > 0
          ? `序号不可靠（${ordered.length} 个中 ${parityDropped} 个与黑白不符），已按局面导入`
          : linePitch > 0 && linePitch < 24
            ? `序号难以辨认（棋盘线距仅 ${Math.round(linePitch)}px，仅认出 ${ordered.length}/${actualStones} 个），建议放大或只截取棋盘区域`
            : `序号不连续（仅认出 ${ordered.length}/${actualStones} 个），已按局面导入`;
    const note = [
      fallback ? "未检测到网格线，已按标准边距识别，建议截取仅含棋盘的区域。" : "已自动定位棋盘网格。",
      `识别 ${actualStones} 子`,
      ignoredColoredMarkers ? `忽略 ${ignoredColoredMarkers} 个彩色标注` : "",
      numberingNote,
      balanceWarning,
    ].filter(Boolean).join("；");
    return {
      boardSize,
      board,
      numberedMoves: recoveredMoves,
      confidence,
      ignoredColoredMarkers,
      note,
      imageWidth: sourceWidth,
      imageHeight: sourceHeight,
    };
  } finally {
    closeRasterImage(image, loaded.revoke);
    accelerator?.dispose();
  }
};
