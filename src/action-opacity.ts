/** 功能区按钮的透明度（用户 2026-10-09：「加入一个调整功能区按钮透明度的功能，放到功能区设置里面，
 *  可以自由调整功能区的按钮的透明度」）。
 *
 *  与 `board-opacity.ts` 同一套写法（同一个 normalize/load/save 三段式），只是作用对象不同：
 *  棋盘透明度改的是棋面底色，这个改的是**功能区那些按钮**的底子（首行功能区 / 常驻操作区 / 底部导航
 *  里那一排排按钮），让背景主题能透出来。
 *
 *  ⚠ 下限取 0.05 而不是像棋盘那样 0.35：按钮**没有别的可识别物**（棋盘再淡也还有网格线），
 *    压到很低时按钮会几乎看不见。但用户明说"自由调整"，所以下限只防"完全消失"这一种情况，
 *    真淡到看不清时由用户自己拉回来（值持久化在本机）。
 */
export const ACTION_OPACITY_KEY = "banbu-action-opacity-v1";
export const DEFAULT_ACTION_OPACITY = 1;
export const MIN_ACTION_OPACITY = 0.05;

export const normalizeActionOpacity = (value: unknown): number => {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_ACTION_OPACITY;
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(MIN_ACTION_OPACITY, Math.round(ratio * 100) / 100));
};

export const loadActionOpacity = (): number => {
  try {
    return normalizeActionOpacity(localStorage.getItem(ACTION_OPACITY_KEY));
  } catch {
    return DEFAULT_ACTION_OPACITY;
  }
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 把主题色（hex / rgb / rgba）与透明度合成为 rgba 字符串。
 *
 *  为什么需要在 JS 里算：老 Android WebView（K20 / WebView 83）既不支持 `color-mix`，
 *  也不能把 hex 色拆成 rgba 分量（相对颜色语法要更新的内核）。而"底色跟着透明度变淡、
 *  文字图标保持清晰"这件事必须靠 `rgba()`（用 `opacity` 会连内容一起淡）。
 *  于是 App 在透明度或主题变化时调用它，把结果写进
 *  `--paper-with-alpha` / `--line-with-alpha`（顶/底栏）以及
 *  `--action-surface-rgba` / `--action-surface2-rgba` / `--action-border-rgba`
 *  （功能区与卡片，见 action-opacity.css 的老内核段）。
 *
 *  ⚠ 必须支持 **8 位 hex**：深色/材质主题的 `--surface` 是带 alpha 的
 *    （如 deepsea `#142a31e8`、blackgold `#171510e8`）。合成本身也要带 alpha，
 *    而且是**相乘**（底色自带的 0.91 × 用户透明度），不是覆盖 ——
 *    否则那些主题的卡片会从"半透明深块"变成"完全不透明"。
 *  ⚠ 认不出来的色值原样返回：宁可"这次没淡"，也不要变成黑色块。 */
export const withAlpha = (color: string, opacity: number): string => {
  const raw = String(color || "").trim();
  const alpha = clamp01(opacity);
  const hex8 = raw.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex8) {
    const baked = parseInt(hex8[4], 16) / 255;
    return `rgba(${parseInt(hex8[1], 16)}, ${parseInt(hex8[2], 16)}, ${parseInt(hex8[3], 16)}, ${clamp01(baked * alpha)})`;
  }
  const hex4 = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex4) {
    const [r, g, b, a] = hex4.slice(1).map((c) => parseInt(c + c, 16));
    return `rgba(${r}, ${g}, ${b}, ${clamp01((a / 255) * alpha)})`;
  }
  const long = raw.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (long) {
    return `rgba(${parseInt(long[1], 16)}, ${parseInt(long[2], 16)}, ${parseInt(long[3], 16)}, ${alpha})`;
  }
  const short = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    const [r, g, b] = short.slice(1).map((c) => parseInt(c + c, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  /* `rgb()` / `rgba()` / 现代 `rgb(r g b / a%)` 都收：分量原样保留，alpha 相乘。 */
  const rgb = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (rgb) {
    const bakedRaw = rgb[4];
    const baked = bakedRaw === undefined ? 1 : bakedRaw.endsWith("%") ? parseFloat(bakedRaw) / 100 : parseFloat(bakedRaw);
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${clamp01((Number.isFinite(baked) ? baked : 1) * alpha)})`;
  }
  return raw;
};

export const saveActionOpacity = (value: number) => {
  try { localStorage.setItem(ACTION_OPACITY_KEY, String(normalizeActionOpacity(value))); } catch { /* optional visual preference */ }
};
