/* 诊断探针：测量 Rapfi 各档（fallback/full/multi）在搜索期间的 INFO 输出节奏。
 * 节点显示只随引擎 INFO 行（迭代边界）更新——本探针量化「节点显示冻结」的
 * 真实间隔：INFO 行间间隔、UI progress 流（100ms 节流后）最大静默期。
 * 用法：node scripts/probe-io-cadence.mjs [fallback|full|multi] [timeMs] [maxDepth]
 * 依赖：本机 5193 vite dev 服务（带 COOP/COEP，multi 可测），代理需绕过 7897。
 */
import { chromium } from "playwright";

const variant = process.argv[2] || "fallback";
const timeMs = Number(process.argv[3] || 2000);
const maxDepth = Number(process.argv[4] || 64);
const maxMemoryMb = Number(process.env.AI_MAX_MEM || 0);
const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5193/";

// 中局确定性局面：18 子蛇形，黑方行棋，无直接五连。
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

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const page = await browser.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.Worker));

const dataUrl = variant === "fallback" ? null : "/engine-packs/rapfi-full-v3.data";
const multiJsUrl = "/engine-packs/rapfi-multi-v1.jsc";
const multiWasmUrl = "/engine-packs/rapfi-multi-v1.wasmc";
const trace = await page.evaluate(({ variant: nextVariant, dataUrl: nextData, multiJsUrl: nextJs, multiWasmUrl: nextWasm, moves: nextMoves, timeMs: nextTime, maxDepth: nextDepth, nextMaxMem }) => new Promise((resolve, reject) => {
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const t0 = performance.now();
  const infos = [];
  const progress = [];
  const logs = [];
  let readyAt = null;
  const timer = setTimeout(() => resolve({ hang: true, elapsedMs: Math.round(performance.now() - t0), infos, progress, logs }), nextTime + 90000);
  worker.onmessage = (event) => {
    const t = performance.now() - t0;
    const message = event.data;
    if (message.type === "ready") { readyAt = t; return; }
    if (message.type === "log") {
      const text = String(message.message);
      logs.push({ t: Math.round(t), text: text.slice(0, 120) });
      if (text.startsWith("RAW ")) {
        const line = text.slice(4);
        const depth = Number((line.match(/(?:^|\s)DEPTH\s+(-?\d+)/) || [])[1]);
        const nodes = Number((line.match(/(?:^|\s)NODES\s+(-?\d+)/) || [])[1]);
        const totalNodes = Number((line.match(/(?:^|\s)TOTALNODES\s+(-?\d+)/) || [])[1]);
        if (line.startsWith("INFO") || /^MESSAGE Bestline/i.test(line)) infos.push({ t: Math.round(t), depth: depth || 0, nodes: nodes || 0, totalNodes: totalNodes || 0, line: line.slice(0, 60) });
      }
      return;
    }
    if (message.type === "progress") progress.push({ t: Math.round(t), nodes: message.nodes, depth: message.depth });
    if (message.type === "result") {
      clearTimeout(timer);
      resolve({ variant: message.variant, elapsedMs: Math.round(performance.now() - t0), readyAt: readyAt ? Math.round(readyAt) : null, result: { depth: message.result.depth, nodes: message.result.nodes, move: message.result.principalVariation?.[0] || message.result.move }, infos, progress, logs });
    }
    if (message.type === "error") { clearTimeout(timer); reject(new Error(message.message)); }
  };
  worker.postMessage({ type: "warmup", engine: nextVariant, ...(nextData ? { dataUrl: nextData } : {}), ...(nextVariant === "multi" ? { multiJsUrl: nextJs, multiWasmUrl: nextWasm } : {}) });
  setTimeout(() => {
    worker.postMessage({ type: "analyze", engine: nextVariant, ...(nextData ? { dataUrl: nextData } : {}), ...(nextVariant === "multi" ? { multiJsUrl: nextJs, multiWasmUrl: nextWasm } : {}), size: 15, moves: nextMoves, player: "black", rule: "renju", timeMs: nextTime, maxDepth: nextDepth, finishOnBareMove: true, rawDebug: true, maxMemoryMb: nextMaxMem });
  }, 150);
}), { variant, dataUrl, multiJsUrl, multiWasmUrl, moves, timeMs, maxDepth, nextMaxMem: maxMemoryMb });

const gaps = (arr) => arr.map((item, i) => (i ? item.t - arr[i - 1].t : item.t)).sort((a, b) => a - b);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const igaps = gaps(trace.infos);
const pgaps = gaps(trace.progress);
console.log(JSON.stringify({
  variant: trace.variant || variant, timeMs, maxDepth, stones: moves.length, mover: "black",
  readyAtMs: trace.readyAt,
  logs: trace.logs.slice(0, 5),
  elapsedMs: trace.elapsedMs,
  result: trace.result,
  infoLines: trace.infos.length,
  infoFirstAtMs: trace.infos.length ? trace.infos[0].t : null,
  infoGapMs: { p50: pct(igaps, 0.5), p95: pct(igaps, 0.95), max: igaps[igaps.length - 1] || 0 },
  // UI 实际看到的节点流：progress 静默期 = 「节点显示卡住不动」的时长
  uiNodeFreezeMaxMs: pgaps[pgaps.length - 1] || 0,
  uiNodeFreezeP95Ms: pct(pgaps, 0.95),
  nodeHead: trace.progress.slice(0, 6).map((p) => `${p.t}ms:d${p.depth}:${p.nodes}`),
  nodeTail: trace.progress.slice(-6).map((p) => `${p.t}ms:d${p.depth}:${p.nodes}`),
  firstInfos: trace.infos.slice(0, 6).map((i) => `${i.t}ms:d${i.depth}:n${i.nodes}${i.totalNodes ? ":T" + i.totalNodes : ""}`),
  lastInfos: trace.infos.slice(-4).map((i) => `${i.t}ms:d${i.depth}:n${i.nodes}${i.totalNodes ? ":T" + i.totalNodes : ""} ${i.line}`),
}, null, 1));
await browser.close();