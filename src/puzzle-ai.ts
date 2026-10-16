import { findBestMove as findEnhancedMove } from "./renju-ai/engine";
import { winningLinesAt } from "./game";
import type { Cell, Player, Position, RuleSet } from "./types";

export function winnerAt(board: Cell[][], position: Position, rule: RuleSet = "freestyle"): Player | null {
  const player = board[position.row]?.[position.col];
  return player && winningLinesAt(board, position, rule).length ? player : null;
}

export interface AiSearchOptions { maxDepth?: number; timeBudgetMs?: number; width?: number; rule?: RuleSet }

export interface AiAnalysisCandidate {
  move: Position;
  score?: number;
  winRate?: number;
  nodes?: number;
  depth?: number;
  /** 和棋率（%，KataGo 专属）：本构建的 scoreMean 字段即 drawrate（gtp.cpp:649）。 */
  drawRate?: number;
  /** PV index from the engine stdout stream (0 = principal variation / 当前最强点). */
  pvIndex?: number;
  /** Opening-book strength rank (source === "book"; 越小越强). */
  rank?: number;
  principalVariation?: Array<Position & { player: Player }>;
}

export interface AiMoveResult {
  move: Position | null;
  score: number;
  depth: number;
  /** 引擎实际到达的最大深度（Rapfi 的 INFO SELDEPTH）。与 depth 一起构成「最小-最大」
   *  区间；启发式兜底不产生它。 */
  selDepth?: number;
  nodes: number;
  /** 节点速度（节点/秒）：Rapfi 自报 SPEED 优先，否则按总节点/用时现算。
   *  启发式兜底（alpha-beta 等）不产生它，所以是可选的。 */
  speed?: number;
  elapsedMs: number;
  illegalRejected: number;
  reason: string;
  source: "alpha-beta" | "verified-vcf" | "rapfi" | "book";
  /** 打点簿标签（如 "4*"），仅 source==="book" 时携带。 */
  bookLabel?: string;
  principalVariation?: Array<Position & { player: Player }>;
  /** Win rate is normalized to 0..1 and is only present when the engine emits it. */
  winRate?: number;
  /** True only when Rapfi emitted a score; zero is otherwise kept for legacy callers. */
  scoreAvailable?: boolean;
  /** Root alternatives returned by the engine; heuristic fallback deliberately leaves this absent. */
  candidates?: AiAnalysisCandidate[];
}

/** Enhanced Renju search. The worker-facing API stays string-based; the engine
 * uses compact numeric cells so legality and search share one implementation. */
export function findBestMoveDetailed(board: Cell[][], player: Player, options: AiSearchOptions = {}): AiMoveResult {
  const numericBoard = board.map((row) => row.map((cell) => cell === "black" ? 1 : cell === "white" ? 2 : 0)) as (0 | 1 | 2)[][];
  const result = findEnhancedMove(numericBoard, player === "black" ? 1 : 2, {
    maxDepth: options.maxDepth,
    timeBudgetMs: options.timeBudgetMs,
    candidateLimit: options.width,
    rule: options.rule || "renju",
  });
  return { ...result, source: "alpha-beta" };
}

export function findBestMove(board: Cell[][], player: Player, options: AiSearchOptions = {}): Position | null {
  return findBestMoveDetailed(board, player, options).move;
}
