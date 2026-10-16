// @vitest-environment jsdom
/**
 * 原生引擎桥的生命周期测试（Rapfi + KataGo）。
 *
 * 锁住两个 2026-09-26 排查出来的根因——它们的共同点是「rapfi 看不出来、
 * katago 必犯」，因为 katago 要 ~800MB / 6 秒才加载完，任何一次中途被杀
 * 都会让它永远卡在「加载中」：
 *
 *  1. 桥在解绑（worker 被 terminate/重建）时**不得**杀引擎进程。原生进程是
 *     应用级单例（分析槽 2 个预热 worker + 对局 + 复盘共用），App 里 17 处
 *     worker 重建，任何一处都会 SIGKILL 掉正在加载的 katago → 起了就死。
 *  2. 多个 worker 并发 kata-start 时，进程只真启动一次、标定只由其中一个
 *     跑，其余复用结果。否则 Java start() 对活进程早退返回「已就绪」，
 *     每个 worker 都以为轮到自己，几条校准在同一条 GTP 流上交错。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 真实 @capacitor/core 在 jsdom 里 isNativePlatform() 恒为 false，插件永远取不到；
// 与 file-destination 系列测试同一套做法：整体 mock 掉，让桥读到我们塞的假插件。
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {},
  },
}));

interface FakeCall { type: string; [key: string]: unknown }

/** 最小插件假实现：记录调用、可注入监听器事件。 */
function makePlugin() {
  const calls: string[] = [];
  const listeners = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
  let running = false;
  let spawns = 0;
  const api = {
    calls,
    get spawns() { return spawns; },
    emit: (event: string, payload: Record<string, unknown>) => {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
    check: vi.fn(async () => { calls.push("check"); return { available: true, payloadReady: true, abi: "arm64-v8a", cores: 8 }; }),
    prepare: vi.fn(async () => { calls.push("prepare"); return { ready: true, dir: "/x" }; }),
    // spawned 与真实插件同语义：复用在跑的进程时 false（进程不会再打一遍 GTP ready）
    start: vi.fn(async () => { calls.push("start"); const spawned = !running; if (spawned) spawns += 1; running = true; return { running: true, spawned }; }),
    write: vi.fn(async () => { calls.push("write"); }),
    stop: vi.fn(async () => { calls.push("stop"); running = false; }),
    isRunning: () => running,
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    addListener: (event: string, handler: (payload: Record<string, unknown>) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      return { remove: async () => { set.delete(handler); } };
    },
  };
  return api;
}

function makeWorker() {
  const posted: FakeCall[] = [];
  const handlers: Array<(event: { data: unknown }) => void> = [];
  const worker = {
    posted,
    terminated: 0,
    postMessage: (message: FakeCall) => { posted.push(message); },
    addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => { handlers.push(handler); },
    removeEventListener: (_type: string, handler: (event: { data: unknown }) => void) => {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    terminate: () => { worker.terminated += 1; },
    deliver: (data: FakeCall) => { for (const handler of [...handlers]) handler({ data }); },
    hasListeners: () => handlers.length,
  };
  return worker;
}

const installPlugins = (engine: ReturnType<typeof makePlugin>, kata: ReturnType<typeof makePlugin>) => {
  // 桥的 bridge() 读 globalThis.Capacitor（Capacitor 桥是页面注入的），
  // 与上面 mock 的 @capacitor/core 一起构成了完整环境。
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: { NativeEngine: engine, NativeKataGo: kata },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let currentEngine: ReturnType<typeof makePlugin>;
let currentKata: ReturnType<typeof makePlugin>;

beforeEach(() => {
  // 探针结果是**模块级缓存**，每个用例都要拿干净模块，否则第二个用例会
  // 复用第一个的 kataProbed（表现为 check/start 根本没被调用）。
  vi.resetModules();
  currentEngine = makePlugin();
  currentKata = makePlugin();
  installPlugins(currentEngine, currentKata);
});

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe("原生引擎桥的生命周期", () => {
  it.each(["native", "kata"] as const)("removes %s listeners whose handles resolve before detach", async (kind) => {
    const plugin = kind === "native" ? currentEngine : currentKata;
    const addListener = plugin.addListener;
    plugin.addListener = ((event: string, handler: (payload: Record<string, unknown>) => void) => Promise.resolve(addListener(event, handler))) as unknown as typeof plugin.addListener;
    const api = await import("./native-engine");
    const worker = makeWorker();
    const detach = kind === "native" ? api.attachNativeEngine(worker as unknown as Worker) : api.attachKataEngineBridge(worker as unknown as Worker);
    await flush();
    detach();
    await flush();
    expect(plugin.listenerCount("stdout")).toBe(0);
    expect(plugin.listenerCount("exit")).toBe(0);
  });

  it.each(["native", "kata"] as const)("does not spawn %s after a pending prepare is detached", async (kind) => {
    const plugin = kind === "native" ? currentEngine : currentKata;
    let prepared!: (value: { ready: boolean; dir: string }) => void;
    plugin.prepare.mockImplementation(() => new Promise((resolve) => { prepared = resolve; }));
    const api = await import("./native-engine");
    const worker = makeWorker();
    const detach = kind === "native" ? api.attachNativeEngine(worker as unknown as Worker) : api.attachKataEngineBridge(worker as unknown as Worker);
    worker.deliver({ type: `${kind}-start` });
    await flush();
    detach();
    const count = worker.posted.length;
    prepared({ ready: true, dir: "/x" });
    await flush();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(worker.posted).toHaveLength(count);
  });

  it.each(["native", "kata"] as const)("marks planned %s exit as intentional for every attached worker", async (kind) => {
    const api = await import("./native-engine");
    const workers = [makeWorker(), makeWorker()];
    const detach = workers.map((worker) => kind === "native" ? api.attachNativeEngine(worker as unknown as Worker) : api.attachKataEngineBridge(worker as unknown as Worker));
    if (kind === "native") await api.stopNativeEngine();
    else await api.stopNativeKataGo();
    (kind === "native" ? currentEngine : currentKata).emit("exit", { code: 0 });
    expect(workers.map((worker) => worker.posted.find((message) => message.type === `${kind}-exit`)?.intentional)).toEqual([true, true]);
    detach.forEach((remove) => remove());
  });
  it("解绑 worker 时不停引擎进程（katago 起了就死的根因）", async () => {
    const kata = currentKata;
    const { createEngineWorker } = await import("./native-engine");
    const worker = makeWorker();
    // 直接用 attach 系列（createEngineWorker 会 new Worker，jsdom 里没有真实脚本）
    const api = await import("./native-engine");
    const detachKata = api.attachKataEngineBridge(worker as unknown as Worker);

    worker.deliver({ type: "kata-start" });
    await flush();
    await flush();
    expect(kata.calls).toContain("start");

    // 模拟 App 重建 worker（Slot 换局面 / 页面切换）：解绑 + terminate
    detachKata();
    (worker as unknown as { terminate: () => void }).terminate();
    await flush();
    // 关键断言：不得调用 stop（进程必须活下来，否则正在加载的 katago 从零重来）
    expect(kata.calls).not.toContain("stop");
    void createEngineWorker;
  });

  it("并发 kata-start：进程只启动一次，标定只由一个 worker 跑", async () => {
    const kata = currentKata;
    const api = await import("./native-engine");
    const a = makeWorker();
    const b = makeWorker();
    const detachA = api.attachKataEngineBridge(a as unknown as Worker);
    const detachB = api.attachKataEngineBridge(b as unknown as Worker);

    a.deliver({ type: "kata-start" });
    b.deliver({ type: "kata-start" });
    await flush();
    await flush();
    // 单例进程只 spawn 一次
    expect(kata.calls.filter((call) => call === "start").length).toBe(1);
    // 进程 spawn ≠ 就绪：必须等引擎打出 `GTP ready`（模型加载完）才发给 worker。
    // 此前只要 spawn 就宣布就绪，worker 在引擎还没读命令时开搜、烧完预算没落点，
    // 被 App 判成「启动失败」→ 杀引擎重试（用户 09-26 报的循环）。
    const readyOf = (w: ReturnType<typeof makeWorker>) => w.posted.filter((m) => m.type === "kata-ready");
    expect([...readyOf(a), ...readyOf(b)].length).toBe(0);
    // 模拟引擎横幅：KataGo v（进程已起、开始加载模型 —— **不算就绪**，只推进度）
    kata.emit("stdout", { line: "KataGo v1.12.4" });
    await flush();
    expect([...readyOf(a), ...readyOf(b)].length).toBe(0);
    expect(a.posted.concat(b.posted).some((m) => m.type === "kata-phase" && m.phase === "model")).toBe(true);
    // GTP ready（初始化完成、开始读命令）才是真正就绪
    kata.emit("stdout", { line: "GTP ready, beginning main protocol loop" });
    await flush();
    await flush();
    // 只有一个 worker 拿到「你去标定」（overhead: null），另一个挂起等结果
    const first = [...readyOf(a), ...readyOf(b)];
    expect(first.length).toBe(1);
    expect(first[0].overhead).toBeNull();

    // 标定者回报 → 另一个 worker 拿到复用值就绪，且不再要求自己标定
    a.deliver({ type: "kata-calibrated", overhead: 0.12 });
    await flush();
    await flush();
    const second = [...readyOf(a), ...readyOf(b)];
    expect(second.length).toBe(2);
    const reused = second.find((m) => m.overhead !== null);
    expect(reused?.overhead).toBeCloseTo(0.12, 3);
    detachA();
    detachB();
    // 解绑不得停进程（同上）
    expect(kata.calls).not.toContain("stop");
  });

  it("复用活进程的后来者立即可用（不必重等 GTP ready）", async () => {
    // 进程是应用级单例：第一个 worker 等 `GTP ready` 就绪后，后来者（换局面、
    // 新开对局、复盘）发 kata-start 时 Java 会**复用**活进程（spawned=false），
    // 而 `GTP ready` 不会再打一遍——若把「新的 start 调用」一律当成新进程去等，
    // 后来者就会空等一轮超时才报失败（用户会看到「启动失败」的假警报）。
    const kata = currentKata;
    const api = await import("./native-engine");
    const first = makeWorker();
    const detachFirst = api.attachKataEngineBridge(first as unknown as Worker);
    first.deliver({ type: "kata-start" });
    await flush();
    kata.emit("stdout", { line: "KataGo v1.12.4" });
    kata.emit("stdout", { line: "GTP ready, beginning main protocol loop" });
    await flush();
    await flush();
    expect(first.posted.filter((m) => m.type === "kata-ready").length).toBe(1);
    // 第一个 worker 完成标定并回报（真实流程：它拿到 overhead=null 后自己跑标定）
    first.deliver({ type: "kata-calibrated", overhead: 0.1 });
    await flush();

    // 后来者：进程还活着 → 复用 → 必须立刻就绪（不等新横幅、也不重复标定）
    const later = makeWorker();
    const detachLater = api.attachKataEngineBridge(later as unknown as Worker);
    later.deliver({ type: "kata-start" });
    await flush();
    await flush();
    expect(later.posted.filter((m) => m.type === "kata-ready").length).toBe(1);
    // **真正 spawn 只发生过一次**（后来者的 start() 是复用探测，spawned=false）
    expect(kata.spawns).toBe(1);
    expect(later.posted.filter((m) => m.type === "kata-start-failed")).toEqual([]);
    detachFirst();
    detachLater();
  });

  it("引擎在 GTP ready 前退出时不能伪装成已就绪", async () => {
    const kata = currentKata;
    const api = await import("./native-engine");
    const worker = makeWorker();
    const detach = api.attachKataEngineBridge(worker as unknown as Worker);

    worker.deliver({ type: "kata-start" });
    await flush();
    await flush();
    expect(kata.calls).toContain("start");

    // 进程已 spawn，但模型加载/初始化阶段就退出；此时绝不能发送 kata-ready。
    kata.emit("exit", { code: 139 });
    await flush();
    await flush();
    expect(worker.posted.filter((m) => m.type === "kata-ready")).toEqual([]);
    expect(worker.posted.some((m) => m.type === "kata-start-failed")).toBe(true);

    detach();
  });

  it("非持有者 worker 的重试不得停掉别人正在用的引擎", async () => {
    // 真机症状（2026-09-26）：单次正常启动内引擎被重启一次（PID 26182→26214）——
    // 并发 kata-start 下，某个 worker 超时/失败发 kata-stop 就把另一个 worker
    // 正在标定的健康进程杀了，后者随即报「进程退出」并重试，自我制造失败循环。
    // 规则：只有真正 spawn 进程的那个 worker（持有者）有权停。
    const kata = currentKata;
    const api = await import("./native-engine");
    const owner = makeWorker();
    const other = makeWorker();
    const detachOwner = api.attachKataEngineBridge(owner as unknown as Worker);
    const detachOther = api.attachKataEngineBridge(other as unknown as Worker);

    owner.deliver({ type: "kata-start" });     // 持有者：真 spawn
    await flush();
    await flush();
    expect(kata.calls.filter((call) => call === "start").length).toBe(1);

    // 非持有者失败重试：不得真停进程，也不能被判死——回「稍后复用」让它可以续等
    other.deliver({ type: "kata-stop" });
    await flush();
    expect(kata.calls).not.toContain("stop");
    const deferred = other.posted.filter((m) => m.type === "kata-start-deferred");
    expect(deferred.length).toBe(1);
    expect(other.posted.filter((m) => m.type === "kata-start-failed")).toEqual([]);

    // 持有者失败重试：允许真停（否则僵死进程会被 Java 永远复用）
    owner.deliver({ type: "kata-stop" });
    await flush();
    expect(kata.calls.filter((call) => call === "stop").length).toBe(1);
    detachOwner();
    detachOther();
  });

  it("计划内 stop 与计划内 exit 都不上报为崩溃", async () => {
    const kata = currentKata;
    const api = await import("./native-engine");
    const worker = makeWorker();
    const detach = api.attachKataEngineBridge(worker as unknown as Worker);
    worker.deliver({ type: "kata-start" });
    await flush();
    await flush();
    // App 显式停引擎（切换/设置重启）→ 通知所有挂着的 worker
    await api.stopNativeKataGo();
    expect(kata.calls).toContain("stop");
    const stopped = worker.posted.filter((m) => m.type === "kata-stopped");
    expect(stopped.length).toBe(1);
    // 进程随后真的退出：带 intentional 标记，App 不该看到崩溃报错
    kata.emit("exit", { code: 0 });
    const exit = worker.posted.filter((m) => m.type === "kata-exit").pop();
    expect(exit?.intentional).toBe(true);
    detach();
  });
});
