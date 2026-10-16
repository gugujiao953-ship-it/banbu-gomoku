/**
 * 模型推理的共享实现（2026-10-07）：识谱增强两件套（cell-cls 逐格占用/颜色 +
 * digit-head 读号）的裁格与推理**只有这一份数学**。三个调用方共用它：
 *  ① 主线程回落路径（`digit-head.ts` 的扫描器/读号器，多核开关关掉或池子起不来时）；
 *  ② 识谱 worker 池里的分片任务（多核开关打开时，225 格切成 4×线程数 片并行）；
 *  ③ QA 脚本的直算路径。
 * 同一份代码 ⇒ 并行与串行的结果逐位相同（与「多核加速」同一条纪律）。
 *
 * 裁格几何与 Python 侧 `evaluate-lite-hybrid.py` 逐条对齐：灰 235 补方、双线性缩到
 * 64×64、归一化 x/127.5−1、RGB→CHW。裁格面在窗口上建（主线程用 canvas、worker 用
 * OffscreenCanvas），两条路径共用同一个 `CropSurface` 接口。
 *
 * onnxruntime 运行时从应用内 `public/ort/` 动态 import（@vite-ignore，不走打包器：
 * 打包器此前只 emit `.wasm`、丢了线程 worker 的加载器 `.mjs`），模型从
 * `public/models/` 读——路径都走 `import.meta.env.BASE_URL`，子路径部署也正确。
 */
import type { MoveNumberCandidate } from "../../image-recognition";

/**
 * 资源基准 URL（2026-10-07 修生产路径）：`import.meta.env.BASE_URL` 在生产构建里是
 * **相对**的（`./`），而 worker 里 `location.href` 是 worker 脚本自己的 URL
 * （`/assets/recognition-worker-xxx.js`）——相对基准在 worker 里会解析成
 * `/assets/ort/`、`/assets/models/`，模型与 wasm 全部 404，静默退化成「没有补位」。
 * 所以基准由主线程算好（那是页面 URL），随图像装载一起传给 worker（setInferencePageBase）。
 */
let pageBaseUrl: string | null = null;
export const setInferencePageBase = (url: string | null): void => { pageBaseUrl = url; };
// 兜底 `location?.`：单元测试（Node 环境）没有 location，而两个模型地址常量是模块级
// 求值的——在那里只需「不炸」，真地址只在浏览器里用到。
const pageBase = (): string => pageBaseUrl ?? new URL(import.meta.env.BASE_URL, globalThis.location?.href ?? "http://localhost/").href;
const modelUrl = (name: string): string => new URL(`models/${name}`, pageBase()).href;
const wasmBaseUrl = (): string => new URL("ort/", pageBase()).href;

/** 两个内置模型的地址（主线程用；worker 内部不读这两个常量，改用 pageBase 现算）。
 *
 *  ⚠ cell-cls 的速度账（2026-10-08 全部实测，别再重复走这四条路）：
 *    · 逐格 13–16ms（ORT-Web wasm，225 格 = 2.9s，导入路径里模型扫描的全部）；
 *      同一份模型在 Python 原生 ORT 只要 1.1ms/格（225 格 = 246ms）——差 12 倍。
 *    ① 「裁剪/张量构造贵」→ 否：实测裁剪在噪声内（±0.09ms/格）。
 *    ② 「批量能摊薄每次调用开销」→ 否：把输入/输出批维改成符号维（同一份权重、argmax
 *       100% 一致）后在浏览器批量跑是 1.0×（12.96→12.43ms/格）。
 *    ③ 「fp16 在 wasm 上被软件模拟」→ 否：把整图改成 fp32（权重数值不变、argmax 100%
 *       一致）后**反而略慢**（15.94→17.52ms/格）。
 *    ④ 「候选去重/网格预筛省时间」→ 否（那是网格检测那边的事，见 image-recognition）。
 *    结论：这 13–16ms 就是 **ORT-Web 单线程 wasm 跑这个 6 层卷积的固有成本**（dev server
 *    没有跨源隔离 → numThreads=1）。应用现有的应对是**多核分片**：225 格切给 worker 池
 *    （每 worker 一份会话），实测导入侧模型扫描 5179ms → 1292ms。再往下就只剩「换更小的
 *    模型」或「少判一些格」两条路，且都要动识别逻辑与门禁，不是免费的。
 */
export const CELL_CLS_MODEL_URL = modelUrl("cell-cls-real-mix.onnx");

/** 数字头模型**文件名**（唯一来源，2026-10-12 起）。
 *
 * 现役：**combo46**（2026-10-12）。226 类（0=无号 + 1..225），真实域 = `big`
 * （self-big 468 盘 × 3 宽度 161,427 条）+ 合成 527,840 条；fp16 与 fp32 argmax 100% 一致。
 * 为什么**换文件名**而不是覆盖旧名：① 回滚只需改这一行；② URL 变了就不会命中
 * service worker 里按 URL 缓存的旧模型。旧模型文件一律留在 `qa/fixtures/models/`。
 *
 * ⚠ **第 48/49 两轮都没采纳**（2026-10-14，超算作业 124385720 / 124392083）——
 * 两轮都因**门禁 `order-hi-ply-restore`** 红而回退，但**红法不同、且互为镜像**：
 *
 *   轮次 | 真实域组成 | 智子域 6 盘 | 自家渲染 self-hi-ply2a | self-010(215手) × 三档宽度
 *   46  | big            | 0/6  | 5/6 | 3/3 ✓（现役，门禁全绿）
 *   48  | big+zhizi      | **3/6** | 5/6 | 1/3 ✗（@1200 @600 挂）
 *   49  | big+zhizi+hiply2 | 1/6  | 5/6 | 1/3 ✗（@1200 过、@820 @600 挂）
 *
 * 两条教训（写给下一轮）：
 *  ① **真实域只有一个前缀 + 一个权重**（`DIGIT_REAL_PREFIX` / `DIGIT_REAL_WEIGHT`），
 *     所以混入更多自家渲染语料 = **直接稀释智子那份占比**（48 的智子占真实域 38%、
 *     49 降到 27%，智子域随即 3/6 → 1/6）。要两边都保，得**在采样上配比**（比如
 *     hiply2 只取一部分盘），而不是无脑都加。
 *  ② **215 手那张（self-010）就在模型的临界线上**——三轮里三个不同的三档组合，
 *     说明它不是稳定失败，而是每一版都在边界上摇摆。加大 185–225 手样本量或
 *     延长 epoch 才能把这条边界推稳；调门禁不是办法（那是红线）。
 *
 * 模型文件：`digit-head-combo48-fp16.onnx`（智子域最好 3/6）与 `digit-head-combo49-fp16.onnx`
 * 都在 `qa/fixtures/models/`（combo49 的 fp16 与 fp32 argmax 97.9%，见下），
 * 随时可换；`prepare-ai-assets.mjs` 里 combo48/combo49 在 stale 清单、combo46 在拷贝清单。
 * 另：combo49 的 fp16/argmax 一致率只有 **97.9%**（46/48 是 100%），换它之前要额外在
 * 真实裁剪上验 fp16 是否掉读数。
 */
const DIGIT_HEAD_MODEL_FILE = "digit-head-combo46-fp16.onnx";
export const DIGIT_HEAD_MODEL_URL = modelUrl(DIGIT_HEAD_MODEL_FILE);

/** 裁格面的最小接口：主线程 canvas 与 worker 的 OffscreenCanvas 都满足。
 *  注意 **resize 必须走底层画布**——外面套一层 {width,height} 再赋值只改包装对象、
 *  不动真画布（踩过：裁格面停在 1×1，整批输入退化成一块灰，模型对每格给出同一个概率）。 */
interface CropSurface {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  resize(width: number, height: number): void;
}

const createCropSurface = (width = 1, height = 1): CropSurface | null => {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) return { canvas, ctx: ctx as OffscreenCanvasRenderingContext2D, resize: (w, h) => { canvas.width = w; canvas.height = h; } };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) return { canvas, ctx, resize: (w, h) => { canvas.width = w; canvas.height = h; } };
  }
  return null;
};

export interface ModelInferenceOptions {
  /** wasm 运行时目录（仅 QA/dev 显式指定；生产留空 = 页面基准 + ort/）。 */
  wasmPaths?: string;
  /** wasm 线程数。主线程默认 min(4, 硬件并发)（有跨源隔离才真多线程）；
   *  worker 里每个 worker 就是一条线程，固定 1，避免超订。 */
  threads?: number;
  /** 模型地址覆盖（QA 对比用）。缺省 = 页面基准 + models/ 的内置模型。
   *  同一线程只装载一次，第一个非空覆盖生效（会话缓存按线程共享）。 */
  cellModelUrl?: string;
  digitModelUrl?: string;
}

interface ModelSessions {
  ort: typeof import("onnxruntime-web");
  cell: import("onnxruntime-web").InferenceSession;
  digit: import("onnxruntime-web").InferenceSession | null;
}

/**
 * 会话缓存：**按 URL 分量各自缓存，而不是按「调用方给的组合」缓存**（2026-10-08 两次修）。
 *
 * 第一版是全局单例：第一个调用方传的模型地址决定一切，之后再传别的地址也复用旧会话——
 * QA 里表现为「换候选 digit-head 对比」量到同一个模型三遍（三份不同权重的读数**逐位相同**，
 * 差点据此误判「三轮训练都退步」）。
 *
 * 第二版（本版）改成「按 cell/digit 两个 URL 分别缓存会话」而不是「按选项组合缓存」：
 * 识别器里两个调用方传的选项**本来就不同**——scanner 传 `{cellModelUrl, digitModelUrl}`、
 * reader 只传 `{digitModelUrl}`；按组合做键会让它们各建一套完整会话（2× cell + 2× digit），
 * 内存翻倍、wasm 堆抖动，实测导入侧模型扫描从 1.3s 涨到 **9.2s**。
 * 按分量缓存后，两边共享同一份 digit 会话，行为与「单例时代」一致而不再串模型。
 */
interface SessionCache {
  /** ORT 运行时（含 wasm 配置）按 wasm 目录 + 线程数缓存。 */
  runtimes: Map<string, Promise<typeof import("onnxruntime-web") | null>>;
  /** 模型会话按模型文件 URL 缓存。 */
  models: Map<string, Promise<import("onnxruntime-web").InferenceSession | null>>;
}
const cache: SessionCache = { runtimes: new Map(), models: new Map() };

const runtimeKey = (options: ModelInferenceOptions): string =>
  `${options.wasmPaths ?? ""}|${options.threads ?? ""}`;

const loadRuntime = async (options: ModelInferenceOptions): Promise<typeof import("onnxruntime-web") | null> => {
  try {
    // 必须给**绝对 URL**：wasmPaths 是纯前缀拼接，若传相对路径 ORT 会以 bundle
    // 自身位置为基准再拼一次 → /ort/ort/…（实测踩过）。
    const base = options.wasmPaths ?? wasmBaseUrl();
    const loaded = (await import(/* @vite-ignore */ `${base}ort.wasm.bundle.min.mjs`)) as { default?: typeof import("onnxruntime-web") };
    const ort = (loaded.default ?? loaded) as typeof import("onnxruntime-web");
    ort.env.wasm.wasmPaths = base;
    /**
     * 只留 error（2026-10-15）：ORT 的原生 cpuid 探测在某些 CPU 上会在初始化时打一条
     * `[W:onnxruntime:Default, cpuid_info.cc:95 LogEarlyWarning] Unknown CPU vendor.
     * cpuinfo_vendor value: 0` —— 它是**警告**、不影响推理（本机识谱用例与 225 手耗时都正常），
     * 但 wasm 的 stderr 会以 **console error** 的通道冒出来。识谱空闲预热（2026-10-07）开着时
     * 每次开页都会加载 ORT，于是 7 条在册浏览器门禁的「无 console 错误」断言全部误红
     * （opening-reveal / opening-undo / opening-name-toggle / ai-opacity-rules-cancel /
     * mobile-visual / mobile-core-workspace / puzzle-selector-layout），用户控制台也被刷屏。
     * ⚠ 只压 warn 一级：真 error 照样冒出来，不许用它盖掉别的问题。
     */
    ort.env.logLevel = "error";
    const inWorker = typeof document === "undefined";
    const desired = options.threads ?? Math.min(4, navigator.hardwareConcurrency || 1);
    /**
     * 线程数只在**跨源隔离**下有意义（2026-10-09 实测钉死）：
     * 非隔离环境里 `SharedArrayBuffer` 不存在，ORT 起不了真线程池——把 numThreads
     * 从 1 调到 8，同一批 225 格耗时纹丝不动（4275 / 4276 / 4481 / 4306ms，噪声级）。
     * 所以「手机上识谱慢十几倍」不能靠调这个参数解决，**必须先拿到隔离**
     * （安卓侧由 IsolatedWebViewClient + sw.js 两条路注入 COOP/COEP，见各自的注释）。
     */
    ort.env.wasm.numThreads = inWorker ? 1 : (globalThis.crossOriginIsolated === true ? Math.max(1, Math.min(desired, 8)) : 1);
    return ort;
  } catch {
    return null;
  }
};

const loadModel = async (ort: typeof import("onnxruntime-web"), url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await ort.InferenceSession.create(await response.arrayBuffer(), { executionProviders: ["wasm"] });
  } catch {
    return null;
  }
};

/** 懒加载 ORT 与两个模型（同 URL 只装一次）。任何失败返回 null，
 *  调用方静默回落——增强不能变成识别失败的原因。 */
export const ensureModelSessions = async (options: ModelInferenceOptions = {}): Promise<ModelSessions | null> => {
  const rKey = runtimeKey(options);
  let runtime = cache.runtimes.get(rKey);
  if (!runtime) {
    runtime = loadRuntime(options);
    cache.runtimes.set(rKey, runtime);
  }
  const ort = await runtime;
  if (!ort) return null;
  const cellUrl = options.cellModelUrl ?? modelUrl("cell-cls-real-mix.onnx");
  const digitUrl = options.digitModelUrl ?? modelUrl(DIGIT_HEAD_MODEL_FILE);
  const pick = (url: string) => {
    let entry = cache.models.get(url);
    if (!entry) {
      entry = loadModel(ort, url);
      cache.models.set(url, entry);
    }
    return entry;
  };
  const cell = await pick(cellUrl);
  if (!cell) return null;
  const digit = await pick(digitUrl);
  return { ort, cell, digit };
};

/** 裁一格的输入张量（CHW、x/127.5−1），几何与 Python 侧逐条对齐。 */
const cropCell = (
  surface: CropSurface,
  image: { width: number; height: number },
  cx: number,
  cy: number,
  half: number,
  scratch: { tmp: CropSurface; dst: CropSurface },
): Float32Array => {
  const { width, height } = image;
  const x0 = Math.max(0, Math.min(width - 1, Math.round(cx) - half));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(cy) - half));
  const w = Math.min(width, x0 + 2 * half) - x0;
  const h = Math.min(height, y0 + 2 * half) - y0;
  const side = Math.max(w, h);
  const tmp = scratch.tmp;
  if (tmp.canvas.width !== side || tmp.canvas.height !== side) tmp.resize(side, side);
  tmp.ctx.fillStyle = "rgb(235,235,235)"; // 边缘补灰，与 Python 侧 pad=235 一致
  tmp.ctx.fillRect(0, 0, side, side);
  tmp.ctx.drawImage(surface.canvas, x0, y0, w, h, 0, 0, w, h);
  const dst = scratch.dst;
  dst.ctx.drawImage(tmp.canvas, 0, 0, side, side, 0, 0, 64, 64);
  const rgba = dst.ctx.getImageData(0, 0, 64, 64).data;
  const chw = new Float32Array(3 * 64 * 64);
  for (let pixel = 0; pixel < 64 * 64; pixel += 1) {
    chw[pixel] = rgba[pixel * 4] / 127.5 - 1;
    chw[64 * 64 + pixel] = rgba[pixel * 4 + 1] / 127.5 - 1;
    chw[2 * 64 * 64 + pixel] = rgba[pixel * 4 + 2] / 127.5 - 1;
  }
  return chw;
};

/** 图像 → 裁格面（RGBA 原样）。调用方每张图建一次。 */
export const createImageSurface = (image: { data: Uint8ClampedArray; width: number; height: number }): CropSurface | null => {
  const surface = createCropSurface(image.width, image.height);
  if (!surface) return null;
  surface.ctx.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  return surface;
};

export interface CellClass {
  pEmpty: number;
  pBlack: number;
  pWhite: number;
}

export interface DigitRead {
  digit: number;
  digitProb: number;
  digitTop: MoveNumberCandidate[];
}

/** 「紧窗兜底档」的半窗（像素）。**不再是主裁剪尺度**——2026-10-12 起主尺度回到训练
 *  口径（半窗 = 格距，窗口 = 2×格距；训练侧三套生成器全是 CTX=2.0 的「2×2 格上下文」，
 *  见 digit-head.ts 里 halfBase 的注释与 qa/tmp-order-crophalf-probe.mjs 的实测）。
 *
 *  这个值保留为**阶梯末档**，服务「字体占格距的比例与自家渲染不同」的域。
 *  2026-10-08 在旧数字头 + renjuportal 网页棋盘域上实测：半窗 = 格距（70px 盘面 →
 *  140px 窗口）单尺度只读对 41/76，收到 34（68px 窗口）后 64/76。那条结论对**当时的
 *  模型**成立；但把主尺度一刀切到 34 会让自家渲染的高分辨率图（格距 66）比例从 2 掉到 1，
 *  实测读数腰斩（588/588 → 316/588）。所以现在两种比例都进池，由跨尺度概率质量合并裁决。 */
export const DIGIT_CROP_HALF_CAP = 34;

const softmaxInto = (logits: Float32Array, out: Float32Array): void => {
  let max = -Infinity;
  for (let index = 0; index < logits.length; index += 1) if (logits[index] > max) max = logits[index];
  let sum = 0;
  for (let index = 0; index < logits.length; index += 1) { const value = Math.exp(logits[index] - max); out[index] = value; sum += value; }
  for (let index = 0; index < out.length; index += 1) out[index] /= sum;
};

/**
 * cell-cls 逐格占用/颜色。批大小按模型能力来：cell-cls 的输入轴是固定的
 * [1,3,64,64]（batch=1），digit-head 是动态 N——所以这里逐格跑会更慢，
 * 用「一格一批」也得逐次 await；实测批推理对 cell-cls 无收益（见研究文档 §22），
 * 真正的并行靠多核分片（调用方把 queries 切给线程池），所以这里就老实逐格。
 */
export const classifyCells = async (
  image: { data: Uint8ClampedArray; width: number; height: number },
  queries: ReadonlyArray<{ x: number; y: number }>,
  half: number,
  options: ModelInferenceOptions = {},
): Promise<CellClass[] | null> => {
  const sessions = await ensureModelSessions(options);
  if (!sessions) return null;
  const surface = createImageSurface(image);
  if (!surface) return null;
  const scratch = { tmp: createCropSurface(1, 1), dst: createCropSurface(64, 64) };
  if (!scratch.tmp || !scratch.dst) return null;
  const inputName = sessions.cell.inputNames[0];
  const outputName = sessions.cell.outputNames[0];
  const probs = new Float32Array(3);
  const out: CellClass[] = [];
  for (const query of queries) {
    const chw = cropCell(surface, image, query.x, query.y, half, scratch as { tmp: CropSurface; dst: CropSurface });
    const output = await sessions.cell.run({ [inputName]: new sessions.ort.Tensor("float32", chw, [1, 3, 64, 64]) });
    const logits = output[outputName].data as Float32Array;
    softmaxInto(logits.subarray(0, 3), probs);
    out.push({ pEmpty: probs[0], pBlack: probs[1], pWhite: probs[2] });
  }
  return out;
};

/**
 * digit-head 读号：逐格返回 argmax（含「无号」类 0）与 top-3 候选。
 * 一次调用只跑**一个裁剪尺度**——多尺度升级（1.0× → 0.7× → 0.6×）由调用方
 * （digit-head.ts 的扫描器）按「不够确定才换尺度」决定，它据此再发一批更小的
 * queries 过来；这样多核分片与尺度选择互不纠缠，两边都简单。
 */
export const readDigitCandidates = async (
  image: { data: Uint8ClampedArray; width: number; height: number },
  queries: ReadonlyArray<{ x: number; y: number }>,
  half: number,
  options: ModelInferenceOptions = {},
): Promise<DigitRead[] | null> => {
  const sessions = await ensureModelSessions(options);
  if (!sessions?.digit) return null;
  const surface = createImageSurface(image);
  if (!surface) return null;
  const scratch = { tmp: createCropSurface(1, 1), dst: createCropSurface(64, 64) };
  if (!scratch.tmp || !scratch.dst) return null;
  const digitInput = sessions.digit.inputNames[0];
  const digitOutput = sessions.digit.outputNames[0];
  const batchSize = 16;
  const out: DigitRead[] = [];
  for (let start = 0; start < queries.length; start += batchSize) {
    const chunk = queries.slice(start, start + batchSize);
    const input = new Float32Array(chunk.length * 3 * 64 * 64);
    for (let index = 0; index < chunk.length; index += 1) {
      const query = chunk[index];
      input.set(cropCell(surface, image, query.x, query.y, half, scratch as { tmp: CropSurface; dst: CropSurface }), index * 3 * 64 * 64);
    }
    const output = await sessions.digit.run({ [digitInput]: new sessions.ort.Tensor("float32", input, [chunk.length, 3, 64, 64]) });
    const logits = output[digitOutput].data as Float32Array;
    const classCount = logits.length / chunk.length;
    for (let index = 0; index < chunk.length; index += 1) {
      const slice = logits.subarray(index * classCount, (index + 1) * classCount);
      const probs = new Float32Array(classCount);
      softmaxInto(slice, probs);
      let best = 0;
      for (let k = 1; k < classCount; k += 1) if (probs[k] > probs[best]) best = k;
      const ranked: MoveNumberCandidate[] = [];
      for (let k = 1; k < classCount; k += 1) ranked.push({ value: k, score: probs[k] });
      ranked.sort((left, right) => right.score - left.score);
      out.push({ digit: best, digitProb: probs[best], digitTop: ranked.slice(0, 4) });
    }
  }
  return out;
};
