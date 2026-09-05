import { describe, expect, it } from "vitest";
import { emptyBoard, isLegalMove, winAt, type Cell, type Move, type Player } from "./engine";

const place = (board: Cell[][], player: Player, points: Move[]) => {
  points.forEach(({ row, col }) => { board[row][col] = player; });
};

describe("AI search rule semantics", () => {
  it("uses exact five for standard and black Renju, but five-or-more for freestyle and white Renju", () => {
    const board = emptyBoard();
    place(board, 1, [3, 4, 5, 6, 7, 8].map((col) => ({ row: 7, col })));
    expect(winAt(board, { row: 7, col: 8 }, 1, "standard")).toBe(false);
    expect(winAt(board, { row: 7, col: 8 }, 1, "renju")).toBe(false);
    expect(winAt(board, { row: 7, col: 8 }, 1, "freestyle")).toBe(true);

    const white = emptyBoard();
    place(white, 2, [3, 4, 5, 6, 7, 8].map((col) => ({ row: 7, col })));
    expect(winAt(white, { row: 7, col: 8 }, 2, "renju")).toBe(true);
  });

  it("accepts a black exact five before an overline in another direction", () => {
    const board = emptyBoard();
    place(board, 1, [
      { row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 8 }, { row: 7, col: 9 },
      { row: 4, col: 7 }, { row: 5, col: 7 }, { row: 6, col: 7 }, { row: 8, col: 7 }, { row: 9, col: 7 },
    ]);
    expect(isLegalMove(board, { row: 7, col: 7 }, 1, "renju")).toBe(true);
    board[7][7] = 1;
    expect(winAt(board, { row: 7, col: 7 }, 1, "renju")).toBe(true);
  });

  it("allows standard overlines without treating them as a win and rejects black Renju overlines", () => {
    const board = emptyBoard();
    place(board, 1, [3, 4, 5, 6, 7].map((col) => ({ row: 7, col })));
    expect(isLegalMove(board, { row: 7, col: 8 }, 1, "standard")).toBe(true);
    expect(isLegalMove(board, { row: 7, col: 8 }, 1, "freestyle")).toBe(true);
    expect(isLegalMove(board, { row: 7, col: 8 }, 1, "renju")).toBe(false);
  });

  it("shares the canonical same-axis double-four judgement", () => {
    const board = emptyBoard();
    place(board, 1, [3, 5, 6, 9].map((col) => ({ row: 7, col })));
    expect(isLegalMove(board, { row: 7, col: 7 }, 1, "renju")).toBe(false);
  });
});
