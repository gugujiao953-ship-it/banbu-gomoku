export type Player = 1 | 2;
export type Cell = 0 | Player;
export interface Move { row: number; col: number; }
export type SearchRule = "renju" | "standard" | "freestyle";
export interface SearchOptions { maxDepth?: number; timeBudgetMs?: number; candidateLimit?: number; renjuRules?: boolean; rule?: SearchRule; }
export interface SearchResult { move: Move | null; score: number; depth: number; nodes: number; elapsedMs: number; illegalRejected: number; reason: string; }

const SIZE = 15;
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const other = (player: Player): Player => player === 1 ? 2 : 1;
const inside = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const keyOf = (row: number, col: number) => row * SIZE + col;

export const cloneBoard = (board: Cell[][]): Cell[][] => board.map((row) => [...row] as Cell[]);
export const emptyBoard = (): Cell[][] => Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(0));

const lineInfo = (board: Cell[][], row: number, col: number, player: Player, dr: number, dc: number) => {
  let count = 1, open = 0;
  for (const sign of [-1, 1]) {
    let step = 1;
    while (inside(row + dr * step * sign, col + dc * step * sign) && board[row + dr * step * sign][col + dc * step * sign] === player) { count += 1; step += 1; }
    if (inside(row + dr * step * sign, col + dc * step * sign) && board[row + dr * step * sign][col + dc * step * sign] === 0) open += 1;
  }
  return { count, open };
};
const ruleFromLegacy = (rule: SearchRule | boolean = "renju"): SearchRule => typeof rule === "boolean" ? (rule ? "renju" : "freestyle") : rule;
const winningCount = (count: number, player: Player, rule: SearchRule) => rule === "standard" || (rule === "renju" && player === 1) ? count === 5 : count >= 5;

export const winAt = (board: Cell[][], move: Move, player: Player, rule: SearchRule = "freestyle"): boolean =>
  DIRECTIONS.some(([dr, dc]) => winningCount(lineInfo(board, move.row, move.col, player, dr, dc).count, player, rule));
const winningPoints = (board: Cell[][], player: Player, rule: SearchRule) => {
  const result: Move[] = [];
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) if (board[row][col] === 0) {
    board[row][col] = player;
    if (winAt(board, { row, col }, player, rule)) result.push({ row, col });
    board[row][col] = 0;
  }
  return result;
};

/** Renju legality delegates to the canonical game rule evaluator. Keeping the
 * search gate on the same implementation prevents AI-only interpretations of
 * same-axis double fours, true/false threes, and exact-five priority. */
export const isLegalMove = (board: Cell[][], move: Move, player: Player, ruleOrRenju: SearchRule | boolean = "renju"): boolean => {
  if (!inside(move.row, move.col) || board[move.row][move.col] !== 0) return false;
  const rule = ruleFromLegacy(ruleOrRenju);
  if (rule !== "renju" || player === 2) return true;
  const canonicalBoard: GameCell[][] = board.map((row) => row.map((cell) => cell === 1 ? "black" : cell === 2 ? "white" : null));
  return evaluateRenjuMove(canonicalBoard, move).legal;
};

const candidateMoves = (board: Cell[][], player: Player, limit: number, rule: SearchRule): Move[] => {
  const occupied: Move[] = [];
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) if (board[row][col]) occupied.push({ row, col });
  if (!occupied.length) return [{ row: 7, col: 7 }];
  const candidates = new Map<number, { move: Move; score: number }>();
  for (const stone of occupied) for (let row = Math.max(0, stone.row - 2); row <= Math.min(SIZE - 1, stone.row + 2); row += 1) for (let col = Math.max(0, stone.col - 2); col <= Math.min(SIZE - 1, stone.col + 2); col += 1) if (board[row][col] === 0 && isLegalMove(board, { row, col }, player, rule)) {
    board[row][col] = player;
    const own = DIRECTIONS.reduce((sum, [dr, dc]) => { const x = lineInfo(board, row, col, player, dr, dc); return sum + x.count * x.count * 10 + x.open * 3; }, 0);
    board[row][col] = other(player);
    const block = DIRECTIONS.reduce((sum, [dr, dc]) => { const x = lineInfo(board, row, col, other(player), dr, dc); return sum + x.count * x.count * 8 + x.open * 2; }, 0);
    board[row][col] = 0;
    candidates.set(keyOf(row, col), { move: { row, col }, score: own + block * 1.15 - (Math.abs(row - 7) + Math.abs(col - 7)) * 0.15 });
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.move);
};

const immediateWinningMoves = (board: Cell[][], player: Player, rule: SearchRule) =>
  winningPoints(board, player, rule).filter((move) => isLegalMove(board, move, player, rule));

const sameMove = (a: Move, b: Move) => a.row === b.row && a.col === b.col;

const patternScore = (count: number, open: number, side: Player, rule: SearchRule) => winningCount(count, side, rule) ? 1_000_000 : count > 5 ? 18_000 : count === 4 && open === 2 ? 80_000 : count === 4 ? 12_000 : count === 3 && open === 2 ? 4_000 : count === 3 ? 600 : count === 2 && open === 2 ? 120 : count * 8;
const evaluate = (board: Cell[][], player: Player, rule: SearchRule) => {
  let score = 0;
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) if (board[row][col] === player || board[row][col] === other(player)) {
    const side = board[row][col] as Player;
    for (const [dr, dc] of DIRECTIONS) { const info = lineInfo(board, row, col, side, dr, dc); score += side === player ? patternScore(info.count, info.open, side, rule) : -patternScore(info.count, info.open, side, rule) * 1.08; }
  }
  return score;
};

const zobrist = Array.from({ length: SIZE * SIZE }, (_, index) => [BigInt((index + 1) * 2654435761 >>> 0), BigInt((index + 1) * 1597334677 >>> 0)] as const);
const hashBoard = (board: Cell[][], side: Player) => { let hash = BigInt(side); for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) { const cell = board[row][col]; if (cell) hash ^= zobrist[keyOf(row, col)][cell - 1]; } return hash.toString(); };
type Bound = "exact" | "lower" | "upper";
interface TTEntry { depth: number; score: number; bound: Bound; best?: Move; generation: number; }

export const findBestMove = (input: Cell[][], player: Player, options: SearchOptions = {}): SearchResult => {
  const board = cloneBoard(input); const started = performance.now(); const budget = options.timeBudgetMs ?? 900; const maxDepth = options.maxDepth ?? 7; const limit = options.candidateLimit ?? 12; const rule: SearchRule = options.rule ?? ruleFromLegacy(options.renjuRules ?? true); const table = new Map<string, TTEntry>(); let nodes = 0; let rejected = 0; let generation = 0; const ownWins = immediateWinningMoves(board, player, rule); const opponentWins = immediateWinningMoves(board, other(player), rule); const forcedBlocks = opponentWins.filter((move) => isLegalMove(board, move, player, rule)); let best = ownWins[0] || forcedBlocks[0] || candidateMoves(board, player, limit, rule)[0] || null; let bestScore = -Infinity; let completedDepth = 0;
  const ordered = (side: Player, ttBest?: Move) => { const moves = candidateMoves(board, side, limit, rule); if (ttBest) moves.sort((a, b) => (a.row === ttBest.row && a.col === ttBest.col ? -1 : b.row === ttBest.row && b.col === ttBest.col ? 1 : 0)); return moves; };
  const search = (side: Player, depth: number, alpha: number, beta: number): number => {
    nodes += 1; if ((nodes & 127) === 0 && performance.now() - started >= budget) throw new Error("budget");
    const key = hashBoard(board, side), alphaStart = alpha; const cached = table.get(key); if (cached && cached.depth >= depth) { if (cached.bound === "exact") return cached.score; if (cached.bound === "lower") alpha = Math.max(alpha, cached.score); else beta = Math.min(beta, cached.score); if (alpha >= beta) return cached.score; }
    if (!depth) return evaluate(board, player, rule);
    const ownWins = immediateWinningMoves(board, side, rule);
    if (ownWins.length) return side === player ? 1_000_000 + depth : -1_000_000 - depth;
    const opponentWins = immediateWinningMoves(board, other(side), rule);
    let moves = ordered(side, cached?.best);
    if (opponentWins.length) {
      moves = moves.filter((move) => opponentWins.some((win) => sameMove(win, move)));
      if (!moves.length) return side === player ? -1_000_000 - depth : 1_000_000 + depth;
    }
    if (!moves.length) return evaluate(board, player, rule);
    let value = side === player ? -Infinity : Infinity; let pv: Move | undefined;
    for (const move of moves) { board[move.row][move.col] = side; const score = winAt(board, move, side, rule) ? (side === player ? 1_000_000 + depth : -1_000_000 - depth) : search(other(side), depth - 1, alpha, beta); board[move.row][move.col] = 0; if (side === player ? score > value : score < value) { value = score; pv = move; } if (side === player) alpha = Math.max(alpha, value); else beta = Math.min(beta, value); if (beta <= alpha) break; }
    const bound: Bound = value <= alphaStart ? "upper" : value >= beta ? "lower" : "exact"; table.set(key, { depth, score: value, bound, best: pv, generation }); return value;
  };
  for (let depth = 1; depth <= maxDepth; depth += 1) { generation += 1; try { let moves = ordered(player, best || undefined); if (ownWins.length) moves = ownWins; else if (opponentWins.length) moves = moves.filter((move) => forcedBlocks.some((block) => sameMove(block, move))); let levelBest = best, levelScore = -Infinity; for (const move of moves) { if (!isLegalMove(board, move, player, rule)) { rejected += 1; continue; } board[move.row][move.col] = player; const score = winAt(board, move, player, rule) ? 1_000_000 + depth : search(other(player), depth - 1, -Infinity, Infinity); board[move.row][move.col] = 0; if (score > levelScore) { levelScore = score; levelBest = move; } } if (levelBest) best = levelBest; bestScore = levelScore; completedDepth = depth; } catch { break; } }
  return { move: best, score: bestScore, depth: completedDepth, nodes, elapsedMs: performance.now() - started, illegalRejected: rejected, reason: completedDepth >= maxDepth ? "completed" : "budget" };
};
import { evaluateRenjuMove } from "../game";
import type { Cell as GameCell } from "../types";
