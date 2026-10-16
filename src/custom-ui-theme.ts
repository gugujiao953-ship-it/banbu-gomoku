/**
 * 「自定义背景」的**界面主题**（用户 2026-10-12：「现有是有自定义主题的，但是虽然主题自定义了，
 * ui 却还没有，所以自定义那里可以加入一个选择适配主题 ui 的选项（不过要记得，解锁了的主题才能用）」）。
 *
 * ## 它是什么、解决什么
 *
 * `custom` 主题一直是"只换背景"：用户选一张图 / 一个色，铺在 `.app-shell` 上，
 * 而界面（顶栏、面板、按钮、文字颜色）仍是**固定那一套浅色**——因为 `data-theme` 被写死成
 * `custom`，而 `custom` 只覆盖了背景与顶栏两条样式，令牌（`--ink/--paper/--jade…`）全部
 * 落回 `:root` 的默认浅色。于是"背景是我的照片、界面还是原样"。
 *
 * 这个模块存的就是"界面要用哪一套主题"：
 *  · 选 `light` / `dark` / `cyber` / `soul` … ⇒ 界面的令牌、顶栏、面板、控件全随它；
 *  · 背景**仍然**归用户自定义的色 / 图（实现见 `App.tsx` 的 `customAppStyle` 与
 *    `styles.css` 里 `html[data-custom-bg]` 那一段）。
 *
 * ## 为什么值域是 `CONCRETE_THEME_IDS`
 *
 * 「解锁了的主题才能用」——解锁判定不在这里，而在 UI 层（`SettingsPage` 复用既有的
 * `LockableOption` + `soulUnlockForTarget`，锁着的还是点了预览、右边魂火买了才切）。
 * 这里只做**读档归一化**：`system`（跟随系统不是一种渲染结果）与 `custom`（它自己）
 * 不是合法值，读到任何不认识的东西一律落回默认 `light`。
 *
 * ⚠ 默认是 `light` 而非 `dark`：老存档里 `custom` 就是浅色界面，默认值必须让
 *   「升级前后长得一样」，否则老用户打开应用会莫名变黑。
 */
import type { ResolvedTheme } from "./app-shell-types";
import { CONCRETE_THEME_IDS } from "./theme-options";

/** 存档键（加进 `backup.ts` 的键表，否则换机会丢）。 */
export const CUSTOM_UI_THEME_KEY = "banbu-custom-ui-theme-v1";

/** 默认界面主题：老 `custom` 的浅色界面（见文件头 ⚠）。 */
export const DEFAULT_CUSTOM_UI_THEME: ResolvedTheme = "light";

/** 合法值 = 可测主题清单（`system` / `custom` 已被 `CONCRETE_THEME_IDS` 排除）。 */
export const isCustomUiTheme = (value: unknown): value is ResolvedTheme =>
  typeof value === "string" && (CONCRETE_THEME_IDS as readonly string[]).includes(value);

/** 读档：不认识的值（含 `system` / `custom` / 旧存档没有它）一律落回默认。 */
export const loadCustomUiTheme = (): ResolvedTheme => {
  try {
    const value = localStorage.getItem(CUSTOM_UI_THEME_KEY);
    return isCustomUiTheme(value) ? value : DEFAULT_CUSTOM_UI_THEME;
  } catch { return DEFAULT_CUSTOM_UI_THEME; }
};

/** 落盘。存储不可用时忽略（本次会话仍然生效）。 */
export const saveCustomUiTheme = (value: ResolvedTheme): void => {
  try { localStorage.setItem(CUSTOM_UI_THEME_KEY, value); } catch { /* ignore unavailable storage */ }
};
