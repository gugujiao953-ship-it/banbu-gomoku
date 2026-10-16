import { describe, expect, it } from "vitest";
import { BOARD_VIEWBOX, DEFAULT_BOARD_MARGIN, boardMarginLabel, clampBoardMargin, coordinateLayout, minBoardMargin } from "./board-margin";

describe("board margin (四边坐标缝)", () => {
  it("keeps the historical default layout pixel-identical", () => {
    // 改造前硬编码：上 20 / 下 560 / 左 18 / 右 554，默认档必须原样返回，
    // 否则会悄悄改掉所有人现有棋盘的观感。
    expect(DEFAULT_BOARD_MARGIN).toBe(34);
    expect(coordinateLayout(DEFAULT_BOARD_MARGIN, 12)).toEqual({ topY: 20, bottomY: 560, leftX: 18, rightX: 554 });
  });

  it("grows the board as the margin shrinks", () => {
    const gridSize = (margin: number) => BOARD_VIEWBOX - 2 * margin;
    expect(gridSize(DEFAULT_BOARD_MARGIN)).toBe(504);
    expect(gridSize(minBoardMargin(12))).toBeGreaterThan(504);
  });

  it("keeps coordinates inside the board frame at the minimum margin", () => {
    // 最小档的判据：文字不能越过底板矩形（4..568），否则就是被裁掉而不是「勉强容纳」。
    for (const fontSize of [6, 10, 12, 14]) {
      const margin = minBoardMargin(fontSize);
      const layout = coordinateLayout(margin, fontSize);
      const capHeight = fontSize * 0.72;
      const descender = fontSize * 0.25;
      const digitWidth = fontSize * 1.1; // 两位数
      expect(layout.topY - capHeight).toBeGreaterThanOrEqual(4);
      expect(layout.bottomY + descender).toBeLessThanOrEqual(568);
      expect(layout.leftX - digitWidth / 2).toBeGreaterThanOrEqual(4);
      expect(layout.rightX + digitWidth / 2).toBeLessThanOrEqual(568);
      // 也不能压到棋盘的格线上。
      expect(layout.topY).toBeLessThan(margin);
      expect(layout.bottomY).toBeGreaterThan(BOARD_VIEWBOX - margin);
      expect(layout.leftX).toBeLessThan(margin);
      expect(layout.rightX).toBeGreaterThan(BOARD_VIEWBOX - margin);
    }
  });

  it("scales the minimum with the coordinate font size", () => {
    expect(minBoardMargin(14)).toBeGreaterThan(minBoardMargin(6));
    // 字号变大后，先前存的窄侧边要被抬到新的下限，而不是让坐标溢出去：
    // 14px 字号的最小侧边是 22，存着 18 的旧值用前会被抬到 22。
    expect(minBoardMargin(14)).toBe(22);
    expect(clampBoardMargin(18, 14)).toBe(minBoardMargin(14));
    expect(clampBoardMargin(24, 14)).toBe(24);
  });

  it("clamps into the legal range and recovers from junk", () => {
    expect(clampBoardMargin(999, 12)).toBe(DEFAULT_BOARD_MARGIN);
    expect(clampBoardMargin(2, 12)).toBe(minBoardMargin(12));
    expect(clampBoardMargin(Number.NaN, 12)).toBe(DEFAULT_BOARD_MARGIN);
    expect(clampBoardMargin(undefined, 12)).toBe(DEFAULT_BOARD_MARGIN);
    expect(clampBoardMargin(25.4, 12)).toBe(25);
  });

  it("labels the default and minimum ends", () => {
    expect(boardMarginLabel(DEFAULT_BOARD_MARGIN, 12)).toContain("默认");
    expect(boardMarginLabel(minBoardMargin(12), 12)).toContain("最小");
    expect(boardMarginLabel(26, 12)).toBe("26px");
  });
});
