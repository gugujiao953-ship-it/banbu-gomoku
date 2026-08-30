import { describe, expect, it } from "vitest";
import { inverseTransformBoardPosition, transformBoardPosition, type BoardRotation } from "./board-transform";

const point = { row: 2, col: 5 };
const rotations: BoardRotation[] = [0, 90, 180, 270];

describe("board content transform", () => {
  it("maps a point around a fixed 15x15 board", () => {
    expect(transformBoardPosition(point, 15, 0, false)).toEqual({ row: 2, col: 5 });
    expect(transformBoardPosition(point, 15, 90, false)).toEqual({ row: 5, col: 12 });
    expect(transformBoardPosition(point, 15, 180, false)).toEqual({ row: 12, col: 9 });
    expect(transformBoardPosition(point, 15, 270, false)).toEqual({ row: 9, col: 2 });
    expect(transformBoardPosition(point, 15, 0, true)).toEqual({ row: 2, col: 9 });
  });

  it("keeps every transformed point inside the board", () => {
    for (const rotation of rotations) {
      for (const mirrored of [false, true]) {
        for (const row of [0, 7, 14]) {
          for (const col of [0, 7, 14]) {
            const transformed = transformBoardPosition({ row, col }, 15, rotation, mirrored);
            expect(transformed.row).toBeGreaterThanOrEqual(0);
            expect(transformed.row).toBeLessThan(15);
            expect(transformed.col).toBeGreaterThanOrEqual(0);
            expect(transformed.col).toBeLessThan(15);
          }
        }
      }
    }
  });

  it("round-trips visual hits back to logical positions", () => {
    for (const rotation of rotations) {
      for (const mirrored of [false, true]) {
        const transformed = transformBoardPosition(point, 15, rotation, mirrored);
        expect(inverseTransformBoardPosition(transformed, 15, rotation, mirrored)).toEqual(point);
      }
    }
  });
});
