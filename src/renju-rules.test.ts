import { describe, expect, it } from "vitest";
import { emptyBoard, evaluateRenjuMove, forbiddenPoints, winningLinesAt } from "./game";
import type { Cell, Position } from "./types";

const black = (board: Cell[][], points: Position[]) => points.forEach(({ row, col }) => { board[row][col] = "black"; });

describe("renju rule evaluation", () => {
  it("marks an overline but keeps an exact black five legal", () => {
    const overline = emptyBoard();
    black(overline, [2, 3, 4, 5, 6].map((col) => ({ row: 7, col })));
    expect(evaluateRenjuMove(overline, { row: 7, col: 7 }).reason).toBe("长连禁手");
    overline[7][7] = "black";
    expect(winningLinesAt(overline, { row: 7, col: 7 }, "renju")).toHaveLength(0);

    const five = emptyBoard();
    black(five, [3, 4, 5, 6].map((col) => ({ row: 7, col })));
    expect(evaluateRenjuMove(five, { row: 7, col: 7 })).toMatchObject({ legal: true, exactFive: true, reason: null });
  });

  it("detects independent horizontal and vertical fours", () => {
    const board = emptyBoard();
    black(board, [
      { row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 8 },
      { row: 5, col: 7 }, { row: 6, col: 7 }, { row: 8, col: 7 },
    ]);
    expect(evaluateRenjuMove(board, { row: 7, col: 7 })).toMatchObject({ legal: false, forbidden: "double-four", reason: "四四禁手" });
  });

  it("detects a true double three and ignores a blocked pseudo three", () => {
    const board = emptyBoard();
    black(board, [{ row: 7, col: 6 }, { row: 7, col: 8 }, { row: 6, col: 7 }, { row: 8, col: 7 }]);
    expect(evaluateRenjuMove(board, { row: 7, col: 7 })).toMatchObject({ legal: false, forbidden: "double-three", reason: "三三禁手" });

    board[7][5] = "white";
    expect(evaluateRenjuMove(board, { row: 7, col: 7 }).reason).toBeNull();
  });

  it("returns red-X candidates without including occupied points", () => {
    const board = emptyBoard();
    black(board, [2, 3, 4, 5, 6].map((col) => ({ row: 7, col })));
    const points = forbiddenPoints(board);
    expect(points).toContainEqual({ row: 7, col: 7, reason: "长连禁手" });
    expect(points.some((point) => point.row === 7 && point.col === 6)).toBe(false);
  });

  it("returns the exact winning stones for horizontal and diagonal fives", () => {
    const board = emptyBoard();
    black(board, [3, 4, 5, 6, 7].map((col) => ({ row: 8, col })));
    board[4][4] = board[5][5] = board[6][6] = board[7][7] = board[8][8] = "white";
    expect(winningLinesAt(board, { row: 8, col: 7 }, "renju")[0]).toHaveLength(5);
    expect(winningLinesAt(board, { row: 8, col: 8 }, "renju")[0]).toHaveLength(5);
  });
});
