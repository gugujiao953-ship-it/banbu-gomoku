import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const file = process.env.AI_PUZZLE_FILE ? new URL(process.env.AI_PUZZLE_FILE, import.meta.url) : new URL("../artifacts/nnue/p29-30.json", import.meta.url);
const ruleName = process.env.AI_RULE || "renju";
const engineVariant = process.env.AI_ENGINE || "full";
const raw = JSON.parse(await readFile(file, "utf8"));
const puzzles = raw.map((stones, index) => ({
  id: index + 1,
  stones: stones.filter((value) => typeof value === "string" && value.includes(",")).map((value) => {
    const [coordinate, color] = value.split(",");
    const col = coordinate.charCodeAt(0) - 65;
    const row = 14 - Number(coordinate.slice(1));
    return { row, col, player: color === "1" ? "black" : "white" };
  }),
}));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(process.env.BANBU_URL || "http://127.0.0.1:5181/", { waitUntil: "domcontentloaded" });
for (const puzzle of puzzles) {
  let attacker = process.env.AI_ATTACKER === "black" || process.env.AI_ATTACKER === "white"
    ? process.env.AI_ATTACKER
    : (() => {
        const firstIsBlack = puzzle.stones[0].player === "black";
        const lastIsBlack = puzzle.stones.length % 2 === 1 ? firstIsBlack : !firstIsBlack;
        return lastIsBlack ? "white" : "black";
      })();
  const probe = await page.evaluate(({ moves, player, rule, engine }) => new Promise((resolve, reject) => {
    const key = "__banbuRapfiProbe";
    const state = window[key] || (() => {
      const worker = new Worker("./rapfi/rapfi-worker.js");
      const created = { worker, pending: null };
      worker.onmessage = (event) => {
        if (event.data.type === "result" && created.pending) { const current = created.pending; created.pending = null; current.resolve(event.data.result); }
        if (event.data.type === "error" && created.pending) { const current = created.pending; created.pending = null; current.reject(new Error(event.data.message || "Rapfi error")); }
      };
      window[key] = created;
      return created;
    })();
    state.pending = { resolve, reject };
    state.worker.postMessage({ type: "analyze", engine, size: 15, moves, player, rule, timeMs: 5000, maxDepth: 64 });
  }), { moves: puzzle.stones, player: attacker, rule: ruleName, engine: engineVariant });
  console.log(JSON.stringify({ puzzle: puzzle.id, attacker, rule: ruleName, score: probe.score, winRate: probe.winRate, depth: probe.depth, best: probe.move, candidates: (probe.candidates || []).slice(0, 3).map((c) => ({ move: c.move, score: c.score, winRate: c.winRate })) }));
}
await browser.close();
