// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { planRecognitionPool } from "./recognition-pool-size";

// 池大小是「用手机处理器与内存」的那一步决策：留一个核心给主线程（界面还在画），
// 再按设备内存与图像大小收敛——每个线程要持有一份 RGBA + 自己的灰度图。
describe("recognition accelerator pool sizing", () => {
  const small = 1000 * 700;
  const big = 1600 * 1600;

  it("never takes the last core away from the main thread", () => {
    expect(planRecognitionPool({ cores: 1, memoryGb: 16, pixelCount: small })).toBe(1);
    expect(planRecognitionPool({ cores: 2, memoryGb: 16, pixelCount: small })).toBe(1);
    expect(planRecognitionPool({ cores: 4, memoryGb: 16, pixelCount: small })).toBe(3);
  });

  it("caps the pool at six threads even on many-core machines", () => {
    expect(planRecognitionPool({ cores: 12, memoryGb: 16, pixelCount: small })).toBe(6);
    expect(planRecognitionPool({ cores: 8, memoryGb: 8, pixelCount: small })).toBe(6);
  });

  it("shrinks the pool on low-memory devices and for large images", () => {
    // 2GB 机型：预算 48MB，一张 1600×1600 的图每个线程要约 28MB —— 只开 1 个。
    expect(planRecognitionPool({ cores: 8, memoryGb: 2, pixelCount: big })).toBe(1);
    // 同样 2GB，小图（约 13MB/线程）可以开 3 个。
    expect(planRecognitionPool({ cores: 8, memoryGb: 2, pixelCount: small })).toBe(3);
    // 4GB 机型 + 大图：预算 96MB → 3 个。
    // ⚠ 2026-10-15 试过把预算抬到 min(720, 内存×60)（4G→240/8G→480），桌面 A/B 确实快 37%，
    //   但真机上出现**渲染进程崩溃连带应用闪退**（logcat: SIGTRAP + crashpad "Render process
    //   crash wasn't handled ... triggering application crash"，连续两次），已收回 160MB 上限
    //   ——这两条断言就是「收回后」的形态。要再抬，先在真机上按 recognition-pool-size.ts
    //   顶部注释做二分，并盯 `adb logcat -b crash`。
    expect(planRecognitionPool({ cores: 8, memoryGb: 4, pixelCount: big })).toBe(3);
    // 8GB 机型 + 大图：预算 160MB → 5 个（仍不超过核心数上限 6）。
    expect(planRecognitionPool({ cores: 8, memoryGb: 8, pixelCount: big })).toBe(5);
    // 带模型会话时每线程 47.5MB —— 160MB 只够 3 条（手机上的大池因此开不大）。
    expect(planRecognitionPool({ cores: 12, memoryGb: 8, pixelCount: big, withModelSessions: true })).toBe(3);
  });

  it("always returns at least one thread so the work leaves the main thread", () => {
    for (const memoryGb of [0, 0.5, 1, 2, 4, 8, 16]) {
      for (const pixelCount of [320 * 320, small, big]) {
        expect(planRecognitionPool({ cores: 1, memoryGb, pixelCount })).toBeGreaterThanOrEqual(1);
        expect(planRecognitionPool({ cores: 8, memoryGb, pixelCount })).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
