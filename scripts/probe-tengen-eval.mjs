import { chromium } from "playwright";

// Probe: does the full engine report a high win rate for black after 1.Tengeng (H8),
// and what does the white reply + top-N candidate set look like at increasing budgets?
// Usage: BANBU_URL=http://127.0.0.1:4173 node scripts/probe-tengen-eval.mjs

const url = process.env.BANBU_URL || "http://127.0.0.1:4173/";
const budgets = (process.env.PROBE_BUDGETS || "3000,8000,20000").split(",").map(Number);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ budgets }) => {
  const packUrl = "https://gugujiao953-ship-it.github.io/banbu-gomoku/engine-packs/rapfi-full-v2.data";
  const blob = await (await fetch(packUrl)).blob();
  const dataUrl = URL.createObjectURL(blob);
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const pending = [];
  worker.onmessage = (event) => {
    const d = event.data || {};
    if (d.type === "result" || d.type === "error") { const item = pending.shift(); if (item) item.resolve(d.type === "result" ? d.result || d : new Error(d.message || "engine error")); }
  };
  const analyze = (payload) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); worker.postMessage({ type: "analyze", ...payload }); });
  const coord = (m) => `${String.fromCharCode(65 + m.col)}${15 - m.row}`;
  const results = [];
  for (const timeMs of budgets) {
    const t0 = performance.now();
    // 1. White to move after black tengen H8.
    const whiteReply = await analyze({ engine: "auto", dataUrl, size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju", timeMs, maxDepth: 96, topN: 5 });
    // 2. Black to move after 1.H8 2.I9 (white knight-reply far away) — does black win rate stay high?
    const blackEval = await analyze({ engine: "auto", dataUrl, size: 15, moves: [{ row: 7, col: 7, player: "black" }, { row: 5, col: 8, player: "white" }], player: "black", rule: "renju", timeMs, maxDepth: 96, topN: 5 });
    results.push({ timeMs, elapsedMs: Math.round(performance.now() - t0), whiteReply: { move: coord(whiteReply.move), wr: whiteReply.winRate, depth: whiteReply.depth, nodes: whiteReply.nodes, top5: (whiteReply.candidates || []).map((c) => ({ m: coord(c.move), wr: c.winRate, d: c.depth, n: c.nodes })) }, blackEval: { wr: blackEval.winRate, score: blackEval.score, depth: blackEval.depth, top5: (blackEval.candidates || []).map((c) => ({ m: coord(c.move), wr: c.winRate, d: c.depth })) }});
  }
  URL.revokeObjectURL(dataUrl);
  worker.terminate();
  return { packBytes: blob.size, results };
}, { budgets });

for (const line of out.results) console.log(JSON.stringify(line));
