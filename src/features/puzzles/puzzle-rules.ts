import { forbiddenReason } from "../../game";
import type { Cell, Player, Position, RuleSet } from "../../types";

export type PuzzleRuleMode = "forbidden" | "unrestricted";
export type PuzzleRuleSource = "puzzle" | "collection" | "preference";

export interface PuzzleRuleCarrier {
  rule?: RuleSet;
}

export interface ResolvedPuzzleRule {
  mode: PuzzleRuleMode;
  rule: RuleSet;
  source: PuzzleRuleSource;
  locked: boolean;
}

export interface PuzzleMoveLegality {
  legal: boolean;
  reason: string | null;
}

export const PUZZLE_RULE_PREFERENCE_KEY = "banbu-puzzle-rule-preference-v1";

export const puzzleRuleSet = (mode: PuzzleRuleMode): RuleSet => mode === "forbidden" ? "renju" : "freestyle";

export const puzzleRuleMode = (rule?: RuleSet): PuzzleRuleMode | undefined => rule === "renju"
  ? "forbidden"
  : rule === "standard" || rule === "freestyle"
    ? "unrestricted"
    : undefined;

/** Only explicit, unambiguous metadata is accepted. Numeric rule codes differ
 * between third-party puzzle formats and are deliberately not guessed. */
export function parsePuzzleRule(value: unknown): RuleSet | undefined {
  if (value === true) return "renju";
  if (value === false) return "freestyle";
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["renju", "forbidden", "forbidden-enabled", "禁手", "有禁手"].includes(normalized)) return "renju";
  if (["standard", "freestyle", "unrestricted", "no-forbidden", "无禁手", "自由五子棋"].includes(normalized)) return normalized === "standard" ? "standard" : "freestyle";
  return undefined;
}

export function loadPuzzleRulePreference(): PuzzleRuleMode {
  try {
    const value = localStorage.getItem(PUZZLE_RULE_PREFERENCE_KEY);
    return value === "forbidden" ? "forbidden" : "unrestricted";
  } catch {
    // Old puzzle sessions allowed every user move and counted overlines as a
    // win, so unrestricted is the compatibility default.
    return "unrestricted";
  }
}

export function savePuzzleRulePreference(value: PuzzleRuleMode) {
  try { localStorage.setItem(PUZZLE_RULE_PREFERENCE_KEY, value); } catch { /* optional preference */ }
}

export function resolvePuzzleRule(
  puzzle: PuzzleRuleCarrier | undefined,
  collection: PuzzleRuleCarrier | undefined,
  preference: PuzzleRuleMode,
): ResolvedPuzzleRule {
  const puzzleMode = puzzleRuleMode(puzzle?.rule);
  if (puzzleMode) return { mode: puzzleMode, rule: puzzleRuleSet(puzzleMode), source: "puzzle", locked: true };
  const collectionMode = puzzleRuleMode(collection?.rule);
  if (collectionMode) return { mode: collectionMode, rule: puzzleRuleSet(collectionMode), source: "collection", locked: true };
  return { mode: preference, rule: puzzleRuleSet(preference), source: "preference", locked: false };
}

export function puzzleMoveLegality(board: Cell[][], position: Position, player: Player, mode: PuzzleRuleMode): PuzzleMoveLegality {
  if (board[position.row]?.[position.col]) return { legal: false, reason: "该位置已有棋子" };
  if (mode !== "forbidden" || player !== "black") return { legal: true, reason: null };
  const reason = forbiddenReason(board, position);
  return reason ? { legal: false, reason } : { legal: true, reason: null };
}

/** Defensive fallback only: normal AI paths should already return a legal
 * move. If an engine produces a forbidden black point, keep the puzzle
 * session consistent instead of demonstrating an illegal continuation. */
export function fallbackLegalPuzzleMove(board: Cell[][], player: Player, mode: PuzzleRuleMode): Position | null {
  const center = (board.length - 1) / 2;
  const candidates: Position[] = [];
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < board.length; col += 1) {
    const position = { row, col };
    if (puzzleMoveLegality(board, position, player, mode).legal) candidates.push(position);
  }
  candidates.sort((a, b) => (Math.abs(a.row - center) + Math.abs(a.col - center)) - (Math.abs(b.row - center) + Math.abs(b.col - center)));
  return candidates[0] || null;
}
