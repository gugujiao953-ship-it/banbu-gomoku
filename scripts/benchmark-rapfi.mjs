import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const maxPlies = Number(process.env.AI_PUZZLE_PLIES || 15);
const thinkTime = Number(process.env.AI_PUZZLE_TIME || 1800);
const puzzleFile = new URL("../public/puzzles/kaibao/三手胜4-高级题.json", import.meta.url);
const raw = JSON.parse(await readFile(puzzleFile, "utf8"));
const puzzles = raw.slice(0, process.env.AI_PUZZLE_LIMIT ? Number(process.env.AI_PUZZLE_LIMIT) : undefined).map((stones, index) => ({
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
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.Worker));

const engineVariant = process.env.AI_ENGINE || "fallback";
const dataUrl = process.env.AI_DATA_URL || "";
const analyze = async (moves, player) => page.evaluate(({ moves: nextMoves, player: nextPlayer, thinkTime: nextThinkTime, engine: nextEngine, data: nextData }) => new Promise((resolve, reject) => {
  const key = "__banbuRapfiBench";
  const state = window[key] || (() => {
    const worker = new Worker("./rapfi/rapfi-worker.js");
    const created = { worker, pending: null, variant: "unknown" };
    worker.onmessage = (event) => {
      if (event.data.type === "ready") { created.variant = event.data.variant || "unknown"; return; }
      if (event.data.type === "result" && created.pending) { const current = created.pending; created.pending = null; current.resolve({ ...event.data.result, engineVariant: created.variant }); }
      if (event.data.type === "error" && created.pending) { const current = created.pending; created.pending = null; current.reject(new Error(event.data.message || "Rapfi error")); }
    };
    window[key] = created;
    return created;
  })();
  state.pending = { resolve, reject };
  state.worker.postMessage({ type: "analyze", engine: nextEngine, dataUrl: nextData || undefined, size: 15, moves: nextMoves, player: nextPlayer, rule: "renju", timeMs: nextThinkTime, maxDepth: 64 });
}), { moves, player, thinkTime, engine: engineVariant, data: dataUrl });

const other = (player) => player === "black" ? "white" : "black";
const winner = (moves, last) => {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  for (const move of moves) board[move.row][move.col] = move.player;
  const exact = last.player === "black";
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return directions.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) for (let step = 1; board[last.row + dr * step * sign]?.[last.col + dc * step * sign] === last.player; step += 1) count += 1;
    return exact ? count === 5 : count >= 5;
  });
};

const results = [];
const engineVariants = new Set();
for (const puzzle of puzzles) {
  let moves = [...puzzle.stones];
  const attacker = moves.length % 2 === 0 ? "black" : "white";
  let solved = false;
  let error = "";
  let aiMoves = 0;
  try {
    for (let ply = 0; ply < maxPlies; ply += 1) {
      const player = ply % 2 === 0 ? attacker : other(attacker);
      const protocolMoves = moves.map((move) => ({ ...move }));
      const result = await analyze(protocolMoves, player);
      engineVariants.add(result.engineVariant || "unknown");
      if (!result?.move) { error = "Rapfi 没有返回落点"; break; }
      const move = { ...result.move, player };
      if (moves.some((item) => item.row === move.row && item.col === move.col)) { error = "返回了重复落点"; break; }
     moves.push(move);
     if (player === attacker) aiMoves += 1;
      if (winner(moves, move)) { solved = player === attacker; break; }
    }
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  results.push({ id: puzzle.id, solved, plies: moves.length - puzzle.stones.length, aiMoves, error });
  console.log(JSON.stringify(results.at(-1)));
}
await browser.close();
const solved = results.filter((result) => result.solved).length;
console.log(JSON.stringify({ requestedEngine: engineVariant, actualEngines: [...engineVariants], total: results.length, solved, failed: results.length - solved, maxPlies, thinkTime }));
if (solved !== results.length) process.exitCode = 1;
