/**
 * KataGo worker 变体（rapfi-worker.js 的 kata 分支）集成测试。
 *
 * worker 是自包含脚本（public/，非打包模块），测试方式：读源码放进伪造的
 * worker 沙箱（self/postMessage/importScripts 打桩），驱动消息流验证：
 *   1. warmup(analyze 请求) 带 engine:"kata" → 走 kata-start → 模拟引擎应答
 *      完成标定 → ready(variant:"kata")；
 *   2. analyze 落子：runKata 的 GTP 命令序列正确（boardsize/clear_board/
 *      kata-set-rule/play.../time_settings 在同步之后/kata-genmove_analyze），
 *      "= F5" 应答 → result.move 坐标换算正确（GTP 跳 I）且 source:"kata"；
 *   3. 非交替局面（白先）走 kata-set_position 摆子路径；
 *   4. time_settings 的预算 = 档位秒数 − overhead − margin（标定协议 v1）。
 */
// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Posted { type: string; [key: string]: unknown }

/** 沙箱里的假 WebSocket：模拟 iKataGo 云引擎的连接。
 *
 *  为什么需要它：worker 的云引擎走 WebSocket，而 Node 沙箱没有这个全局对象——
 *  没有它，云引擎的用例连「开始连接」都到不了，测不出任何东西（三条例外用例
 *  全卡在这里）。
 *
 *  行为：`connect: true` 时异步触发 onopen；`remoteLines` 里的行由用例通过
 *  `emit()` 主动喂（模拟远端 stdout）。`fail: true` 时触发 onerror。 */
class MockWebSocket {
  static OPEN = 1;
  static last: MockWebSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(public url: string, private options: { connect?: boolean } = {}) {
    MockWebSocket.last = this;
    if (options.connect !== false) {
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
  }
  send(line: string) { this.sent.push(line); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: "closed" }); }
  emit(line: string) { this.onmessage?.({ data: line + "\n" }); }
  failConnection() { this.onerror?.(); }
}

function loadWorkerSandbox() {
  const source = readFileSync(
    new URL("../../../public/rapfi/rapfi-worker.js", import.meta.url),
    "utf8",
  );
  const posted: Posted[] = [];
  const sandbox: Record<string, unknown> = {
    performance,
    URL,
    fetch: async () => ({ ok: false }),
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    setTimeout,
    clearTimeout,
    clearTimeoutSafe: clearTimeout,
    // 云引擎用：默认「能连上」，用例可改 options 或直接 failConnection()
    WebSocket: function (url: string) { return new MockWebSocket(url, { connect: true }); },
  };
  sandbox.self = sandbox;
  sandbox.postMessage = (message: Posted) => { posted.push(message); };
  sandbox.importScripts = () => { throw new Error("wasm 不参与本测试"); };
  const factory = new Function(
    "self", "navigator", "performance", "URL", "fetch", "setTimeout", "clearTimeout", "importScripts", "postMessage", "WebSocket",
    `${source}\n;return self;`,
  );
  factory(sandbox, sandbox.navigator, performance, URL, sandbox.fetch, setTimeout, clearTimeout, sandbox.importScripts, sandbox.postMessage, sandbox.WebSocket);
  const workerSelf = sandbox.self as { onmessage: (event: { data: unknown }) => void };
  return {
    posted,
    send: (data: unknown) => workerSelf.onmessage({ data }),
    find: (type: string) => posted.find((m) => m.type === type),
    last: (type: string) => [...posted].reverse().find((m) => m.type === type),
    commands: () => posted.filter((m) => m.type === "kata-command").map((m) => String(m.line)),
    socket: () => MockWebSocket.last,
  };
}

/** 命令泵：模拟引擎进程——**按顺序**应答每一条命令：
 *   · setup 命令（boardsize/clear_board/kata-set-rule/play/kata-set-param）→ 裸 "="；
 *   · `kata-genmove_analyze`（落子轮）→ 先一个前导裸 "="（gtp.cpp 在开搜前先打
 *     一个 "="，真机日志可见），搜索结束后回 "= <vertex>" 终局行；
 *   · `kata-analyze`（持续分析轮）→ 只有前导 "="，**永远不产生终局行**（analyze
 *     路径不落子、无 play 行）——后续 info 行由用例自己喂。
 *  真机 stdout 就是这个顺序，worker 的「待收输出窗口」（kataSetupAcks）按此关闭。 */
function makePump(worker: ReturnType<typeof loadWorkerSandbox>) {
  const isGen = (line: string) => line.startsWith("kata-genmove_analyze") || line.startsWith("genmove");
  const isAnalyze = (line: string) => line.startsWith("kata-analyze") || line.startsWith("lz-analyze") || line.startsWith("analyze");
  const isSearch = (line: string) => isGen(line) || isAnalyze(line);
  // serviced 跨调用共享：只对尚未应答的命令应答（每轮调用都从 0 重数会把未应答
  // 的新命令误判成已处理，泵就永远等不到目标）。
  let serviced = 0;
  return async function pump(genmoveReply: string, newRounds: number): Promise<boolean> {
    let rounds = 0;
    let idle = 0;
    for (let i = 0; i < 2000 && rounds < newRounds; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const commands = worker.commands();
      if (serviced >= commands.length) {
        // 连续多轮没有新命令：本轮走了早退路径（超限/无法表达等，只报错不发
        // 搜索命令），立即返回——别让泵空转到上限（那会把用例拖成 20 秒超时）。
        idle += 1;
        if (idle > 20) return false;
        continue;
      }
      idle = 0;
      while (serviced < commands.length && rounds < newRounds) {
        const line = commands[serviced];
        serviced += 1;
        if (isSearch(line)) {
          // 搜索前导 "="（gtp.cpp 开搜前先打一个）+ 其后的格式空行
          worker.send({ type: "kata-stdout", line: "=" });
          worker.send({ type: "kata-stdout", line: "" });
          rounds += 1;
          // 只有落子轮才有终局行；持续分析轮（kata-analyze）永不自行收尾。
          if (isGen(line)) worker.send({ type: "kata-stdout", line: `= ${genmoveReply}` });
        } else {
          worker.send({ type: "kata-stdout", line: "=" });
          worker.send({ type: "kata-stdout", line: "" });     // 真机每条 = 后跟一个空行
        }
      }
    }
    return rounds >= newRounds;
  };
}

async function warmupKata(worker: ReturnType<typeof loadWorkerSandbox>) {
  worker.send({ type: "kata-ready" });
  const pump = makePump(worker);
  // E 项：不再标定——kata-ready 一到就绪（固定余量 0.15s，见 startKataVariant），
  // 没有 4 轮 genmove 要喂，直接确认 ready 即可。
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(worker.find("ready")).toMatchObject({ variant: "kata" });
  return pump;
}

describe("rapfi-worker kata 变体", () => {
  it("warmup starts KataGo without an analysis request and ignores the old Rapfi exit", async () => {
    const worker = loadWorkerSandbox();
    worker.send({ type: "warmup", engine: "kata", native: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("kata-start")).toBeTruthy();
    worker.send({ type: "native-exit", code: 0 });
    await warmupKata(worker);
    expect(worker.find("error")).toBeUndefined();
    expect(worker.commands()).toEqual([]);
    worker.send({ type: "kata-exit", code: 9 });
    expect(worker.last("error")?.message).toContain("code 9");
  });

  it("Rapfi warmup and readiness survive an unrelated KataGo exit", async () => {
    const worker = loadWorkerSandbox();
    worker.send({ type: "warmup", engine: "light", native: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("native-start")).toBeTruthy();
    worker.send({ type: "kata-exit", code: 9 });
    worker.send({ type: "native-ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("ready")).toMatchObject({ variant: "native" });
    worker.send({ type: "kata-exit", code: 9 });
    expect(worker.find("error")).toBeUndefined();
    worker.send({ type: "native-exit", code: 9 });
    expect(worker.last("error")?.message).toContain("code 9");
  });

  it("does not let the old Rapfi exit interrupt a native-to-KataGo switch", async () => {
    const worker = loadWorkerSandbox();
    worker.send({ type: "warmup", engine: "light", native: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    worker.send({ type: "native-ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("ready")).toMatchObject({ variant: "native" });
    worker.send({
      type: "analyze", requestId: "switch", generation: 2, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 1000, topN: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("kata-start")).toBeTruthy();
    worker.send({ type: "native-exit", code: 0 });
    expect(worker.find("error")).toBeUndefined();
    worker.send({ type: "kata-ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.last("ready")).toMatchObject({ variant: "kata" });
  });

  it("an active KataGo analysis survives the previous Rapfi process exiting", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "switch-kata", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", continuous: true, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pump = await warmupKata(worker);
    await pump("F5", 1);
    worker.send({ type: "native-exit", code: 0 });
    worker.send({ type: "kata-stdout", line: "info move F5 visits 40 winrate 5500 prior 1000 order 0 pv F5" });
    expect(worker.last("progress")).toMatchObject({ requestId: "switch-kata", variant: "kata" });
    expect(worker.find("error")).toBeUndefined();
    worker.send({ type: "stop" });
  });

  it("启动超时足够宽裕，且加载文案如实（不承诺「约几秒」）", async () => {
    // 用户 09-26 报「每次 1 秒左右就说启动失败，我还以为真的失败了呢」。
    // 两件事都要锁住：① 引擎侧启动超时必须是「宁可得等」的量级（90s），
    // 否则慢机/冷机上的正常加载会被误判成失败；② 加载期的文案要如实说明
    // 耗时，让用户知道在正常加载而不是卡死。
    const source = readFileSync(
      new URL("../../../public/rapfi/rapfi-worker.js", import.meta.url),
      "utf8",
    );
    const timeout = source.match(/const KATA_START_TIMEOUT_MS = (\d+);/);
    expect(timeout).toBeTruthy();
    expect(Number(timeout![1])).toBeGreaterThanOrEqual(60000);
    // 文案要提到「较慢」，别只写四个字让人以为卡住；且**不许承诺具体短时长**——
    // 用户 10-08：「既不是首次启动也不是只要几秒，目测我切换要四五十秒」，
    // 旧文案「首次较慢，约几秒」与实际不符，看起来就像卡死。
    expect(source).toMatch(/model: "[^"]*较慢[^"]*"/);
    expect(source).not.toMatch(/model: "[^"]*约几秒[^"]*"/);
    // 慢速升级：加载超过 12 秒要换一句「仍在继续」，长时间等待有明确反馈。
    expect(source).toMatch(/KATA_SLOW_HINT_MS = (\d+)/);
    expect(source).toContain("仍在继续");
  });

  it("不再标定：kata-ready 一到即就绪（E 项，首启省 4 秒）", async () => {
    // 弈境同构：持续制下 maxTime 运行时下发，「每手固定开销」只影响预算制的
    // stop 余量（固定 0.15s），旧流程首启要跑 4 轮 genmove@1s 才就绪——砍掉。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r0", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 2000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("kata-start")).toBeTruthy();
    worker.send({ type: "kata-ready" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 就绪立刻出来（不等标定）；进度条收尾
    expect(worker.find("ready")).toMatchObject({ variant: "kata" });
    const loading = worker.posted.filter((m) => m.type === "engine-loading").pop();
    expect(loading).toMatchObject({ engine: "kata", done: true });
    // 没有任何标定 genmove（排队的请求那一次 genmove 是请求本身，不是标定）
    expect(worker.find("kata-calibrated")).toBeFalsy();
  });

  it("标定完成后以 kata 变体就绪，落子应答换算正确", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 2000, topN: 5,
    });
    // 模拟主线程桥：kata-start → 立即 kata-ready；标定 4 轮 + 真实落子各回 "= "
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("kata-start")).toBeTruthy();
    const pump = await warmupKata(worker);
    // 真实落子轮
    await pump("F5", 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = worker.last("result") as { result?: { move?: { row: number; col: number }; source?: string } } | undefined;
    expect(result).toBeTruthy();
    expect(result?.result?.source).toBe("kata");
    // GTP "F5" → 行 15-5=10、列 5（字母 F 跳 I 换算）
    expect(result?.result?.move).toMatchObject({ row: 10, col: 5 });
  });

  it("runKata 的 GTP 命令序列与预算正确（同步在前、time_settings 在后）", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r2", generation: 1, engine: "kata", native: true,
      size: 15,
      moves: [{ row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" }],
      player: "black", rule: "renju", timeMs: 5000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pump = await warmupKata(worker);
    await pump("F5", 1);
    // 标定轮与请求轮共用命令流：lastIndexOf 锁定真实请求的那一轮命令
    const commands = worker.commands();
    const boardsizeIdx = commands.lastIndexOf("boardsize 15");
    const playIdx = commands.map((line) => line.startsWith("play black")).lastIndexOf(true);
    const paramIdx = commands.map((line) => line.startsWith("kata-set-param maxTime")).lastIndexOf(true);
    const genmoveIdx = commands.map((line) => line.startsWith("kata-genmove_analyze")).lastIndexOf(true);
    expect(boardsizeIdx).toBeGreaterThanOrEqual(0);
    expect(playIdx).toBeGreaterThan(boardsizeIdx);
    // 预算必须在棋盘同步之后、genmove 之前（每次搜索前重设 maxTime）
    expect(paramIdx).toBeGreaterThan(playIdx);
    expect(genmoveIdx).toBeGreaterThan(paramIdx);
    expect(commands.some((line) => line.startsWith("kata-set-rule basicrule renju"))).toBe(true);
    expect(commands.some((line) => line === "play black H8")).toBe(true);
    // 绝不用 time_settings（整局绝对时钟语义，真机实测首手只搜 1 个访问）
    expect(commands.some((line) => line.startsWith("time_settings"))).toBe(false);
    // 预算 = 5s − overhead(标定≈0) − margin(≥0.05)，应 < 5 且 ≥ 4.5
    const budget = Number(commands[paramIdx].split(" ").pop());
    expect(budget).toBeGreaterThanOrEqual(4.5);
    expect(budget).toBeLessThan(5);
  });

  it("冷启动等待期不吃搜索预算：排队久也能正常出结果", async () => {
    // 用户 09-26 报「非常容易引擎启动未成功」的真根因：预算时钟从 request.started
    // （**请求入队时刻**）起算，而旗舰冷启动要 ~6 秒加载模型——盘面档位只有 2 秒时，
    // 引擎还在加载、计时器就到期 → 发 stop → 无合法落点 → finish 报 error →
    // App 判定「启动失败」并杀掉正在加载的引擎重试，新进程又从零开始，永远起不来
    // （真机 logcat 实证：start → 2.6s 后 stop(reason=analysis-retry) → start）。
    // 现在 kata 的 deadline 由 markSearchStart 在 GTP setup 发完后才设定，
    // 排队/加载多久都不消耗搜索预算。本用例锁住这个不变式。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "rshort", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju",
      timeMs: 300, topN: 1,   // 极短预算：一旦被加载等待吃掉就必然失败
    });
    // 模拟「模型正在加载」：kata-ready 迟来，请求一直排在池子里
    await new Promise((resolve) => setTimeout(resolve, 900));
    const pump = await warmupKata(worker);
    await pump("F5", 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 关键：不得出现「未返回合法落点」之类的错误
    expect(worker.posted.filter((m) => m.type === "error")).toEqual([]);
    const result = worker.last("result") as { result?: { move?: unknown; source?: string } } | undefined;
    expect(result?.result?.source).toBe("kata");
    expect(result?.result?.move).toBeTruthy();
    // 且 genmove 必须紧跟在 maxTime 之后（预算时钟起点 = setup 发完）
    const commands = worker.commands();
    const paramIdx = commands.map((line) => line.startsWith("kata-set-param maxTime")).lastIndexOf(true);
    const genIdx = commands.map((line) => line.startsWith("kata-genmove_analyze")).lastIndexOf(true);
    expect(genIdx).toBe(paramIdx + 1);
  });

  it("非交替局面（白先、子数相等）用 play 序列把行棋方反色放最后", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r3", generation: 1, engine: "kata", native: true,
      size: 15,
      // 白先局面：黑白各 1 子但轮白走。真机验收确认「下一手 = 最后一颗落子的反色」，
      // 所以把黑子（白方的反色）放最后即可让引擎认为轮到白方；颜色保持真实。
      moves: [{ row: 7, col: 7, player: "black" }, { row: 8, col: 8, player: "white" }],
      player: "white", rule: "renju", timeMs: 2000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pump = await warmupKata(worker);
    await pump("F5", 1);
    const commands = worker.commands();
    const whiteIdx = commands.lastIndexOf("play white J7");
    const blackIdx = commands.lastIndexOf("play black H8");
    expect(whiteIdx).toBeGreaterThanOrEqual(0);
    // 黑子必须排在白子之后（最后一颗 = 白方的反色）
    expect(blackIdx).toBeGreaterThan(whiteIdx);
    // 本构建没有 kata-set_position（真机会回 "? unknown command" 且棋盘为空）
    expect(commands.some((line) => line.startsWith("kata-set_position"))).toBe(false);
  });

  it("缺少行棋方反色子时如实报错（不能拿空盘凑合）", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r4", generation: 1, engine: "kata", native: true,
      size: 15,
      // 只有黑子且轮黑走：白先反色一子都不存在，行棋方无法表达（真实对局不会出现）
      moves: [
        { row: 7, col: 7, player: "black" },
        { row: 8, col: 8, player: "black" },
      ],
      player: "black", rule: "renju", timeMs: 2000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pump = await warmupKata(worker);
    await pump("F5", 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("error")).toBeTruthy();
    // 不得发出任何 play 命令（否则会以错误的行棋方搜索）
    expect(worker.commands().some((line) => line.startsWith("play "))).toBe(false);
  });

  it("盘面超 15 路时纵深守卫报错（不发出非法 GTP 坐标）", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r5", generation: 1, engine: "kata", native: true,
      size: 19, moves: [], player: "black", rule: "renju", timeMs: 2000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pump = await warmupKata(worker);
    await pump("F5", 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("error")).toBeTruthy();
    // 上限守卫必须拦截在命令生成之前：boardsize/play 一律不发（19 路坐标越界）
    expect(worker.commands().some((line) => line === "boardsize 19")).toBe(false);
  });

  it("GTP 字母列含 O（跳 I 后的第 14 列）也能正确换算", async () => {
    // 回归：解析正则曾写成 [A-HJ-NP]，漏掉 O 列——O 列落子会被判非法、
    // 整轮收尾成「引擎未返回合法落点」。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r6", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 2000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pump = await warmupKata(worker);
    await pump("O5", 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = worker.last("result") as { result?: { move?: { row: number; col: number } } } | undefined;
    expect(result?.result?.move).toMatchObject({ row: 10, col: 13 });
  });

  it("真机抓包逐字重现：多候选 + 对称重复 + play 终局行，统计不被弱着覆盖", async () => {
    // 以下 info/play 行取自 2026-09-26 真机（装机后的 katago-onnxcpu）实测输出，
    // 逐字截断自实际抓包：每个 info 行是根节点候选列表的一项，order 0 为最佳着，
    // G8 是 J8 的对称重复（isSymmetryOf），最后一行 order 49 是弱着。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r7", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 3000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await warmupKata(worker);
    // 等 drain 把真实请求发起来（标定 4 轮 + 请求 1 轮 = 第 5 条 genmove 命令）
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const genmoves = worker.commands().filter((line) => line.startsWith("kata-genmove_analyze")).length;
      if (genmoves >= 5) break;
    }
    // 真实应答流（先裸 =，再 info 流，最后 play 行）
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "info move H8 visits 94 utility 0.970294 winrate 0.985147 scoreMean 1.10624 prior 0.0258789 order 0 pv H8 G7 H9" });
    worker.send({ type: "kata-stdout", line: "info move J8 visits 48 utility 0.968043 winrate 0.984022 scoreMean 1.28477 prior 0.0239258 order 1 pv J8 K9 H8" });
    worker.send({ type: "kata-stdout", line: "info move G8 visits 48 utility 0.968043 winrate 0.984022 scoreMean 1.28477 prior 0.0239258 isSymmetryOf J8 order 2 pv G8 F9 H8" });
    worker.send({ type: "kata-stdout", line: "info move L11 visits 1 utility 0.940306 winrate 0.970153 scoreMean 3.38868 prior 0.0090332 order 49 pv L11" });
    worker.send({ type: "kata-stdout", line: "play H8" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = worker.last("result") as { result?: { move?: { row: number; col: number }; winRate?: number; nodes?: number; candidates?: Array<{ move: { row: number; col: number } }> } } | undefined;
    expect(result?.result?.move).toMatchObject({ row: 7, col: 7 });      // H8
    // 根访问数 = 非对称候选之和（H8 94 + J8 48 + L11 1 = 143）。
    // **不是 order 0 的 94**——那是 H8 自己的子节点访问数，不是根节点的。
    // 真机实测两局面：候选之和/引擎自报 Root visits = 0.999 与 0.998，
    // 而 order0 只有 0.78~0.83 倍（面板速度长期偏低 5.96 倍的根因）。
    // 对称重复点 G8（48）必须排除：它与 J8 是同一节点，计入会虚高。
    expect(result?.result?.nodes).toBe(143);
    // 引擎输出就是行棋方视角（SIDETOMOVE 名副其实，两个真机局面交叉验证），原样透传
    expect(result?.result?.winRate).toBeCloseTo(0.9851, 3);
    const moves = (result?.result?.candidates || []).map((c) => `${c.move.row}:${c.move.col}`);
    expect(moves[0]).toBe("7:7");                                        // primary H8
    expect(moves).toContain("7:8");                                      // J8 次强
    // 对称重复点 G8 不得入候选（否则面板出现同值重复项）：G8 = row7,col6
    expect(moves).not.toContain("7:6");
  });

  it("一行多候选（真机真实格式）：每个候选都要带上自己的胜率与计算量", async () => {
    // 用户 09-26 报「只有选点、没有胜率」。真机抓包确认：本构建把**整批候选挤在
    // 同一行**（14 个 `info move …` 连成一串，只有行首有换行；`grep -c '^info move'`
    // = 1，而 `grep -o 'info move' | wc -l` = 14）。旧解析器按「一行一个候选」处理，
    // 于是只有第一个候选拿到 visits/winrate，其余全 undefined → 面板显示「—」。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "roneline", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 3000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await warmupKata(worker);
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (worker.commands().filter((line) => line.startsWith("kata-genmove_analyze")).length >= 5) break;
    }
    // 逐字取自真机抓包：三个候选连成一行（含一个对称重复点 G9）。
    // 信息流前面的裸 "=" 是真机协议里必有的搜索前导应答（gtp.cpp 开搜前先打一个）。
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "info move G7 visits 13 winrate 0.00895376 scoreMean 0.655312 order 0 pv G7 H9 H10 J8 K8 info move G9 visits 13 winrate 0.00895376 scoreMean 0.655312 isSymmetryOf G7 order 1 pv G9 H7 H6 J8 K8 info move F8 visits 7 winrate 0.00604073 scoreMean 0.228077 order 4 pv F8 J7 G9 K8" });
    worker.send({ type: "kata-stdout", line: "play G7" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = worker.last("result") as { result?: { nodes?: number; winRate?: number; candidates?: Array<{ move: { row: number; col: number }; winRate?: number; nodes?: number; pvIndex?: number }> } } | undefined;
    const candidates = result?.result?.candidates || [];
    // 两个真候选都必须在，且**都带有数值**（这正是「只有选点没胜率」的修复点）
    expect(candidates.length).toBe(2);
    for (const candidate of candidates) {
      expect(typeof candidate.winRate).toBe("number");
      expect(typeof candidate.nodes).toBe("number");
    }
    // 第一个是 order 0 的 G7（列 G=6，行 = 15−7 = 8），第二个是 order 4 的 F8（列 F=5，行 7）
    expect(candidates[0].move).toMatchObject({ row: 8, col: 6 });
    expect(candidates[0].nodes).toBe(13);
    expect(candidates[1].move).toMatchObject({ row: 7, col: 5 });
    expect(candidates[1].nodes).toBe(7);
    // 对称重复点 G9 不入候选（列 G=6，行 15−9=6）
    expect(candidates.map((c) => `${c.move.row}:${c.move.col}`)).not.toContain("6:6");
    // 根访问数 = 非对称候选之和（G7 13 + F8 7 = 20）；G9 是 G7 的对称重复，必须排除。
    // 若误把对称点算进来会变成 33（虚高 65%）。
    expect(result?.result?.nodes).toBe(20);
    expect(result?.result?.winRate).toBeCloseTo(0.00895376, 6);
  });

  it("旧分析的迟到收尾行不得 finish 新轮（点一手没反应的根因）", async () => {
    // 用户 09-27 报「点一手，直接没反应了，只有第一次开的时候在计算」。
    // 复现链：换手时新命令打断旧搜索，引擎会把打断的旧搜索的收尾行（play <vertex>）
    // 先吐出来 → 它到达时 active 已是新轮 → 直接 finish 会把刚启动的新轮立刻
    // "完成"（面板永远「思考中」或立刻无候选）。修复：按「待收输出窗口」
    // （kataSetupAcks）判定——窗口内（setup 应答未收完）到达的收尾行必是旧尾巴，
    // 丢弃；第一条 info 会把窗口清零，之后到达的才是本轮终局行。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    // 第一轮：持续分析长跑
    worker.send({
      type: "analyze", requestId: "r1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true, auto: true,
    });
    await tick();
    await warmupKata(worker);
    await tick(100);
    // App cancel → stop（不带 toResult），然后新 analyze（同一 worker）
    worker.send({ type: "stop", requestId: "r1", generation: 2 });
    await tick(0);
    worker.send({
      type: "analyze", requestId: "r2", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju",
      timeMs: 2000, topN: 5, continuous: true, auto: true,
    });
    await tick(120);
    // 旧分析的迟到收尾行（stop 引起，先于新轮应答到达）
    worker.send({ type: "kata-stdout", line: "play G7" });
    await tick(150);
    // **关键**：不得有 result（旧收尾行不能 finish 新轮）
    expect(worker.posted.filter((m) => m.type === "result")).toEqual([]);
    // 新轮正常应答 → 正常 result（裸 "=" 是真机协议里的搜索前导应答）
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "info move J9 visits 80 winrate 0.55 order 0 pv J9" });
    await tick(100);
    worker.send({ type: "kata-stdout", line: "play J9" });
    await tick(200);
    const r2 = worker.last("result") as { requestId?: string; result?: { move?: { row: number; col: number } } } | undefined;
    expect(r2?.requestId).toBe("r2");
    expect(r2?.result?.move).toMatchObject({ row: 6, col: 8 });
  });

  it("换手零延迟：新请求立即上路，不等旧轮跑满预算（对标分析 App 的流畅度）", async () => {
    // 用户 09-26 报「多点了几手后启动越来越慢、还不断弹启动失败」，且对标
    // 「五子棋分析」App「几乎零延迟」。旧流程换手要：stop → 等 500ms 宽限 →
    // finish → 回 result → App 才发新请求；且滚动续算每轮预算 +2s 递增（20s
    // 封顶）——旧轮预算越大、等得越久，这正是「越走越慢」的机制。
    // 引擎侧实锸（gtp.cpp:1288）："Upon any input line at all, stop any analysis"
    // ——收到任何新命令就立刻 stopAndWait 当前分析。所以新请求直接上路即可，
    // 引擎自己打断旧轮；worker 把旧轮立刻置 finished + 回 stopped，不再挡路。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    // 旧局面：20 秒滚动预算（旧实现里换手必须等它跑完或宽限收尾）
    worker.send({
      type: "analyze", requestId: "old", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    await warmupKata(worker);
    await tick(100);
    const commandsBefore = worker.commands().length;
    // 新局面请求进来（旧轮预算还剩 19 秒以上）
    worker.send({
      type: "analyze", requestId: "new", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju",
      timeMs: 2000, topN: 5, continuous: true,
    });
    await tick(50);
    const newCommands = worker.commands().slice(commandsBefore);
    // **零延迟 + 恒全量重摆**：不等旧轮收尾直接原地打断（引擎 any-input-line 机制）；
    // 全量重摆保证引擎盘面精确等于请求局面（增量同步 10-01 实测无收益且引入回归，
    // 见下一条测试的注释）。行棋方不传参，引擎用盘面行棋方。
    expect(newCommands).toEqual([
      "boardsize 15",
      "clear_board",
      "kata-set-rule basicrule renju",
      "play black H8",
      "kata-set-param maxTime 100000",
      "kata-analyze 10",
    ]);
    // 旧轮立刻回 stopped（App 侧据此换手，不需要它的 result）
    expect(worker.posted.some((m) => m.type === "stopped" && m.requestId === "old")).toBe(true);
  });

  it("持续分析换手：全量重摆（增量同步 10-01 实测无收益且有回归，已回退）", async () => {
    // 10-01 实测结论：增量同步 vs 恒重摆的访问量曲线几乎重合（clear_board/play 不清
    // nnCacheTable，重摆只花几毫秒；真正重开搜索的是 kata-analyze 命令本身），而增量
    // 会让 kataSetupAcks 窗口计数错位、info 帧被当旧收尾行吞掉（真机 82 帧 info、
    // 0 条 progress）。因此回到恒全量重摆：盘面绝对可信，代价可忽略。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    const base = [
      { row: 7, col: 7, player: "black" },
      { row: 8, col: 8, player: "white" },
    ];
    worker.send({
      type: "analyze", requestId: "b0", generation: 1, engine: "kata", native: true,
      size: 15, moves: base, player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    await warmupKata(worker);
    await tick(100);
    const before = worker.commands().length;
    worker.send({
      type: "analyze", requestId: "b1", generation: 2, engine: "kata", native: true,
      size: 15, moves: [...base, { row: 9, col: 9, player: "black" }], player: "white",
      rule: "renju", timeMs: 2000, topN: 5, continuous: true,
    });
    await tick(50);
    const commands = worker.commands().slice(before);
    // 全量重摆：boardsize/clear_board/rule + 3 颗子 + 上限 + analyze
    expect(commands).toEqual([
      "boardsize 15",
      "clear_board",
      "kata-set-rule basicrule renju",
      "play black H8",
      "play white J7",
      "play black K6",
      "kata-set-param maxTime 100000",
      "kata-analyze 10",
    ]);
  });

  it("换手时旧搜索的管道残留 info 整行丢弃（落子后旧选点残余的根因，2026-10-01）", async () => {
    // 用户长期反馈「一子落下后旧选点残留，新思考的点会慢慢覆盖旧的，没覆盖前一直
    // 在；小网尤其严重」。机制：换手时新轮 setup 命令经 any-input-line 打断旧搜索，
    // 但旧搜索最后几帧 info 还躺在输出管道里，排在新轮 `=` 应答**之前**到达；旧实现
    // 见到 info 就清零窗口并归给新轮（rememberKataLine 按坐标合并=并集）→ 旧选点
    // 挂着旧数值，要等新搜索恰好访问到同一坐标才被覆盖。协议上新轮自己的 info 必然
    // 在全部 setup `=` 之后 → 「info 且窗口未关」⇔ 旧残行，整行丢弃。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "old", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    const pump = await warmupKata(worker);
    await pump("D4", 1);
    // 旧局面（空盘）的两帧正常输出
    worker.send({ type: "kata-stdout", line: "info move K10 visits 40 winrate 0.91 order 0 pv K10 info move C3 visits 30 winrate 0.88 order 1 pv C3 K10" });
    await tick(60);
    // 换手（下一手）：新轮请求上路，旧轮被置 finished
    worker.send({
      type: "analyze", requestId: "new", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju",
      timeMs: 20000, topN: 5, continuous: true,
    });
    await tick(0);
    // **关键**：新轮 setup 尚未应答（窗口未关）时，旧搜索的残行先到——
    // 必须整行丢弃，不得把 K10/C3 及其旧胜率并入新轮。
    worker.send({ type: "kata-stdout", line: "info move K10 visits 120 winrate 0.95 order 0 pv K10 info move C3 visits 90 winrate 0.9 order 1 pv C3" });
    await pump("D4", 1);
    // 新轮自己的第一帧（D4，胜率 0.52）
    worker.send({ type: "kata-stdout", line: "info move D4 visits 30 winrate 0.52 order 0 pv D4" });
    await tick(120);
    const frames = worker.posted.filter((m) => m.type === "progress");
    const last = frames[frames.length - 1] as { candidates?: { move: { row: number; col: number } }[]; winRate?: number };
    const coords = (last.candidates || []).map((c) => `${c.move.row}:${c.move.col}`);
    expect(coords).not.toContain("5:9");    // K10（旧局面的候选）不得混入
    expect(coords).not.toContain("12:2");   // C3 同上
    expect(coords).toContain("11:3");       // D4（新轮候选）在
    expect(last.winRate).toBeCloseTo(0.52, 5); // 旧残行的 0.95 不得覆盖新轮根胜率
  });

  it("引擎就绪后排空积压只跑最新请求（切换引擎后无数据的死锁根因，2026-10-01）", async () => {
    // 用户报「切换引擎：加载提示完成、引擎也在思考，就是没有信息输出」。机制：重启
    // loading 期到达的请求在 waiting 里排队；就绪后按 FIFO 先跑最旧的「过期代」请求
    // ——持续轮永不自行收尾，其帧又带着 App 已不认的旧 generation（全被丢）→ 引擎
    // 在算、面板无数据；App 以为自己的轮次还在跑、不再发新请求 → 双向死锁。修复：
    // 积压 >1 时只跑最新，其余 stopped 让路。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    // 引擎未就绪（未发 kata-ready）连发两轮：模拟重启 loading 期的排队
    worker.send({
      type: "analyze", requestId: "old", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick(0);
    worker.send({
      type: "analyze", requestId: "new", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju",
      timeMs: 20000, topN: 5, continuous: true,
    });
    await tick(0);
    // 引擎就绪 → drain 放行
    worker.send({ type: "kata-ready" });
    await tick(80);
    // 过期代请求被 stopped 让路
    const stopped = worker.posted.filter((m) => m.type === "stopped") as Array<{ requestId?: string }>;
    expect(stopped.some((m) => m.requestId === "old")).toBe(true);
    // 首个上路的请求就是最新代：摆盘包含它的棋子（FIFO 的话先跑的是空盘 old 轮）
    expect(worker.commands()).toContain("play black H8");
  });

  it("native rapfi 轮次守卫：旧轮收尾残行不得算进新轮（胜率/选点残留根因，2026-10-01）", async () => {
    // 用户报「rapfi 落子后时不时有前面的胜率残留」。机制（设备实测）：native rapfi
    // 被新命令中止后，会把旧搜索的收尾输出（最后几条 INFO + 终局裸坐标）排在 START
    // 的 "OK" 应答**之前**——这些残行若被算进新轮，就是残留；升级 0.43.02 后时间
    // 管理变化让尾巴更长、更容易撞上。修复：本轮 OK 之前的输出一律丢弃（与 kata 的
    // 「首个裸 = 之前丢弃」同构）。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    // 借 kata 放弃路径让 native 变体就绪（既有用例同款）
    worker.send({
      type: "analyze", requestId: "a", generation: 1, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 6, player: "black" }], player: "white", rule: "renju",
      timeMs: 2000, topN: 3, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-start-failed", reason: "x" });
    await tick(30);
    worker.send({ type: "kata-start-failed", reason: "y" });
    await tick(30);
    worker.send({ type: "native-ready", version: "t" });
    await tick(30);
    // 第一轮的边界应答 + 正常帧（旧局面）
    worker.send({ type: "native-stdout", line: "OK" });
    worker.send({ type: "native-stdout", line: "INFO VALUE 1234" });
    await tick(40);
    // 换手：新局面上路 → 旧轮被中止（native 现在也走打断分支），YXSTOP 已发出
    worker.send({
      type: "analyze", requestId: "b", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 6, player: "black" }, { row: 8, col: 8, player: "white" }],
      player: "black", rule: "renju", timeMs: 2000, topN: 3, continuous: true,
    });
    await tick(40);
    const nativeCommands = worker.posted.filter((m) => m.type === "native-command").map((m) => String(m.line));
    expect(nativeCommands).toContain("YXSTOP");
    // 旧轮的真实收尾顺序：残行（含终局坐标）排在 START 的 OK 之前
    worker.send({ type: "native-stdout", line: "INFO VALUE -9999" });
    worker.send({ type: "native-stdout", line: "7,7" });
    worker.send({ type: "native-stdout", line: "OK" });
    // 新轮自己的帧
    worker.send({ type: "native-stdout", line: "INFO VALUE 555" });
    await tick(60);
    const progress = worker.posted.filter((m) => m.type === "progress") as Array<{
      requestId?: string; score?: number; candidates?: Array<{ move: { row: number; col: number } }>;
    }>;
    const bFrames = progress.filter((m) => m.requestId === "b");
    expect(bFrames.length).toBeGreaterThan(0);
    const last = bFrames[bFrames.length - 1];
    expect(last.score).toBe(555);                       // 旧轮尾巴的 -9999 不得覆盖
    const coords = (last.candidates || []).map((c) => `${c.move.row}:${c.move.col}`);
    expect(coords).not.toContain("7:7");                // 旧轮终局坐标 7,7 → row7,col7 不得混入
  });

  it("落子轮之后必须全量重摆（引擎内部真的落子，增量基准不可信）", async () => {
    // gtp.cpp 源码实证：`kata-genmove_analyze` 的 playChosenMove=true → :810
    // bot->makeMove ——引擎盘上会真的落下它自己那一步。此后「引擎盘 = 我们摆的
    // 局面」这个增量同步的假设就不成立（会多一颗幽灵子、行棋方错位，分析整体
    // 失真）。所以落子轮之后必须全量重摆；持续分析改用 kata-analyze（不落子）
    // 后正常路径不受影响（见下一个用例）。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "g1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 5000, topN: 1, finishOnBareMove: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    expect(worker.commands()).toContain("kata-genmove_analyze");
    const before = worker.commands().length;
    // 局面延伸（黑 H8 已落）：若沿用「引擎盘 = 空盘」的错误假设，只会发 1 条 play
    worker.send({
      type: "analyze", requestId: "g2", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju",
      timeMs: 5000, topN: 1, continuous: true,
    });
    await tick(50);
    const commands = worker.commands().slice(before);
    expect(commands).toContain("boardsize 15");
    expect(commands).toContain("clear_board");
    expect(commands).toContain("play black H8");
  });

  it("同行多候选一次全部冒出（对标 rapfi，不逐个出现）", async () => {
    // 用户 09-26 报「选点一个个冒而不是直接全部冒出来，对比 rapfi 弱爆了」。
    // 根因：同行多候选被切分后**逐条**走 parseKataRecord → 每条各发一次 progress，
    // 节流器（100ms）只放行第一条——同行的其余候选要等 finish 才出现。
    // 修复：整行解析完再发**一次** progress（emitKataProgress），全部候选同帧。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "oneshot", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 3000, topN: 5, continuous: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await warmupKata(worker);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const framesBefore = worker.posted.filter((m) => m.type === "progress").length;
    // 一行含 3 个候选（真机格式；前面的裸 "=" 是真机必有的搜索前导应答）
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "info move A1 visits 100 winrate 0.9 order 0 pv A1 B2 info move B3 visits 80 winrate 0.8 order 1 pv B3 C4 info move C5 visits 60 winrate 0.7 order 2 pv C5 D6" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const frames = worker.posted.filter((m) => m.type === "progress").slice(framesBefore) as Array<{ type: string; candidates?: Array<unknown> }>;
    expect(frames.length).toBe(1);                       // 只发一次
    expect(frames[0].candidates?.length).toBe(3);        // 三个候选同帧出现
  });

  it("做题场景：胜率饱和即发 stop（已证胜不白等预算）", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r9", generation: 1, engine: "kata", native: true,
      size: 15,
      moves: [{ row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" }],
      player: "black", rule: "renju", timeMs: 5000, topN: 1,
      finishOnBareMove: true, stopOnProvenWin: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await warmupKata(worker);
    // 等真实请求挂起后，喂一条饱和胜率的 info 行（前面的裸 "=" 是真机必有的搜索前导应答）
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (worker.commands().filter((line) => line.startsWith("kata-genmove_analyze")).length >= 5) break;
    }
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "info move H8 visits 900 winrate 0.9997 scoreMean 12.0 order 0 pv H8 G7" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 必须发出 GTP stop（而不是继续等满 5 秒预算）
    expect(worker.commands().some((line) => line === "stop")).toBe(true);
    worker.send({ type: "kata-stdout", line: "play H8" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = worker.last("result") as { result?: { move?: { row: number; col: number } } } | undefined;
    expect(result?.result?.move).toMatchObject({ row: 7, col: 7 });
  });

  it("不再标定：持续制下发安全上限且不自行收尾（弈境同构）", async () => {
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r8", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 2000, topN: 5,
      continuous: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    worker.send({ type: "kata-ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.find("ready")).toMatchObject({ variant: "kata" });
    const commands = worker.commands();
    // 持续制：下发极大安全上限（等价弈境的 maxTime 1e10）——引擎持续搜索、每 0.4s
    // 一帧 info，只被新命令/stop 打断，不按 cfg 的 30s 自行收尾（自收尾的收尾行
    // 归属歧义曾是死锁来源，且每 30s 白扔一次「收尾+重启」往返）。
    expect(commands).toContain("kata-set-param maxTime 100000");
    expect(commands.filter((line) => line.startsWith("kata-analyze")).length).toBe(1);
    expect(commands).toContain("kata-analyze 10");
    expect(worker.find("kata-calibrated")).toBeFalsy();
  });

  it("stop 后新一轮必须仍能收尾（旧布尔守卫被永久污染的死锁回归）", async () => {
    // 09-27 真机定位的根因：旧实现用布尔标志「丢掉下一个收尾行」防旧尾巴污染新轮，
    // 但 stop 之后 active 已为空、旧收尾行到达时被 `!active` 提前丢弃——标志没人
    // 消费、永久残留，把**下一轮真正的收尾行**吃掉：那一轮永远不 finish、面板永远
    // 「思考中」、引擎空转。真机日志实锤：第一轮 `play G7` 之后再无任何 analyze 完成。
    // 现在按「待收输出窗口」计数（见 kataSetupAcks），窗口最迟被第一条 info 清零。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "a", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    // 第一轮 setup 应答 + 第一帧 info
    for (const line of ["=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    worker.send({ type: "kata-stdout", line: "info move H8 visits 100 winrate 0.6 order 0 pv H8" });
    await tick(120);
    expect(worker.last("progress")).toBeTruthy();
    // 用户停止（换手/关开关 → App 侧 cancel → stop）：引擎吐旧收尾行，
    // 此刻 active 已为空——旧实现的标志就在这里被永久污染。
    worker.send({ type: "stop", requestId: "a", generation: 1 });
    worker.send({ type: "kata-stdout", line: "play H8" });
    await tick(20);
    // 新一轮（新局面，增量同步）
    worker.send({
      type: "analyze", requestId: "b", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju",
      timeMs: 20000, topN: 5, continuous: true,
    });
    await tick(50);
    // 逐条应答 setup（play + maxTime 两条裸 "="），再喂 info 与终局行——真机顺序
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "info move K6 visits 60 winrate 0.7 order 0 pv K6" });
    worker.send({ type: "kata-stdout", line: "play K6" });
    await tick(20);
    const result = worker.last("result") as { requestId?: string; result?: { move?: { row: number; col: number } } } | undefined;
    expect(result?.requestId).toBe("b");
    // GTP K6 → 第 6 行（row 9）、K 列（col 9）
    expect(result?.result?.move).toMatchObject({ row: 9, col: 9 });
  });

  it("持续轮不自行收尾：info 持续刷新只发 progress，不发 result", async () => {
    // 弈境同构：持续制下引擎持续搜索（maxTime 十万秒安全上限），只被新命令/stop
    // 打断——不像旧实现按 cfg 的 30s 每轮自行收尾（每 30s 白扔一次往返，且收尾行
    // 的归属歧义正是死锁来源）。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "c", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    for (const line of ["=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    for (let i = 0; i < 6; i += 1) {
      worker.send({ type: "kata-stdout", line: `info move H${8 + i} visits ${100 + i} winrate 0.6 order ${i} pv H${8 + i}` });
      await tick(120);
    }
    expect(worker.find("result")).toBeFalsy();
    expect(worker.posted.filter((m) => m.type === "progress").length).toBeGreaterThanOrEqual(3);
  });

  it("白先局面按白方搜索（行棋方不再硬编码黑方）", async () => {
    // 09-27 真机日志实锤：9 手白先局面下旧实现硬编码 `kata-genmove_analyze black`，
    // 引擎按黑方视角给候选——面板整批选点错位（弃权级错误）。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "w", generation: 1, engine: "kata", native: true,
      size: 15,
      moves: [{ row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" }, { row: 6, col: 7, player: "black" }],
      player: "white", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    // 行棋方不再显式传参：引擎用自己盘面的行棋方（全量重摆后即真实行棋方）
    expect(worker.commands()).toContain("kata-analyze 10");
    expect(worker.commands().some((line) => /^kata-analyze\s+(black|white)/.test(line))).toBe(false);
  });

  it("静默看门狗：搜索静默后自动收尾，面板永不悬挂（自愈兜底）", async () => {
    // 收尾行因任何意外没被认领时，active 会永久悬挂、面板卡「思考中」——旧实现的
    // 实际表现。持续分析下引擎每 0.4s 必出一条 info，静默 6s 只可能是「搜索已结束
    // 但收尾行没认领」，看门狗用当前最强快照收尾（随后 App 的续算开新一轮）。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "silent", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    for (const line of ["=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    // 一帧 info（有候选可收尾），之后引擎「静默」——收尾行永不出现
    worker.send({ type: "kata-stdout", line: "info move H8 visits 120 winrate 0.62 order 0 pv H8" });
    expect(worker.find("result")).toBeFalsy();
    await tick(6600);
    const result = worker.last("result") as { requestId?: string; result?: { move?: { row: number; col: number } } } | undefined;
    expect(result?.requestId).toBe("silent");
    expect(result?.result?.move).toMatchObject({ row: 7, col: 7 });
    // 不得报错（有候选时用快照收尾，而不是宣告失败）
    expect(worker.posted.filter((m) => m.type === "error")).toEqual([]);
  }, 20000);

  it("不限时思考点停止：引擎收尾落点必须交到 App（不能卡住棋局）", async () => {
    // 「不限时思考 → 点停止 → 落当前最强点」是人机对战的停止语义。旗舰收到 GTP
    // stop 后仍会执行 playChosenMove 并打出 `play X`；旧实现在 stop 时立刻把
    // active 置空（`toResult && !unlimited` 把不限时排除在外），那一行被 `!active`
    // 丢掉——App 永远等不到落点，棋局卡死。现在保留 active 等引擎收尾行。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "u1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 0, unlimited: true, topN: 1, finishOnBareMove: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    expect(worker.commands()).toContain("kata-genmove_analyze");
    for (const line of ["=", "=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    worker.send({ type: "kata-stdout", line: "info move H8 visits 500 winrate 0.9 order 0 pv H8" });
    await tick(150);
    expect(worker.find("result")).toBeFalsy();
    // 用户点停止 → App 发 toResult（要落子）→ 引擎收尾打出 play H8
    worker.send({ type: "stop", requestId: "u1", generation: 1, toResult: true });
    worker.send({ type: "kata-stdout", line: "play H8" });
    await tick(50);
    const result = worker.last("result") as { requestId?: string; result?: { move?: { row: number; col: number } } } | undefined;
    expect(result?.requestId).toBe("u1");
    expect(result?.result?.move).toMatchObject({ row: 7, col: 7 });
  });

  it("不限时停止后引擎迟迟不吐落点：宽限到期用进度快照兜底", async () => {
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "u2", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 0, unlimited: true, topN: 1, finishOnBareMove: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    for (const line of ["=", "=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    worker.send({ type: "kata-stdout", line: "info move J9 visits 300 winrate 0.8 order 0 pv J9" });
    await tick(150);
    worker.send({ type: "stop", requestId: "u2", generation: 1, toResult: true });
    // 引擎收尾行始终不来 → 2s 宽限到期用快照落子（不是永远挂着）
    await tick(2300);
    const result = worker.last("result") as { requestId?: string; result?: { move?: { row: number; col: number } } } | undefined;
    expect(result?.requestId).toBe("u2");
    // GTP J9 → 第 9 行（row 6）、J 列（col 8）
    expect(result?.result?.move).toMatchObject({ row: 6, col: 8 });
  });

  it("胜率视角：引擎输出即行棋方视角，worker 原样透传", async () => {
    // 引擎恒输出**行棋方视角**（2026-09-30 行棋方无歧义的矩阵实验定案）。
    // 09-27 那次「SIDETOMOVE 只在被分析方是黑棋时翻转 → 输出永远是白方视角」的读法是
    // 错的（标定局面其实是白走却被当成黑走），已作废，详见 kata.cfg 的视角段注释。
    // worker 的职责就是**原样透传**：折算在展示层按用途区分——面板直接用原值
    // （标签跟着行棋方走），胜率曲线/复盘才折到黑方视角。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "p1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    for (const line of ["=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    // 黑行棋：引擎输出 0.97（黑方视角）→ 原样透传（若做 1-x 折算会颠倒成 0.03）
    worker.send({ type: "kata-stdout", line: "info move H8 visits 100 winrate 0.97 order 0 pv H8" });
    await tick(150);
    const progress = worker.last("progress") as { winRate?: number } | undefined;
    expect(progress?.winRate).toBeCloseTo(0.97, 6);
    // 白方行棋：引擎输出本来就是行棋方视角，原样通过
    worker.send({
      type: "analyze", requestId: "p2", generation: 2, engine: "kata", native: true,
      size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju",
      timeMs: 20000, topN: 5, continuous: true,
    });
    await tick(50);
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "=" });
    worker.send({ type: "kata-stdout", line: "info move K10 visits 50 winrate 0.62 order 0 pv K10" });
    await tick(150);
    const progress2 = worker.last("progress") as { winRate?: number } | undefined;
    expect(progress2?.winRate).toBeCloseTo(0.62, 6);   // 白行棋：同样透传
  });

  it("0 访问的纯先验着法不进候选（选点不再飘忽、不再飘到远处）", async () => {
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "z1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    for (const line of ["=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    worker.send({ type: "kata-stdout", line: "info move H8 visits 40 winrate 0.6 order 0 pv H8 info move J9 visits 0 winrate 0.5 order 1 pv J9 info move K10 visits 0 winrate 0.4 order 2 pv K10" });
    await tick(150);
    const progress = worker.last("progress") as { candidates?: Array<{ move: { row: number; col: number }; nodes?: number }> } | undefined;
    expect(progress?.candidates?.length).toBe(1);
    expect(progress?.candidates?.[0]?.move).toMatchObject({ row: 7, col: 7 });
  });

  it("速度＝访问/秒（相邻帧增量，不再随轮时增长跌到个位数）", async () => {
    // 持续制下一轮可跑几分钟：旧的「根访问数 ÷ 本轮时长」会一路缩水（用户报
    // 「速度缩水一百倍」）。现在用相邻两帧的访问增量现算。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "s1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 20000, topN: 5, continuous: true,
    });
    await tick();
    worker.send({ type: "kata-ready" });
    await tick(50);
    for (const line of ["=", "=", "=", "="]) worker.send({ type: "kata-stdout", line });
    worker.send({ type: "kata-stdout", line: "info move H8 visits 100 winrate 0.6 order 0 pv H8" });
    await tick(320);                     // 建立速度采样基线（采样窗口 ≥250ms）
    worker.send({ type: "kata-stdout", line: "info move H8 visits 400 winrate 0.6 order 0 pv H8" });
    await tick(150);
    const progress = worker.last("progress") as { speed?: number } | undefined;
    expect(progress?.speed).toBeGreaterThan(200);
  });

  it("启动失败：先真停进程再自动重试一次，再失败才放弃落到 Rapfi", async () => {
    // 回归（用户 09-26 报「几分钟了一直加载中」）：旧逻辑失败后 load() 重试，
    // 而 Java start() 对活进程早退复用——僵死进程被永远复用，且重试无上限，
    // 每隔一阵报一次「启动失败正在重试」永不收敛。新契约：
    //   第 1 次失败 → 发 kata-stop（桥真杀进程）→ 自动重试一次；
    //   第 2 次失败 → 如实放弃（日志「暂时改用 Rapfi」+ 关进度条）→ native 接管。
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.send({
      type: "analyze", requestId: "r10", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 1000, topN: 3,
    });
    await tick();
    expect(worker.find("kata-start")).toBeTruthy();
    // 第 1 次失败：必须先让桥停掉旧进程（kata-stop），再自动重试一次
    worker.send({ type: "kata-start-failed", reason: "模拟启动失败 1" });
    await tick(50);
    expect(worker.posted.some((m) => m.type === "kata-stop")).toBe(true);
    expect(worker.posted.filter((m) => m.type === "kata-start").length).toBe(2);
    // 第 2 次失败：不再重试，放弃并落到 Rapfi（native）
    worker.send({ type: "kata-start-failed", reason: "模拟启动失败 2" });
    await tick(50);
    expect(worker.posted.filter((m) => m.type === "kata-start").length).toBe(2);
    const logs = worker.posted.filter((m) => m.type === "log").map((m) => String(m.message));
    expect(logs.some((line) => line.includes("暂时改用 Rapfi"))).toBe(true);
    expect(worker.posted.some((m) => m.type === "native-start")).toBe(true);
    // 进度条要收尾（done），不能永远停在「加载中」
    const loading = worker.posted.filter((m) => m.type === "engine-loading").pop();
    expect(loading).toMatchObject({ engine: "kata", done: true });
    // Rapfi 就绪 → worker 恢复可用
    worker.send({ type: "native-ready", version: "test" });
    await tick(30);
    expect(worker.last("ready")).toMatchObject({ variant: "native" });
  });

  it("放弃后不自动重试；设置重启/显式切换才给旗舰全新机会", async () => {
    const worker = loadWorkerSandbox();
    const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    const kataStarts = () => worker.posted.filter((m) => m.type === "kata-start").length;
    // 走到放弃（连续两次失败）→ native 接管
    worker.send({
      type: "analyze", requestId: "r11a", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 1000, topN: 3,
    });
    await tick();
    worker.send({ type: "kata-start-failed", reason: "失败 1" });
    await tick(30);
    worker.send({ type: "kata-start-failed", reason: "失败 2" });
    await tick(30);
    worker.send({ type: "native-ready", version: "t" });
    await tick(20);
    expect(worker.last("ready")).toMatchObject({ variant: "native" });
    const abandoned = kataStarts();
    // 放弃状态下继续请求旗舰：不自动重试（每手赌 2×40s 用户等不起）
    worker.send({
      type: "analyze", requestId: "r11b", generation: 2, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 1000, topN: 3,
    });
    await tick(30);
    expect(kataStarts()).toBe(abandoned);
    // 设置变更重启（App 停进程 → kata-stopped）算显式动作：清失败记忆
    worker.send({ type: "kata-stopped" });
    await tick(0);
    worker.send({
      type: "analyze", requestId: "r11c", generation: 3, engine: "strong", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 1000, topN: 3,
    });
    await tick(20);
    worker.send({ type: "native-ready", version: "t2" });
    await tick(20);
    // 用户切走（strong）再切回 katago：显式切换 → 全新机会
    worker.send({
      type: "analyze", requestId: "r11d", generation: 4, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 1000, topN: 3,
    });
    await tick(30);
    expect(kataStarts()).toBe(abandoned + 1);
  });

  it("显式请求 katago 时绝不静默落到 rapfi（误报「改用原生引擎」的回归）", async () => {
    // 用户 09-26 报：每次落子都提示「切换到原生引擎」，但其实 katago 还在加载、
    // 稍后就成功了。根因是 chooseVariant 在「要 kata 但本 worker 未授权」时
    // 落到 native(rapfi) 并打日志说换引擎。这里锁住：请求 kata 时**不得**
    // 出现任何「改用原生/Rapfi」字样，且必须发起 kata-start。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "r12", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 1000, topN: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const logs = worker.posted.filter((m) => m.type === "log").map((m) => String(m.message));
    const misleading = logs.filter((line) => /改用\s*Rapfi|改用原生/.test(line));
    expect(misleading).toEqual([]);
    expect(worker.posted.some((m) => m.type === "kata-start")).toBe(true);
    // 只允许出现「正在重试」这类如实措辞
    for (const line of logs) expect(line).not.toMatch(/改用\s*Rapfi/);
  });
});

describe("iKataGo 云引擎（用户填服务器地址自连）", () => {
  it("云引擎也走 KataGo 解析：候选必须全部显示（不能只剩首选）", async () => {
    // 用户 09-29 报「引擎又没有选点了」。根因：candidateVisible 里只有
    // `activeVariant === "kata"` 走 order 过滤，云引擎落到 Rapfi 分支——那条要求
    // `candidate.depth >= minDepth`，可 KataGo 的 info 帧**根本没有 depth 字段**
    // （恒 undefined → 0），于是除 order 0 之外全部被滤掉，面板只剩一个点。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "cloud1", generation: 1, engine: "ikatago",
      ikatago: { serverUrl: "wss://example.com/ws", username: "u", password: "p", platform: "linux-x64" },
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 3000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 云引擎就绪：远端进程打出 GTP ready（通过假 socket 喂进来）
    await new Promise((resolve) => setTimeout(resolve, 10));
    worker.socket()?.emit("GTP ready, beginning main protocol loop");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(worker.find("ready")).toMatchObject({ variant: "ikatago" });
    // 一帧多候选（真机同款格式：order 0..3，全部没有 depth 字段；
    // 前面的裸 "=" 是真机必有的搜索前导应答）
    worker.socket()?.emit("=");
    worker.socket()?.emit(
      "info move H8 visits 94 winrate 0.985 order 0 scoreMean 0.4 pv H8 G7 "
        + "info move J8 visits 48 winrate 0.984 order 1 scoreMean 0.3 pv J8 K9 "
        + "info move G7 visits 21 winrate 0.90 order 2 scoreMean 0.2 pv G7 H9 "
        + "info move K9 visits 9 winrate 0.85 order 3 scoreMean 0.1 pv K9 L9",
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const progress = worker.last("progress") as { candidates?: unknown[] } | undefined;
    // **核心断言**：四个候选都要在（修 bug 前只有 1 个）
    expect(progress?.candidates?.length).toBe(4);
    // 和棋率随候选一起带出（「选点显示内容=和棋率」要用）
    const first = (progress?.candidates as Array<{ drawRate?: number }>)[0];
    expect(first?.drawRate).toBeCloseTo(0.4, 5);
  });

  it("云引擎用 GTP 命令序列（不是 Rapfi 的 START/INFO）", async () => {
    // 云引擎必须与本地旗舰同构：漏掉 isKataFamily 分流会让它发出 Rapfi 命令，
    // 远端 KataGo 直接回 "? unknown command"，整轮无输出。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "cloud2", generation: 1, engine: "ikatago",
      ikatago: { serverUrl: "wss://example.com/ws", username: "", password: "", platform: "linux-x64" },
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 3000, topN: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 10));
    worker.socket()?.emit("GTP ready, beginning main protocol loop");
    await new Promise((resolve) => setTimeout(resolve, 30));
    // 云引擎的命令走 WebSocket 直发（不经 kata-command 消息），所以看 socket.sent
    const commands = worker.socket()?.sent || [];
    expect(commands.some((line) => line.startsWith("boardsize"))).toBe(true);
    expect(commands.some((line) => line.startsWith("kata-analyze") || line.startsWith("kata-genmove_analyze"))).toBe(true);
    // 绝不能出现 Rapfi 专有命令
    expect(commands.some((line) => /^(START|INFO RULE|INFO THREAD_NUM)\b/.test(line))).toBe(false);
  });

  it("云引擎连不上时不静默降级到本机引擎", async () => {
    // 用户选了「云端算力」，悄悄换成本机算会让他以为云引擎生效了（算力/账单对不上）。
    const worker = loadWorkerSandbox();
    worker.send({
      type: "analyze", requestId: "cloud3", generation: 1, engine: "ikatago",
      ikatago: { serverUrl: "wss://unreachable.invalid/ws", username: "", password: "", platform: "linux-x64" },
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 3000, topN: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 连接失败（DNS/端口/凭据）→ 必须报 error，且不得静默起 Rapfi
    worker.socket()?.failConnection();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const error = worker.last("error") as { message?: string } | undefined;
    expect(String(error?.message || "")).toContain("iKataGo");
    expect(worker.find("ready")?.variant).not.toBe("native");
  });

  it("应用主动停旗舰后（kata-stopped），写入失败不再把它复活——幽灵进程回归钉（2026-10-07 真机）", async () => {
    /* 真机实测：切到 rapfi 后 0.8s，被杀掉的 katago 又被拉起来常驻（~800MB），
       进程表里两套引擎并存、下一次切回旗舰的行为变得不可预期。机制：切走时
       kata-stopped 清了 engine，但在飞请求继续写命令 → 写失败 → 旧的「原地重连」
       无条件 post kata-start（桥收到直接 spawn），另一条经 drain → load() 复活。
       修法：kata-stopped 置 kataStopIntended，堵住两条复活路径，并给被放弃的
       在飞请求发**请求级错误回执**（静默丢弃会让对局永远等不到结果）；
       下一个显式 kata 请求清标记、恢复正常启动。 */
    const worker = loadWorkerSandbox();
    const kataStarts = () => worker.posted.filter((m) => m.type === "kata-start").length;
    worker.send({
      type: "analyze", requestId: "ghost1", generation: 1, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 2000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kataStarts()).toBe(1);
    await warmupKata(worker);                                  // 第一次启动完成（ready(variant:kata)）
    await new Promise((resolve) => setTimeout(resolve, 10));   // 让请求进入在飞（setup 命令已发出、未回落点）
    // 应用切走 rapfi：计划内停进程
    worker.send({ type: "kata-stopped" });
    // 在飞请求写命令失败（进程已死）→ 不得复活进程，且必须回执这条请求
    worker.send({ type: "kata-write-failed", reason: "引擎未运行" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(kataStarts()).toBe(1);                              // 关键断言①：没有新的 kata-start（不复活）
    const receipt = worker.posted.filter((m) => m.type === "error" && m.requestId === "ghost1").pop();
    expect(receipt, "被放弃的在飞请求必须有请求级错误回执").toBeTruthy();   // 关键断言②：不静默挂死
    // 之后用户显式切回旗舰（新的 analyze）→ 标记解除，正常重新启动
    worker.send({
      type: "analyze", requestId: "ghost2", generation: 2, engine: "kata", native: true,
      size: 15, moves: [], player: "black", rule: "renju", timeMs: 2000, topN: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(kataStarts()).toBe(2);                              // 关键断言③：显式请求照常拉起
  });
});
