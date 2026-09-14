/* 诊断探针：连续分析深度递进与 TT 尺寸影响。
 * 同一 worker 同一局面连续跑 N 轮（每轮 timeMs，TT 跨轮继承），记录每轮
 * depth/nodes/胜率——回答「长时间分析是不是算到一定程度就不加深了」。
 * 用法：node scripts/probe-continuous-depth.mjs [fallback|full] [rounds] [timeMs] [maxMemoryMb]
 */
import { chromium } from "playwright";

const variant = process.argv[2] || "full";
const rounds = Number(process.argv[3] || 8);
const timeMs = Number(process.argv[4] || 2000);
const maxMemoryMb = Number(process.argv[5] || 0);
const baseUrl = process.env.BANBU_URL || "http://[::1]:5193/";

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
while (moves.length < 14) {
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
const summary = await page.evaluate(async ({ variant: nextVariant, dataUrl: nextData, moves: nextMoves, rounds: nextRounds, timeMs: nextTime, maxDepth, maxMemory }) => {
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const t0 = performance.now();
  const ready = await new Promise((resolve) => {
    worker.onmessage = (event) => {
      if (event.data.type === "ready") resolve(event.data.variant);
      if (event.data.type === "error") resolve("error:" + event.data.message);
    };
    worker.postMessage({ type: "warmup", engine: nextVariant, ...(nextData ? { dataUrl: nextData } : {}) });
  });
  const roundResults = [];
  for (let round = 1; round <= nextRounds; round += 1) {
    const result = await new Promise((resolve) => {
      let last = null;
      const timer = setTimeout(() => resolve({ hang: true, last }), nextTime + 20000);
      worker.onmessage = (event) => {
        const m = event.data;
        if (m.type === "progress") last = { nodes: m.nodes, depth: m.depth, winRate: m.winRate, candidates: m.candidates?.length };
        if (m.type === "result") {
          clearTimeout(timer);
          resolve({ ...m.result, progressPeaks: last });
        }
        if (m.type === "error") { clearTimeout(timer); resolve({ error: m.message }); }
      };
      worker.postMessage({ type: "analyze", engine: nextVariant, ...(nextData ? { dataUrl: nextData } : {}), size: 15, moves: nextMoves, player: "black", rule: "renju", timeMs: nextTime, maxDepth, continuous: true, finishOnBareMove: false, maxMemoryMb: maxMemory || undefined });
    });
    roundResults.push({ round, depth: result.depth, nodes: result.nodes, elapsedMs: result.elapsedMs, winRate: result.winRate, score: result.score, candidates: result.candidates?.length ?? 0, move: result.move ? `${result.move.row},${result.move.col}` : null, error: result.error });
  }
  return { ready, totalMs: Math.round(performance.now() - t0), roundResults };
}, { variant, dataUrl, moves, rounds, timeMs, maxDepth: 512, maxMemory: maxMemoryMb });
console.log(JSON.stringify({ variant, rounds, timeMs, maxMemoryMb: maxMemoryMb || "(default 256)", ...summary }, null, 1));
await browser.close();