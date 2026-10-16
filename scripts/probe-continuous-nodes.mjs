/* 诊断探针：复刻 App「持续分析」的轮次结构，量化界面上的节点/深度数字流。
 *
 * App 的行为（src/App.tsx startThink + continuousBudgetMs）：同一局面每完成一轮就
 * 立刻发下一轮，预算是 2s、4s、6s…直到 20s；worker 侧 stats 每轮清零，而界面把
 * nodes/depth 取 Math.max 兜底。本探针把每一轮的 progress 流、轮次边界和「界面会
 * 显示什么」一起录下来，回答两个问题：
 *   ① 每轮节点数是不是累计的（还是各轮独立、甚至更少）
 *   ② 深度到底有没有随轮次增长
 *
 * 用法：node scripts/.tmp-continuous-nodes.mjs [fallback|full] [rounds] [topN]
 * 依赖：本机 vite dev（BANBU_URL，默认 http://[::1]:5193/）。
 */
import { chromium } from "playwright";

const variant = process.argv[2] || "full";
const rounds = Number(process.argv[3] || 6);
const topN = Number(process.argv[4] || 1);
const baseUrl = process.env.BANBU_URL || "http://[::1]:5193/";

// 与 probe-io-cadence 同一局面（18 子中局，黑方行棋），便于跨探针对照。
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
const trace = await page.evaluate(async ({ nextVariant, nextData, nextMoves, roundCount, nextTopN, nextSettleMs }) => {
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const t0 = performance.now();
  const readyAt = await new Promise((resolve) => {
    worker.onmessage = (event) => {
      if (event.data.type === "ready") resolve(Math.round(performance.now() - t0));
      if (event.data.type === "error") resolve("error:" + event.data.message);
    };
    worker.postMessage({ type: "warmup", engine: nextVariant, ...(nextData ? { dataUrl: nextData } : {}) });
  });
  const roundRows = [];
  const uiStream = [];
  const rawLog = [];
  // 判定实验：warmup 之后等 N 毫秒再发第一轮（验证「引擎自报 ready 时其实还没读
  // stdin」这个启动竞态）。SETTLE_MS=0 关闭。
  const settleMs = nextSettleMs;
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
  let lastRoundEndAt = null;
  for (let round = 1; round <= roundCount; round += 1) {
    const budgetMs = Math.min(20000, 2000 + (round - 1) * 2000);
    const startedAt = Math.round(performance.now() - t0);
    const gapMs = lastRoundEndAt === null ? 0 : startedAt - lastRoundEndAt;
    const peaks = await new Promise((resolve) => {
      let peakNodes = 0, peakDepth = 0, lastSpeed = undefined, samples = 0;
      const timer = setTimeout(() => resolve({ hang: true, peakNodes, peakDepth, samples }), budgetMs + 30000);
      worker.onmessage = (event) => {
        const m = event.data;
        if (m.type === "log") {
          const text = String(m.message);
          if (text.startsWith("RAW ")) rawLog.push(`${Math.round(performance.now() - t0)}ms r${round} ${text.slice(4, 100)}`);
          return;
        }
        if (m.type === "progress") {
          samples += 1;
          peakNodes = Math.max(peakNodes, m.nodes || 0);
          peakDepth = Math.max(peakDepth, m.depth || 0);
          if (typeof m.speed === "number") lastSpeed = m.speed;
          uiStream.push({ t: Math.round(performance.now() - t0), round, nodes: m.nodes || 0, depth: m.depth || 0 });
          return;
        }
        if (m.type === "result") {
          clearTimeout(timer);
          resolve({ peakNodes, peakDepth, lastSpeed, samples, result: m.result });
        }
        if (m.type === "error") { clearTimeout(timer); resolve({ peakNodes, peakDepth, samples, error: m.message }); }
      };
      worker.postMessage({
        type: "analyze", engine: nextVariant, ...(nextData ? { dataUrl: nextData } : {}),
        size: 15, moves: nextMoves, player: "black", rule: "renju",
        timeMs: budgetMs, maxDepth: 512, topN: nextTopN,
        // 与 App 的持续分析完全一致：continuous + 不做提前收尾
        continuous: true, finishOnBareMove: false, stopOnProvenWin: false,
        rawDebug: true,
      });
    });
    lastRoundEndAt = Math.round(performance.now() - t0);
    roundRows.push({
      round, budgetMs, gapMs,
      elapsedMs: peaks.result ? Math.round(peaks.result.elapsedMs) : null,
      depth: peaks.result?.depth, nodes: peaks.result?.nodes,
      peakDepth: peaks.peakDepth, peakNodes: peaks.peakNodes,
      speed: peaks.lastSpeed, samples: peaks.samples,
      move: peaks.result?.move ? `${peaks.result.move.row},${peaks.result.move.col}` : null,
      progressCount: peaks.result?.candidates?.length ?? 0,
      error: peaks.error, hang: peaks.hang || false,
    });
  }
  return { readyAt, roundRows, uiStream, rawLog };
}, { nextVariant: variant, nextData: dataUrl, nextMoves: moves, roundCount: rounds, nextTopN: topN, nextSettleMs: Number(process.env.SETTLE_MS || 0) });

// 界面实际显示什么：nodes/depth 都取历史最大值（App.tsx 的 Math.max 兜底）
let shownNodes = 0, shownDepth = 0;
const uiActual = trace.uiStream.map((sample) => {
  shownNodes = Math.max(shownNodes, sample.nodes);
  shownDepth = Math.max(shownDepth, sample.depth);
  return { t: sample.t, round: sample.round, shownNodes, shownDepth, engineNodes: sample.nodes, engineDepth: sample.depth };
});
const perSecond = [];
for (let second = 1; second <= Math.ceil((uiActual.at(-1)?.t || 0) / 1000); second += 1) {
  const row = [...uiActual].reverse().find((item) => item.t <= second * 1000);
  if (row) perSecond.push(`${second}s r${row.round} d${row.shownDepth}/${row.engineDepth} n${row.shownNodes}/${row.engineNodes}`);
}

console.log(JSON.stringify({
  variant, topN, rounds, readyAtMs: trace.readyAt,
  roundRows: trace.roundRows,
  // 界面读数随时间：shownNodes 是界面显示值，engineNodes 是该轮引擎的真实值
  uiPerSecond: perSecond,
  engineNodeTail: trace.uiStream.slice(-8).map((s) => `${s.t}ms r${s.round} d${s.depth} n${s.nodes}`),
  rawHead: trace.rawLog.slice(0, 12),
  rawCount: trace.rawLog.length,
}, null, 1));
await browser.close();
