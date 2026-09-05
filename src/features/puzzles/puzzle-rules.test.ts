// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { emptyBoard } from "../../game";
import { winnerAt } from "../../puzzle-ai";
import type { Cell, Position } from "../../types";
import {
  PUZZLE_RULE_PREFERENCE_KEY,
  loadPuzzleRulePreference,
  parsePuzzleRule,
  puzzleMoveLegality,
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

