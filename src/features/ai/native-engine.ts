/**
 * 原生引擎桥（安卓）：把 WASM worker 与「本机跑 Rapfi 的进程」接起来。
 *
 * 分工：**协议逻辑仍然只在 `public/rapfi/rapfi-worker.js` 一处**。worker 里多了个
 * `native` 变体，它不发 importScripts，而是往主线程要一个进程：命令走
 * `postMessage({type:"native-command"})` → 主线程写进进程 stdin；进程 stdout 按行
 * 回灌成 `{type:"native-stdout"}` → worker 交给同一套 parseOutput 解析。
 * 因此解析、候选、时限、收尾这些行为原生与 wasm 完全一致，不需要第二份实现。
 *
 * 为什么安卓必须走原生：WebView 不支持跨源隔离（设备实测：带上 COOP/COEP 后
 * `crossOriginIsolated` 仍是 false、`SharedArrayBuffer` 是 undefined），wasm 的
 * pthread 多线程在 APK 里永远不可能。原生用真线程，不需要 SAB。
 *
 * 能力探测与降级：APK 里没有对应 ABI 的可执行文件、或设备禁止执行时，`check()`
 * 返回不可用 → worker 完全不尝试原生，照旧走 WASM（轻量档随包，强力档可下载）。
 */
import { Capacitor } from "@capacitor/core";

interface NativeEngineProbe {
  available: boolean;
  abi: string;
  cores: number;
  assetsCopied: boolean;
  binaryPath: string;
  /** arm64 打了两份可执行文件，按 CPU 特性选：dotprod（armv8.2+ 的 NNUE 加速）或 baseline。 */
  binaryVariant?: string;
  /** 大核数量（按 cpufreq 最高频那批统计）；等于 cores 表示同构或读不到。 */
  bigCores?: number;
  /** 本机 CPU 是否具备 NEON DotProd 能力；以及当前是否真的在用 dotprod 二进制。 */
  dotprodCapable?: boolean;
  dotprodEnabled?: boolean;
  dotprodPreference?: "auto" | "on" | "off";
}

interface NativeEngineApi {
  check?: () => Promise<NativeEngineProbe>;
  prepare?: () => Promise<{ ready: boolean; dir: string }>;
  start?: () => Promise<{ running: boolean; cores: number }>;
  write?: (options: { line: string }) => Promise<void>;
  stop?: (options?: { reason?: string }) => Promise<void>;
  setDotprod?: (options: { mode: "auto" | "on" | "off" }) => Promise<{ preference: string; capable: boolean; restartRequired: boolean }>;
  addListener?: (event: string, handler: (payload: Record<string, unknown>) => void) => { remove?: () => Promise<void> } | Promise<unknown>;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

const bridge = () => (globalThis as { Capacitor?: CapacitorBridge }).Capacitor ?? null;

/** Capacitor listeners may register asynchronously. Keep the resolved handle
 * so detach works both before and after registration finishes. */
const listenToNativeEvent = (api: Pick<NativeEngineApi, "addListener">, event: string, handler: (payload: Record<string, unknown>) => void): (() => void) => {
  let active = true;
  let subscription: { remove?: () => Promise<void> } | null = null;
  const remove = () => {
    const current = subscription;
    subscription = null;
    try { void current?.remove?.().catch(() => undefined); } catch { /* best effort */ }
  };
  const registered = api.addListener?.(event, (payload) => { if (active) handler(payload); });
  void Promise.resolve(registered).then((handle) => {
    subscription = (handle as { remove?: () => Promise<void> } | undefined) ?? null;
    if (!active) remove();
  }).catch(() => undefined);
  return () => { active = false; remove(); };
};

/** 鸭子类型取插件：测试里可以直接往 globalThis.Capacitor.Plugins.NativeEngine 塞假实现
 *  （与 SAF 那套假桥同一模式），因此不在模块加载期缓存。 */
const plugin = (): NativeEngineApi | null => {
  if (Capacitor.isNativePlatform && !Capacitor.isNativePlatform()) return null;
  const api = bridge()?.Plugins?.NativeEngine as NativeEngineApi | undefined;
  return api && typeof api.start === "function" ? api : null;
};

let probePromise: Promise<NativeEngineProbe | null> | null = null;
let probed: NativeEngineProbe | null = null;

/** 插件注册可能晚于本模块第一次被调用（Capacitor 的桥是注入进来的）。 */
const PROBE_ATTEMPTS = 6;
const PROBE_RETRY_MS = 250;

type NativeEngineListener = (info: NativeEngineProbe | null) => void;
const listeners = new Set<NativeEngineListener>();

/** 订阅探测结果（含后续重探）。UI 的「本机原生引擎是否可用」必须跟着它走，而不是
 *  自己在挂载时读一次：安卓上插件注册可能晚于启动 effect，那一次读到的 false 会把
 *  整个会话判成「本机没有原生引擎」，于是界面一直说「引擎包未就绪、去下载 38MB」，
 *  而安装包里其实带着模型（2026-09-18 用户报的「本来就有模型却让我下载引擎」）。 */
export const subscribeNativeEngine = (listener: NativeEngineListener) => {
  listeners.add(listener);
  listener(probed);
  return () => { listeners.delete(listener); };
};

/** 探测一次（结果缓存）。App 启动时调一次即可，代价只是几次文件检查。
 *
 * 关键：**「拿不到插件」不能缓存成永久结论**。安卓上 Capacitor 的插件注册偶尔晚于
 * 启动 effect，旧实现会把这个 null 缓存住 → `nativeEngineUsable()` 整个会话恒为 false
 * → 原生引擎被静默禁用、UI 退回「需下载引擎包」（2026-09-15 在 MuMu 上实测复现：
 * 同一秒手动调 `Capacitor.Plugins.NativeEngine.check()` 明明返回 available:true，
 * 而 `window.__banbuNativeEngine` 是 null）。所以插件还没就绪时重试几次，仍拿不到就
 * 清空缓存，留给下一次调用再探——调用方（App）另外按退避重探并订阅结果。
 */
export const probeNativeEngine = (): Promise<NativeEngineProbe | null> => {
  if (!probePromise) {
    probePromise = probeWithRetry().then((result) => {
      probed = result;
      // 诊断读数：排障时一眼看到「这个包里有没有原生引擎、权重铺了没」（null = 还没探到）。
      (globalThis as { __banbuNativeEngine?: unknown }).__banbuNativeEngine = result;
      if (!result) probePromise = null;
      for (const listener of listeners) listener(result);
      return result;
    });
  }
  return probePromise;
};

const probeWithRetry = async (): Promise<NativeEngineProbe | null> => {
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    const api = plugin();
    if (api?.check) {
      try {
        return await api.check();
      } catch {
        // 插件在、但 check 抛错：等下一轮再试，拿不到就按不可用处理。
      }
    }
    if (attempt < PROBE_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_MS));
  }
  return null;
};

/** 同步读取探测结果：worker 消息里的 native 开关用它。
 *  探测未完成时返回 false —— 宁可先用 WASM 起一局，也不要让分析等着探测。 */
export const nativeEngineUsable = () => probed?.available === true;

/** 停掉 Rapfi 原生进程。用于「引擎互斥」：切到旗舰档时先把 rapfi 进程停掉，
 *  避免两套引擎（各自 ~20-30MB 常驻 + 词表/缓存）同时占内存与发热。 */
export const stopNativeEngine = async (): Promise<void> => {
  nativeStopIntent = true;
  try { await plugin()?.stop?.(); } catch { /* 没在跑就算了 */ }
  // 通知所有挂着的 worker：实例已失效（别等下一手写命令失败，也别把退出当崩溃报错）
  for (const worker of attachedNativeWorkers) worker.postMessage({ type: "native-stopped" });
};

/** 停掉 KataGo 旗舰进程（切回 rapfi 时用；也用于设置变更后的重启）。
 *  reason 只用于诊断日志（谁是调用方），不参与逻辑。 */
export const stopNativeKataGo = async (reason?: string): Promise<void> => {
  kataStopIntent = true;
  kataStartOwner = null;        // 进程没了，持有者作废（下次启动重新登记）
  kataProcessReady = false;     // 就绪状态一并作废：下次启动必须重新等 GTP ready
  try { await kataPlugin()?.stop?.({ reason: reason || "" }); } catch { /* 没在跑就算了 */ }
  for (const worker of attachedKataWorkers) worker.postMessage({ type: "kata-stopped" });
};

/** 确保旗舰引擎的资产已铺到私有目录（幂等）。设置模块改写 kata.cfg 前调用：
 *  刚启用旗舰就进设置改参数时，目录可能还没铺好。 */
export const prepareNativeKataGo = async (): Promise<boolean> => {
  const api = kataPlugin();
  if (!api?.prepare) return false;
  try {
    await api.prepare();
    return true;
  } catch {
    return false;
  }
};

export const nativeEngineInfo = () => probed;

/** 切换 NEON DotProd 二进制（安卓）。下一轮搜索前需要引擎进程重启，调用方负责。 */
export const setNativeDotprod = async (mode: "auto" | "on" | "off"): Promise<boolean> => {
  const api = plugin();
  if (!api?.setDotprod) return false;
  try {
    await api.setDotprod({ mode });
    probed = null;
    probePromise = null;
    await probeNativeEngine();
    return true;
  } catch {
    return false;
  }
};

/** 把 worker 与原生进程接起来；返回解绑函数（worker terminate 时调用）。 */
export const attachNativeEngine = (worker: Worker): (() => void) => {
  const api = plugin();
  if (!api) return () => undefined;
  let disposed = false;
  attachedNativeWorkers.add(worker);
  let lastVersion: string | null = null;

  const listen = (event: string, handler: (payload: Record<string, unknown>) => void) => {
    return listenToNativeEvent(api, event, handler);
  };

  // stdout/exit 监听只在桥生命周期注册一次：原先每次 native-start 都重复注册且
  // 从不下掉（detachStdout 被覆盖），重启 N 次后每行输出被转发 N 遍。
  const detachStdout = listen("stdout", (payload) => {
    const line = String(payload.line ?? "");
    if (line.startsWith("MESSAGE Rapfi")) lastVersion = line.replace(/^MESSAGE\s+/, "").slice(0, 80);
    worker.postMessage({ type: "native-stdout", line });
  });
  const detachExit = listen("exit", (payload) => {
    const intentional = nativeStopIntent;
    worker.postMessage({ type: "native-exit", code: Number(payload.code ?? -1), intentional });
  });

  const onWorkerMessage = (event: MessageEvent) => {
    const message = (event.data || {}) as { type?: string; line?: string };
    if (message.type === "native-command" && typeof message.line === "string") {
      void api.write?.({ line: message.line }).catch((error: unknown) => {
        if (disposed) return;
        worker.postMessage({ type: "native-exit", code: -1, reason: String(error) });
      });
      return;
    }
    if (message.type !== "native-start") return;
    void (async () => {
      // 加载阶段上报（与 kata 同一套消息，App 画进度条）：切回 rapfi 时也有进度可看
      const phase = (percent: number, label: string) =>
        worker.postMessage({ type: "engine-loading", engine: "rapfi", percent, label, done: percent >= 100 });
      phase(10, "准备引擎文件");
      const info = await probeNativeEngine();
      if (disposed) return;
      if (!info?.available) {
        worker.postMessage({ type: "native-start-failed", reason: "本安装包不包含当前设备可用的原生引擎" });
        return;
      }
      try {
        // 权重首次运行从 assets 复制到私有目录（39MB，只做一次）
        await api.prepare?.();
        if (disposed) return;
        phase(45, "启动引擎进程");
        await api.start?.();
        if (disposed) return;
        nativeStopIntent = false;    // 新进程起来了：之前的停止意图已消费
        phase(100, "就绪");
        worker.postMessage({ type: "native-ready", version: lastVersion, cores: info.cores });
      } catch (error) {
        if (disposed) return;
        worker.postMessage({ type: "native-start-failed", reason: error instanceof Error ? error.message : String(error) });
      }
    })();
  };

  worker.addEventListener("message", onWorkerMessage);
  return () => {
    disposed = true;
    attachedNativeWorkers.delete(worker);
    worker.removeEventListener("message", onWorkerMessage);
    detachStdout();
    detachExit();
    // **不在这里停进程**：原生进程是应用级单例（分析/对局/复盘多个 worker 共用），
    // worker 只是使用者。原先 detach 里调 api.stop()，于是任何一次 worker 重建
    // （分析槽换局面、对局槽重建）都会 SIGKILL 掉正在加载的引擎——katago 要
    // ~800MB/6 秒，被杀后从头再来、下次重建又杀，形成「起了就死」的循环，
    // 表现就是永远「加载中」（用户 09-26 报）。rapfi 约 1 秒起得来，同样的 bug
    // 在它身上看不出来，所以一直没人发现。
    // 进程生命周期归 App 显式管：切换引擎 stopNativeEngine/stopNativeKataGo，
    // 应用退出由插件 handleOnDestroy 收尾。
  };
};

/** 统一的引擎 worker 工厂：原生环境顺带把桥接上，其余环境就是普通 worker。
 *  App 里所有 `new Worker("rapfi/rapfi-worker.js")` 都走这里。 */
export const createEngineWorker = (scriptUrl: string): Worker => {
  const worker = new Worker(scriptUrl);
  if (plugin() || kataPlugin()) {
    const detach = attachNativeEngine(worker);
    const detachKata = attachKataEngineBridge(worker);
    const originalTerminate = worker.terminate.bind(worker);
    worker.terminate = () => { detach(); detachKata(); originalTerminate(); };
  }
  return worker;
};

// ---------------------------------------------------------------------------
// KataGo 旗舰引擎桥（仅安卓）：与上面的 Rapfi 桥同构但消息类型独立（kata-*），
// 两个桥可以同时挂在同一个 worker 上——worker 按请求的 engine 选择走哪条。
// 原生插件是独立注册的 NativeKataGo（见 NativeKataGoPlugin.java），事件互不串线。
// ---------------------------------------------------------------------------

export interface NativeKataGoProbe {
  available: boolean;
  payloadReady: boolean;
  abi: string;
  cores: number;
  binaryPath?: string;
  /** 引擎档位（2026-10-01 收敛为两档）：当前档位 + 大网档是否可用。 */
  profile?: string;
  activeBinary?: string;
  zzAvailable?: boolean;
  dotprodCapable?: boolean;
  zzRequiresDotprod?: boolean;
  /** 当前规则贴纸（`renju` / `freestyle`）与无禁手网是否铺好（2026-10-12）。 */
  rule?: string;
  freestyleAvailable?: boolean;
}

interface NativeKataGoApi {
  check?: () => Promise<NativeKataGoProbe>;
  prepare?: () => Promise<{ ready: boolean; dir: string }>;
  start?: () => Promise<{ running: boolean }>;
  /** 大网档专属启动入口：命令行在原生侧写死成字面量，JS 只决定「调哪个」。 */
  startZz?: () => Promise<{ running: boolean }>;
  /** 切换档位（原生侧归一化后写 engine.choice）；改档只影响下一次 spawn，需重启引擎。 */
  setProfile?: (options: { profile: string }) => Promise<{ profile: string }>;
  /** 切换规则贴纸（原生侧归一化后写 engine.rule）；只有 renju / freestyle 两个取值，
   *  决定自带档用哪张网，改完同样只影响下一次 spawn（必须接着重启）。 */
  setRule?: (options: { rule: string }) => Promise<{ rule: string }>;
  write?: (options: { line: string }) => Promise<void>;
  stop?: (options?: { reason?: string }) => Promise<void>;
  diag?: (options: { text: string }) => Promise<void>;
  addListener?: (event: string, handler: (payload: Record<string, unknown>) => void) => { remove?: () => Promise<void> } | Promise<unknown>;
}

const kataPlugin = (): NativeKataGoApi | null => {
  if (Capacitor.isNativePlatform && !Capacitor.isNativePlatform()) return null;
  const api = bridge()?.Plugins?.NativeKataGo as NativeKataGoApi | undefined;
  return api && typeof api.start === "function" ? api : null;
};

// 诊断通道（默认关闭，零开销）：把 JS 侧关键消息流写进原生插件的外部日志文件
// （见 NativeKataGoPlugin.DEBUG_DIAG）。排查「引擎不动」这类只能真机复现的问题时，
// 两端开关一起改成 true 重新打包，adb pull /sdcard/Android/data/<包名>/files/
// kata_diag/kata_diag.log 即可看到消息流断在哪一层。关着时每次调用只是一次
// 布尔判断，不产生任何 bridge 往返。
const KATA_DIAG_ENABLED = true;
export const kataDiag = (text: string) => {
  if (!KATA_DIAG_ENABLED) return;
  try { void kataPlugin()?.diag?.({ text }).catch(() => undefined); } catch { /* 忽略 */ }
};

let kataProbePromise: Promise<NativeKataGoProbe | null> | null = null;
let kataProbed: NativeKataGoProbe | null = null;
/** 当前引擎档位与各档可用性（2026-09-30 照搬智子双引擎）。
 *  own = 自带 ONNX Runtime + 蒸馏网；gl = 智子 Eigen + 原生小网；zz = 智子 ORT + b24c256。
 *  真值来自原生 check()，切换走 setProfile()；两者都只影响下一次 spawn。 */
let kataProfile = "own";
let kataProfileAvailability = { zz: false };
/** 当前规则贴纸与「无禁手网是否铺好」——同样来自原生 check()，同样只影响下一次 spawn。 */
let kataRule = "renju";
let kataFreestyleAvailable = false;

/** 标定结果缓存（每手固定开销，秒）。原生进程是单例、worker 有多个（对局 + 分析
 *  槽），若每个 worker 各跑一遍标定会互相污染（命令与应答在同一进程里交错）——
 *  所以由桥统一持有：第一个 worker 标完回报，后续 worker 直接用；并持久化到
 *  localStorage，跨会话复用（设备/机型特性，重启后仍适用）。 */
let kataCalibration: number | null = null;
const KATA_CALIBRATION_KEY = "banbu-kata-calib-v1";
try {
  const raw = localStorage.getItem(KATA_CALIBRATION_KEY);
  if (raw !== null) {
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 1) kataCalibration = value;
  }
} catch { /* 隐私模式等：拿不到就现场标定 */ }

// 桥当前挂着的 worker 们（对局槽 + 分析槽共用单例引擎进程，都要收到停止通知）
// + 「计划内停止」标记：stopNativeKataGo/stopNativeEngine 停进程时通知 worker
// 丢弃失效实例（否则它继续向死进程写命令，还可能把计划内停止当成崩溃报错）。
// Every attached worker sees the same intentional exit; a new start resets it.
const attachedKataWorkers = new Set<Worker>();
const attachedNativeWorkers = new Set<Worker>();
let kataStopIntent = false;
let nativeStopIntent = false;
// 单例进程的启动串行化：并发 kata-start 只真正启动一次，其余等这条链。
let kataStartPromise: Promise<void> | null = null;
// 启动链的持有者（真正 spawn 进程的那个 worker）。只有它有权发 kata-stop 真停进程，
// 其余 worker 的失败重试不得波及别人的健康进程（见 kata-stop 分支注释）。
let kataStartOwner: Worker | null = null;
// 「等待引擎真正就绪」的信号：进程起来后要等 stdout 打出 `GTP ready`（模型加载完、
// 开始读 GTP 命令）才算就绪。详见 stdout 监听里的注释。resolve 的布尔值必须保留：
// 进程在 ready 前退出是启动失败，不能被当成成功继续发 GTP 命令。
type KataReadySignal = { resolve: (ready: boolean) => void };
let readySignal: KataReadySignal | null = null;
// 进程当前是否已就绪（GTP ready 已见过）。多个 worker 共用单例进程，第二个 worker
// 到来时 start() 会早退、`GTP ready` 也不会再打一遍——所以必须记住这个状态，
// 否则后来者会空等一轮超时。
let kataProcessReady = false;
/** 等 GTP ready：已就绪立即返回；否则等信号，超时返回 false。 */
const KATA_READY_WAIT_MS = 60000;
const waitForKataReady = (): Promise<boolean> => new Promise((resolve) => {
  let settled = false;
  const signal: KataReadySignal = {
    resolve: (ok) => {
      if (settled) return;
      settled = true;
      // 旧一轮的 60 秒超时不能清掉新一轮已经登记的 signal。
      if (readySignal === signal) readySignal = null;
      resolve(ok);
    },
  };
  if (kataProcessReady) { signal.resolve(true); return; }
  readySignal = signal;
  setTimeout(() => signal.resolve(false), KATA_READY_WAIT_MS);
});
// 标定仲裁：进程是单例，但校准必须**只有一个 worker 跑**（两个 worker 同时
// 校准会在同一条 GTP 流上交错命令与应答，两份墙钟都不可信）。第一个到达的
// worker 当校准者，其余的等这个 gate 拿到值再就绪（直接复用，不再自己标定）。
let kataCalibGate: Promise<number | null> | null = null;
let releaseKataCalibGate: ((value: number | null) => void) | null = null;
const releaseKataGate = (value: number | null) => {
  if (releaseKataCalibGate) { releaseKataCalibGate(value); releaseKataCalibGate = null; }
  kataCalibGate = null;
};

/** 取得本机每手固定开销（秒）。有缓存直接给；否则本调用者成为「标定者」
 *  （拿到 null → worker 自己跑标定并回报 kata-calibrated），其余并发调用等
 *  标定者回报后复用。返回 null 表示「名额归你，请自己标定并回报」。
 *  等待有上限：标定者中途死掉/超时不会让其他 worker 永久挂住。 */
const KATA_CALIB_GATE_WAIT_MS = 30000;
const acquireKataOverhead = async (): Promise<number | null> => {
  if (kataCalibration !== null) return kataCalibration;
  if (!kataCalibGate) {
    kataCalibGate = new Promise<number | null>((resolve) => { releaseKataCalibGate = resolve; });
    return null;                       // 名额归本次调用者
  }
  const gate = kataCalibGate;
  const value = await Promise.race([
    gate,
    new Promise<null>((resolve) => { setTimeout(() => resolve(null), KATA_CALIB_GATE_WAIT_MS); }),
  ]);
  // 标定者回报了值 → 复用；等超时或标定失败 → 这次自己上（有界重试，不会无限）
  return value;
};
export const probeNativeKataGo = (): Promise<NativeKataGoProbe | null> => {
  if (!kataProbePromise) {
    kataProbePromise = (async () => {
      for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
        const api = kataPlugin();
        if (api?.check) {
          try {
            const info = await api.check();
            kataProbed = {
              available: info.available === true,
              payloadReady: info.payloadReady === true,
              abi: String(info.abi || ""),
              cores: Number.isFinite(info.cores) ? info.cores : 0,
              binaryPath: String(info.binaryPath || ""),
              profile: typeof info.profile === "string" ? info.profile : undefined,
              activeBinary: typeof info.activeBinary === "string" ? info.activeBinary : undefined,
              zzAvailable: info.zzAvailable === true,
              dotprodCapable: info.dotprodCapable === true,
              zzRequiresDotprod: info.zzRequiresDotprod === true,
              rule: typeof info.rule === "string" ? info.rule : undefined,
              freestyleAvailable: info.freestyleAvailable === true,
            };
            // 档位信息随探测一起取回：UI 用它把用不了的档位置灰（而不是让用户选完才发现回落）。
            if (typeof info.profile === "string" && info.profile) kataProfile = info.profile;
            kataProfileAvailability = { zz: info.zzAvailable === true };
            if (info.rule === "renju" || info.rule === "freestyle") kataRule = info.rule;
            kataFreestyleAvailable = info.freestyleAvailable === true;
            (globalThis as { __banbuNativeKataGo?: unknown }).__banbuNativeKataGo = kataProbed;
            return kataProbed;
          } catch {
            // 插件在、但 check 抛错：等下一轮再试。
          }
        }
        if (attempt < PROBE_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_MS));
      }
      kataProbePromise = null;
      return null;
    })();
  }
  return kataProbePromise;
};

/** 同步读取 KataGo 探测结果：UI 的旗舰引擎开关用它。 */
export const nativeKataGoInfo = () => kataProbed;

/** 同步读取引擎档位与各档可用性（UI 的档位选择器用它）。 */
export const nativeKataProfile = () => ({
  profile: kataProfile,
  zzAvailable: kataProfileAvailability.zz,
});

/** 同步读取规则贴纸与「无禁手网铺好了吗」（2026-10-12）。
 *  UI/提示用 freestyleAvailable 如实说明"无禁手本该用 f15、没铺开后回落 r15"。 */
export const nativeKataRule = () => ({ rule: kataRule, freestyleAvailable: kataFreestyleAvailable });

/** prepare 之后刷新档位可用性：check() 跑在 prepare() 之前，装机后首启时资产还没铺开，
 *  会把大网档误报成「本机不可用」（真机首启实测到过）。铺完再报一次就准了。 */
const refreshKataProfileAvailability = async (): Promise<void> => {
  const api = kataPlugin();
  if (!api?.check) return;
  try {
    const info = await api.check();
    if (typeof info.profile === "string" && info.profile) kataProfile = info.profile;
    kataProfileAvailability = { zz: info.zzAvailable === true };
    if (info.rule === "renju" || info.rule === "freestyle") kataRule = info.rule;
    kataFreestyleAvailable = info.freestyleAvailable === true;
  } catch { /* 刷新失败就沿用旧值，不影响引擎本身 */ }
};

/** 切换引擎档位（原生侧写 engine.choice）。**改档只影响下一次 spawn**：调用方随后必须
 *  重启引擎进程（与 kata 线程/缓存设置变更同一条链路：先取消在算的请求，再停进程）。
 *  返回 false = 本环境没有原生插件（网页版）或原生侧拒绝。 */
export const setNativeKataProfile = async (profile: string): Promise<boolean> => {
  const api = kataPlugin();
  if (!api?.setProfile) return false;
  try {
    const result = await api.setProfile({ profile });
    kataProfile = typeof result?.profile === "string" && result.profile ? result.profile : profile;
    kataDiag("setProfile -> " + kataProfile);
    return true;
  } catch (error) {
    kataDiag("setProfile failed: " + String(error));
    return false;
  }
};

/** 切换引擎**规则贴纸**（原生侧写 engine.rule）。与档位切换完全同构：
 *  只有 renju / freestyle 两个取值，决定自带档用 r15 还是 f15 那张网；
 *  改完只影响下一次 spawn，调用方必须接着重启引擎。
 *  返回 false = 本环境没有原生插件（网页版）或原生侧拒绝。 */
export const setNativeKataRule = async (rule: "renju" | "freestyle"): Promise<boolean> => {
  const api = kataPlugin();
  if (!api?.setRule) return false;
  try {
    const result = await api.setRule({ rule });
    kataRule = result?.rule === "freestyle" ? "freestyle" : "renju";
    kataDiag("setRule -> " + kataRule);
    return true;
  } catch (error) {
    kataDiag("setRule failed: " + String(error));
    return false;
  }
};

/** 把 worker 与 KataGo 原生进程接起来；返回解绑函数（worker terminate 时调用）。
 *  worker 侧消息：kata-start（起进程，先 prepare）→ kata-ready/kata-start-failed；
 *  kata-command（写 stdin）；进程 stdout → kata-stdout，退出 → kata-exit。 */
export const attachKataEngineBridge = (worker: Worker): (() => void) => {
  const api = kataPlugin();
  if (!api) return () => undefined;
  let disposed = false;
  attachedKataWorkers.add(worker);

  const listen = (event: string, handler: (payload: Record<string, unknown>) => void) => {
    return listenToNativeEvent(api, event, handler);
  };

  // stdout/exit 监听只在桥生命周期注册一次：原先每次 kata-start 都重复注册且
  // 从不下掉（detachStdout 被覆盖），重启 N 次后每行输出被转发 N 遍——标定
  // 墙钟、候选统计全被污染（09-26「一直加载中」排查时发现的隐藏 bug）。
  const detachStdout = listen("stdout", (payload) => {
    const line = String(payload.line ?? "");
    // 两件事必须分开：**进度**与**就绪**。真机横幅顺序是
    //   KataGo v1.12.4        ← 进程刚起来就打印（此刻开始初始化/加载模型）
    //   Loaded model …        ← 模型加载完
    //   GTP ready, …          ← 初始化完成，开始读 GTP 命令
    // 旧实现把 `KataGo v` 当成就绪信号，于是 worker 在引擎还没读命令时就发命令、
    // 开始烧搜索预算——短预算（持续分析 2 秒档）下必然「预算耗尽却没有落点」
    // → 报 error → App 判定「引擎启动失败」→ 杀掉正在加载的引擎重启 → 循环。
    // 这正是用户 09-26 报的「1 秒左右弹无法启动」「越走越慢、弹窗不断」。
    // 现在：KataGo v = 进入「加载神经网络」阶段（进度 55%）；GTP ready = 真就绪。
    if (line.startsWith("KataGo v")) {
      worker.postMessage({ type: "kata-phase", phase: "model" });
    }
    if (line.includes("GTP ready")) {
      kataProcessReady = true;
      readySignal?.resolve(true);
    }
    worker.postMessage({ type: "kata-stdout", line });
  });
  const detachExit = listen("exit", (payload) => {
    const intentional = kataStopIntent;
    kataStartOwner = null;        // 进程已退出：持有者作废
    // 进程没了 → 就绪状态与等待者一并作废（下一次启动必须重新等 GTP ready）
    kataProcessReady = false;
    readySignal?.resolve(false);
    worker.postMessage({ type: "kata-exit", code: Number(payload.code ?? -1), intentional });
  });

  const onWorkerMessage = (event: MessageEvent) => {
    const message = (event.data || {}) as { type?: string; line?: string; text?: string; overhead?: number };
    if (message.type === "kata-diag") { kataDiag("worker:" + String(message.text)); return; }
    if (message.type === "kata-command" && typeof message.line === "string") {
      kataDiag("cmd> " + message.line);
      void api.write?.({ line: message.line }).catch((error: unknown) => {
        if (disposed) return;
        kataDiag("cmd-write-error " + String(error));
        // **写入失败 ≠ 进程退出**（09-28 真机定位「换手后卡几十秒」的根因）：
        // Java 侧 write() 在 running=false 时抛「引擎未运行」——而 running 由
        // Java 的 reader 线程在进程结束（或 handleOnDestroy）时置假。真机日志里
        // 一整串 setup 命令（boardsize/clear_board/play/kata-analyze）在 50ms 内
        // **全部**写入失败、随后 worker 把 engine 置空、重新 spawn，命令要等新
        // 进程起来才重发——实测最坏 47.9 秒没有任何一帧输出（面板一直显示上一手
        // 的胜率，用户看到的就是「延迟很大 + 继承上一手胜率」）。
        // 这里改报一条**独立的**信号：worker 侧据此走「原地重连」而不是「判死」。
        worker.postMessage({ type: "kata-write-failed", reason: String(error) });
      });
      return;
    }
    // worker 失败重试链：先把旧进程真正杀掉，下一次 start() 才是全新 spawn
    // （Java start() 对活进程早退复用，不杀的话僵死进程会被永远复用）。
    //
    // **但只允许「启动链的持有者」杀**：并发场景下多个 worker 各发 kata-start，
    // 其中某一个超时/失败时若直接 stop，会把另一个 worker 正在正常标定的健康
    // 进程一并杀掉——后者随即报「进程退出」、重试、再被杀，形成自我制造的失败
    // 循环（真机实测：单次正常启动内引擎被重启一次，PID 26182→26214）。
    // 判定归属：谁真正 spawn 的（或谁持有标定 gate），谁才有权停。
    if (message.type === "kata-stop") {
      if (!kataStartOwner || kataStartOwner === worker) {
        kataStopIntent = true;
        void api.stop?.().catch(() => undefined);
      } else {
        // 非持有者想重试：**不真停进程**，但也别把它判死——进程归持有者，
        // 它等的那份标定结果马上会到（kata-calibrated 会放行 gate）。
        // 这里回一条「稍后重试」，worker 侧据此重新排队，而不是报失败。
        worker.postMessage({ type: "kata-start-deferred", reason: "启动链由其他窗口持有" });
      }
      return;
    }
    // worker 标定完成：缓存 + 持久化，后续 worker/会话不再重复标定。
    if (message.type === "kata-calibrated") {
      const value = Number(message.overhead);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        kataCalibration = value;
        try { localStorage.setItem(KATA_CALIBRATION_KEY, String(value)); } catch { /* best-effort */ }
      }
      // 放行等在这条 gate 上的其他 worker（值拿不到也给 null，让它们自己重试）
      releaseKataGate(Number.isFinite(value) && value >= 0 && value <= 1 ? value : null);
      return;
    }
    if (message.type !== "kata-start") return;
    kataDiag("kata-start received by bridge");
    void (async () => {
      try {
        // 加载阶段上报：worker 转成 engine-loading 给 App 画进度条
        worker.postMessage({ type: "kata-phase", phase: "prepare" });
        const info = await probeNativeKataGo();
        if (disposed) return;
        if (!info?.available) {
          worker.postMessage({ type: "kata-start-failed", reason: "本安装包不包含当前设备可用的 KataGo 引擎" });
          return;
        }
        await api.prepare?.();
        if (disposed) return;
        // 档位可用性是 check() 报的，而 check() 跑在 prepare() **之前**：装机后第一次启动时
        // 资产还没铺开，大网档会被误报成「本机不可用」（真机首启实测到过）。铺完再刷一次。
        await refreshKataProfileAvailability();
        if (disposed) return;
        worker.postMessage({ type: "kata-phase", phase: "start" });
        // 引擎进程是应用级单例，但 worker 有多个（分析槽/对局槽/复盘各自发
        // kata-start）。Java start() 对活进程「早退复用」，于是第二个 worker
        // 会立刻收到就绪并开始**自己的校准**，与第一个 worker 的校准在同一条
        // GTP 流上交错命令、互相污染墙钟（09-26「一直加载中」排查发现）。
        // 这里串行化：进程只真启动一次；标定只指定一个 worker 去做，其余等
        // 它的结果直接复用（拿不到值就重新竞争，见 acquireKataOverhead）。
        if (!kataStartPromise) {
          kataStartPromise = (async () => {
            // 档位专属入口（2026-10-01 收敛为两档）：命令行在原生侧写死成字面量，
            // JS 只决定「调哪个入口」。档位方法缺失或档位未知时回落自带档 start()，
            // 与原生侧的回落规则一致（原生侧还会再兜一次，两边都不依赖对方正确）。
            const started = kataProfile === "zz" && api.startZz
              ? await api.startZz()
              : await api.start?.();
            // **全新进程必须清掉「已就绪」**：Java 侧若发现旧进程成了残留会先清扫
            // 再 spawn（killStaleEngines），此时进程是新的、还没打 `GTP ready`，
            // 但桥里可能还留着上一轮的 ready 标记 → 误判就绪 → 又把命令发进一个
            // 正在加载的引擎。spawned=false 表示复用了活进程（它早打过 ready）。
            if ((started as { spawned?: boolean } | undefined)?.spawned !== false) {
              kataProcessReady = false;
            }
            kataStopIntent = false;    // 新进程起来了：之前的停止意图已消费
            // **等模型加载完再算就绪**：`api.start()` 只保证进程 spawn 成功，
            // 而引擎还要几秒加载模型（真机横幅：KataGo v → Loaded model →
            // GTP ready）。不等它，worker 就会在引擎还没读命令时开搜、烧完
            // 预算没落点 → 报错 → App 杀引擎重试（用户 09-26 报的循环）。
            const ready = await waitForKataReady();
            if (!ready) throw new Error("KataGo 进程启动后未在预期时间内就绪");
          })().finally(() => { kataStartPromise = null; });
          // 登记持有者：只有真 spawn 的这个 worker 有权在失败时停进程
          kataStartOwner = worker;
        }
        await kataStartPromise;
        if (disposed) return;
        // overhead 为数字 = 直接复用；null = 由本 worker 负责标定并回报
        kataDiag("post kata-ready to worker");
        const overhead = await acquireKataOverhead();
        if (!disposed) worker.postMessage({ type: "kata-ready", overhead });
      } catch (error) {
        if (disposed) return;
        kataDiag("post kata-start-failed " + String(error));
        worker.postMessage({ type: "kata-start-failed", reason: error instanceof Error ? error.message : String(error) });
      }
    })();
  };

  worker.addEventListener("message", onWorkerMessage);
  return () => {
    disposed = true;
    attachedKataWorkers.delete(worker);
    worker.removeEventListener("message", onWorkerMessage);
    detachStdout();
    detachExit();
    // **不在这里停进程**（与 Rapfi 桥同理，这里代价更大）：katago 常驻 ~800MB、
    // 冷加载 6 秒，worker 重建时 SIGKILL 会让它每次从零重来，形成「起了就死」的
    // 死循环（用户 09-26 报的「一直加载中」根因）。进程归 App 显式管。
  };
};
