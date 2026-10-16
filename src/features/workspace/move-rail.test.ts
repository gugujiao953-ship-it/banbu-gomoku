import { describe, expect, it } from "vitest";
import { isRailDrag, RAIL_TAP_DEAD_ZONE, railDepthFromRatio, railRatioForDepth, railTapDirection } from "./move-rail";

describe("棋盘手数滑轨映射（用户 09-17 第二批③）", () => {
  it("比例→手数：两端与中点", () => {
    expect(railDepthFromRatio(0, 40)).toBe(0);
    expect(railDepthFromRatio(1, 40)).toBe(40);
    expect(railDepthFromRatio(0.5, 40)).toBe(20);
  });

  it("比例→手数：四舍五入并夹在 0..total", () => {
    expect(railDepthFromRatio(0.012, 40)).toBe(0);
    expect(railDepthFromRatio(0.987, 40)).toBe(39);
    expect(railDepthFromRatio(1.6, 40)).toBe(40);
    expect(railDepthFromRatio(-0.5, 40)).toBe(0);
  });

  it("空棋谱（total=0）恒为 0，不产生 NaN", () => {
    expect(railDepthFromRatio(0.7, 0)).toBe(0);
    expect(railDepthFromRatio(Number.NaN, 40)).toBe(0);
    expect(railRatioForDepth(3, 0)).toBe(0);
  });

  it("手数→比例与反向映射互逆（整数手）", () => {
    const total = 30;
    for (const depth of [0, 7, 15, 30]) {
      expect(railDepthFromRatio(railRatioForDepth(depth, total), total)).toBe(depth);
    }
  });

  it("点击方向：上方上一手、下方下一手、滑块附近不动", () => {
    expect(railTapDirection(0.1, 0.5)).toBe(-1);
    expect(railTapDirection(0.9, 0.5)).toBe(1);
    expect(railTapDirection(0.5, 0.5)).toBe(0);
    expect(railTapDirection(0.5 + RAIL_TAP_DEAD_ZONE - 0.001, 0.5)).toBe(0);
    expect(railTapDirection(0.5 + RAIL_TAP_DEAD_ZONE + 0.001, 0.5)).toBe(1);
  });

  it("拖动判定按位移阈值", () => {
    expect(isRailDrag(100, 104)).toBe(false);
    expect(isRailDrag(100, 107)).toBe(true);
    expect(isRailDrag(100, 93)).toBe(true);
  });
});
