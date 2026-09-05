import { describe, expect, it } from "vitest";
import { emptyBoard } from "./game";
import type { Cell, Player, Position } from "./types";
import { isLegalMove, isWinningMove, searchVcf, verifyVcfProof } from "./vcf";

const place = (board: Cell[][], player: Player, points: Position[]) => {
  points.forEach(({ row, col }) => { board[row][col] = player; });
};

const row = (at: number, columns: number[]): Position[] => columns.map((col) => ({ row: at, col }));
const column = (at: number, rows: number[]): Position[] => rows.map((rowIndex) => ({ row: rowIndex, col: at }));

describe("VCF rule semantics", () => {
  it("uses canonical Renju legality when exact five and an overline share one move", () => {
    const board = emptyBoard();
    const move = { row: 7, col: 7 };
    place(board, "black", [
      ...row(7, [5, 6, 8, 9]),
      ...column(7, [4, 5, 6, 8, 9]),
    ]);

    expect(isLegalMove(board, move, "black", "renju")).toBe(true);
    expect(isWinningMove(board, move, "black", "renju")).toBe(true);

    const result = searchVcf(board, "black", {
      rule: "renju",
      maxAttackMoves: 1,
      timeBudgetMs: 500,
      nodeBudget: 20_000,
    });
    expect(result.status).toBe("win");
    expect(result.principalVariation[0]).toMatchObject({ ...move, player: "black" });
    expect(verifyVcfProof(board, result.proof, "black", "renju")).toEqual({ valid: true });
  });

  it("distinguishes standard, freestyle, and Renju overline semantics", () => {
    const move = { row: 7, col: 5 };
    const black = emptyBoard();
    place(black, "black", row(7, [2, 3, 4, 6, 7]));

    expect(isLegalMove(black, move, "black", "standard")).toBe(true);
    expect(isWinningMove(black, move, "black", "standard")).toBe(false);
    expect(isLegalMove(black, move, "black", "freestyle")).toBe(true);
    expect(isWinningMove(black, move, "black", "freestyle")).toBe(true);
    expect(isLegalMove(black, move, "black", "renju")).toBe(false);
    expect(isWinningMove(black, move, "black", "renju")).toBe(false);

    const white = emptyBoard();
    place(white, "white", row(7, [2, 3, 4, 6, 7]));
    expect(isLegalMove(white, move, "white", "renju")).toBe(true);
    expect(isWinningMove(white, move, "white", "renju")).toBe(true);
  });

  it("accepts an overline proof only under a five-or-more rule", () => {
    const board = emptyBoard();
    place(board, "black", row(7, [2, 3, 4, 6, 7]));

    const freestyle = searchVcf(board, "black", {
      rule: "freestyle",
      maxAttackMoves: 1,
      timeBudgetMs: 500,
      nodeBudget: 20_000,
    });
    expect(freestyle.status).toBe("win");
    expect(verifyVcfProof(board, freestyle.proof, "black", "freestyle")).toEqual({ valid: true });
    expect(verifyVcfProof(board, freestyle.proof, "black", "standard").valid).toBe(false);

    const standard = searchVcf(board, "black", {
      rule: "standard",
      maxAttackMoves: 1,
      timeBudgetMs: 500,
      nodeBudget: 20_000,
    });
    expect(standard.status).toBe("not-found");
  });
});
