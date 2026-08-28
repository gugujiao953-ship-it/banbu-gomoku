import { findBestMove as findEnhancedMove } from "./renju-ai/engine";
import { winningLinesAt } from "./game";
import type { Cell, Player, Position, RuleSet } from "./types";

export function winnerAt(board: Cell[][], position: Position, rule: RuleSet = "freestyle"): Player | null {
  const player = board[position.row]?.[position.col];
  return player && winningLinesAt(board, position, rule).length ? player : null;
}

export interface AiSearchOptions { maxDepth?: number; timeBudgetMs?: number; width?: number; rule?: RuleSet }

export interface AiMoveResult {
  move: Position | null;
  score: number;
  depth: number;
  nodes: number;
  elapsedMs: number;
  illegalRejected: number;
  reason: string;
  source: "alpha-beta" | "verified-vcf" | "rapfi";
  principalVariation?: Array<Position & { player: Player }>;
}

/** Enhanced Renju search. The worker-facing API stays string-based; the engine
 * uses compact numeric cells so legality and search share one implementation. */
export function findBestMoveDetailed(board: Cell[][], player: Player, options: AiSearchOptions = {}): AiMoveResult {
  const numericBoard = board.map((row) => row.map((cell) => cell === "black" ? 1 : cell === "white" ? 2 : 0)) as (0 | 1 | 2)[][];
  const result = findEnhancedMove(numericBoard, player === "black" ? 1 : 2, {
    maxDepth: options.maxDepth,
    timeBudgetMs: options.timeBudgetMs,
    candidateLimit: options.width,
    renjuRules: options.rule ? options.rule === "renju" : true,
  });
  return { ...result, source: "alpha-beta" };
}

export function findBestMove(board: Cell[][], player: Player, options: AiSearchOptions = {}): Position | null {
  return findBestMoveDetailed(board, player, options).move;
}
