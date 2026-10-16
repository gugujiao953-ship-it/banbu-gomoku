import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 引擎内存档的决策单测（2026-10-11）。
 *
 * ## 为什么单独立一组
 *
 * 用户报「电脑网页版人机对战总是显示『AI 引擎未能分配内存…一直报错』」，
 * 根因是**一个"设了状态但没人读"的 bug**：
 *
 * ```
 * // 失败时把降级值记下来
 * gameMemoryRetryRef.current = 256;
 * // 然后重试 —— 但发出去的还是原高档值，因为 postMessage 没读那个 ref
 * maxMemoryMb: engineMemoryMbFor(engineChoice, settings.analysisMaxMemoryMb)
 * ```
 *
 * 后果：每一手都走一遍"失败 → 记 256 → 重试（仍高档）→ 再失败 → 换兜底"，
 * 于是用户看到"一直报错"，而该降的档位永远降不下去。
 *
 * 这类 bug **类型系统抓不到、代码读起来也对**（那个赋值语句本身完全正常），
 * 原来的测试也照不出来（它们只验"要不要重试"，不验"重试时用了什么值"）。
 * 所以这里把"到底发多少内存"收成纯函数 `resolveAnalyzeMemoryMb` 并钉住：
 * **降级值必须优先于用户档位**。
 */

// `engineMemoryMbFor` 读 `navigator.deviceMemory` 决定钳制上限，
// 所以每个用例都把它固定住（jsdom 默认没有这个属性）。
const setDeviceMemory = (gb: number) => {
  Object.defineProperty(globalThis.navigator, "deviceMemory", { value: gb, configurable: true, writable: true });
};

// 模块要在 stub 好 navigator 之后再引（顶层 import 会被提升）
const { resolveAnalyzeMemoryMb, shouldRetryWithLowerMemory, MEMORY_RETRY_MB } = await import("./engine-memory");

describe("引擎内存档：该发多少", () => {
  beforeEach(() => setDeviceMemory(8));

  it("没有降级时按用户档位（并受设备内存钳制）", () => {
    // 8GB → 上限 1024
    expect(resolveAnalyzeMemoryMb("strong", 128, null)).toBe(128);
    expect(resolveAnalyzeMemoryMb("strong", 2048, null)).toBe(1024);   // 被钳住
    expect(resolveAnalyzeMemoryMb("strong", 64, null)).toBe(64);
  });

  it("**降级值优先于用户档位**（这条就是那个 bug 的回归锁）", () => {
    // 用户档位仍是 2048，但已经降级过一次 ⇒ 必须发 256
    expect(resolveAnalyzeMemoryMb("strong", 2048, MEMORY_RETRY_MB)).toBe(256);
    expect(resolveAnalyzeMemoryMb("strong", 1024, 256)).toBe(256);
    // 极端：用户档位很低、但降级值给了个数（不该发生，但语义要确定）
    expect(resolveAnalyzeMemoryMb("strong", 64, 256)).toBe(256);
  });

  it("兜底档（light）与旗舰档（kata）不接内存档（undefined = worker 自动分档）", () => {
    expect(resolveAnalyzeMemoryMb("light", 2048, null)).toBeUndefined();
    expect(resolveAnalyzeMemoryMb("kata", 2048, null)).toBeUndefined();
    // 降级值也不该把 undefined 顶掉：这两个档根本不是 MAX_MEMORY 管的
    expect(resolveAnalyzeMemoryMb("light", 2048, 256)).toBe(256);
  });

  it("不同设备内存下的钳制上限", () => {
    setDeviceMemory(2);
    expect(resolveAnalyzeMemoryMb("strong", 2048, null)).toBe(256);
    setDeviceMemory(4);
    expect(resolveAnalyzeMemoryMb("strong", 2048, null)).toBe(512);
    setDeviceMemory(16);
    expect(resolveAnalyzeMemoryMb("strong", 2048, null)).toBe(2048);
  });

  it("坏档位值回落到默认 128（NaN/负数/0 都不该变成 0 或负）", () => {
    setDeviceMemory(8);
    expect(resolveAnalyzeMemoryMb("strong", Number.NaN, null)).toBe(128);
    expect(resolveAnalyzeMemoryMb("strong", -5, null)).toBe(128);
    expect(resolveAnalyzeMemoryMb("strong", 0, null)).toBe(128);
    // 低于下限 64 的正数被抬到 64
    expect(resolveAnalyzeMemoryMb("strong", 10, null)).toBe(64);
  });
});

describe("引擎内存档：要不要降级重试", () => {
  beforeEach(() => setDeviceMemory(16));

  it("档位高于 256 且还没降过 ⇒ 值得降一次再试", () => {
    expect(shouldRetryWithLowerMemory("strong", 2048, null)).toBe(true);
    expect(shouldRetryWithLowerMemory("strong", 1024, null)).toBe(true);
    expect(shouldRetryWithLowerMemory("strong", 512, null)).toBe(true);
  });

  it("档位已经不高（≤256）⇒ 降下去也没意义，直接换兜底引擎", () => {
    expect(shouldRetryWithLowerMemory("strong", 256, null)).toBe(false);
    expect(shouldRetryWithLowerMemory("strong", 128, null)).toBe(false);
    expect(shouldRetryWithLowerMemory("strong", 64, null)).toBe(false);
  });

  it("**已经降过一次就不再降**（否则会无限重试，正是「一直报错」的另一半）", () => {
    expect(shouldRetryWithLowerMemory("strong", 2048, MEMORY_RETRY_MB)).toBe(false);
  });

  it("兜底/旗舰档没有内存档 ⇒ 不降级（它们不吃 MAX_MEMORY）", () => {
    expect(shouldRetryWithLowerMemory("light", 2048, null)).toBe(false);
    expect(shouldRetryWithLowerMemory("kata", 2048, null)).toBe(false);
  });

  it("设备内存钳制后的实际值参与判断（不是看滑杆原值）", () => {
    setDeviceMemory(2);   // 上限 256
    // 滑杆写着 2048，但实际会被钳到 256 ⇒ 不该再降（已经不高了）
    expect(shouldRetryWithLowerMemory("strong", 2048, null)).toBe(false);
    setDeviceMemory(4);   // 上限 512
    expect(shouldRetryWithLowerMemory("strong", 2048, null)).toBe(true);
  });
});
