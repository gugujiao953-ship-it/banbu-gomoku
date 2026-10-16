import {
  createSampledImage,
  localAccelerator,
  type CellClass,
  type CellQuery,
  type CellScanQuery,
  type CombQuery,
  type DigitRead,
  type GridWindowQuery,
  type MeshQuery,
  type ModelScanOptions,
  type MoveNumberCandidate,
  type MoveNumberQuery,
  type RecognitionAccelerator,
  type SampledImage,
} from "../../image-recognition";
import RecognitionWorker from "./recognition-worker?worker";
import { runRecognitionJob } from "./recognition-jobs";
import { planRecognitionPool } from "./recognition-pool-size";
import type {
  RecognitionJob,
  RecognitionJobResult,
  RecognitionWorkerReply,
  RecognitionWorkerRequestPayload,
} from "./recognition-protocol";

/** 每个线程领的分片数：比线程数多几倍，先算完的线程接着领下一片，避免某个
 * 分片偏重时整批被它拖住。分片是连续区间，所以合并顺序天然就是原顺序。 */
const CHUNKS_PER_WORKER = 4;
/** 单条分片的超时。卡死的线程绝不能让导入一直转圈（历史教训：识别永挂），
 *  超时即降级——停池、剩下全在主线程直算。 */
const SLICE_TIMEOUT_MS = 20000;
/** 模型分片的超时。比 CV 分片宽：worker 首次跑模型任务时要先把 ORT 与两个模型
 *  装进各自的 wasm 堆（装载现在由 prewarm 单独负责，这里留的余量覆盖首个分片
 *  的惰性初始化与手机上的慢算力）。 */
const MODEL_SLICE_TIMEOUT_MS = 30000;
/**
 * 模型装载（每个 worker 各一次）的预算（2026-10-09，真机「识谱十几秒」的根因修复）。
 *
 * 现场：手机 Android WebView 不支持跨源隔离 → 每个 worker 只有单线程，装载
 * ORT（13.6MB wasm 编译）+ 两个 fp16 模型很慢；而旧实现是「发一条空任务、不等待」，
 * 于是 ①装载把后面排队的网格分片一起堵住，②模型分片的 20s 计时从**派发**就开始，
 * 预算被装载吃掉 → 超时降级 → 主线程把整批重算一遍（实测书谱 66 子：单线程 4.7s 的活
 * 变成 25.7s，日志里明确打出「识别分片超时（20000ms）」）。
 *
 * 现在：装载**按需触发、单独计时、显式等待**——只有在真的要派模型分片时才开始装，
 * 且装载与 CV 分片互不阻塞。超过这个预算就认定「这台设备上 worker 跑模型不划算」，
 * 整批模型任务回落主线程（主线程扫 225 格实测 4–9s，比「等 30s 再降级」划算得多）。
 */
const MODEL_PREWARM_TIMEOUT_MS = 20000;

interface PendingRequest {
  resolve: (reply: RecognitionWorkerReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 多核识谱执行器：把批次切成连续分片派给线程池，按原位拼回结果。
 * 返回 null 表示「这台设备/这次环境用不了多核」（老 WebView、线程构造被拒、
 * 图像上传失败），调用方回落单线程直算。运行中任何分片失败/超时都会降级：
 * 停掉线程池，未算完的分片在主线程补算，结果顺序与内容不变。
 *
 * 2026-10-09 起降级**按任务类别分开**（`cvDegraded` / `modelDegraded`）：模型分片
 * 在慢设备上很容易冲爆超时，但纯 CV 分片（网格检测/线梳/逐格特征）在同一批里
 * 可能只花几百毫秒。旧实现把两者绑在一个 `degraded` 上，模型一超时连 CV 的收益
 * 也一起丢（实测网格走池 0.96s、单线程 6.7s）。
 */
/**
 * 池**常驻复用**（2026-10-14）。为什么要做：调用方每次识别都在 finally 里 `dispose()`，
 * 于是每个 worker 都要**重编一次 13.5MB 的 ORT wasm**。同一页连跑三次导入的实测（12 核）：
 *
 *   池#1（冷）17226ms ｜ 池#2 2185ms ｜ 池#3 1926ms ｜ 单线程 1479ms
 *
 * 也就是「第一次最贵」这笔钱付得有理（后面确实快），但**热好的会话被随手扔掉了**——
 * 而应用里「导入 → 复原手序 → 补全识别」本来就是连着点好几次的，每次都重付一遍。
 *
 * 做法：按（画布尺寸 + 是否需要模型会话）缓存**一个**共享池；下一次识别只把新图重发给
 * worker（worker 侧重建 SampledImage，ORT 会话照旧热着），不再重建线程与编译 wasm。
 * 回收纪律：空闲 `POOL_IDLE_DISPOSE_MS` 后自动拆；切到后台立刻拆（与「切后台停引擎」
 * 同一条纪律，别在后台占着 6 个 worker 的内存）。
 *
 * 安全门（宁可重建也不错用）：复用前要求**池里没有在途请求**（`pending.size === 0`）——
 * 上一趟若中途抛错，可能有分片的回包还在路上，换图会让它算在错的图上。
 */
const POOL_IDLE_DISPOSE_MS = 60_000;
interface SharedPool {
  key: string;
  /** 建池时按那张图的画布算出的线程数。复用时要与新图的计划核对（见 createParallelAccelerator）。 */
  capacity: number;
  accelerator: RecognitionAccelerator;
  /** 把新图像重发给**前 activeCount 个** worker、换掉主线程回落用的本地加速器；多出来的
   *  worker 退回占位图（不白抱着上一张真图）。false = 池不可复用。 */
  rebind: (image: SampledImage, activeCount: number) => Promise<boolean>;
  /** 立刻拆池（停 worker、拒掉在途请求）。 */
  disposeNow: () => void;
}
let sharedPool: SharedPool | null = null;
let sharedPoolTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * QA 遥测（2026-10-14）：池的「新建 worker 数 / 复用次数」。
 * 并行一致性门禁靠它区分「真的走了多核」与「静默回落单线程」——**复用池时不新建 worker**，
 * 只看 Worker 构造函数的调用次数会把复用误判成回落。两个整数自增，正常识别零成本。
 */
const poolTelemetry = (globalThis as typeof globalThis & { __banbuPoolStats?: { spawned: number; reused: number } });
poolTelemetry.__banbuPoolStats ??= { spawned: 0, reused: 0 };
/** 池内「不参与本轮的 worker」用的占位图（320×320，0.4MB）。每次调用新建一份，
 *  避免多个池共享同一块缓冲后又被调用方改到。 */
const warmPlaceholderImage = (): SampledImage => createSampledImage(new Uint8ClampedArray(320 * 320 * 4), 320, 320);
/** 预热进行中/已完成的备忘（见 prewarmRecognitionPool；池被回收时清空）。 */
let prewarmPromise: Promise<boolean> | null = null;
const releaseSharedPool = (): void => {
  if (sharedPoolTimer) { clearTimeout(sharedPoolTimer); sharedPoolTimer = null; }
  sharedPool?.disposeNow();
  sharedPool = null;
  // 预热备忘也要一起清（2026-10-14）：否则「热好 → 空闲 5 分钟被回收 → 用户这才点图片识谱」
  // 时，prewarmRecognitionPool 会直接返回上次缓存的 true，池早就没了，白等一场。
  prewarmPromise = null;
};
const armSharedPoolTimer = (idleMs: number = POOL_IDLE_DISPOSE_MS): void => {
  if (sharedPoolTimer) clearTimeout(sharedPoolTimer);
  sharedPoolTimer = setTimeout(releaseSharedPool, idleMs);
};
/** 预热池的空闲时限更长（2026-10-14）：预热发生在用户看首页/选图的时候，之后可能过一会儿
 *  才真的导入；60 秒就把刚热好的池拆掉等于白热。5 分钟足够覆盖「看首页 → 点导入 → 选图」。 */
const POOL_PREWARM_IDLE_DISPOSE_MS = 5 * 60_000;
/** 切到后台后的宽限时限（2026-10-14）。原来是「一 hidden 立刻拆池」，但**系统相册/文件
 *  选择器会把页面挂到后台**（Capacitor 里就是 Activity onPause）——用户点「图片识谱」→
 *  相册打开 → 页面 hidden → 池被拆 → 选完图回来还得从零建池（每 worker 重编 14MB ORT wasm）。
 *  改成留一段宽限：短暂切走（选图、看一眼通知）保留热池，真长时间挂后台才释放内存。 */
const POOL_HIDDEN_DISPOSE_MS = 120_000;
if (typeof document !== "undefined" && !(globalThis as typeof globalThis & { __BANBU_POOL_VIS_HOOK__?: boolean }).__BANBU_POOL_VIS_HOOK__) {
  (globalThis as typeof globalThis & { __BANBU_POOL_VIS_HOOK__?: boolean }).__BANBU_POOL_VIS_HOOK__ = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") armSharedPoolTimer(POOL_HIDDEN_DISPOSE_MS);
  });
}

export const createParallelAccelerator = async (image: SampledImage, options: { modelSessions?: boolean } = {}): Promise<RecognitionAccelerator | null> => {
  if (typeof Worker === "undefined") return null;
  // 先看能不能复用上一趟的池。池键**不含画布尺寸**（2026-10-14）：worker 与图像无关
  // （复用时会重发新图），而「预热」必须在不知道真实图尺寸时就建好池，否则白热。
  // 画布尺寸的影响改由下面的 **capacity 核对**兜住：线程数不一致就重建（见注释）。
  const poolKey = options.modelSessions === true ? "model" : "cv";
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  // WebKit 不实现 navigator.deviceMemory（Chromium 专有），缺失时以前兜底 4GB——
  // 那会把池子按「低内存机」卡在 3 个线程。现代 iPhone/iPad 普遍 4-8GB，按 5GB 估计：
  // 既不按 4GB 过度保守，也不放开到 8GB 让内存闸门失效（每个线程要持一份像素+灰度图）。
  const memoryGb = (typeof navigator === "undefined" ? 5 : (navigator as Navigator & { deviceMemory?: number }).deviceMemory) ?? 5;
  // 模型会话（ORT + 两个 fp16 模型）也在 worker 里时，每线程多算 ~20MB。
  const poolSize = planRecognitionPool({ cores, memoryGb, pixelCount: image.width * image.height, withModelSessions: options.modelSessions === true });
  if (sharedPool) {
    // 「model」池是「cv」池的**超集**：modelOnWorkers 是全局开关（默认 true），两种池的
    // worker 都能跑全部任务类型，差别只在建池时的内存预算。所以已经热好的 model 池
    // **绝不为一次 cv 请求拆掉**，直接复用；反过来（手里是 cv 池、这次要 model）才重建。
    const sameCapability = sharedPool.key === poolKey || sharedPool.key === "model";
    // 复用判据：**热池的线程数 ≥ 这张图的计划数**（2026-10-14 定案，见下面三段推导）。
    //
    //  1) 少了就是真损失。预热占位图 1200×1600 算 3 线程，而真机 720×1600 截图算 4 线程，
    //     整条链路实测慢 25%（diag-first-import-prewarm 复现）——所以「热池线程数 < 计划」
    //     必须重建，不能将就。
    //  2) 多了不该重建，而该**按计划只用前 N 个**。重建要重付每个 worker 的 ORT 会话
    //     创建（实测 1 个 worker 单独 1.8s，5 个并发各 5.2s——争抢 CPU/带宽），代价远大于
    //     少用几个线程。于是预热的正确做法是：用**最小占位画布**建池，让它的线程数等于
    //     本机上任何图能拿到的最多线程（C = min(核数-1, 6, 内存预算/最小每线程）），
    //     真图来了就按自己的计划取用前 N 个（N ≤ C 恒成立，因为每线程内存下界就是
    //     8MB + 20MB 模型）。
    //  3) 内存安全：真图只发给前 N 个 worker，其余退回占位图，于是峰值 = N × 每线程(真图)
    //     = 计划本身的上限（planRecognitionPool 的不变式），**不超过**不预热的峰值。
    if (sameCapability && sharedPool.capacity >= poolSize && await sharedPool.rebind(image, poolSize)) {
      poolTelemetry.__banbuPoolStats!.reused += 1;
      armSharedPoolTimer();
      return sharedPool.accelerator;
    }
    releaseSharedPool(); // 能力/线程数对不上，或池已不可用：立刻拆掉再重建
  }
  // 主线程回落用的本地加速器：复用池换图时要一起换（否则回落段会算在上一张图上）。
  let local = localAccelerator(image);
  const pending = new Map<number, PendingRequest>();
  const workers: Worker[] = [];
  let nextId = 1;
  // cv = 网格窗评分/网格支撑/线梳/逐格特征（便宜、稳）；model = 模型扫描/读号（贵、慢设备上易超时）。
  let cvDegraded = false;
  let modelDegraded = false;
  let disposed = false;
  const debugEnabled = Boolean((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__);

  const degrade = (error: unknown, kind: "cv" | "model" = "cv") => {
    const already = kind === "model" ? modelDegraded : cvDegraded;
    if (!already) {
      console.warn(`[banbu-image-accelerator] 多核分片失败（${kind === "model" ? "模型" : "识别"}任务），改用单线程继续`, error);
    }
    if (kind === "model") modelDegraded = true; else cvDegraded = true;
  };

  const stopWorkers = () => {
    for (const worker of workers.splice(0)) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("识别线程池已停止"));
    }
    pending.clear();
  };

  const send = (worker: Worker, payload: RecognitionWorkerRequestPayload, timeoutMs = SLICE_TIMEOUT_MS): Promise<RecognitionWorkerReply> => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`识别分片超时（${timeoutMs}ms）`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ ...payload, id });
  });

  const sendJob = async (worker: Worker, job: RecognitionJob, timeoutMs = SLICE_TIMEOUT_MS): Promise<RecognitionJobResult> => {
    const reply = await send(worker, { type: "job", job }, timeoutMs);
    if (reply.type === "error") throw new Error(reply.message);
    if (reply.type !== "done") throw new Error("识别线程应答异常");
    return reply.result;
  };

  /**
   * 把（新）图像发给所有 worker，等每个都回 ready。首次建池用它装载第一张图；
   * **复用池时也用它重发新图**（worker 侧重建 SampledImage，ORT 会话照旧热着），
   * 所以它必须在 try 之外可被 `rebind` 取到。灰度在 worker 内用同一份代码重建，
   * 省掉一半拷贝；pageBase 一并带上——worker 里模型/ort 的地址要以**页面**为基准解析
   * （生产构建的 BASE_URL 是相对的，worker 自己解析会落到 /assets/）。
   */
  const uploadImage = async (target: SampledImage, targets: readonly Worker[] = workers): Promise<boolean> => {
    const imageMessage = {
      type: "image" as const,
      data: target.data,
      width: target.width,
      height: target.height,
      pageBase: new URL(import.meta.env.BASE_URL, globalThis.location.href).href,
    };
    const readies = await Promise.all(targets.map((worker) => send(worker, imageMessage)));
    return readies.every((reply) => reply.type === "ready");
  };

  // 每个线程一个「远程执行器」：形状与主线程直算完全一致，所以上层派发逻辑
  // （runRecognitionJob）只有一份，本地与远程走同一段代码。
  /**
   * 模型装载确认（每个 worker 一次，2026-10-09）。发一条**空**模型任务并等它回来：
   * 空任务不产生计算，只负责触发 worker 侧懒加载 ORT + 两个模型。返回 true 表示
   * 这个 worker 已经能跑模型分片；false 表示超预算（慢设备），调用方按主线程回落。
   *
   * 为什么必须**等**（旧实现是 `void send(...)` 发了不管）：不等的话装载会占着
   * worker 的消息队列，把排在它后面的网格分片也一起堵住；而且模型分片的超时计时
   * 从派发就开始，预算被装载吃掉 → 超时降级 → 整批重算（真机「识谱十几秒」的根因）。
   */
  const prewarmState = new WeakMap<Worker, Promise<boolean>>();
  const ensureModelPrewarmed = (worker: Worker): Promise<boolean> => {
    let state = prewarmState.get(worker);
    if (!state) {
      const started = performance.now();
      state = send(worker, { type: "job", job: { kind: "scanCells", queries: [], half: 1 } }, MODEL_PREWARM_TIMEOUT_MS)
        .then((reply) => {
          if (reply.type === "error") return false;
          if (debugEnabled) console.info("[banbu-image-accelerator] 模型预装完成", Math.round(performance.now() - started) + "ms");
          return true;
        })
        .catch(() => false);
      prewarmState.set(worker, state);
    }
    return state;
  };

  const remote = (worker: Worker): RecognitionAccelerator => ({
    scoreWindows: async (queries: readonly GridWindowQuery[]) => {
      const result = await sendJob(worker, { kind: "scoreWindows", queries });
      if (result.kind !== "scoreWindows") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    meshSupports: async (queries: readonly MeshQuery[]) => {
      const result = await sendJob(worker, { kind: "meshSupports", queries });
      if (result.kind !== "meshSupports") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    fitCombs: async (queries: readonly CombQuery[]) => {
      const result = await sendJob(worker, { kind: "fitCombs", queries });
      if (result.kind !== "fitCombs") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    cellFeatures: async (queries: readonly CellQuery[]) => {
      const result = await sendJob(worker, { kind: "cellFeatures", queries });
      if (result.kind !== "cellFeatures") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    // 模型推理（2026-10-07）：worker 侧自己懒加载 ORT 与两个模型（每 worker 一份会话，
    // 首次分片多付装载、之后各分片直接算），主线程因此完全不参与 225 格扫描。
    //
    // 2026-10-09：超时改成 MODEL_SLICE_TIMEOUT_MS（装载+算力都算进去），并且只在
    // **预装已成功**（或该 worker 已经算过一次模型任务）时才真正派模型分片；否则
    // 直接回落主线程——省掉「等 20–30 秒再降级」的那一段白等。
    scanCells: async (queries, half, options) => {
      // wasmPaths/threads 只对主线程直算有意义（worker 内固定单线程、路径走 BASE_URL）。
      void options;
      if (!modelOnWorkers || modelDegraded || !(await ensureModelPrewarmed(worker))) {
        const fallback = await runRecognitionJob(local, { kind: "scanCells", queries, half });
        return fallback.kind === "scanCells" ? fallback.value : [];
      }
      const result = await sendJob(worker, { kind: "scanCells", queries, half }, MODEL_SLICE_TIMEOUT_MS);
      if (result.kind !== "scanCells") throw new Error("识别线程应答类型不匹配");
      return result.value as CellClass[];
    },
    readDigits: async (queries, half, options) => {
      void options;
      if (!modelOnWorkers || modelDegraded || !(await ensureModelPrewarmed(worker))) {
        const fallback = await runRecognitionJob(local, { kind: "readDigits", queries, half });
        return fallback.kind === "readDigits" ? fallback.value : [];
      }
      const result = await sendJob(worker, { kind: "readDigits", queries, half }, MODEL_SLICE_TIMEOUT_MS);
      if (result.kind !== "readDigits") throw new Error("识别线程应答类型不匹配");
      return result.value as Array<DigitRead | null>;
    },
    // 手数序号逐子匹配（2026-10-10）：模板段并行的远程执行器。
    // 超时用 MODEL_SLICE_TIMEOUT_MS（比 CV 分片宽）：模板渲染在慢设备上最慢，
    // 而这一片本来就贵（几百毫秒到数秒），用 CV 的 20s 预算会把正常分片误判成卡死。
    matchMoveNumbers: async (queries) => {
      const result = await sendJob(worker, { kind: "matchMoveNumbers", queries }, MODEL_SLICE_TIMEOUT_MS);
      if (result.kind !== "matchMoveNumbers") throw new Error("识别线程应答类型不匹配");
      return result.value as MoveNumberCandidate[][];
    },
    // worker 侧模板渲染指纹（2026-10-10）：模板段并行的准入自检。
    // 单线程回落（本 worker 已降级/停用时）直接在本地算——那是主线程同一块画布，
    // 指纹必然与主线程相同，于是调用方会判「一致」而启用并行；但此时 dispatch 已经
    // cvDegraded，模板任务会走本地补算，不会真的发远程，所以不会出错。
    renderFingerprint: async () => {
      const result = await sendJob(worker, { kind: "renderFingerprint" });
      if (result.kind !== "renderFingerprint") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    dispose: () => { /* 线程由池统一收 */ },
  });

  try {
    for (let index = 0; index < poolSize; index += 1) {
      // 用 vite 的 `?worker` 包装：构建侧 worker.format="iife"（vite.config）——
      // 包装类按 **classic** 创建 worker，与产物格式一致。此前两类翻车都记在
      // vite.config 的注释里：classic 包装配 ESM chunk → SyntaxError；ESM 包装
      // 配 { type:"module" } → Chrome 79 的老 WebView 直接不支持（群友机型）。
      const worker = new RecognitionWorker({ name: `banbu-recognition-${index}` });
      worker.onmessage = (event: MessageEvent<RecognitionWorkerReply>) => {
        const reply = event.data;
        const entry = pending.get(reply.id);
        if (!entry) return;
        pending.delete(reply.id);
        clearTimeout(entry.timer);
        if (reply.type === "error") entry.reject(new Error(reply.message));
        else entry.resolve(reply);
      };
      worker.onerror = (event) => {
        degrade(event instanceof ErrorEvent ? event.message : "识别线程异常退出");
        stopWorkers();
      };
      worker.onmessageerror = () => {
        degrade("识别线程消息无法反序列化");
        stopWorkers();
      };
      workers.push(worker);
    }
    if (!(await uploadImage(image))) throw new Error("识别线程未能装载图像");
    if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
      console.info("[banbu-image-accelerator]", JSON.stringify({ poolSize, cores, memoryGb, width: image.width, height: image.height }));
    }
  } catch (error) {
    degrade(error);
    stopWorkers();
    return null;
  }

  // 模型预装（2026-10-07 加，2026-10-09 改成「按需等待」）：这批识别带 boardScanner 时，
  // worker 迟早要为模型扫描加载 ORT 与两个模型。旧实现在这里就 `void send(空任务)`，
  // 好处是装载与主线程的网格探测并行，坏处是装载会堵住该 worker 的消息队列、并把
  // 「模型分片」的超时预算吃掉一半（慢设备上直接触发超时降级 + 整批重算）。
  // 现在装载统一由 ensureModelPrewarmed 按需触发并等待（见 remote.scanCells），
  // 这里只做一件事：**把这批识别的模型需求记下来**，供 dispatch 判断要不要给
  // 模型分片留出余量。
  /**
   * 模型任务派给 worker 池（2026-10-09 定案，**默认始终走池**）。
   *
   * 这里有一段被推翻过的判断，记下来免得重走：早些时候我基于一次 A/B 得出「非隔离环境
   * （手机）把模型任务放主线程更快」，并按那个结论把非隔离环境的模型任务挪回主线程。
   * 那次 A/B 其实是**无效实验**——探针漏了设置路由覆盖开关，两条路都跑在同一个配置上，
   * 量出的 41s/42s 是同一配置跑两遍，却被我当成了「走池不划算」的证据。
   *
   * 修正后的实测（CPU 降频 6× 模拟手机，import 路径，模型扫描那一段）：
   *   15 手截图：走池 15.8s vs 主线程 47.6s（走池快 3.0×）
   *   书谱 66 子：走池 19.6s vs 主线程 71.4s（走池快 3.6×）
   * 原因很直白：手机主线程单核跑 225 格，而池子有最多 6 个 worker 并行；每个 worker
   * 各自装载 wasm 的那点固定成本，远小于并行带来的收益。所以**不论是否跨源隔离都走池**；
   * 跨源隔离只影响每个 worker 内部的 wasm 多线程（那是额外的加成，不是前提）。
   */
  const modelOnWorkers = (globalThis as typeof globalThis & { __BANBU_FORCE_MODEL_WORKERS__?: boolean }).__BANBU_FORCE_MODEL_WORKERS__ ?? true;
  const modelSessionsNeeded = options.modelSessions === true;
  void modelSessionsNeeded;

  const remotesAll = workers.map(remote);
  // 只用前 activeCount 个（复用热池时按本图计划裁剪，见 createParallelAccelerator 的判据）。
  let remotes = remotesAll;
  /** 不参与本轮的 worker 退回这张小图，别再抱着上一张真图（0.4MB，见 rebind）。 */
  const idleImage = warmPlaceholderImage();

  const dispatch = async <TQuery, TResult>(
    queries: readonly TQuery[],
    makeJob: (slice: readonly TQuery[]) => RecognitionJob,
    readValue: (result: RecognitionJobResult) => TResult[],
  ): Promise<TResult[]> => {
    // CV 批次只受 cvDegraded 影响：模型分片在慢设备上超时不该连网格检测的收益一起废掉。
    if (cvDegraded || !remotes.length || disposed) return readValue(await runRecognitionJob(local, makeJob(queries)));
    const chunkTarget = Math.max(1, Math.min(queries.length, remotes.length * CHUNKS_PER_WORKER));
    const chunkSize = Math.max(1, Math.ceil(queries.length / chunkTarget));
    const chunks: Array<{ start: number; slice: readonly TQuery[] }> = [];
    for (let start = 0; start < queries.length; start += chunkSize) {
      chunks.push({ start, slice: queries.slice(start, start + chunkSize) });
    }
    const results = new Array<TResult>(queries.length);
    const computed = new Array<boolean>(chunks.length).fill(false);
    let cursor = 0;
    await Promise.all(remotes.map(async (accelerator) => {
      for (;;) {
        if (cvDegraded || disposed) return;
        const index = cursor;
        if (index >= chunks.length) return;
        cursor += 1;
        const chunk = chunks[index];
        try {
          readValue(await runRecognitionJob(accelerator, makeJob(chunk.slice)))
            .forEach((value, offset) => { results[chunk.start + offset] = value; });
          computed[index] = true;
        } catch (error) {
          degrade(error, "cv");
          return;
        }
      }
    }));
    // 降级/停止时没算完的分片在主线程补算：结果仍是原顺序、原数值。
    for (let index = 0; index < chunks.length; index += 1) {
      if (computed[index]) continue;
      const chunk = chunks[index];
      readValue(await runRecognitionJob(local, makeJob(chunk.slice)))
        .forEach((value, offset) => { results[chunk.start + offset] = value; });
    }
    return results;
  };

  const api: RecognitionAccelerator = {
    scoreWindows: (queries: readonly GridWindowQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "scoreWindows", queries: slice }),
      (result) => (result.kind === "scoreWindows" ? result.value : []),
    ),
    meshSupports: (queries: readonly MeshQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "meshSupports", queries: slice }),
      (result) => (result.kind === "meshSupports" ? result.value : []),
    ),
    fitCombs: (queries: readonly CombQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "fitCombs", queries: slice }),
      (result) => (result.kind === "fitCombs" ? result.value : []),
    ),
    cellFeatures: (queries: readonly CellQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "cellFeatures", queries: slice }),
      (result) => (result.kind === "cellFeatures" ? result.value : []),
    ),
    // 模型推理（2026-10-07）：与其它任务同一条派发路径（连续分片、4×线程数、
    // 降级时未完成的分片回到主线程直算）——所以「多核开关」一关，它们就老实单线程，
    // 开关一开，225 格扫描与逐格读号都被切开并行。
    scanCells: (queries, half) => dispatch<CellScanQuery, CellClass | null>(
      queries,
      (slice) => ({ kind: "scanCells", queries: slice, half }),
      (result) => (result.kind === "scanCells" ? result.value : []),
    ),
    readDigits: (queries, half) => dispatch<CellScanQuery, DigitRead | null>(
      queries,
      (slice) => ({ kind: "readDigits", queries: slice, half }),
      (result) => (result.kind === "readDigits" ? result.value : []),
    ),
    // 手数序号逐子匹配（2026-10-10）：与其它任务同一条派发路径（连续分片、4×线程数、
    // 降级时未完成的分片回主线程重算）。返回形状是「每颗子一个候选数组」。
    matchMoveNumbers: (queries) => dispatch<MoveNumberQuery, MoveNumberCandidate[]>(
      queries,
      (slice) => ({ kind: "matchMoveNumbers", queries: slice }),
      (result) => (result.kind === "matchMoveNumbers" ? result.value : []),
    ),
    // 模型预热（2026-10-14）：把每个 worker 的 ORT 编译 + 模型装载提前做掉。
    // 只在「预装成功」时返回 true；任一 worker 失败也算 false（调用方只当日志，不当错误）。
    prewarmModels: async (): Promise<boolean> => {
      if (!workers.length || disposed) return false;
      const states = await Promise.all(workers.map((worker) => ensureModelPrewarmed(worker)));
      return states.every(Boolean);
    },
    // 池级指纹：随便借一个 worker 问（每个 worker 的字体栈相同）。
    // 池停摆/降级时返回主线程指纹——但那时模板任务本来也不会远程派发。
    renderFingerprint: async () => {
      if (cvDegraded || !remotes.length || disposed) return local.renderFingerprint();
      const probe = await runRecognitionJob(remotes[0], { kind: "renderFingerprint" });
      return probe.kind === "renderFingerprint" ? probe.value : null;
    },
    dispose: () => {
      // 复用池（2026-10-14）：调用方在每次识别的 finally 里都会调它，但**不立刻拆**——
      // 只是在共享池上这把椅子空出来了，空闲 POOL_IDLE_DISPOSE_MS 后再拆；期间再来一次
      // 识别就能直接复用（省掉每 worker 重编 13.5MB wasm）。不是共享池（已被换掉/从未登记）
      // 才真的立刻拆。
      if (sharedPool?.accelerator === api) {
        armSharedPoolTimer();
        return;
      }
      disposed = true;
      stopWorkers();
    },
  };
  sharedPool = {
    key: poolKey,
    capacity: poolSize,
    accelerator: api,
    rebind: async (next: SampledImage, activeCount: number): Promise<boolean> => {
      if (disposed || !workers.length) return false;
      // 在途请求没清空就不复用：上一趟可能中途抛错、有回包还在路上，换图会让它算在错的图上。
      if (pending.size > 0) return false;
      const active = Math.max(1, Math.min(Math.floor(activeCount) || 1, workers.length));
      try {
        const on = workers.slice(0, active);
        const off = workers.slice(active);
        // 一起等完：都留着在途消息会让下一次复用被判「在途未清」而白白重建。
        const ok = await Promise.all([
          uploadImage(next, on),
          ...off.map((worker) => uploadImage(idleImage, [worker])),
        ]);
        if (!ok[0]) return false;
        remotes = remotesAll.slice(0, active);
        local = localAccelerator(next);
        return true;
      } catch {
        return false;
      }
    },
    disposeNow: () => { disposed = true; stopWorkers(); },
  };
  poolTelemetry.__banbuPoolStats!.spawned += workers.length;
  armSharedPoolTimer();
  return api;
};

/**
 * 后台预热识别池（2026-10-14）。**这是「第一次导入太慢」的正解**：
 * 页面首次识别的耗时几乎全在「每个 worker 各自编译 13.5MB 的 ORT wasm + 装载两个模型」
 * （实测池#1 板面扫描 18.8s、池#2 仅 1.1s），而这段与「哪张图」无关。所以 App 在
 * **用户还在看首页 / 正在系统相册里选图**时就把它做掉，真正识别时只剩「重发图像 + 识别」。
 *
 * 无损：预热只建池、只装载，不跑任何识别、不碰任何判定；真图来了走的是同一条复用路径
 * （同一份代码同一份权重），结果与「不预热直接识别」逐位相同。
 *
 * 幂等：同一会话内多次调用只会热一次（已有共享池且已预热就直接返回）。
 */
export const prewarmRecognitionPool = (): Promise<boolean> => {
  if (typeof Worker === "undefined") return Promise.resolve(false);
  // QA 开关（2026-10-14）：`__BANBU_NO_PREWARM__ = true` 时不预热，用来把「预热造成的
  // 干扰」与「识别本身的差异」分开量（与 __BANBU_FORCE_MODEL_WORKERS__ 同一套惯例）。
  if ((globalThis as typeof globalThis & { __BANBU_NO_PREWARM__?: boolean }).__BANBU_NO_PREWARM__ === true) return Promise.resolve(false);
  if (prewarmPromise) return prewarmPromise;
  prewarmPromise = (async () => {
    try {
      let pool = sharedPool?.accelerator ?? null;
      if (!pool) {
        // 占位图取识别器的**最小画布**（320×320）：这样预热池的线程数是本机上限 C，
        // 任何真图（计划数 N ≤ C）都能直接复用它、只按计划取前 N 个 worker 用（见
        // createParallelAccelerator 的复用判据）。反面教训：早先用 1200×1600 占位，
        // 池只有 3 线程，真机 720×1600 截图要 4 线程 → 每次都被判「不够用」而重建，
        // 白热一场（diag-first-import-prewarm 实测慢 25%）。
        const width = 320;
        const height = 320;
        pool = await createParallelAccelerator(
          createSampledImage(new Uint8ClampedArray(width * height * 4), width, height),
          { modelSessions: true },
        );
        if (!pool) return false;
      }
      const ready = pool.prewarmModels ? await pool.prewarmModels() : false;
      // 失败不缓存结论：下次（用户点「图片识谱」时）再试一次。成功才按 5 分钟空闲留着。
      if (!ready) prewarmPromise = null;
      armSharedPoolTimer(POOL_PREWARM_IDLE_DISPOSE_MS);
      if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
        console.info("[banbu-image-accelerator] 识别池预热", ready ? "完成" : "未完成（已回落）");
      }
      return ready;
    } catch (error) {
      console.warn("[banbu-image-accelerator] 预热识别池失败（不影响正常识别）", error);
      return false;
    }
  })();
  return prewarmPromise;
};
