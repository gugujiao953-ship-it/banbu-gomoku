import { boardAt } from "./game";
import { createPuzzleDocument, type Puzzle } from "./puzzles";
import { searchVcf, verifyVcfProof } from "./vcf";
import type { RuleSet } from "./types";

export interface AiBenchmarkOptions {
  collectionTitle?: string;
  rule?: RuleSet;
  maxSteps?: number;
  timeBudgetMs?: number;
  nodeBudget?: number;
}

export interface AiBenchmarkCaseResult {
  puzzleId: string;
  title: string;
  passed: boolean;
  status: "win" | "not-found" | "budget";
  steps: number;
  nodes: number;
  elapsedMs: number;
  reason: string;
}

/** The native set is named exactly like this in the supplied puzzle library.
 * Keeping the selector explicit prevents an unrelated imported collection from
 * silently becoming the strength gate. */
export const selectAdvancedThreeMovePuzzles = (puzzles: Puzzle[], collectionTitle = "") => /三手胜.*高级/.test(collectionTitle)
  ? puzzles
  : puzzles.filter((puzzle) => /三手胜.*高级/.test(puzzle.title));

/**
 * Strength gate for the local tactical engine. A puzzle passes only when VCF
 * finds a principal variation of at most maxSteps plies and the full proof tree
 * survives an independent legal-defense verification. A single lucky line is
 * therefore never counted as a solved advanced problem.
 */
export function benchmarkAdvancedThreeMovePuzzles(puzzles: Puzzle[], options: AiBenchmarkOptions = {}): AiBenchmarkCaseResult[] {
  const rule = options.rule || "renju";
  const maxSteps = Math.max(1, options.maxSteps || 15);
  const maxAttackMoves = Math.max(1, Math.floor((maxSteps + 1) / 2));
  return selectAdvancedThreeMovePuzzles(puzzles, options.collectionTitle).map((puzzle) => {
    const session = createPuzzleDocument(puzzle);
    const board = boardAt(session.document, session.initialNodeId);
    const result = searchVcf(board, puzzle.player, {
      rule,
      maxAttackMoves,
      timeBudgetMs: options.timeBudgetMs || 700,
      nodeBudget: options.nodeBudget || 70000,
    });
    const verified = result.status === "win" ? verifyVcfProof(board, result.proof, puzzle.player, rule) : { valid: false, error: "没有完成强制胜证明" };
    const steps = result.principalVariation.length;
    const passed = result.status === "win" && verified.valid && steps <= maxSteps;
    return {
      puzzleId: puzzle.id,
      title: puzzle.title,
      passed,
      status: result.status,
      steps,
      nodes: result.nodes,
      elapsedMs: result.elapsedMs,
      reason: passed ? `已验证，主变化 ${steps} 步` : verified.error || `主变化超过 ${maxSteps} 步或未找到证明`,
    };
  });
}
