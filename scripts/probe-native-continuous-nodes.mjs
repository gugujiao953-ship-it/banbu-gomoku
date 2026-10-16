/**
 * 临时探针：在安卓 WebView 里直接驱动原生引擎，复刻 App「持续分析」的轮次结构。
 *
 * 目的：桌面 wasm 上已经测出「每轮独立搜索 + 界面 Math.max」会让节点数冻在最高点
 * （见 scripts/.tmp-continuous-nodes.mjs），这里要在**真实原生引擎**上确认同一条曲线
 * （原生速度高 5-10×，饱和会来得更早），并确认原生构建有没有发 INFO TOTALNODES。
 *
 * 桥接是手写的：App 里那段 attachNativeEngine 在打包产物里不可 import，但
 * window.Capacitor.Plugins.NativeEngine 是全局可达的，照它的协议接一遍即可。
 *
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node scripts/.tmp-native-continuous-nodes.mjs [rounds] [topN]
 */
const port = Number(process.env.CDP_PORT || 9222);
const rounds = Number(process.argv[2] || 5);
const topN = Number(process.argv[3] || 1);
const threads = Number(process.argv[4] ?? 0);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((item) => item.type === "page");
if (!target) throw new Error("没有页面 target");
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const evaluate = (expression, awaitPromise = false) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true, timeout: 300000 } }));
});

// 与 probe-io-cadence / .tmp-continuous-nodes 同一局面（18 子中局，黑方行棋）
const movesJson = (() => {
  let rngState = 20260912;
  const rng = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; };
  const size = 15;
  const board = Array.from({ length: size }, () => Array(size).fill(null));
  const hasFive = (row, col, player) => {
    for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let count = 1;
      for (const sign of [-1, 1]) for (let step = 1; board[row + dr * step * sign]?.[col + dc * step * sign] === player; step += 1) count += 1;
      if (count >= 5) return true;
    }
    return false;
  };
  const candidates = () => {
    const out = [];
    for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
      if (board[r][c] !== null) continue;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
        if (board[r + dr]?.[c + dc] !== null) { near = true; break; }
      }
      if (near) out.push([r, c]);
    }
    return out;
  };
  const moves = [];
  board[7][7] = "black"; moves.push({ row: 7, col: 7, player: "black" });
  while (moves.length < 18) {
    const pool = candidates();
    const [r, c] = pool[Math.floor(rng() * pool.length)];
    const player = moves.length % 2 === 0 ? "black" : "white";
    board[r][c] = player;
    if (hasFive(r, c, player)) { board[r][c] = null; continue; }
    moves.push({ row: r, col: c, player });
  }
  return JSON.stringify(moves);
})();

const trace = await evaluate(`(async () => {
  const plugin = window.Capacitor.Plugins.NativeEngine;
  const nextMoves = ${movesJson};
  const roundCount = ${rounds}, nextTopN = ${topN}, nextThreads = ${threads};
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const logs = [];
  const uiStream = [];
  const errors = [];
  let nativeStartSent = false;
  // 手写桥：与 src/features/ai/native-engine.ts 的 attachNativeEngine 同协议
  worker.addEventListener("message", (event) => {
    const m = event.data || {};
    if (m.type === "native-command") { plugin.write({ line: m.line }).catch((error) => errors.push("write:" + String(error))); return; }
    if (m.type === "native-start") {
      if (nativeStartSent) return;
      nativeStartSent = true;
      (async () => {
        try {
          await plugin.prepare();
          await plugin.addListener("stdout", (payload) => worker.postMessage({ type: "native-stdout", line: String(payload.line ?? "") }));
          await plugin.addListener("exit", (payload) => worker.postMessage({ type: "native-exit", code: Number(payload.code ?? -1) }));
          await plugin.start();
          worker.postMessage({ type: "native-ready", version: null, cores: 4 });
        } catch (error) { errors.push("start:" + String(error)); worker.postMessage({ type: "native-start-failed", reason: String(error) }); }
      })();
    }
  });
  const t0 = performance.now();
  const warm = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 60000);
    worker.onmessage = (event) => {
      if (event.data.type === "ready") { clearTimeout(timer); resolve({ variant: event.data.variant, ms: Math.round(performance.now() - t0) }); }
      if (event.data.type === "error") { clearTimeout(timer); resolve({ error: event.data.message }); }
    };
    worker.postMessage({ type: "warmup", engine: "auto", native: true, threads: 4 });
  });
  const roundRows = [];
  // 冷启动竞态规避：引擎自报 ready 时其实还在读 config/权重，第一轮会整轮超时
  // （见 .tmp-continuous-nodes.mjs 的 SETTLE_MS 实验）。测量节点曲线时先让引擎静下来。
  await new Promise((resolve) => setTimeout(resolve, 2500));
  let lastRoundEndAt = null;
  for (let round = 1; round <= roundCount; round += 1) {
    const budgetMs = Math.min(20000, 2000 + (round - 1) * 2000);
    const startedAt = Math.round(performance.now() - t0);
    const gapMs = lastRoundEndAt === null ? 0 : startedAt - lastRoundEndAt;
    const outcome = await new Promise((resolve) => {
      let peakNodes = 0, peakDepth = 0, lastSpeed = undefined, samples = 0;
      const timer = setTimeout(() => resolve({ hang: true, peakNodes, peakDepth, samples }), budgetMs + 40000);
      worker.onmessage = (event) => {
        const m = event.data;
        if (m.type === "log") { const text = String(m.message); if (text.startsWith("RAW ")) logs.push({ t: Math.round(performance.now() - t0), round, line: text.slice(4, 90) }); return; }
        if (m.type === "progress") {
          samples += 1;
          peakNodes = Math.max(peakNodes, m.nodes || 0);
          peakDepth = Math.max(peakDepth, m.depth || 0);
          if (typeof m.speed === "number") lastSpeed = m.speed;
          uiStream.push({ t: Math.round(performance.now() - t0), round, nodes: m.nodes || 0, depth: m.depth || 0, speed: m.speed });
          return;
        }
        if (m.type === "result") { clearTimeout(timer); resolve({ peakNodes, peakDepth, lastSpeed, samples, result: m.result, variant: m.variant }); }
        if (m.type === "error") { clearTimeout(timer); resolve({ peakNodes, peakDepth, samples, error: m.message }); }
      };
      worker.postMessage({
        type: "analyze", engine: "auto", size: 15, moves: nextMoves, player: "black", rule: "renju",
        timeMs: budgetMs, maxDepth: 512, topN: nextTopN,
        continuous: true, finishOnBareMove: false, stopOnProvenWin: false,
        native: true, threads: nextThreads, rawDebug: true,
      });
    });
    lastRoundEndAt = Math.round(performance.now() - t0);
    roundRows.push({
      round, budgetMs, gapMs,
      elapsedMs: outcome.result ? Math.round(outcome.result.elapsedMs) : null,
      depth: outcome.result ? outcome.result.depth : null,
      nodes: outcome.result ? outcome.result.nodes : null,
      peakDepth: outcome.peakDepth, peakNodes: outcome.peakNodes,
      speed: outcome.lastSpeed, samples: outcome.samples,
      move: outcome.result && outcome.result.move ? outcome.result.move.row + "," + outcome.result.move.col : null,
      variant: outcome.variant, error: outcome.error, hang: outcome.hang || false,
    });
  }
  let shownNodes = 0, shownDepth = 0;
  const uiActual = uiStream.map((sample) => {
    shownNodes = Math.max(shownNodes, sample.nodes);
    shownDepth = Math.max(shownDepth, sample.depth);
    return { t: sample.t, round: sample.round, shownNodes, shownDepth, engineNodes: sample.nodes, engineDepth: sample.depth };
  });
  const perSecond = [];
  const lastT = uiActual.length ? uiActual[uiActual.length - 1].t : 0;
  for (let second = 1; second <= Math.ceil(lastT / 1000); second += 1) {
    let row = null;
    for (const item of uiActual) if (item.t <= second * 1000) row = item;
    if (row) perSecond.push(second + "s r" + row.round + " d" + row.shownDepth + "/" + row.engineDepth + " n" + row.shownNodes + "/" + row.engineNodes);
  }
  const infoSample = logs.filter((entry) => /NODES|TOTALNODES/.test(entry.line)).slice(0, 8).map((entry) => entry.t + "ms " + entry.line);
  return JSON.stringify({ warm, errors, roundRows, uiPerSecond: perSecond, infoSample, logCount: logs.length });
})()`, true);

console.log(trace.result.value);
socket.close();
