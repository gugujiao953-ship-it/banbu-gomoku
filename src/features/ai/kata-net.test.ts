/**
 * 旗舰引擎「按规则换网」（`src/features/ai/kata-net.ts`）。
 *
 * 这几条对着**真会出错的地方**，而不是"跑一遍覆盖率"：
 *  · 首次调用必须**问过原生侧**再比 —— 拿默认值硬比会让"上次会话最后是无禁手、
 *    贴纸停在 freestyle，这次开连珠文档却被当成没变"这种静默错配溜过去；
 *  · 只有**类别变了**才写贴纸 + 停进程（同规则内反复切什么都不做，
 *    否则每换一份棋谱就重启一次引擎）；
 *  · 网页版/没有原生插件时一个字都不写、也不停任何东西。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./native-engine", () => ({
  probeNativeKataGo: vi.fn(),
  nativeKataRule: vi.fn(),
  setNativeKataRule: vi.fn(),
}));
vi.mock("./kata-settings", () => ({ restartKataEngine: vi.fn() }));

import { ensureKataNetForRule, kataNetRuleForRule, resetKataNetStateForTest } from "./kata-net";
import { nativeKataRule, probeNativeKataGo, setNativeKataRule } from "./native-engine";
import { restartKataEngine } from "./kata-settings";

const probeMock = vi.mocked(probeNativeKataGo);
const nativeRuleMock = vi.mocked(nativeKataRule);
const setRuleMock = vi.mocked(setNativeKataRule);
const restartMock = vi.mocked(restartKataEngine);

/** 让原生侧"贴纸当前是 sticker"，且写贴纸成功。 */
const stubNative = (sticker: "renju" | "freestyle" | null) => {
  probeMock.mockResolvedValue(sticker === null ? null : ({ available: true } as never));
  nativeRuleMock.mockReturnValue({ rule: sticker ?? "renju", freestyleAvailable: true });
  setRuleMock.mockResolvedValue(true);
};

describe("旗舰引擎按规则换网", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKataNetStateForTest();
  });

  it("规则 → 网类别：只有 renju 用 r15，freestyle/standard 都用 f15", () => {
    expect(kataNetRuleForRule("renju")).toBe("renju");
    expect(kataNetRuleForRule("freestyle")).toBe("freestyle");
    // standard 与 freestyle 只差长连判定 —— 刻意共用 f15（原生 ownModelForRule 同一口径）
    expect(kataNetRuleForRule("standard")).toBe("freestyle");
  });

  it("贴纸已经就是该类别 ⇒ 不写、不停", async () => {
    stubNative("renju");
    expect(await ensureKataNetForRule("renju")).toBe(false);
    expect(setRuleMock).not.toHaveBeenCalled();
    expect(restartMock).not.toHaveBeenCalled();
  });

  it("类别变了 ⇒ 写贴纸 + 停进程，且只做一次", async () => {
    stubNative("renju");
    expect(await ensureKataNetForRule("freestyle")).toBe(true);
    expect(setRuleMock).toHaveBeenCalledWith("freestyle");
    expect(restartMock).toHaveBeenCalledTimes(1);
    // 同规则内再来一次：会话内已生效，什么都不做（不是每次都重启）
    expect(await ensureKataNetForRule("standard")).toBe(false);
    expect(restartMock).toHaveBeenCalledTimes(1);
  });

  it("首次调用以原生侧报回的贴纸为准（不是默认值）", async () => {
    // 上次会话最后看的是无禁手文档 ⇒ 贴纸停在 freestyle；这次开连珠文档必须换回 r15
    stubNative("freestyle");
    expect(await ensureKataNetForRule("renju")).toBe(true);
    expect(setRuleMock).toHaveBeenCalledWith("renju");
    expect(restartMock).toHaveBeenCalledTimes(1);
  });

  it("网页版 / 没有原生旗舰 ⇒ 一个字都不写、不停任何东西", async () => {
    stubNative(null);
    expect(await ensureKataNetForRule("freestyle")).toBe(false);
    expect(setRuleMock).not.toHaveBeenCalled();
    expect(restartMock).not.toHaveBeenCalled();
  });

  it("原生侧拒绝写贴纸时不当成已生效（下次还会再试）", async () => {
    stubNative("renju");
    setRuleMock.mockResolvedValueOnce(false);
    expect(await ensureKataNetForRule("freestyle")).toBe(false);
    expect(restartMock).not.toHaveBeenCalled();
  });
});
