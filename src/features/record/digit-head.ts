import type { BoardCellEvidence, BoardScanner, CellScanQuery, DigitReader, ModelScanOptions, MoveNumberCandidate, RecognitionAccelerator } from "../../image-recognition";
import { ensureModelSessions, readDigitCandidates, DIGIT_CROP_HALF_CAP } from "./model-inference";

/**
 * 数字头读号器（可选增强，2026-10-06）：把训练好的小型数字 CNN 接进应用读号环节。
 *
 * 模型：digit-head-combo46-fp16（**226 类**：0=无号 + 1..225，输入 [N,3,64,64] float；
 * 2026-10-12 起。此前是 digit-head-iter8 的 **171 类** 0..170——那是**模型侧上限**，
 * 172 手以上结构性读不出，不是接线 bug；换 226 类后满盘的号段才真正可达）。
 * 训练语料与逐层验收见 `docs/纪要-数字头训练诊断与修复-2026-10-10.md` §16：
 * 留出集（未参与训练的 136 盘 / 48,078 裁剪）读号 94.51%→**99.87%**、601 颗人工真值
 * **601/601**、老标尺三图逐位不变。早期（171 类时代）真实图验证见
 * `_research/手机模型独立测试-2026-10-04.md` 与 `_research/浏览器端数字头测速与集成决策-2026-10-06.md`：
 * 比赛图逐坐标 57/57、白底 89 手图完整复原、外部 App 截图（黑子白字）15/15。
 *
 * 边界（与集成决策文档一致）：
 *  - 只替换「每格读什么号」这一步；完整性/奇偶/交换风险等全部门控不变。
 *  - 模型包缺失、加载失败、推理异常 → 返回 null，调用方回落现有模板匹配。
 *  - 裁格几何与 Python 侧 evaluate-lite-hybrid.py 的 crop_cell 逐条对齐：
 *    半窗 = max(6, round(格距))（即 2×2 格窗口）、越界取到边界、非方补灰 235、
 *    双线性缩到 64×64、归一化 x/127.5−1、RGB→CHW。
 *
 * 2026-10-07 起裁格与推理**只有一份实现**（`model-inference.ts`）：主线程直算、
 * 识谱 worker 池里的分片（多核加速开关打开时）都调它，所以并行与串行逐位相同。
 */

/** 识谱增强包（2026-10-07）：两个模型**内置**在应用里（`public/models`，由
 * `scripts/prepare-ai-assets.mjs` 在 prebuild 拷好），点「复原手序-本地」即用，
 * 零下载、离线可用。模型地址常量在 `model-inference.ts` 里（唯一来源），这里
 * 原样再导出，保持 `App.tsx`/QA 脚本的既有引用。 */
export { CELL_CLS_MODEL_URL, DIGIT_HEAD_MODEL_URL } from "./model-inference";

export interface DigitHeadOptions {
  /** 模型文件地址（.onnx）。默认用内置的 digit-head-iter8；QA 可指向别处对比。 */
  modelUrl: string;
  /** wasm 运行时目录（仅 QA/dev 需要显式指定；生产留空由打包器与 ORT 自动解析）。 */
  wasmPaths?: string;
  /** wasm 线程数，默认 min(4, 硬件并发)。 */
  threads?: number;
  /** 单次推理的格数。默认 16（批大小对速度影响很小，只为减少 await 次数）。 */
  batchSize?: number;
  /** 逐格回落门槛：数字头 top-1 softmax 低于它就把这颗子交回模板匹配。
   *  默认 0.5，与应用自身「可读」门槛（0.55）同量级。 */
  confidenceFloor?: number;
}

/**
 * 逐格读号器：主线程直算版。裁格与推理全部交给 `model-inference`（与 worker 池同一份），
 * 这里只负责「门槛与候选条数」这一层语义——与原实现逐位一致：
 * argmax 为 0（判无号）或置信 < floor → null（该格交回模板）；否则返回 top-3。
 */
export const createDigitHeadReader = async (options: DigitHeadOptions): Promise<DigitReader | null> => {
  const modelOptions: ModelScanOptions = { wasmPaths: options.wasmPaths, threads: options.threads, digitModelUrl: options.modelUrl };
  const sessions = await ensureModelSessions(modelOptions);
  if (!sessions?.digit) return null;
  const confidenceFloor = options.confidenceFloor ?? 0.5;
  return async ({ image, centers, spacing }) => {
    const half = Math.max(6, Math.round(spacing));
    const reads = await readDigitCandidates(image, centers, half, modelOptions);
    if (!reads || reads.length !== centers.length) return centers.map(() => null);
    return reads.map((read) => {
      if (read.digit <= 0 || read.digitProb < confidenceFloor) return null;
      return read.digitTop.slice(0, 3);
    });
  };
};

/** 数字头读号时「第一次读得不够强」的救援尺度：见 scanner 内的多尺度读号。
 *  实测（用户那张 15 手图）：红色「15」在 1.0× 下读成 5、0.7× 下才是 15；
 *  K9 的 9 要到 0.6× 才读得动、J6 的 13 在 0.7× 出现（1.0× 是误读 23）。
 *  0.8×（2026-10-07 模糊图实测加档）：那张 5.7px 小字图在 1.0× 只有 18/71 个读数
 *  过 0.5 置信，0.8× 有 26 个、0.7× 有 25 个——小字图里 0.8× 比 1.0× 明显更好，
 *  作为第一档补读能多捞回一批。
 *
 *  0.65/0.45（2026-10-08 网页棋盘域实测，见 qa/tmp-rp-digits.mjs）：renjuportal 这类
 *  棋子带大号的干净盘面上，**密盘**（70+ 子、数字挤在一起）单看 1.0× 只有 41/76，
 *  而 0.45× 有 60/76——2×2 格窗口把邻子的数字也裁进来，密盘里就是干扰源。
 *  但把阶梯整体换成「按格距的绝对尺度 + 按距离排序」的版本会让用户那张 15 手图退化
 *  （读出 15 → 12、完整复原 → 拒绝，2026-10-08 逐条 A/B 实测），所以阶梯保持
 *  「相对主尺度」的旧口径。
 *
 *  「主尺度」本身在 2026-10-12 改回**训练口径**（半窗 = 格距，窗口 = 2×格距）：那一轮
 *  的实测（qa/tmp-order-crophalf-probe.mjs）证明旧的主尺度上限是系统性域差，见台下
 *  halfBase 的注释。原先「密盘需要更紧窗口」的诉求改由阶梯末档的紧窗兜底满足，
 *  不是在主尺度上二选一。 */
// （阶梯档位 0.8/0.7/0.6 直接写在 scanner 里，见那里的注释。）
/** 「这一格还没读准」的置信门槛。低于它就换尺度再问，读数跨尺度按多数票合并
 *  （见 mergeDigitReads 注释：原来的「同号取最高分」在密盘上会把一致的低分正确读
 *  输给单个高分误读）。 */
const DIGIT_RESCUE_BELOW = 0.72;
/** 首选与次选贴得太近也算「还没读准」（2026-10-08 网页棋盘域实测）：密盘上有一批
 *  读数是「自信但错」——比如真值 33 读成 31（0.90）而 0.45×/0.6× 下都读对 33。
 *  只看绝对置信度的话这种格子永远不会被补读（0.90 > 0.72）；加上「领先第二名
 *  多少」这条判据才捞得回来，代价只是这种格子多问一两个尺度。 */
const DIGIT_RESCUE_MARGIN = 0.25;
/** 扫描器的格级证据缓存条数（导入 → 复原会拿同一张图扫两遍，缓存把第二遍省掉）。 */
const SCAN_CACHE_LIMIT = 2;
/** 读号返回的候选条数（装配器要「唯一号 + 1..N + 奇偶」挑，多给几条更有余地）。 */
const DIGIT_TOP_K = 4;
/** 读号批量的分水岭：≥ 这么多格才值得走 worker 池（起池/上传/装模型的固定成本 ~1s）。 */
const DIGIT_POOL_MIN_CELLS = 24;

/** 证据缓存的键：尺寸 + 网格 + 稀疏像素校验和。同一张图两次识别（导入与复原）
 *  画布与网格逐值相同 → 命中；不同图即使尺寸/网格巧合相同，像素校验和也会分开。 */
const scanCacheKey = (image: { data: Uint8ClampedArray; width: number; height: number }, grid: { originX: number; originY: number; spacingX: number; spacingY: number }, boardSize: number): string => {
  let hash = 2166136261;
  const total = image.width * image.height * 4;
  const stride = Math.max(4, Math.floor(total / 512 / 4) * 4);
  for (let index = 0; index < total; index += stride) {
    hash = Math.imul(hash ^ image.data[index], 16777619);
  }
  return `${image.width}x${image.height}|${grid.originX.toFixed(1)},${grid.originY.toFixed(1)},${grid.spacingX.toFixed(2)},${grid.spacingY.toFixed(2)}|${boardSize}|${(hash >>> 0).toString(36)}`;
};

/**
 * cell-cls 全盘扫描器（位置线，2026-10-07）：对全部交点各判一次「空/黑/白」，
 * 需要时再用数字头给指定格读号。
 *
 * 速度（用户反馈「识别比之前慢 3-5 倍」的根修，2026-10-07）：
 *  - **只读要用的号**：旧实现无条件对 225 格各跑一次数字头（单线程约 6 秒），
 *    但实测（user-cno/remote-image2/paper10 三图）pEmpty∈[0.05,0.3) 的疑似补位格
 *    在两种域里全是假阳、真漏子的 pEmpty 全 ≤0.02——数字头只在「调用方点名要读」
 *    的格与 pEmpty<0.05 的格上跑。
 *  - **静态导入完全不读号**（needDigits:false）：那条路径只用占用/颜色。
 *  - **同一张图只扫一遍**：导入识别与「复原手序-本地」都调这个扫描器，格级证据
 *    按（尺寸+网格+像素校验和）缓存，复原时复用导入那一遍。
 *  - **多核**：调用方传了 `accelerator`（识谱多核加速开关打开时就有）时，格级扫描
 *    与读号都切成 4×线程数 片丢进 worker 池——每 worker 一份 ORT 会话，主线程不参与，
 *    225 格从单线程 5 秒级降到 1 秒级；不传（开关关掉 / worker 起不来）就在主线程直算，
 *    两条路径走同一份 `model-inference`，结果逐位相同。
 *  - **多尺度读号**：1.0× 起读，不够确定（<0.72）或读出结构上不可能的号
 *    （> digitMaxNumber）才依次用 0.7× / 0.6× 补读；候选**并集**（同号取高分）返回——
 *    按置信挑单一尺度会把对的丢掉（remote-image2 的真值 51/61/81：1.0× 读得对但
 *    置信不足、0.7× 会读成 41 且更自信）。
 * 模型包缺失/加载/推理失败 → 返回 null，识别器静默跳过补位。
 */
export const createBoardScanner = async (options: { modelUrl: string; digitModelUrl?: string; wasmPaths?: string; threads?: number; digitBatchSize?: number }): Promise<BoardScanner | null> => {
  // 模型不可用就整个不接（调用方据此完全跳过补位，回到旧行为）。
  const modelOptions: ModelScanOptions = { wasmPaths: options.wasmPaths, threads: options.threads, cellModelUrl: options.modelUrl, digitModelUrl: options.digitModelUrl };
  const sessions = await ensureModelSessions(modelOptions);
  if (!sessions) return null;
  /**
   * 格级证据缓存：**按格增量**记录（2026-10-09）。
   *
   * 为什么要「增量」：导入路径多了 `scanTargets`（只扫补位门控可能采用的那些格），
   * 而复原路径要全盘。若缓存只记「扫过 / 没扫过」，导入那次的部分结果会把复原路径
   * 骗成「已经有了」——未扫的格占位是 pEmpty=1（空），真子会被当成空格漏掉。
   * 所以这里同时记 `scanned`：未扫的格在后续全盘请求里会被补齐，两条路径合起来
   * 仍是全盘覆盖，且**任何一格都只扫一次**。
   */
  interface ScanCacheEntry {
    /** 长度恒为 boardSize²；未扫的格以「空」占位（pEmpty=1，语义见下）。 */
    cells: BoardCellEvidence[];
    /** 1 = 该格真的跑过模型（与 cells 一一对应）。 */
    scanned: Uint8Array;
  }
  const scanCache = new Map<string, ScanCacheEntry>();

  const scanner: BoardScanner = async ({ image, grid, boardSize, needDigits = true, digitCenters, digitSkip, digitSpacing, digitMaxNumber, digitDeep, accelerator, scanTargets }) => {
    const key = scanCacheKey(image, grid, boardSize);
    let entry = scanCache.get(key);
    const debug = Boolean((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__);
    const tScan = performance.now();
    const total = boardSize * boardSize;
    if (!entry) {
      entry = {
        // 逐格 null（模型缺失/该格失败）按「空格」记：调用方的补位只认 pEmpty<0.05，
        // 记成空格就等于这一格没有补充，不会误补。
        cells: Array.from({ length: total }, (_, index) => ({
          row: Math.floor(index / boardSize), col: index % boardSize,
          pEmpty: 1, pBlack: 0, pWhite: 0, digit: 0, digitProb: 0,
        })),
        scanned: new Uint8Array(total),
      };
      scanCache.set(key, entry);
      if (scanCache.size > SCAN_CACHE_LIMIT) scanCache.delete(scanCache.keys().next().value as string);
    }
    // 待扫下标 = 「这次要的格」∩「还没扫过的格」。scanTargets 缺省 = 全盘（复原路径）。
    //
    // ⚠ 安全边界（2026-10-09）：`scanTargets` 是**给不读号的静态导入用的省算力剪枝**，
    // 它可能漏掉很多格。而下面的读号逻辑会把读数写回 `cells[index].digitTop`——若某格
    // 没扫过、又被点名读号，读数就挂在一个「空占位」格上（pEmpty=1），调用方读到
    // 「有号但算空格」这种自相矛盾的证据。所以一旦这轮要读号（needDigits 且模型在），
    // **一律退回全盘**，不接受 scanTargets。剪枝的收益（省 N² 次 cell-cls）本来就只
    // 对导入路径有意义，复原路径从来都是全盘。
    const wantsDigits = needDigits && Boolean(sessions.digit);
    const scanWanted = scanTargets && !wantsDigits
      ? new Set(scanTargets.map((target) => target.row * boardSize + target.col).filter((index) => index >= 0 && index < total))
      : null;
    const todo: number[] = [];
    for (let index = 0; index < total; index += 1) {
      if (entry.scanned[index]) continue;
      if (scanWanted && !scanWanted.has(index)) continue;
      todo.push(index);
    }
    let scannedNow = 0;
    if (todo.length) {
      const half = Math.max(6, Math.round((grid.spacingX + grid.spacingY) / 2));
      const queries: CellScanQuery[] = todo.map((index) => ({
        x: grid.originX + (index % boardSize) * grid.spacingX,
        y: grid.originY + Math.floor(index / boardSize) * grid.spacingY,
        row: Math.floor(index / boardSize),
        col: index % boardSize,
      }));
      const classes = accelerator
        ? await accelerator.scanCells(queries, half, modelOptions)
        : await localScan(image, queries, half, modelOptions);
      // 整批失败就整批返回 null（与拆分前一致：调用方据此完全跳过补位，不写缓存）。
      if (!classes || classes.length !== queries.length) return null;
      queries.forEach((query, slot) => {
        const index = todo[slot];
        const value = classes[slot];
        entry!.cells[index] = value
          ? { row: query.row ?? 0, col: query.col ?? 0, pEmpty: value.pEmpty, pBlack: value.pBlack, pWhite: value.pWhite, digit: 0, digitProb: 0 }
          : { row: query.row ?? 0, col: query.col ?? 0, pEmpty: 1, pBlack: 0, pWhite: 0, digit: 0, digitProb: 0 };
        entry!.scanned[index] = 1;
      });
      scannedNow = todo.length;
    }
    const cells = entry.cells;
    // 浅拷贝：缓存的对象不能被调用方改到（调用方会往证据上挂读数）。
    const out = cells.map((cell) => ({ ...cell }));
    if (debug) {
      console.info("[banbu-cell-scan]", JSON.stringify({
        cached: scannedNow === 0,
        cells: scannedNow,
        ms: Math.round(performance.now() - tScan),
        via: accelerator ? "加速器" : "主线程",
        partial: scanWanted !== null,
        lowEmpty: out.filter((cell) => cell.pEmpty < 0.05).length,
      }));
    }
    if (!needDigits || !sessions.digit) return out;

    // 读号目标 = 调用方点名的格 ∪ pEmpty 低于补位门槛的格（补位子要有号才能落地）。
    const spacingBase = Math.max(6, Math.round(digitSpacing ?? Math.min(grid.spacingX, grid.spacingY)));
    const wanted = new Set<number>();
    const targets: Array<{ index: number; x: number; y: number }> = [];
    const pushTarget = (row: number, col: number) => {
      const index = row * boardSize + col;
      if (index < 0 || index >= out.length || wanted.has(index)) return;
      wanted.add(index);
      targets.push({ index, x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY });
    };
    if (digitCenters) for (const center of digitCenters) pushTarget(center.row, center.col);
    // 「这轮不需要号」的格（导入路径把已识别子列进来，见 BoardScanner.digitSkip 注释）：
    // 它们不进读号目标，但**不是**「已读过」——不写 digitTop，缓存里保持待读状态，
    // 复原那一路再读时照常补上（代价只是挪到那一步，总数不变）。
    const digitSkipKeys = digitSkip ? new Set(digitSkip.map((center) => center.row * boardSize + center.col)) : null;
    for (let index = 0; index < out.length; index += 1) {
      if (out[index].digitTop) continue;
      if (digitSkipKeys?.has(index)) continue;
      if (out[index].pEmpty < 0.05) pushTarget(out[index].row, out[index].col);
    }
    if (!targets.length) return out;
    // 主裁剪尺度（2026-10-12 修回训练口径）：半窗 = 格距，即窗口 = 2×格距。
    // 依据：训练侧三套数据生成器**全部**是这个口径——build-real-digit-dataset.py
    // `half = max(6, round(P))`、build-digit-dataset.py / build-self-digit-data.py
    // `half = round(CTX/2 * cell)` 且 CTX=2.0（「2×2 格上下文」）。模型对格距绝对值
    // 是尺度不变的（窗口同样缩到 64×64），唯一敏感的是**窗口/格距 = 2** 这个比例。
    //
    // 旧写法 `min(spacingBase, DIGIT_CROP_HALF_CAP=34)` 是 2026-10-08 在**旧数字头**
    // 上按网页棋盘域调出来的：高分辨率图上半窗被砍到 34 → 窗口 68px、比例 2→1，字面
    // 细节翻倍、密盘邻子干扰减半。对那个「没见过自家高分辨率渲染」的旧模型是净收益，
    // 但 combo46 起真实域已覆盖 1200/820/600 三档宽度，这条上限就变成**系统性的域差**：
    // 同一批 188–204 手 1200px 自家渲染棋谱，用真值坐标直接裁，half=round(格距)=67
    // 读出 588/588（100%，含 171+ 手档），half=34 只有 316/588（53%）——低手数档的
    // 命中率也被腰斩，正是「复原手序还不行、补全也补不上」的读数来源。
    //
    // 网页棋盘这种「字体占格距的比例与自家渲染不同」的域，旧紧窗口径仍可能更优，
    // 所以它没有消失，而是降级成**阶梯末档**（tightHalf）：两种比例同时在池子里，
    // 由跨尺度的概率质量合并去挑，而不是在代码里二选一。主尺度一旦读准，
    // uncertain() 会让这一档直接跳过，等于零成本。
    const halfBase = Math.max(6, spacingBase);
    /** 主尺度之上不设上限、之下保留旧紧窗口径（见上）。仅当它与主尺度不同才加档。 */
    const tightHalf = halfBase > DIGIT_CROP_HALF_CAP ? DIGIT_CROP_HALF_CAP : null;
    /** 补读阶梯：**相对主尺度**的旧口径（0.8/0.7/0.6）。2026-10-08 试过改成「按格距取
     *  绝对尺度、按距离排序」，理由是密盘上 0.45× 比 1.0× 明显更好；但逐条 A/B 证明那条
     *  改动会让用户那张 15 手图从「读出 15、完整复原 1..15」退化到「读出 12、拒绝复原」
     *  （另外两条改动——裁到上限、概率质量合并——单独留着都仍然 15/15）。所以阶梯保持
     *  旧口径；高分辨率图上它现在是 53/46/40，与主尺度一起覆盖「标准 2× 上下文 →
     *  收窄到 1.2× 上下文」这一段。 */
    const ladder = [0.8, 0.7, 0.6]
      .map((scale) => Math.max(6, Math.round(halfBase * scale)))
      .filter((half) => half !== halfBase && half !== tightHalf);
    /**
     * 加深档（digitDeep，2026-10-09「补全识别」用）：在标准阶梯之外，再补一批**更细密**
     * 的裁剪尺度。动机是用户实测「点了几次补全还是没读出」——标准阶梯对某一格往往只
     * 问 2–3 档就停了（一旦某档读数够确定就不再追问），而那几颗读不出来的子恰恰是
     * 「每一档都读错/读弱」的硬骨头，尺度不够密就永远碰不到那一档。
     *
     * 尺度取「主尺度 1.0 到 0.45 之间的等分」，与阶梯同源（都相对 halfBase），所以
     * 同一批读数仍是「同一套裁格几何 + 同一份模型」，并行/串行逐位相同的纪律不变。
     * 谁在用它：用户点「补全识别」（`knownNumbers`），以及**复原手序那一趟没成时的二轮
     * 补读**（2026-10-12，见 image-recognition.ts 的二轮补读注释）——失败的那一趟因此
     * 自带一次补全。静止局面导入与首次复原（成功的那条路）都不走这里。
     */
    const deepLadder = digitDeep
      ? [0.9, 0.75, 0.65, 0.55, 0.5, 0.45, 0.4]
        .map((scale) => Math.max(6, Math.round(halfBase * scale)))
        .filter((half, index, list) => half !== halfBase && half !== tightHalf && !ladder.includes(half) && list.indexOf(half) === index)
      : [];

    // 一次读号分片：对给定的格集合跑一个裁剪尺度，把结果并进 merged。
    // merged 同时记两份证据（2026-10-08）：
    //  - mass：每个号码在所有尺度上的**概率质量之和**（合并时按它排序）；
    //  - best：每个号码在单个尺度上的最高概率（对外输出的 digitProb 仍用它，
    //    保持「置信度」的原语义，装配器的 minScore 门控量级不变）；
    //  - votes 不另存：票数用 mass 的排序近似即可，实测两者在真值上同分。
    // 为什么改：原来只存 best、按最高分取胜，密盘上「1.0× 自信误读」会压过
    // 「0.45×/0.65× 都读对但分低」的正确读数（实测真值 33 读成 31(0.90) 而两个
    // 小尺度都读 33）。按质量求和，一致的正确读数就能翻上来。
    // 走哪条路看批量大小（2026-10-07）：
    //  - 小批（< DIGIT_POOL_MIN_CELLS，典型是十几格）走主线程直算——池子每次识别
    //    新建，为这点活付「起池 + 上传图像 + 装模型」的固定成本不划算，多尺度升级
    //    也不用每档来回一次消息；
    //  - 大批（实测 remote-image2 的补位要读 74–118 格 × 1–3 个尺度）丢进 worker 池，
    //    单线程 2–4 秒的那段降到半秒级。
    const merged = new Map<number, Map<number, { mass: number; best: number }>>(); // targetIndex → (value → 证据)，-1 = 无号类
    const readBatch = async (batchTargets: Array<{ index: number; x: number; y: number }>, half: number) => {
      const queries = batchTargets.map((target) => ({ x: target.x, y: target.y }));
      const reads = accelerator && queries.length >= DIGIT_POOL_MIN_CELLS
        ? await accelerator.readDigits(queries, half, modelOptions)
        : await localReadDigits(image, queries, half, modelOptions);
      if (!reads || reads.length !== queries.length) return;
      batchTargets.forEach((target, index) => {
        const read = reads[index];
        if (!read) return;
        const slot = merged.get(target.index) ?? new Map<number, { mass: number; best: number }>();
        const add = (value: number, score: number) => {
          const entry = slot.get(value) ?? { mass: 0, best: 0 };
          // 无号类没有候选列表，只有一个概率；给个地板值避免它把正号的质量压死。
          slot.set(value, { mass: entry.mass + Math.max(score, 0.05), best: Math.max(entry.best, score) });
        };
        if (read.digit === 0 || read.digitTop.length === 0) add(-1, read.digitProb);
        for (const candidate of read.digitTop) add(candidate.value, candidate.score);
        merged.set(target.index, slot);
      });
    };
    /** 该格当前的最好读数是否够确定（不够就换尺度再问一次）。 */
    const uncertain = (index: number): boolean => {
      const slot = merged.get(index);
      if (!slot) return true;
      const noDigit = slot.get(-1)?.best ?? 0;
      let best = 0, bestValue = 0, second = 0;
      for (const [value, entry] of slot) {
        if (value <= 0) continue;
        if (entry.best > best) { second = best; best = entry.best; bestValue = value; }
        else if (entry.best > second) second = entry.best;
      }
      if (bestValue === 0 || noDigit >= 0.9) return false; // 明确判为无号：不再追问
      if (best < DIGIT_RESCUE_BELOW) return true;
      // 「自信但读错」那一类：首选与次选贴得近时也换尺度问一次（仅新口径）。
      if (best - second < DIGIT_RESCUE_MARGIN) return true;
      return digitMaxNumber !== undefined && bestValue > digitMaxNumber;
    };
    await readBatch(targets, halfBase);
    for (const half of ladder) {
      const pending = targets.filter((target) => uncertain(target.index));
      if (!pending.length) break;
      await readBatch(pending, half);
    }
    // 紧窗兜底档（2026-10-12）：主尺度回到训练口径（窗口 2×格距）后，把 10-08 调出的
    // 旧紧窗口径（窗口 = 2×34px）作为独立一档留在池子里。它服务的是「字体占格距的比例
    // 与自家渲染不同」的域（网页棋盘/大幅标注图）——那种图上主尺度的比例可能偏大。
    // 放在相对阶梯之后：主尺度与相对阶梯都没让某格读准时才轮到它，读准了的格
    // uncertain() 已返回 false，这一档自然不付成本。
    if (tightHalf !== null) {
      const pending = targets.filter((target) => uncertain(target.index));
      if (pending.length) await readBatch(pending, tightHalf);
    }
    // 加深档（补全识别专用）：标准阶梯跑完后，对**仍然没读出有信号**的格继续用更细密的
    // 尺度追问。判定比标准档更宽——标准档认为「已够确定」而提前收手的格，这里也再问一遍
    // （补全的意义就是「上次没读出来，这次多花点力气」，而不是把同一套再跑一次）。
    if (deepLadder.length) {
      for (const half of deepLadder) {
        const pending = targets.filter((target) => {
          const slot = merged.get(target.index);
          if (!slot) return true;
          // 已经有足够强的正号读数（≥0.85）就不再追问：那种格再问也只会拿到同样的答案，
          // 却要付一整轮推理，而补全的预算该留给真正读不出来的格子。
          let best = 0;
          for (const [value, entry] of slot) if (value > 0 && entry.best > best) best = entry.best;
          return best < 0.85;
        });
        if (!pending.length) break;
        await readBatch(pending, half);
      }
    }
    for (const target of targets) {
      const slot = merged.get(target.index);
      if (!slot) continue;
      const ranked = [...slot.entries()]
        .filter(([value]) => value > 0)
        .map(([value, entry]) => ({ value, score: entry.best, mass: entry.mass }))
        .sort((left, right) => right.mass - left.mass || right.score - left.score || left.value - right.value);
      const cell = out[target.index];
      const noDigit = slot.get(-1)?.mass ?? 0;
      const top = ranked[0];
      // digit/digitProb 沿用「argmax（含无号类）」的语义：把无号类的概率也参与比较
      // （无号类这里用质量而不是单次概率，因为多尺度都把某格判成无号时它确实更可信）。
      if (top && top.mass >= noDigit) { cell.digit = top.value; cell.digitProb = top.score; }
      else { cell.digit = 0; cell.digitProb = slot.get(-1)?.best ?? 0; }
      cell.digitTop = ranked.slice(0, DIGIT_TOP_K).map(({ value, score }) => ({ value, score }));
      // 写回缓存条目：同一张图的第二次调用（复原的二轮补读、再次点复原）直接复用，
      // 不重复付推理钱。
      const cached = cells[target.index];
      cached.digit = cell.digit;
      cached.digitProb = cell.digitProb;
      cached.digitTop = cell.digitTop;
    }
    return out;
  };
  return scanner;
};

/** 主线程直算的格级扫描（无 accelerator 时的回落）。 */
const localScan = async (
  image: { data: Uint8ClampedArray; width: number; height: number },
  queries: readonly CellScanQuery[],
  half: number,
  options: ModelScanOptions,
): Promise<Array<{ pEmpty: number; pBlack: number; pWhite: number } | null> | null> => {
  const { classifyCells } = await import("./model-inference");
  const values = await classifyCells(image, queries, half, options);
  if (!values) return null;
  return values;
};

/** 主线程直算的读号（无 accelerator 时的回落）。 */
const localReadDigits = async (
  image: { data: Uint8ClampedArray; width: number; height: number },
  queries: readonly CellScanQuery[],
  half: number,
  options: ModelScanOptions,
): Promise<Array<{ digit: number; digitProb: number; digitTop: MoveNumberCandidate[] } | null> | null> => {
  const values = await readDigitCandidates(image, queries, half, options);
  if (!values) return null;
  return values;
};
