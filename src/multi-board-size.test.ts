import { describe, expect, it } from "vitest";
import { analyzeCandidates } from "./analysis";
import { emptyBoard } from "./game";
// TS 兜底引擎用的是数字盘面（0/1/2），跟 game.ts 的 "black"/"white"/null 不是同一套。
import { emptyBoard as numericBoard, findBestMove } from "./renju-ai/engine";
import { searchVcf } from "./vcf";
import type { Position } from "./types";

// 引擎主链路已支持 22 路以内的任意盘面（见 features/ai/board-size-support.ts），
// 下面这些模块过去写死 15 路：要么在 9 路盘上直接越界抛错（vcf 的
// tacticalPoints/emptyPoints 会读到 board[9] === undefined），要么在 19 路盘上
// 只扫左上 15×15 而漏掉大半盘面（analysis 的候选点、TS 兜底引擎的着法生成）。
const place = <T,>(board: T[][], player: T, points: Position[]) => {
  points.forEach(({ row, col }) => { board[row][col] = player; });
};
const inBounds = (size: number, { row, col }: Position) => row >= 0 && row < size && col >= 0 && col < size;

describe("multi-size board support", () => {
  for (const size of [9, 19]) {
    it(`finds the winning fifth stone on a ${size}x${size} board`, () => {
      const board = numericBoard(size);
      const row = Math.floor(size / 2);
      place(board, 1, [row - 2, row - 1, row, row + 1].map((col) => ({ row, col })));
      const result = findBestMove(board, 1, { maxDepth: 4, timeBudgetMs: 1500, rule: "freestyle" });
      expect(result.move).not.toBeNull();
      expect(inBounds(size, result.move!)).toBe(true);
      expect([row - 3, row + 2]).toContain(result.move!.col);
      expect(result.move!.row).toBe(row);
    });

    it(`keeps VCF coordinates inside a ${size}x${size} board`, () => {
      const board = emptyBoard(size);
      const row = Math.floor(size / 2);
      place(board, "black", [row - 2, row - 1, row, row + 1].map((col) => ({ row, col })));
      const result = searchVcf(board, "black", { rule: "freestyle", maxAttackMoves: 3, timeBudgetMs: 800 });
      expect(result.status).toBe("win");
      expect(result.principalVariation.length).toBeGreaterThan(0);
      for (const point of result.principalVariation) expect(inBounds(size, point)).toBe(true);
    });
  }

  it("scans the whole 19x19 board for analysis candidates, not just the top-left 15x15", () => {
    const size = 19;
    const board = emptyBoard(size);
    place(board, "black", [14, 15, 16].map((col) => ({ row: 16, col })));
    const candidates = analyzeCandidates(board, "white", 6);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => inBounds(size, candidate.position))).toBe(true);
    // 白棋必须能在第 16 行（旧实现的扫描范围之外）看到挡四的点。
    expect(candidates.some((candidate) => candidate.position.row === 16)).toBe(true);
    expect(candidates.some((candidate) => candidate.reasons.some((reason) => reason.includes("防守对方四")))).toBe(true);
  });
});
