/**
 * 棋钟设置的持久化（用户 2026-09-23）。
 *
 * 照项目里 settings 模块的同一套写法（`DEFAULT_*` / `normalize*` / `load*` / `save*` / `*_KEY`），
 * 见 audio-settings.ts、update-settings.ts。所有取值都要收窄——localStorage 里的东西
 * 可能被手改、可能是旧版本写的，**归一化失败必须回落到默认值而不是让棋钟带着脏数据跑**
 * （时限为 NaN 会让整场对局的时间显示变成 NaN）。
 */
import { CLOCK_PRESETS, DEFAULT_CLOCK_SETTINGS, type ClockMode, type ClockSettings } from "./duel-clock";

export const CLOCK_SETTINGS_KEY = "banbu-duel-clock-settings-v1";
export const CLOCK_PRESET_KEY = "banbu-duel-clock-preset-v1";

/** 时限允许区间：1 秒 ~ 6 小时。超出范围的当作无效（恶意/损坏值）。 */
const MIN_BASE_MS = 1_000;
const MAX_BASE_MS = 6 * 60 * 60 * 1000;
/** 加秒允许区间：0 ~ 5 分钟。 */
const MIN_INCREMENT_MS = 0;
const MAX_INCREMENT_MS = 5 * 60 * 1000;
/** 布龙斯坦延时额度：0 ~ 5 分钟。 */
const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 5 * 60 * 1000;
/** 读秒额度 1 秒 ~ 10 分钟；周期 1 ~ 20。 */
const MIN_READOFF_MS = 1_000;
const MAX_READOFF_MS = 10 * 60 * 1000;
const MIN_PERIODS = 1;
const MAX_PERIODS = 20;

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
};

const isMode = (value: unknown): value is ClockMode =>
  value === "fischer" || value === "bronstein" || value === "readOff";

export const normalizeClockSettings = (value: unknown): ClockSettings => {
  if (!value || typeof value !== "object") return { ...DEFAULT_CLOCK_SETTINGS };
  const raw = value as Partial<ClockSettings>;
  return {
    mode: isMode(raw.mode) ? raw.mode : DEFAULT_CLOCK_SETTINGS.mode,
    baseMs: clamp(raw.baseMs, MIN_BASE_MS, MAX_BASE_MS, DEFAULT_CLOCK_SETTINGS.baseMs),
    incrementMs: clamp(raw.incrementMs, MIN_INCREMENT_MS, MAX_INCREMENT_MS, DEFAULT_CLOCK_SETTINGS.incrementMs),
    // 老版本（v1 只有 fischer/readOff、没有 delayMs）存的设置在这里补上默认延时额度，
    // 不会因为缺字段让布龙斯坦档变成 0 秒延时（那等于包干）。
    delayMs: clamp(raw.delayMs, MIN_DELAY_MS, MAX_DELAY_MS, DEFAULT_CLOCK_SETTINGS.delayMs),
    readOffMs: clamp(raw.readOffMs, MIN_READOFF_MS, MAX_READOFF_MS, DEFAULT_CLOCK_SETTINGS.readOffMs),
    readOffPeriods: clamp(raw.readOffPeriods, MIN_PERIODS, MAX_PERIODS, DEFAULT_CLOCK_SETTINGS.readOffPeriods),
  };
};

export const loadClockSettings = (): ClockSettings => {
  try {
    const raw = localStorage.getItem(CLOCK_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_CLOCK_SETTINGS };
    return normalizeClockSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CLOCK_SETTINGS };
  }
};

export const saveClockSettings = (settings: ClockSettings) => {
  try { localStorage.setItem(CLOCK_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 存储满时不影响对局 */ }
};

/**
 * 没记录时回落到默认设置对应的预设 id。
 * 由 DEFAULT_CLOCK_SETTINGS 反查而不是写死字面量：写死的 "wc"（2 小时 + 30 秒）
 * 跟真正的默认档「5 分钟快棋」对不上，界面上会把默认档标成世锦赛档。
 * 用 CLOCK_PRESETS[0].id 兜底，是为了默认设置万一不在预设表里（值被改过）也还有结果。
 */
export const defaultClockPresetId = (): string =>
  matchClockPreset(DEFAULT_CLOCK_SETTINGS) ?? CLOCK_PRESETS[0].id;

/** 上次用的预设 id；没存过时用默认设置对应的那一档。 */
export const loadClockPresetId = (): string => {
  try { return localStorage.getItem(CLOCK_PRESET_KEY) || defaultClockPresetId(); } catch { return defaultClockPresetId(); }
};

export const saveClockPresetId = (id: string) => {
  try { localStorage.setItem(CLOCK_PRESET_KEY, id); } catch { /* 同上 */ }
};

/**
 * 两份设置是否等价（用来判断当前是不是某个预设、要不要显示"自定义"）。
 * **`delayMs` 必须参与比较**：少了它，把「25 分 + 延时 5 秒」的延时额度改成 30 秒之后，
 * 界面仍然把那一档显示成选中态，看起来就像"改了没生效"（2026-10-01 实测）。
 */
export const sameClockSettings = (a: ClockSettings, b: ClockSettings): boolean =>
  a.mode === b.mode && a.baseMs === b.baseMs && a.incrementMs === b.incrementMs
  && a.delayMs === b.delayMs
  && a.readOffMs === b.readOffMs && a.readOffPeriods === b.readOffPeriods;

/** 找出与当前设置匹配的预设 id；没有则为 null（= 自定义）。 */
export const matchClockPreset = (settings: ClockSettings): string | null =>
  CLOCK_PRESETS.find((preset) => sameClockSettings(preset.settings, settings))?.id ?? null;

/** 面板上显示的简短描述，例如「2 小时 + 30 秒」「30 分 + 读秒 60 秒×3」。 */
export const describeClock = (settings: ClockSettings): string => {
  const base = describeBase(settings.baseMs);
  if (settings.mode === "readOff") return `${base} + 读秒 ${Math.round(settings.readOffMs / 1000)} 秒×${settings.readOffPeriods}`;
  if (settings.mode === "bronstein") return `${base} + 延时 ${Math.round(settings.delayMs / 1000)} 秒`;
  if (settings.incrementMs <= 0) return `${base}（包干）`;
  return `${base} + 每手 ${Math.round(settings.incrementMs / 1000)} 秒`;
};

/** 「1 小时 30 分」/「5 分」/「1 分 30 秒」——秒不为零时才把秒说出来。 */
const describeBase = (baseMs: number): string => {
  const totalSeconds = Math.round(baseMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} 秒`);
  return parts.join(" ");
};

