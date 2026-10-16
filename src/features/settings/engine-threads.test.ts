import { describe, expect, it } from "vitest";
import { autoEngineThreads, engineThreadHint, engineThreadOptions } from "./engine-threads";

describe("引擎线程档位", () => {
  it("按设备核心数生成，全核那档写的是本机核数（用户 09-15 问「我们是多少核」）", () => {
    expect(engineThreadOptions(8)).toEqual([
      ["0", "自动（一半核心 = 4）"],
      ["1", "1 线程（省电）"],
      ["2", "2 线程"],
      ["4", "4 线程"],
      ["6", "6 线程"],
      ["-1", "全核（8 核）"],
    ]);
    expect(engineThreadOptions(4)).toEqual([
      ["0", "自动（一半核心 = 2）"],
      ["1", "1 线程（省电）"],
      ["2", "2 线程"],
      ["-1", "全核（4 核）"],
    ]);
    const large = engineThreadOptions(12);
    expect(large[large.length - 1]).toEqual(["-1", "全核（12 核）"]);
  });

  it("不出现「同一个数字两个选项」：等于核心数的档位让给全核", () => {
    for (const cores of [2, 3, 4, 6, 8, 12]) {
      const values = engineThreadOptions(cores).map(([value]) => value);
      expect(new Set(values).size).toBe(values.length);
      const numeric = values.filter((value) => Number(value) > 0).map(Number);
      expect(numeric).not.toContain(cores);
    }
  });

  it("单核设备只给自动档（既没有一半也没有全核的意义）", () => {
    expect(engineThreadOptions(1)).toEqual([["0", "自动"]]);
  });

  it("大小核机器多一个「大核（N 核）」档（值 -2）；同构机器不出现", () => {
    const heterogeneous = engineThreadOptions(8, 4);
    expect(heterogeneous).toContainEqual(["-2", "大核（4 核）"]);
    // 位置在「全核」之前，方便和它挨着对比
    expect(heterogeneous[heterogeneous.length - 1]).toEqual(["-1", "全核（8 核）"]);
    expect(heterogeneous[heterogeneous.length - 2]).toEqual(["-2", "大核（4 核）"]);
    // 全核已经是 4 核的机器（bigCores == cores）不该出现这一档
    expect(engineThreadOptions(8, 8).map(([value]) => value)).not.toContain("-2");
    expect(engineThreadOptions(4, 4).map(([value]) => value)).not.toContain("-2");
    // 拿不到大核信息（读不到 cpufreq 时插件按同构处理）也不出现
    expect(engineThreadOptions(8, 0).map(([value]) => value)).not.toContain("-2");
  });

  it("自动档 = 一半核心，向下取整但不低于 1", () => {
    expect(autoEngineThreads(8)).toBe(4);
    expect(autoEngineThreads(3)).toBe(2);
    expect(autoEngineThreads(1)).toBe(1);
  });

  it("行文案：大小核机器指向新增的「大核」档（Lazy SMP 被最慢线程拖住）", () => {
    const heterogeneous = engineThreadHint(true, 8, 4);
    expect(heterogeneous).toContain("本机 8 核（4 大核 + 4 小核）");
    expect(heterogeneous).toContain("大核（4 核）");
    // 同构机器不出现大小核字样，避免无用的噪声
    const homogeneous = engineThreadHint(true, 8, 8);
    expect(homogeneous).toContain("本机 8 核");
    expect(homogeneous).not.toContain("大核");
    // 网页版（原生未就绪）说的是 wasm 那套
    expect(engineThreadHint(false, 8, 4)).toContain("网页版 wasm");
  });
});
