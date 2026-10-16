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

/**
 * 每日一题的默认规则：**固定按有禁手**（用户 2026-10-12：「不用切换有无禁，默认就有禁吧，
 * 但是不是全局生效，就这个生效」）。
 *
 * 为什么要单给它一条默认：内置的 17 个题集**没有一个声明规则**（`白先VCF_puzzle` /
 * `白先胜100题_puzzle` 里那个 `"rule": 2` 是数字编码，`parsePuzzleRule` 刻意不猜），
 * 于是解析一路落到"用户偏好"，而偏好的默认是**无禁手**——实测 6355 道内置题里
 * **4191 道（66%）是黑先**，玩家执黑时禁手正是判据本身：默认模式下玩家能把三三/四四/
 * 长连当成正常一手落下去，黑棋长连还会被算成赢。实测过：同一道黑先三三题，
 * 默认模式下那一手**被接受**，改成有禁手才提示「三三禁手」。
 *
 * 边界（用户点名"不是全局生效"）：
 *  · **不读也不写** `PUZZLE_RULE_PREFERENCE_KEY` —— 那个偏好是「打谱 → 做题」那套在用，
 *    动了它会把自由五子棋类的题（黑棋长连本来算赢）一起判错；
 *  · 题目 / 题集**显式声明的规则照旧优先**（显式元数据永远压过默认值）。
 */
export const DAILY_PUZZLE_RULE_MODE: PuzzleRuleMode = "forbidden";

/** 每日一题专用的规则解析：默认有禁手，其余顺序与 `resolvePuzzleRule` 完全一致。 */
export const resolveDailyPuzzleRule = (
  puzzle: PuzzleRuleCarrier | undefined,
  collection: PuzzleRuleCarrier | undefined,
): ResolvedPuzzleRule => resolvePuzzleRule(puzzle, collection, DAILY_PUZZLE_RULE_MODE);

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
