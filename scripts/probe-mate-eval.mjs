import { chromium } from "playwright";

// Probe: what does the engine report for proven-won positions?
// Black has four in a row (H8-I8-J8-K8): black wins next move whatever white plays.
// Usage: BANBU_URL=http://127.0.0.1:4173 node scripts/probe-mate-eval.mjs

const url = process.env.BANBU_URL || "http://127.0.0.1:4173/";
const step = (name) => console.error(`[probe] ${name} @${Math.round(performance.now())}ms`);
step("launch");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[page error]", String(e).slice(0, 160)));
page.on("console", (m) => console.error(`[page ${m.type()}]`, String(m.text()).slice(0, 200)));
step("goto");
await page.goto(url, { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async () => {
  const packUrl = "engine-packs/rapfi-full-v2.data";
  console.log("fetch-pack");
  const blob = await (await fetch(packUrl)).blob();
  console.log("pack-ok", blob.size);
  const dataUrl = URL.createObjectURL(blob);
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const pending = [];
  worker.onmessage = (event) => {
    const d = event.data || {};
    if (d.type === "result" || d.type === "error") { const item = pending.shift(); if (item) item.resolve(d.type === "result" ? d.result || d : new Error(d.message || "engine error")); }
  };
  const analyze = (payload) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); worker.postMessage({ type: "analyze", ...payload }); });
  const coord = (m) => `${String.fromCharCode(65 + m.col)}${15 - m.row}`;
  const b = (row, col) => ({ row, col, player: "black" });
  const w = (row, col) => ({ row, col, player: "white" });

  // Scenario 1: black four H8,I8,J8,K8 — white to move (white is lost).
  const whiteLost = await analyze({ engine: "auto", dataUrl, size: 15, moves: [b(7, 7), b(7, 8), b(7, 9), b(7, 10)], player: "white", rule: "renju", timeMs: 5000, maxDepth: 96, topN: 3 });
  // Scenario 2: same + white blocks L8 — black to move (black completes five at G8).
  const blackWins = await analyze({ engine: "auto", dataUrl, size: 15, moves: [b(7, 7), b(7, 8), b(7, 9), b(7, 10), w(7, 11)], player: "black", rule: "renju", timeMs: 5000, maxDepth: 96, topN: 3 });
  // Scenario 3: white to move in a quiet position (1 stone) as control.
  const quiet = await analyze({ engine: "auto", dataUrl, size: 15, moves: [b(7, 7)], player: "white", rule: "renju", timeMs: 5000, maxDepth: 96, topN: 3 });
  URL.revokeObjectURL(dataUrl);
  worker.terminate();
  const fmt = (r) => ({ move: coord(r.move), winRate: r.winRate, score: r.score, depth: r.depth, nodes: r.nodes, cands: (r.candidates || []).slice(0, 3).map((c) => ({ m: coord(c.move), wr: c.winRate })) });
  return { whiteLost: fmt(whiteLost), blackWins: fmt(blackWins), quiet: fmt(quiet) };
});
console.log(JSON.stringify(out, null, 1));
