export type Player = 1 | 2;
export type Cell = 0 | Player;
export interface Move { row: number; col: number; }
export interface SearchOptions { maxDepth?: number; timeBudgetMs?: number; candidateLimit?: number; renjuRules?: boolean; }
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
export const winAt = (board: Cell[][], move: Move, player: Player): boolean => DIRECTIONS.some(([dr, dc]) => lineInfo(board, move.row, move.col, player, dr, dc).count >= 5);
const overlineAt = (board: Cell[][], move: Move, player: Player) => DIRECTIONS.some(([dr, dc]) => lineInfo(board, move.row, move.col, player, dr, dc).count > 5);

const winningPoints = (board: Cell[][], player: Player) => {
  const result: Move[] = [];
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) if (board[row][col] === 0) {
    board[row][col] = player;
    if (winAt(board, { row, col }, player)) result.push({ row, col });
    board[row][col] = 0;
  }
  return result;
};

const lineContains = (board: Cell[][], move: Move, point: Move, player: Player, dr: number, dc: number) => {
  let row = point.row;
  let col = point.col;
  while (inside(row - dr, col - dc) && board[row - dr][col - dc] === player) {
    row -= dr;
    col -= dc;
  }
  while (inside(row, col) && board[row][col] === player) {
    if (row === move.row && col === move.col) return true;
    row += dr;
    col += dc;
  }
  return false;
};

/** Count directional threats made by the just-played stone.
 * A direction is counted once even when both ends are winning points.
 * This is the important distinction between a double-four and two exits
 * from the same four.
 */
const threatDirections = (board: Cell[][], move: Move, player: Player, targetCount: 4 | 5) => {
  let directions = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let found = false;
    for (let row = 0; row < SIZE && !found; row += 1) for (let col = 0; col < SIZE && !found; col += 1) {
      if (board[row][col] !== 0) continue;
      const extension = { row, col };
      board[row][col] = player;
      const info = lineInfo(board, row, col, player, dr, dc);
      if (info.count === targetCount && lineContains(board, move, extension, player, dr, dc)) found = true;
      board[row][col] = 0;
    }
    if (found) directions += 1;
  }
  return directions;
};

const openThreeDirections = (board: Cell[][], move: Move, player: Player) => {
  let directions = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let continuations = 0;
    for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] !== 0) continue;
      board[row][col] = player;
      const info = lineInfo(board, row, col, player, dr, dc);
      if (info.count === 4 && info.open > 0 && lineContains(board, move, { row, col }, player, dr, dc)) continuations += 1;
      board[row][col] = 0;
    }
    if (continuations >= 2) directions += 1;
  }
  return directions;
};

/** Renju legality: black only; exact five is legal, overline/double-four/double-three illegal. */
export const isLegalMove = (board: Cell[][], move: Move, player: Player, renjuRules = true): boolean => {
  if (!inside(move.row, move.col) || board[move.row][move.col] !== 0) return false;
  if (!renjuRules || player === 2) return true;
  board[move.row][move.col] = player;
  if (overlineAt(board, move, player)) { board[move.row][move.col] = 0; return false; }
  // Exact five is a legal winning move even when the placement also exposes
  // more than one continuation point; the double-four restriction applies to
  // non-winning threats.
  if (winAt(board, move, player)) { board[move.row][move.col] = 0; return true; }
  if (threatDirections(board, move, player, 5) >= 2) { board[move.row][move.col] = 0; return false; }
  const threes = openThreeDirections(board, move, player);
  board[move.row][move.col] = 0;
  return threes < 2;
};

const candidateMoves = (board: Cell[][], player: Player, limit: number, renjuRules: boolean): Move[] => {
  const occupied: Move[] = [];
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) if (board[row][col]) occupied.push({ row, col });
  if (!occupied.length) return [{ row: 7, col: 7 }];
  const candidates = new Map<number, { move: Move; score: number }>();
  for (const stone of occupied) for (let row = Math.max(0, stone.row - 2); row <= Math.min(SIZE - 1, stone.row + 2); row += 1) for (let col = Math.max(0, stone.col - 2); col <= Math.min(SIZE - 1, stone.col + 2); col += 1) if (board[row][col] === 0 && isLegalMove(board, { row, col }, player, renjuRules)) {
    board[row][col] = player;
    const own = DIRECTIONS.reduce((sum, [dr, dc]) => { const x = lineInfo(board, row, col, player, dr, dc); return sum + x.count * x.count * 10 + x.open * 3; }, 0);
    board[row][col] = other(player);
    const block = DIRECTIONS.reduce((sum, [dr, dc]) => { const x = lineInfo(board, row, col, other(player), dr, dc); return sum + x.count * x.count * 8 + x.open * 2; }, 0);
    board[row][col] = 0;
    candidates.set(keyOf(row, col), { move: { row, col }, score: own + block * 1.15 - (Math.abs(row - 7) + Math.abs(col - 7)) * 0.15 });
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.move);
};

const immediateWinningMoves = (board: Cell[][], player: Player, renjuRules: boolean) =>
  winningPoints(board, player).filter((move) => isLegalMove(board, move, player, renjuRules));

const sameMove = (a: Move, b: Move) => a.row === b.row && a.col === b.col;

const patternScore = (count: number, open: number) => count >= 5 ? 1_000_000 : count === 4 && open === 2 ? 80_000 : count === 4 ? 12_000 : count === 3 && open === 2 ? 4_000 : count === 3 ? 600 : count === 2 && open === 2 ? 120 : count * 8;
const evaluate = (board: Cell[][], player: Player) => {
  let score = 0;
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) if (board[row][col] === player || board[row][col] === other(player)) {
    const side = board[row][col] as Player;
    for (const [dr, dc] of DIRECTIONS) { const info = lineInfo(board, row, col, side, dr, dc); score += side === player ? patternScore(info.count, info.open) : -patternScore(info.count, info.open) * 1.08; }
  }
  return score;
};

const zobrist = Array.from({ length: SIZE * SIZE }, (_, index) => [BigInt((index + 1) * 2654435761 >>> 0), BigInt((index + 1) * 1597334677 >>> 0)] as const);
const hashBoard = (board: Cell[][], side: Player) => { let hash = BigInt(side); for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) { const cell = board[row][col]; if (cell) hash ^= zobrist[keyOf(row, col)][cell - 1]; } return hash.toString(); };
type Bound = "exact" | "lower" | "upper";
interface TTEntry { depth: number; score: number; bound: Bound; best?: Move; generation: number; }

export const findBestMove = (input: Cell[][], player: Player, options: SearchOptions = {}): SearchResult => {
  const board = cloneBoard(input); const started = performance.now(); const budget = options.timeBudgetMs ?? 900; const maxDepth = options.maxDepth ?? 7; const limit = options.candidateLimit ?? 12; const renjuRules = options.renjuRules ?? true; const table = new Map<string, TTEntry>(); let nodes = 0; let rejected = 0; let generation = 0; const ownWins = immediateWinningMoves(board, player, renjuRules); const opponentWins = immediateWinningMoves(board, other(player), renjuRules); const forcedBlocks = opponentWins.filter((move) => isLegalMove(board, move, player, renjuRules)); let best = ownWins[0] || forcedBlocks[0] || candidateMoves(board, player, limit, renjuRules)[0] || null; let bestScore = -Infinity; let completedDepth = 0;
  const ordered = (side: Player, ttBest?: Move) => { const moves = candidateMoves(board, side, limit, renjuRules); if (ttBest) moves.sort((a, b) => (a.row === ttBest.row && a.col === ttBest.col ? -1 : b.row === ttBest.row && b.col === ttBest.col ? 1 : 0)); return moves; };
  const search = (side: Player, depth: number, alpha: number, beta: number): number => {
    nodes += 1; if ((nodes & 127) === 0 && performance.now() - started >= budget) throw new Error("budget");
    const key = hashBoard(board, side), alphaStart = alpha; const cached = table.get(key); if (cached && cached.depth >= depth) { if (cached.bound === "exact") return cached.score; if (cached.bound === "lower") alpha = Math.max(alpha, cached.score); else beta = Math.min(beta, cached.score); if (alpha >= beta) return cached.score; }
    if (!depth) return evaluate(board, player);
    const ownWins = immediateWinningMoves(board, side, renjuRules);
    if (ownWins.length) return side === player ? 1_000_000 + depth : -1_000_000 - depth;
    const opponentWins = immediateWinningMoves(board, other(side), renjuRules);
    let moves = ordered(side, cached?.best);
    if (opponentWins.length) {
      moves = moves.filter((move) => opponentWins.some((win) => sameMove(win, move)));
      if (!moves.length) return side === player ? -1_000_000 - depth : 1_000_000 + depth;
    }
    if (!moves.length) return evaluate(board, player);
    let value = side === player ? -Infinity : Infinity; let pv: Move | undefined;
    for (const move of moves) { board[move.row][move.col] = side; const score = winAt(board, move, side) ? (side === player ? 1_000_000 + depth : -1_000_000 - depth) : search(other(side), depth - 1, alpha, beta); board[move.row][move.col] = 0; if (side === player ? score > value : score < value) { value = score; pv = move; } if (side === player) alpha = Math.max(alpha, value); else beta = Math.min(beta, value); if (beta <= alpha) break; }
    const bound: Bound = value <= alphaStart ? "upper" : value >= beta ? "lower" : "exact"; table.set(key, { depth, score: value, bound, best: pv, generation }); return value;
  };
  for (let depth = 1; depth <= maxDepth; depth += 1) { generation += 1; try { let moves = ordered(player, best || undefined); if (ownWins.length) moves = ownWins; else if (opponentWins.length) moves = moves.filter((move) => forcedBlocks.some((block) => sameMove(block, move))); let levelBest = best, levelScore = -Infinity; for (const move of moves) { if (!isLegalMove(board, move, player, renjuRules)) { rejected += 1; continue; } board[move.row][move.col] = player; const score = winAt(board, move, player) ? 1_000_000 + depth : search(other(player), depth - 1, -Infinity, Infinity); board[move.row][move.col] = 0; if (score > levelScore) { levelScore = score; levelBest = move; } } if (levelBest) best = levelBest; bestScore = levelScore; completedDepth = depth; } catch { break; } }
  return { move: best, score: bestScore, depth: completedDepth, nodes, elapsedMs: performance.now() - started, illegalRejected: rejected, reason: completedDepth >= maxDepth ? "completed" : "budget" };
};
