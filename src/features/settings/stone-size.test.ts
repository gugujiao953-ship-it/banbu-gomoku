import { describe, expect, it } from "vitest";
import { BOARD_VIEWBOX, DEFAULT_BOARD_MARGIN, minBoardMargin } from "./board-margin";
import {
  DEFAULT_STONE_SCALE,
  MAX_STONE_SCALE,
  MIN_STONE_SCALE,
  autoStoneRadius,
  clampStoneScale,
  stoneHitRadiusFor,
  stoneRadiusFor,
  stoneSizeLabel,
  tangentStoneRadius,
} from "./stone-size";

const gapFor = (boardSize: number, margin = DEFAULT_BOARD_MARGIN) => (BOARD_VIEWBOX - 2 * margin) / (boardSize - 1);
/** 支持的路数（多路数棋盘 5–22 路）。 */
const SIZES = Array.from({ length: 18 }, (_, index) => index + 5);

describe("stone size (棋子大小)", () => {
  it("keeps the historical automatic radius at the default step", () => {
    // 改造前：Math.min(24, Math.max(10, gap * 0.43))。默认档必须原样返回。
    for (const boardSize of SIZES) {
      const gap = gapFor(boardSize);
      expect(stoneRadiusFor(gap, DEFAULT_STONE_SCALE)).toBe(autoStoneRadius(gap));
    }
    expect(autoStoneRadius(36)).toBeCloseTo(15.48, 6);
    expect(autoStoneRadius(2)).toBe(10);
    expect(autoStoneRadius(200)).toBe(24);
  });

  it("never lets adjacent stones overlap, at any step and any board size", () => {
    // 用户的红线：最大不能压住其他棋子。相切（半径 = 半个格距）即上限，
    // 所以任意路数 × 任意侧边 × 任意档位都必须满足 2r ≤ 格距。
    for (const boardSize of SIZES) {
      for (const margin of [DEFAULT_BOARD_MARGIN, minBoardMargin(12), 20]) {
        const gap = gapFor(boardSize, margin);
        for (const scale of [MIN_STONE_SCALE, 0.9, DEFAULT_STONE_SCALE, 1.1, MAX_STONE_SCALE]) {
          const radius = stoneRadiusFor(gap, scale);
          expect(radius).toBeLessThanOrEqual(gap / 2 + 1e-9);
          expect(radius * 2).toBeLessThanOrEqual(gap + 1e-9);
        }
      }
    }
  });

  it("actually reaches the tangent limit at the top step", () => {
    // 顶档必须真的「顶到头」——否则滑杆最上几格拖了没反应，等于量程虚标。
    // 13 路以上自动值是 gap*0.43、没被 24 的上限截断，0.43*1.2 > 0.5 正好够到相切。
    for (const boardSize of [13, 15, 19, 21, 22]) {
      const gap = gapFor(boardSize);
      expect(stoneRadiusFor(gap, MAX_STONE_SCALE)).toBeCloseTo(tangentStoneRadius(gap), 9);
      // 也比默认明显更大（15 路：15.48 → 18，径向 +16%）。
      expect(stoneRadiusFor(gap, MAX_STONE_SCALE)).toBeGreaterThan(stoneRadiusFor(gap, DEFAULT_STONE_SCALE) * 1.1);
    }
  });

  it("keeps the smallest step close to the default", () => {
    // 「最小也不能比默认小太多」：低端只有 15%，且仍随路数自动缩放。
    expect(stoneRadiusFor(36, MIN_STONE_SCALE)).toBeCloseTo(15.48 * 0.85, 6);
    for (const boardSize of SIZES) {
      const gap = gapFor(boardSize);
      expect(stoneRadiusFor(gap, MIN_STONE_SCALE)).toBeGreaterThan(stoneRadiusFor(gap, DEFAULT_STONE_SCALE) * 0.84);
    }
  });

  it("grows monotonically with the step", () => {
    const gap = gapFor(15);
    let previous = 0;
    for (let scale = MIN_STONE_SCALE; scale <= MAX_STONE_SCALE + 1e-9; scale += 0.05) {
      const radius = stoneRadiusFor(gap, scale);
      expect(radius).toBeGreaterThanOrEqual(previous);
      previous = radius;
    }
  });

  it("grows the tap target with the stone but never past the tangent line", () => {
    // 默认档与改造前逐像素一致：15 路 15.48*1.14 = 17.6（小于相切 18），
    // 22 路自动值是 10.32*1.14 = 11.76，由 max(14, …) 兜到 14。
    expect(stoneHitRadiusFor(gapFor(15), DEFAULT_STONE_SCALE)).toBeCloseTo(autoStoneRadius(gapFor(15)) * 1.14, 9);
    expect(stoneHitRadiusFor(gapFor(22), DEFAULT_STONE_SCALE)).toBe(14);
    // 放大后热区跟着长，但不超过相切线，否则相邻格子的热区会互相覆盖。
    const gap = gapFor(15);
    expect(stoneHitRadiusFor(gap, MAX_STONE_SCALE)).toBeCloseTo(tangentStoneRadius(gap), 9);
    for (const boardSize of SIZES) {
      const boardGap = gapFor(boardSize);
      expect(stoneHitRadiusFor(boardGap, MAX_STONE_SCALE)).toBeLessThanOrEqual(Math.max(14, boardGap / 2) + 1e-9);
    }
  });

  it("clamps into the legal range and recovers from junk", () => {
    expect(clampStoneScale(undefined)).toBe(DEFAULT_STONE_SCALE);
    expect(clampStoneScale(Number.NaN)).toBe(DEFAULT_STONE_SCALE);
    expect(clampStoneScale("big")).toBe(DEFAULT_STONE_SCALE);
    expect(clampStoneScale(99)).toBe(MAX_STONE_SCALE);
    expect(clampStoneScale(0)).toBe(MIN_STONE_SCALE);
    expect(clampStoneScale(1.07)).toBe(1.07);
    expect(clampStoneScale(1.234)).toBe(1.2);
  });

  it("labels the default, minimum and maximum ends", () => {
    expect(stoneSizeLabel(DEFAULT_STONE_SCALE)).toBe("100%（默认）");
    expect(stoneSizeLabel(MIN_STONE_SCALE)).toBe("85%（最小）");
    expect(stoneSizeLabel(MAX_STONE_SCALE)).toBe("120%（最大）");
    expect(stoneSizeLabel(1.1)).toBe("110%");
  });
});
