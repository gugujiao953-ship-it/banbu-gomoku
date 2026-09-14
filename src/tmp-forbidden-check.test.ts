import { describe, expect, it } from "vitest";
import { forbiddenPoints } from "./game";

describe("temp: forbiddenPoints construction check", () => {
  it("finds the double-three at H8 for the constructed board", () => {
    const board: (string | null)[][] = Array.from({ length: 15 }, () => Array(15).fill(null));
    board[7][5] = "black"; board[7][6] = "black"; board[5][7] = "black"; board[6][7] = "black";
    board[9][5] = "white"; board[9][9] = "white";
    const points = forbiddenPoints(board as never);
    expect(points.filter((point) => point.row === 7 && point.col === 7)).toHaveLength(1);
  });
});
