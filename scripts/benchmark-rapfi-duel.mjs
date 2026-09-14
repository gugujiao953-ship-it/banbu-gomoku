import { chromium } from "playwright";

// Head-to-head match between the bundled Rapfi variants (full NNUE networks vs
// the small fallback networks) under renju rules. Colors alternate with a
// small seeded random opening so the deterministic engines do not repeat one
// identical game per color assignment.
const games = Number(process.env.AI_DUEL_GAMES || 8);
const thinkTime = Number(process.env.AI_DUEL_TIME || 1800);
const seed = Number(process.env.AI_DUEL_SEED || 20260905);
let rngState = seed >>> 0;
const rng = () => {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 4294967296;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(process.env.BANBU_URL || "http://127.0.0.1:5181/", { waitUntil: "domcontentloaded" });

// One worker per engine variant; a turn-based game only ever has one request
// in flight, so a single pending slot per worker is sufficient.
const askMove = (engine, moves, player) => page.evaluate(({ engine: nextEngine, moves: nextMoves, player: nextPlayer, thinkTime: nextTime }) => new Promise((resolve, reject) => {
  const key = "__banbuRapfiDuel";
  const state = window[key] || (() => {
    const workers = new Map();
    const entryFor = (name) => {
      if (workers.has(name)) return workers.get(name);
      const worker = new Worker("./rapfi/rapfi-worker.js");
      const created = { worker, pending: null };
      worker.onmessage = (event) => {
        if (event.data.type === "result" && created.pending) { const current = created.pending; created.pending = null; current.resolve(event.data.result); }
        if (event.data.type === "error" && created.pending) { const current = created.pending; created.pending = null; current.reject(new Error(event.data.message || "Rapfi error")); }
      };
      workers.set(name, created);
      return created;
    };
    window[key] = {
      request: (name, movesForEngine, playerForEngine, timeMs) => {
        const entry = entryFor(name);
        return new Promise((res, rej) => {
          entry.pending = { resolve: res, reject: rej };
          entry.worker.postMessage({ type: "analyze", engine: name, size: 15, moves: movesForEngine, player: playerForEngine, rule: "renju", timeMs, maxDepth: 64 });
        });
      },
    };
    return window[key];
  })();
  state.request(nextEngine, nextMoves, nextPlayer, nextTime).then(resolve, reject);
}), { engine, moves, player, thinkTime });

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

const OPENING_CANDIDATES = [[7, 7], [7, 6], [6, 7], [7, 8], [8, 7], [6, 6], [8, 8], [6, 8], [8, 6]];
const score = { full: 0, fallback: 0, draw: 0 };
const rows = [];
for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
  const fullIsBlack = gameIndex % 2 === 0;
  const engineOf = (player) => (player === "black") === fullIsBlack ? "full" : "fallback";
  const moves = [];
  // Two randomized opening half-moves keep deterministic engines from repeating.
  const openingBlack = OPENING_CANDIDATES[Math.floor(rng() * OPENING_CANDIDATES.length)];
  moves.push({ row: openingBlack[0], col: openingBlack[1], player: "black" });
  if (rng() < 0.85) {
    const openingWhite = OPENING_CANDIDATES[Math.floor(rng() * OPENING_CANDIDATES.length)];
    if (!moves.some((move) => move.row === openingWhite[0] && move.col === openingWhite[1])) {
      moves.push({ row: openingWhite[0], col: openingWhite[1], player: "white" });
    }
  }
  let winnerEngine = "draw";
  let reason = "board-full";
  for (let ply = moves.length; ply < 225; ply += 1) {
    const player = ply % 2 === 0 ? "black" : "white";
    const engine = engineOf(player);
    const result = await askMove(engine, moves.map((move) => ({ ...move })), player);
    if (!result?.move) { winnerEngine = engine === "full" ? "fallback" : "full"; reason = "no-move:" + engine; break; }
    const move = { ...result.move, player };
    if (moves.some((item) => item.row === move.row && item.col === move.col)) { winnerEngine = engine === "full" ? "fallback" : "full"; reason = "illegal:" + engine; break; }
    moves.push(move);
    if (winner(moves, move)) { winnerEngine = engine; reason = "five"; break; }
  }
  if (winnerEngine === "full") score.full += 1;
  else if (winnerEngine === "fallback") score.fallback += 1;
  else score.draw += 1;
  const row = { game: gameIndex + 1, fullColor: fullIsBlack ? "black" : "white", winner: winnerEngine, reason, plies: moves.length };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ games, thinkTime, seed, score, rows }));
await browser.close();
