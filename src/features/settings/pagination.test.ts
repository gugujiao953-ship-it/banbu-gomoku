import { describe, expect, it } from "vitest";
import { OPTIONS_PER_PAGE, pageCount, paginateOptions } from "./pagination";

/** 外观选项分页的切块规则：N 项 → ceil(N/10) 页，每页 ≤ 10，顺序不变。
 *  用户 2026-10-06 要求每页 2 列 × 5 行；这里测容量与顺序，不测 DOM/布局。 */
describe("paginateOptions", () => {
  it("每页 10 个时 28 项切成 3 页（10 / 10 / 8）", () => {
    const items = Array.from({ length: 28 }, (_, i) => `board-${i}`);
    const pages = paginateOptions(items);
    expect(pages.map((page) => page.length)).toEqual([10, 10, 8]);
    expect(pages).toHaveLength(pageCount(28));
  });

  it("当前三组的真实项数都按 ceil(N/10) 分页：主题 22 → 3、棋盘 28 → 3、棋子 31 → 4", () => {
    const sizeOf = (n: number) => paginateOptions(Array.from({ length: n }, (_, i) => i)).map((page) => page.length);
    expect(sizeOf(22)).toEqual([10, 10, 2]);
    expect(sizeOf(28)).toEqual([10, 10, 8]);
    expect(sizeOf(31)).toEqual([10, 10, 10, 1]);
  });

  it("顺序不变：把所有页拉平后与输入逐项相等", () => {
    const items = Array.from({ length: 31 }, (_, i) => `stone-${i}`);
    expect(paginateOptions(items).flat()).toEqual(items);
  });

  it("每页都不超过 10 个（11 项 → 10 + 1）", () => {
    const pages = paginateOptions(Array.from({ length: 11 }, (_, i) => i));
    expect(pages.map((page) => page.length)).toEqual([10, 1]);
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(OPTIONS_PER_PAGE);
  });

  it("刚好一页（10 项）和不足一页（0 / 1 项）", () => {
    expect(paginateOptions(Array.from({ length: 10 }, (_, i) => i))).toHaveLength(1);
    expect(paginateOptions([])).toEqual([]);
    expect(paginateOptions([1])).toEqual([[1]]);
  });

  it("可指定每页容量（2 列 × 2 行 = 4 的用例）", () => {
    expect(paginateOptions([1, 2, 3, 4, 5, 6], 4).map((page) => page.length)).toEqual([4, 2]);
  });

  it("每页容量必须是正整数", () => {
    expect(() => paginateOptions([1], 0)).toThrow(RangeError);
    expect(() => paginateOptions([1], 2.5)).toThrow(RangeError);
  });
});

describe("pageCount", () => {
  it("按 ceil(总数 / 每页容量) 计算，空列表为 0", () => {
    expect(pageCount(0)).toBe(0);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(10)).toBe(1);
    expect(pageCount(11)).toBe(2);
    expect(pageCount(31)).toBe(4);
    expect(pageCount(31, 5)).toBe(7);
  });
});
