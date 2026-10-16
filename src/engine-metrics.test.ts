import { describe, expect, it } from "vitest";
import { formatEngineCount } from "./engine-metrics";

describe("引擎指标紧凑显示", () => {
  it("过千用 k（用户 09-15：节点速度要能一眼比大小）", () => {
    expect(formatEngineCount(999)).toBe("999");
    expect(formatEngineCount(1000)).toBe("1k");
    expect(formatEngineCount(223456)).toBe("223k");
    expect(formatEngineCount(999499)).toBe("999k");
  });

  it("到 1000k 进位成 M，到 1000M 进位成 B，都保留一位小数（用户 09-15）", () => {
    expect(formatEngineCount(1000000)).toBe("1.0M");
    expect(formatEngineCount(1020000)).toBe("1.0M");
    expect(formatEngineCount(1500000)).toBe("1.5M");
    expect(formatEngineCount(12345678)).toBe("12.3M");
    expect(formatEngineCount(999000000)).toBe("999.0M");
    expect(formatEngineCount(1000000000)).toBe("1.0B");
    expect(formatEngineCount(2140000000)).toBe("2.1B");
  });

  it("进位边界：999 999 → 1.0M、999 999 999 → 1.0B，同一量级不出现两种写法", () => {
    expect(formatEngineCount(999999)).toBe("1.0M");
    expect(formatEngineCount(999999999)).toBe("1.0B");
  });

  it("没有值时给占位符而不是 0（0 与「还没算」是两回事）", () => {
    expect(formatEngineCount(undefined)).toBe("-");
    expect(formatEngineCount(null)).toBe("-");
    expect(formatEngineCount(Number.NaN)).toBe("-");
    expect(formatEngineCount(-1)).toBe("-");
    expect(formatEngineCount(0)).toBe("0");
  });
});
