// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { emptyBoard } from "../../game";
import { winnerAt } from "../../puzzle-ai";
import type { Cell, Position } from "../../types";
import {
  DAILY_PUZZLE_RULE_MODE,
  PUZZLE_RULE_PREFERENCE_KEY,
  loadPuzzleRulePreference,
  parsePuzzleRule,
  puzzleMoveLegality,
  resolveDailyPuzzleRule,
  resolvePuzzleRule,
  savePuzzleRulePreference,
} from "./puzzle-rules";

const place = (board: Cell[][], player: "black" | "white", points: Position[]) => points.forEach(({ row, col }) => { board[row][col] = player; });
const row = (at: number, columns: number[]) => columns.map((col) => ({ row: at, col }));
const column = (at: number, rows: number[]) => rows.map((rowIndex) => ({ row: rowIndex, col: at }));

describe("doing-puzzle rule compatibility", () => {
  beforeEach(() => localStorage.clear());

  it("keeps old rule-less collections unrestricted by default and persists an explicit choice", () => {
    expect(loadPuzzleRulePreference()).toBe("unrestricted");
    savePuzzleRulePreference("forbidden");
    expect(localStorage.getItem(PUZZLE_RULE_PREFERENCE_KEY)).toBe("forbidden");
    expect(loadPuzzleRulePreference()).toBe("forbidden");
  });

  it("uses puzzle metadata before collection metadata before the user preference", () => {
    expect(resolvePuzzleRule({ rule: "freestyle" }, { rule: "renju" }, "forbidden")).toMatchObject({ mode: "unrestricted", source: "puzzle", locked: true });
    expect(resolvePuzzleRule({}, { rule: "renju" }, "unrestricted")).toMatchObject({ mode: "forbidden", source: "collection", locked: true });
    expect(resolvePuzzleRule({}, {}, "forbidden")).toMatchObject({ mode: "forbidden", source: "preference", locked: false });
  });

  it("accepts explicit rule metadata but never guesses third-party numeric codes", () => {
    expect(parsePuzzleRule("renju")).toBe("renju");
    expect(parsePuzzleRule("无禁手")).toBe("freestyle");
    expect(parsePuzzleRule(true)).toBe("renju");
    expect(parsePuzzleRule(2)).toBeUndefined();
  });

  it("blocks black overline, double-three and double-four only in forbidden mode", () => {
    const overline = emptyBoard();
    place(overline, "black", row(7, [2, 3, 4, 5, 6]));
    expect(puzzleMoveLegality(overline, { row: 7, col: 7 }, "black", "forbidden")).toMatchObject({ legal: false, reason: "长连禁手" });
    expect(puzzleMoveLegality(overline, { row: 7, col: 7 }, "black", "unrestricted")).toEqual({ legal: true, reason: null });

    const doubleThree = emptyBoard();
    place(doubleThree, "black", [...row(7, [6, 8]), ...column(7, [6, 8])]);
    expect(puzzleMoveLegality(doubleThree, { row: 7, col: 7 }, "black", "forbidden").reason).toBe("三三禁手");

    const doubleFour = emptyBoard();
    place(doubleFour, "black", [...row(7, [5, 6, 8]), ...column(7, [5, 6, 8])]);
    expect(puzzleMoveLegality(doubleFour, { row: 7, col: 7 }, "black", "forbidden").reason).toBe("四四禁手");
  });

  it("never applies black forbidden restrictions to white and uses the selected win rule", () => {
    const board = emptyBoard();
    place(board, "white", row(7, [2, 3, 4, 5, 6]));
    expect(puzzleMoveLegality(board, { row: 7, col: 7 }, "white", "forbidden")).toEqual({ legal: true, reason: null });
    board[7][7] = "white";
    expect(winnerAt(board, { row: 7, col: 7 }, "renju")).toBe("white");

    const black = emptyBoard();
    place(black, "black", row(8, [3, 4, 5, 6, 7, 8]));
    expect(winnerAt(black, { row: 8, col: 7 }, "renju")).toBeNull();
    expect(winnerAt(black, { row: 8, col: 7 }, "freestyle")).toBe("black");
  });
});

/**
 * 每日一题的默认规则（用户 2026-10-12：「不用切换有无禁，默认就有禁吧，
 * 但是不是全局生效，就这个生效」）。
 *
 * 背景：内置 17 个题集一个都没声明规则，若沿用"用户偏好"就会默认成无禁手，
 * 而 66% 的黑先题里禁手正是判据。所以每日一题固定默认有禁手，且**只作用于它自己**。
 */
describe("每日一题的默认规则", () => {
  beforeEach(() => localStorage.clear());

  it("没声明规则的题：每日一题按有禁手判（不看全局偏好）", () => {
    expect(resolveDailyPuzzleRule({}, {})).toMatchObject({ mode: "forbidden", rule: "renju", source: "preference" });
    expect(DAILY_PUZZLE_RULE_MODE).toBe("forbidden");
  });

  it("题目 / 题集显式声明的规则照旧优先（显式元数据压过默认值）", () => {
    expect(resolveDailyPuzzleRule({ rule: "freestyle" }, { rule: "renju" }))
      .toMatchObject({ mode: "unrestricted", source: "puzzle", locked: true });
    expect(resolveDailyPuzzleRule({}, { rule: "renju" }))
      .toMatchObject({ mode: "forbidden", source: "collection", locked: true });
  });

  it("不读也不写全局偏好：偏好设成无禁手，每日一题仍是有禁手，偏好本身也没被动", () => {
    savePuzzleRulePreference("unrestricted");
    expect(resolveDailyPuzzleRule({}, {}).mode).toBe("forbidden");
    // 关键：每日一题不去改那个键 —— 它属于「打谱 → 做题」那套（自由五子棋类的题在那儿）
    expect(localStorage.getItem(PUZZLE_RULE_PREFERENCE_KEY)).toBe("unrestricted");
    expect(loadPuzzleRulePreference()).toBe("unrestricted");
  });

  it("反向确认：「打谱 → 做题」那条路不受影响（偏好仍说了算）", () => {
    // 同一道没声明规则的题：工作区那条路按用户偏好走，每日一题那条路固定有禁手
    expect(resolvePuzzleRule({}, {}, "unrestricted")).toMatchObject({ mode: "unrestricted", source: "preference" });
    expect(resolvePuzzleRule({}, {}, "forbidden")).toMatchObject({ mode: "forbidden", source: "preference" });
    expect(resolveDailyPuzzleRule({}, {}).mode).toBe("forbidden");
  });
});

