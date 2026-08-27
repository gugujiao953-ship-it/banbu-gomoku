import { findBestMove as findEnhancedMove } from "../experiments/renju-ai/engine";
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

export interface AiSearchOptions { maxDepth?: number; timeBudgetMs?: number; width?: number }

/** Enhanced Renju search. The worker-facing API stays string-based; the engine
 * uses compact numeric cells so legality and search share one implementation. */
export function findBestMove(board: Cell[][], player: Player, options: AiSearchOptions = {}): Position | null {
  const numericBoard = board.map((row) => row.map((cell) => cell === "black" ? 1 : cell === "white" ? 2 : 0)) as (0 | 1 | 2)[][];
  const result = findEnhancedMove(numericBoard, player === "black" ? 1 : 2, {
    maxDepth: options.maxDepth,
    timeBudgetMs: options.timeBudgetMs,
    candidateLimit: options.width,
  });
  return result.move;
}
