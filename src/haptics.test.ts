import { afterEach, describe, expect, it } from "vitest";
import { HAPTIC_PATTERNS, hapticsSupported, playHapticCue } from "./haptics";

const stubVibrate = (implementation: (pattern: number | number[]) => boolean = () => true) => {
  const calls: Array<number | number[]> = [];
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    writable: true,
    value: (pattern: number | number[]) => { calls.push(pattern); return implementation(pattern); },
  });
  return calls;
};
const dropVibrate = () => { Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "vibrate"); };

describe("触觉反馈", () => {
  afterEach(dropVibrate);

  it("每个音效 cue 都有节奏，且震动段都是短震", () => {
    for (const pattern of Object.values(HAPTIC_PATTERNS)) {
      const values = Array.isArray(pattern) ? pattern : [pattern];
      expect(values.length).toBeGreaterThan(0);
      values.forEach((value) => expect(value).toBeGreaterThan(0));
      // 偶数下标是「震」的时长，必须短——长震在连续打谱时会变成干扰。
      values.filter((_, index) => index % 2 === 0).forEach((value) => expect(value).toBeLessThanOrEqual(30));
    }
  });

  it("默认关闭：平台支持也不震", () => {
    const calls = stubVibrate();
    expect(playHapticCue("move-black", false)).toBe(false);
    expect(playHapticCue("warning", false)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("开启后按 cue 调用 navigator.vibrate", () => {
    const calls = stubVibrate();
    expect(playHapticCue("warning", true)).toBe(true);
    expect(playHapticCue("move-white", true)).toBe(true);
    expect(calls).toEqual([HAPTIC_PATTERNS.warning, HAPTIC_PATTERNS["move-white"]]);
  });

  it("平台不支持时静默降级，不抛错", () => {
    dropVibrate();
    expect(hapticsSupported()).toBe(false);
    expect(playHapticCue("success", true)).toBe(false);
  });

  it("系统拒绝（返回 false 或抛错）时不冒泡", () => {
    stubVibrate(() => false);
    expect(playHapticCue("success", true)).toBe(false);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => { throw new Error("blocked"); } });
    expect(playHapticCue("error", true)).toBe(false);
  });
});
