// @vitest-environment jsdom
/**
 * 「选点小数位数」的取值链路测试。
 *
 * 背景（用户 2026-09-26 报「选了 5 位还是只有 1 位」）：该设置原先被硬钳在 0–2，
 * 面板下拉也只有 0/1/2 三档——用户想选更高的精度根本选不到；同时面板圆标与
 * 候选列表走的是同一个 analysisMetricText，所以「其他类似的」也会一起受影响。
 * 这里锁住三件事：上限是 5、超范围会夹回、持久化后能原样读回。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ENHANCEMENT_SETTINGS, loadEnhancementSettings, normalizeEnhancementSettings, saveEnhancementSettings } from "../../enhancement-settings";

const withDecimals = (decimals: number) => ({ ...DEFAULT_ENHANCEMENT_SETTINGS, analysisCandidateDecimals: decimals });

describe("选点小数位数", () => {
  it("接受 0–5 位（5 位不再被夹回）", () => {
    for (const value of [0, 1, 2, 3, 4, 5]) {
      expect(normalizeEnhancementSettings(withDecimals(value)).analysisCandidateDecimals).toBe(value);
    }
  });

  it("超出范围夹回边界（负数→0，过大→5）；非数字回落默认", () => {
    expect(normalizeEnhancementSettings(withDecimals(-3)).analysisCandidateDecimals).toBe(0);
    expect(normalizeEnhancementSettings(withDecimals(9)).analysisCandidateDecimals).toBe(5);
    expect(normalizeEnhancementSettings(withDecimals(Number.NaN)).analysisCandidateDecimals).toBe(DEFAULT_ENHANCEMENT_SETTINGS.analysisCandidateDecimals);
  });

  it("小数位设置能存能读（重启后仍生效）", () => {
    saveEnhancementSettings(withDecimals(5));
    expect(loadEnhancementSettings().analysisCandidateDecimals).toBe(5);
    saveEnhancementSettings(withDecimals(3));
    expect(loadEnhancementSettings().analysisCandidateDecimals).toBe(3);
    localStorage.clear();
  });
});
