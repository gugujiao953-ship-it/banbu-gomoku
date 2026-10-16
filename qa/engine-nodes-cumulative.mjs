/**
 * 门禁：持续分析的「节点」必须是本局面跨轮累计量 + 原生引擎的线程数不能被网页版开关压成单线程。
 *
 * 为什么需要（都是 2026-09-15 用户在手机上实测报出来的）：
 *  ① 「速度一直近 100k，节点总量却迟迟不破 1m，十秒才加一秒的量」。持续分析是一轮接一轮
 *     的有界搜索（2s/4s/…/20s），每轮的引擎 INFO TOTALNODES 只是**本轮**的搜索量；热 TT 让
 *     后面的轮省得多（实测同一局面 4 核原生：第 4 轮 8s 搜 1.49M 节点，第 5 轮 10s 只搜
 *     0.28M）。界面为保证「同面续算不闪数字」取历史最大值，于是节点数在某一轮之后再也不会
 *     刷新——引擎满速在跑，数字却冻住。修法：worker 侧跨轮累加（continuousNodesBase）。
 *  ② 「手机常态不到 100k，别人能跑 225k」。原生引擎用真线程、不需要跨源隔离，却被
 *     「多线程引擎」这个**默认关**的网页版实验开关按 threadCountFor → 1 强制单线程。模拟器
 *     实测同一局面 1 线程 109-199k nps、4 线程 230-340k nps。修法：原生不吃那个开关。
 *
 * 这里**不加载真引擎**（也不用浏览器、不用 40MB 包）：每个场景起一个干净的 VM 上下文跑真的
 * worker 代码，往里面注入假引擎 / 假原生桥。好处是确定性——可以让「热 TT」精确复现：同一
 * 局面第二次搜索只搜上次的一半节点。于是
 *   修复前：100k → 50k → 25k（数字越跑越小，界面靠 max 冻住）
 *   修复后：100k → 150k → 175k（真实累计）
 *
 * 用法：node qa/engine-nodes-cumulative.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const engineDir = root + "public/rapfi/";
const workerSource = readFileSync(engineDir + "rapfi-worker.js", "utf8");
const cores = typeof navigator === "object" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;

const failures = [];
const check = (condition, message) => {
  if (condition) console.log(`  ✓ ${message}`);
  else { console.log(`  ✗ ${message}`); failures.push(message); }
};

/** 起一个干净的 worker 上下文。worker 会把引擎变体钉死到实例销毁，所以每个场景必须新起一个。 */
const makeWorker = ({ onPost, importEngine }) => {
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, performance, navigator, URL, TextDecoder, TextEncoder };
  sandbox.self = sandbox;
  sandbox.location = { href: `file:///${engineDir.replaceAll("\\", "/")}rapfi-worker.js` };
  sandbox.postMessage = (message) => onPost(message);
  sandbox.importScripts = () => { if (importEngine) sandbox.Rapfi = importEngine(sandbox); };
  vm.createContext(sandbox);
  vm.runInContext(workerSource, sandbox, { filename: "rapfi-worker.js" });
  return { send: (data) => sandbox.onmessage({ data }), sandbox };
};

// ---- 场景一：持续分析的节点累计（假 wasm 引擎） ------------------------------
// 每搜索一次同一局面，本轮搜索量减半（模拟热 TT）；对外读数应当是各轮搜索量之和。
const FIRST_SEARCH_NODES = 100000;
const roundWorkOf = (count) => Math.round(FIRST_SEARCH_NODES / (2 ** (count - 1)));
let fakeSearch = null;

const importFakeEngine = () => (options) => {
  fakeSearch = { emit: (line) => options.onReceiveStdout(line), size: 15, boardKey: "", counts: new Map(), timers: [] };
  return Promise.resolve({
    sendCommand(command) {
      const text = String(command).trim();
      const start = text.match(/^START\s+(\d+)$/);
      if (start) { fakeSearch.size = Number(start[1]); return; }
      const board = text.match(/^YXBOARD(.*)\s+DONE$/);
      if (board) { fakeSearch.boardKey = board[1]; return; }
      if (/^YXNBEST\s+\d+$/.test(text)) { startSearch(); return; }
      if (text === "YXSTOP") finishSearch();
    },
  });
};

function clearTimers() {
  for (const timer of fakeSearch.timers) clearTimeout(timer);
  fakeSearch.timers = [];
}

function startSearch() {
  clearTimers();
  const count = (fakeSearch.counts.get(fakeSearch.boardKey) || 0) + 1;
  fakeSearch.counts.set(fakeSearch.boardKey, count);
  const work = roundWorkOf(count);
  const steps = 4;
  let total = 0;
  for (let step = 1; step <= steps; step += 1) {
    fakeSearch.timers.push(setTimeout(() => {
      const iterationNodes = Math.round(work / steps);
      total += iterationNodes;
      fakeSearch.emit(`INFO DEPTH ${step * 2}`);
      fakeSearch.emit(`INFO NODES ${iterationNodes}`);
      fakeSearch.emit(`INFO TOTALNODES ${total}`);
      fakeSearch.emit("INFO BESTLINE 7,7");
      if (step === steps) {
        // 引擎宣告本轮答案：MESSAGE Bestline + 裸坐标（worker 在这里收尾）
        fakeSearch.emit("MESSAGE Bestline 7,7");
        fakeSearch.emit("7,7");
      }
    }, step * 5));
  }
}

function finishSearch() {
  clearTimers();
  fakeSearch.emit("MESSAGE Bestline 7,7");
  fakeSearch.emit("7,7");
}

const positionA = [
  { row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" },
  { row: 6, col: 6, player: "black" }, { row: 8, col: 8, player: "white" },
];
const positionB = [...positionA, { row: 6, col: 8, player: "black" }, { row: 8, col: 6, player: "white" }];

console.log("持续分析节点累计门禁（假引擎：同局面每轮搜索量减半，模拟热 TT）");
{
  const progressByRequest = new Map();
  let pending = null;
  const worker = makeWorker({
    importEngine: importFakeEngine,
    onPost: (message) => {
      if (!pending) return;
      if (message.type === "progress" && message.requestId === pending.requestId) { progressByRequest.set(pending.requestId, message.nodes || 0); return; }
      if (message.type === "error") { const { reject, timer } = pending; pending = null; clearTimeout(timer); reject(new Error(message.message)); return; }
      if (message.type !== "result" || message.requestId !== pending.requestId) return;
      const { resolve, timer, requestId } = pending;
      pending = null;
      clearTimeout(timer);
      resolve({ nodes: message.result.nodes || 0, progressNodes: progressByRequest.get(requestId) || 0, depth: message.result.depth || 0 });
    },
  });
  let nextRequestId = 1;
  const runAnalyze = (options) => new Promise((resolve, reject) => {
    const requestId = `gate-${nextRequestId++}`;
    progressByRequest.set(requestId, 0);
    const timer = setTimeout(() => { pending = null; reject(new Error(`请求超时：${options.moves.length} 子 / continuous=${options.continuous === true}`)); }, 15000);
    pending = { requestId, resolve, reject, timer };
    worker.send({
      type: "analyze", requestId, engine: "fallback", size: 15, moves: options.moves, player: "black",
      rule: "renju", timeMs: 4000, maxDepth: 64, topN: 1,
      continuous: options.continuous === true, finishOnBareMove: options.continuous !== true, stopOnProvenWin: false,
    });
  });
  worker.send({ type: "warmup", engine: "fallback" });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("假引擎加载超时")), 15000);
    const poll = setInterval(() => { if (fakeSearch) { clearInterval(poll); clearTimeout(timer); resolve(); } }, 5);
  });

  // ① 同一局面连续三轮（第二轮起每轮搜索量减半）
  const rounds = [];
  for (let round = 1; round <= 3; round += 1) rounds.push(await runAnalyze({ moves: positionA, continuous: true }));
  const ownWork = [1, 2, 3].map(roundWorkOf);
  const expectedCumulative = ownWork.reduce((sum, work) => sum + work, 0);
  console.log(`  同局面三轮：本轮搜索量 ${ownWork.join(" / ")}｜界面读数 ${rounds.map((round) => round.nodes).join(" → ")}`);
  check(rounds.every((round) => round.nodes > 0), "每轮都汇报了非零节点");
  check(rounds[1].nodes >= rounds[0].nodes && rounds[2].nodes >= rounds[1].nodes,
    "同局面连续轮节点数单调不减（修复前第二轮 50k < 首轮 100k，会被界面 max 冻在 100k）");
  check(rounds[2].nodes === expectedCumulative, `末轮读数 = 各轮搜索量之和（期望 ${expectedCumulative}，实际 ${rounds[2].nodes}）`);
  check(rounds[2].progressNodes > rounds[0].progressNodes, "进度消息里的节点数同样累计（界面读数来自它）");

  // ② 换局面：累计必须归零
  const afterSwitch = await runAnalyze({ moves: positionB, continuous: true });
  console.log(`  换局面（+2 子）读数：${afterSwitch.nodes}（该局面首次搜索量 ${FIRST_SEARCH_NODES}）`);
  check(afterSwitch.nodes === FIRST_SEARCH_NODES, "换局面后累计清零，读数回到该局面本轮搜索量");

  // ③ 非持续分析不得累计
  const single1 = await runAnalyze({ moves: positionB, continuous: false });
  const single2 = await runAnalyze({ moves: positionB, continuous: false });
  const singleOwn = [2, 3].map(roundWorkOf);
  console.log(`  非持续同局面两次读数：${single1.nodes} / ${single2.nodes}（本轮搜索量 ${singleOwn.join(" / ")}）`);
  check(single1.nodes === singleOwn[0] && single2.nodes === singleOwn[1], "非持续分析每次都只是本轮量，没有累加");
}

// ---- 场景二：原生引擎的线程数（假原生桥） ------------------------------------
// 走真实的 native 变体代码路径（原生变体不下发 importScripts，所以不会去加载真引擎）。
console.log("\n原生引擎线程数门禁（假原生桥：断言 worker 实际下发的 INFO THREAD_NUM）");
{
  // 每次测量都新起一个 worker：假原生桥永远不会回结果，请求会一直挂在 active 上，
  // 复用同一个实例会让后续请求排队（读到的是上一轮的残留）。
  const measureThreads = async (threads, bigCores) => {
    const commands = [];
    const worker = makeWorker({
      onPost: (message) => {
        if (message.type === "native-command") { commands.push(message.line); return; }
        if (message.type === "native-start") setTimeout(() => worker.send({ type: "native-ready", version: null, cores }), 0);
      },
    });
    worker.send({ type: "warmup", engine: "auto", native: true, multi: false, threads: 0 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    worker.send({
      type: "analyze", requestId: `threads-${threads}`, engine: "auto", size: 15, moves: positionA, player: "black",
      rule: "renju", timeMs: 150, maxDepth: 8, topN: 1, continuous: false, finishOnBareMove: true,
      native: true, multi: false, threads, ...(bigCores === undefined ? {} : { bigCores }),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const line = commands.find((command) => command.startsWith("INFO THREAD_NUM"));
    return line ? Number(line.split(/\s+/).pop()) : null;
  };
  const expectedAuto = Math.max(1, Math.min(cores, Math.round(cores / 2)));
  const autoThreads = await measureThreads(0);
  const oneThread = await measureThreads(1);
  const allThreads = await measureThreads(-1);
  // 09-17 新增「大核（-2）」档：手机多是 4 大 + 4 小，把小核也铺进 Lazy SMP 会被最慢的
  // 线程拖住，所以这一档要按插件报的 bigCores 走；插件读不到频率（无 bigCores）时退回自动档。
  const fakeBigCores = Math.max(1, cores - 1);
  const bigCoreThreads = await measureThreads(-2, fakeBigCores);
  const bigCoreFallback = await measureThreads(-2);
  // 深度范围（用户 09-16）：最小深度映射到 START_DEPTH，只在 >1 且小于 maxDepth 时下发；
  // 缺省/0 绝不发（否则会改变既有路径的行为）。
  const depthCommandsFor = async (depthMin, maxDepth) => {
    const seen = [];
    const worker = makeWorker({
      onPost: (message) => {
        if (message.type === "native-command") { seen.push(message.line); return; }
        if (message.type === "native-start") setTimeout(() => worker.send({ type: "native-ready", version: null, cores }), 0);
      },
    });
    worker.send({ type: "warmup", engine: "auto", native: true, multi: false, threads: 0 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    worker.send({
      type: "analyze", requestId: "depth", engine: "auto", size: 15, moves: positionA, player: "black",
      rule: "renju", timeMs: 150, maxDepth, topN: 1, continuous: false, finishOnBareMove: true,
      native: true, multi: false, threads: 0, ...(depthMin === undefined ? {} : { depthMin }),
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    return seen.filter((command) => command.startsWith("INFO START_DEPTH"));
  };
  const defaultDepth = await depthCommandsFor(undefined, 64);
  const autoDepth = await depthCommandsFor(0, 64);
  const askedDepth = await depthCommandsFor(12, 64);
  const tooDeep = await depthCommandsFor(80, 64);
  console.log(`  本机 ${cores} 核｜「多线程引擎」默认关：自动档 → ${autoThreads} 线程、显式 1 → ${oneThread} 线程、全核 → ${allThreads} 线程、大核（报 ${fakeBigCores}） → ${bigCoreThreads} 线程、大核无 bigCores → ${bigCoreFallback} 线程`);
  check(autoThreads === expectedAuto, `默认关时原生仍按自动档拿到一半核心（期望 ${expectedAuto}），不再被压成单线程`);
  check(oneThread === 1, "显式选 1 线程仍生效（省电降温走这个选择，不靠那个实验开关）");
  check(allThreads === cores, `全核档拿到全部核心（期望 ${cores}）`);
  check(bigCoreThreads === fakeBigCores, `「大核」档按插件报的 bigCores 走（期望 ${fakeBigCores}），不铺小核`);
  check(bigCoreFallback === expectedAuto, `拿不到 bigCores 时「大核」退回自动档行为（期望 ${expectedAuto}），不会变成 0 线程或全核`);
  console.log(`  深度下界命令：默认 ${JSON.stringify(defaultDepth)}｜0 ${JSON.stringify(autoDepth)}｜设 12 ${JSON.stringify(askedDepth)}｜设 80>maxDepth ${JSON.stringify(tooDeep)}`);
  check(defaultDepth.length === 0 && autoDepth.length === 0, "不传 / 传 0 时不下发 START_DEPTH（既有路径行为逐字不变）");
  check(askedDepth.length === 1 && askedDepth[0].endsWith(" 12"), "显式设了最小深度才下发 INFO START_DEPTH 12");
  check(tooDeep.length === 0, "最小深度 ≥ 最大深度时不发（避免引擎在死循环边界上打转）");
}

if (failures.length) {
  console.log(`\n引擎门禁失败：${failures.length} 条断言未通过`);
  process.exit(1);
}
console.log("\n引擎门禁通过：节点跨轮累计（换局面归零、非持续不累计）+ 原生线程数不被网页版开关压成单线程。");
process.exit(0);
