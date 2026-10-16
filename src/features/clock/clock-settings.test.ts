// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  CLOCK_PRESET_KEY,
  CLOCK_SETTINGS_KEY,
  defaultClockPresetId,
  describeClock,
  loadClockPresetId,
  loadClockSettings,
  matchClockPreset,
  normalizeClockSettings,
  sameClockSettings,
  saveClockPresetId,
  saveClockSettings,
} from "./clock-settings";
import { CLOCK_PRESETS, DEFAULT_CLOCK_SETTINGS } from "./duel-clock";

/**
 * 棋钟设置会被写进 localStorage，而那里的东西可能被手改、可能是旧版本写的。
 * 归一化失败不能让棋钟带着 NaN 跑——时限是 NaN 时整场对局的时间显示会变成 NaN。
 */
describe("棋钟设置持久化", () => {
  beforeEach(() => localStorage.clear());

  it("没存过时用默认值（5 分钟快棋）", () => {
    expect(loadClockSettings()).toEqual(DEFAULT_CLOCK_SETTINGS);
    // 回落到的预设 id 必须跟默认设置对得上：写死过 "wc"（2 小时 + 30 秒）会把默认档标错。
    expect(loadClockPresetId()).toBe("blitz5");
    expect(matchClockPreset(DEFAULT_CLOCK_SETTINGS)).toBe(loadClockPresetId());
  });

  it("默认预设 id 由 DEFAULT_CLOCK_SETTINGS 反查得出，改默认档不会漂移", () => {
    expect(defaultClockPresetId()).toBe(matchClockPreset(DEFAULT_CLOCK_SETTINGS));
    // 反查结果指向的预设，其设置必须与默认值等价——否则界面会把默认档标成别的档。
    const preset = CLOCK_PRESETS.find((entry) => entry.id === defaultClockPresetId());
    expect(preset).toBeDefined();
    expect(sameClockSettings(preset!.settings, DEFAULT_CLOCK_SETTINGS)).toBe(true);
    expect(loadClockPresetId()).toBe(defaultClockPresetId());
  });

  it("存了再读要一致", () => {
    const settings = { mode: "fischer" as const, baseMs: 90 * 60 * 1000, incrementMs: 30_000, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 };
    saveClockSettings(settings);
    expect(loadClockSettings()).toEqual(settings);
    saveClockPresetId("open60");
    expect(loadClockPresetId()).toBe("open60");
  });

  it("损坏的 JSON 回落到默认值而不是抛错", () => {
    localStorage.setItem(CLOCK_SETTINGS_KEY, "{不是 JSON");
    expect(loadClockSettings()).toEqual(DEFAULT_CLOCK_SETTINGS);
  });

  it("数值越界/NaN/字符串都被收窄到合法区间", () => {
    expect(normalizeClockSettings({ baseMs: Number.NaN }).baseMs).toBe(DEFAULT_CLOCK_SETTINGS.baseMs);
    expect(normalizeClockSettings({ baseMs: -50 }).baseMs).toBe(1_000);
    expect(normalizeClockSettings({ baseMs: 99 * 60 * 60 * 1000 }).baseMs).toBe(6 * 60 * 60 * 1000);
    expect(normalizeClockSettings({ incrementMs: -1 }).incrementMs).toBe(0);
    expect(normalizeClockSettings({ incrementMs: 99_999_999 }).incrementMs).toBe(5 * 60 * 1000);
    // 字符串数字是合法输入（旧版本可能写成字符串）。
    expect(normalizeClockSettings({ baseMs: "60000" }).baseMs).toBe(60_000);
  });

  it("未知制式回落到 fischer", () => {
    expect(normalizeClockSettings({ mode: "canadian" }).mode).toBe("fischer");
    expect(normalizeClockSettings({ mode: "readOff" }).mode).toBe("readOff");
  });

  it("空/非对象输入不崩", () => {
    expect(normalizeClockSettings(null)).toEqual(DEFAULT_CLOCK_SETTINGS);
    expect(normalizeClockSettings("字符串")).toEqual(DEFAULT_CLOCK_SETTINGS);
    expect(normalizeClockSettings([1, 2, 3])).toEqual(DEFAULT_CLOCK_SETTINGS);
  });

  it("能认出当前用的是哪个比赛预设", () => {
    expect(matchClockPreset({ mode: "fischer", baseMs: 120 * 60 * 1000, incrementMs: 30_000, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 })).toBe("rif-wc");
    expect(matchClockPreset({ mode: "fischer", baseMs: 123_456, incrementMs: 1_234, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 })).toBeNull();
    expect(sameClockSettings(DEFAULT_CLOCK_SETTINGS, { ...DEFAULT_CLOCK_SETTINGS })).toBe(true);
    expect(sameClockSettings(DEFAULT_CLOCK_SETTINGS, { ...DEFAULT_CLOCK_SETTINGS, baseMs: 1 })).toBe(false);
  });

  it("描述文案区分四种制式", () => {
    expect(describeClock({ mode: "fischer", baseMs: 120 * 60 * 1000, incrementMs: 30_000, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 })).toContain("每手 30 秒");
    expect(describeClock({ mode: "fischer", baseMs: 30 * 60 * 1000, incrementMs: 0, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 })).toContain("包干");
    expect(describeClock({ mode: "readOff", baseMs: 60_000, incrementMs: 0, delayMs: 10_000, readOffMs: 10_000, readOffPeriods: 3 })).toContain("读秒 10 秒×3");
    expect(describeClock({ mode: "bronstein", baseMs: 25 * 60 * 1000, incrementMs: 0, delayMs: 5_000, readOffMs: 60_000, readOffPeriods: 3 })).toContain("延时 5 秒");
  });

  it("描述文案把非整分时限说清楚（1 分 30 秒，不是「1 分」）", () => {
    // 老版本的自定义只有整分钟，90 秒这种值根本填不出来；现在能填，描述也要如实写。
    expect(describeClock({ mode: "fischer", baseMs: 90_000, incrementMs: 0, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 })).toBe("1 分 30 秒（包干）");
    expect(describeClock({ mode: "fischer", baseMs: 45_000, incrementMs: 0, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 })).toBe("45 秒（包干）");
    expect(describeClock({ mode: "fischer", baseMs: 2 * 3600_000, incrementMs: 0, delayMs: 10_000, readOffMs: 60_000, readOffPeriods: 3 })).toBe("2 小时（包干）");
  });

  it("延时额度越界/缺失都被收窄（老版本没有这个字段）", () => {
    // 缺字段时补默认值——不能变成 0，那等于静默把布龙斯坦档降级成包干。
    expect(normalizeClockSettings({ mode: "bronstein", baseMs: 60_000 }).delayMs).toBe(DEFAULT_CLOCK_SETTINGS.delayMs);
    expect(normalizeClockSettings({ mode: "bronstein", baseMs: 60_000, delayMs: -5 }).delayMs).toBe(0);
    expect(normalizeClockSettings({ mode: "bronstein", baseMs: 60_000, delayMs: 999_999_999 }).delayMs).toBe(5 * 60 * 1000);
    expect(normalizeClockSettings({ mode: "bronstein", baseMs: 60_000, delayMs: Number.NaN }).delayMs).toBe(DEFAULT_CLOCK_SETTINGS.delayMs);
  });

  it("bronstein 是合法制式（不会被回落到 fischer）", () => {
    expect(normalizeClockSettings({ mode: "bronstein", baseMs: 60_000, delayMs: 5_000 }).mode).toBe("bronstein");
    expect(normalizeClockSettings({ mode: "hourglass", baseMs: 60_000 }).mode).toBe(DEFAULT_CLOCK_SETTINGS.mode);
  });

  it("延时额度参与预设匹配（改了延时就不能还算命中那一档）", () => {
    // 2026-10-01 实测：比较里漏了 delayMs，把「25 分 + 延时 5 秒」的额度改成 30 秒后，
    // 那一档仍然显示选中（勾还在），看起来就像"改了没生效"。
    const preset = CLOCK_PRESETS.find((entry) => entry.id === "delay25i5")!;
    expect(matchClockPreset(preset.settings)).toBe("delay25i5");
    expect(matchClockPreset({ ...preset.settings, delayMs: 30_000 })).toBeNull();
    expect(sameClockSettings(preset.settings, { ...preset.settings, delayMs: 30_000 })).toBe(false);
    // 读秒额度同理早就参与了比较——这里只是把延时补成一样的口径。
    expect(matchClockPreset({ ...preset.settings, mode: "readOff", delayMs: preset.settings.delayMs })).toBeNull();
  });

});
