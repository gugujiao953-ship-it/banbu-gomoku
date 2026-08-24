import { analyzeCandidates } from "./analysis";
import { otherPlayer } from "./game";
import type { Cell, Player, Position } from "./types";

const DIRECTIONS: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const inside = (row: number, col: number) => row >= 0 && row < 15 && col >= 0 && col < 15;

export function winnerAt(board: Cell[][], position: Position): Player | null {
  const player = board[position.row]?.[position.col];
  if (!player) return null;
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const sign of [-1, 1]) for (let step = 1; inside(position.row + dr * step * sign, position.col + dc * step * sign); step += 1) {
      if (board[position.row + dr * step * sign][position.col + dc * step * sign] !== player) break;
      count += 1;
    }
    if (count >= 5) return player;
  }
  return null;
}

function evaluate(board: Cell[][], player: Player) {
  const own = analyzeCandidates(board, player, 6);
  const rival = analyzeCandidates(board, otherPlayer(player), 6);
  return (own[0]?.score || 0) - (rival[0]?.score || 0) * 1.08;
}

export interface AiSearchOptions { maxDepth?: number; timeBudgetMs?: number; width?: number }

/** Clean-room iterative deepening alpha-beta with a small transposition table. */
export function findBestMove(board: Cell[][], player: Player, options: AiSearchOptions = {}): Position | null {
  const started = performance.now();
  const budget = options.timeBudgetMs ?? 900;
  const width = options.width ?? 8;
  const table = new Map<string, { depth: number; score: number }>();
  let best = analyzeCandidates(board, player, width)[0]?.position || null;
  const hash = (side: Player) => `${side[0]}:${board.flat().map((cell) => cell === "black" ? "x" : cell === "white" ? "o" : ".").join("")}`;
  const search = (side: Player, depth: number, alpha: number, beta: number): number => {
    if (performance.now() - started >= budget) throw new Error("budget");
    if (!depth) return evaluate(board, player);
    const key = hash(side);
    const cached = table.get(key);
    if (cached && cached.depth >= depth) return cached.score;
    const moves = analyzeCandidates(board, side, Math.max(4, width - 2));
    if (!moves.length) return 0;
    let value = side === player ? -Infinity : Infinity;
    for (const candidate of moves) {
      const { row, col } = candidate.position;
      board[row][col] = side;
      const win = winnerAt(board, candidate.position);
      const score = win ? (win === player ? 10_000_000 + depth : -10_000_000 - depth) : search(otherPlayer(side), depth - 1, alpha, beta);
      board[row][col] = null;
      if (side === player) { value = Math.max(value, score); alpha = Math.max(alpha, value); }
      else { value = Math.min(value, score); beta = Math.min(beta, value); }
      if (beta <= alpha) break;
    }
    table.set(key, { depth, score: value });
    return value;
  };
  for (let depth = 1; depth <= (options.maxDepth ?? 4); depth += 1) {
    try {
      let levelBest = best;
      let levelScore = -Infinity;
      for (const candidate of analyzeCandidates(board, player, width)) {
        board[candidate.position.row][candidate.position.col] = player;
        const score = winnerAt(board, candidate.position) ? 10_000_000 : search(otherPlayer(player), depth - 1, -Infinity, Infinity);
        board[candidate.position.row][candidate.position.col] = null;
        if (score > levelScore) { levelScore = score; levelBest = candidate.position; }
      }
      best = levelBest;
    } catch { break; }
  }
  return best;
}
