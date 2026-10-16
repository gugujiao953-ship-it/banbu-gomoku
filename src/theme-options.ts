import type { ResolvedTheme, ThemePreference } from "./app-shell-types";

/** 应用主题清单的**唯一来源**（用户 09-17：早就 22 套主题了，门禁里写死 7 套的列表早过时）。
 *
 *  设置页的主题选择器读这里；`App` 把可测主题 id 挂到 `.app-shell[data-theme-options]` 上，
 *  于是所有「新控件必须适配全部主题」的门禁都从应用本身取清单——以后新增主题，
 *  门禁自动覆盖，不需要再去改每个脚本里的数组（历史教训：5 个门禁各写一份 7 项列表）。
 *
 *  只有 id + 名字两项（用户 2026-10-02：「主题卡有说明吗，这些要啥说明，去掉，只留个名字
 *  就行了」）：每张卡左边的色块就是这套主题的样子，再看一句「青绿竹影与竹叶缓慢飘落」
 *  既不能帮判断也不值得占一行；字号开到特大时那行说明还会被截成半句。 */
export const THEME_OPTIONS: Array<[ThemePreference, string]> = [
  ["system", "跟随系统"],
  ["light", "浅色"],
  ["dark", "深色"],
  ["eye", "护眼"],
  ["mono", "黑白极简"],
  ["rain", "雨幕"],
  ["bamboo", "水墨竹林"],
  ["snow", "雪落"],
  ["porcelain", "青花瓷影"],
  ["plum", "梅枝映雪"],
  ["jiangnan", "夜雨江南"],
  ["firefly", "萤火森林"],
  ["rice", "宣纸留白"],
  ["pixel", "像素街机"],
  ["cyber", "霓虹赛博"],
  ["blackgold", "尊贵黑金"],
  ["pale", "苍白世界"],
  ["kawaii", "卡哇伊"],
  ["aurora", "极光"],
  ["deepsea", "深海幽蓝"],
  ["baroque", "巴洛克"],
  ["pelican", "黄昏骑行"],
  ["dunhuang", "飞天敦煌"],
  ["soul", "棋魂"],
  ["custom", "自定义背景"],
];

/** 不能按 id 直接量对比度的两项：
 *  - `system` 不是一种渲染结果，由系统外观解析成浅色/深色（同一次运行里会变）；
 *  - `custom` 的底色由用户自选的背景色/图片决定，对比度不可判定（换一张背景就变了）。
 *  门禁扫的是「可测主题」= 其余 20 套。 */
export const UNTESTABLE_THEME_IDS: ThemePreference[] = ["system", "custom"];

export const CONCRETE_THEME_IDS: ThemePreference[] = THEME_OPTIONS
  .map(([id]) => id)
  .filter((id) => !UNTESTABLE_THEME_IDS.includes(id));

/**
 * **深色主题**（底色偏暗、需要 `color-scheme:dark` 的那批）。
 *
 * ⚠ 2026-10-11 补：这条清单原来**写死在 `App.tsx` 里**
 * （`["dark","rain","jiangnan","firefly","pixel","cyber"].includes(...)`），
 * 而它是**不完整的** —— `blackgold` / `aurora` / `deepsea` / `pelican` 四套
 * 早就是暗色（`styles.css` 里它们标着 `color-scheme:dark`），却不在那份名单里。
 *
 * 后果不是"少一行 CSS"，而是**原生控件与系统 UI 用错色**：
 * 输入框、下拉菜单、滚动条、聚焦环都按 light 渲染，压在墨色底上像补丁。
 * 我这一轮加 `soul`（黑白水墨，暗调）时撞上了它 —— 令牌里写死 `color-scheme:dark`
 * 也被 `App` 那行内联样式盖掉（内联 > 样式表）。
 *
 * 所以名单**收到这里**（主题清单的单一事实来源），并补齐上面漏掉的四套；
 * `App.tsx` 只做 `DARK_THEME_IDS.includes(nextTheme)` 的查询，不再自己维护一份。
 * 以后新增暗色主题，改这一处即可。
 */
export const DARK_THEME_IDS: ResolvedTheme[] = ["dark", "rain", "jiangnan", "firefly", "pixel", "cyber", "blackgold", "aurora", "deepsea", "pelican", "dunhuang", "soul"];

export const isDarkTheme = (id: ResolvedTheme): boolean => DARK_THEME_IDS.includes(id);

const THEME_IDS = new Set<string>(THEME_OPTIONS.map(([id]) => id));
export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === "string" && THEME_IDS.has(value);
