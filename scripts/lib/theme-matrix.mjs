/**
 * 全主题矩阵的共享工具（用户 09-17：「早就 22 主题了，写死 7 套的列表早过时，改成全主题」）。
 *
 * 设计要点：
 *  1. **清单来自应用本身**，不在脚本里写数组：`App` 把可测主题 id 挂在
 *     `.app-shell[data-theme-options]`（源头是 `src/theme-options.ts`）。以后新增主题，
 *     所有读这个清单的门禁自动覆盖——历史教训是 5 个门禁各写一份 7 项列表，主题涨到 22 套
 *     之后那些断言其实一直在测同一批老主题。
 *  2. 清单读不到就**抛错**，不静默降级成空数组：否则「没测」会被当成「全过」。
 *  3. 对比度用 WCAG 相对亮度，并把元素自身与祖先的背景**逐层合成**出不透明底色再比
 *     （背景是 transparent 时直接当纯黑/纯白比，会让任何文字都通过——这是早先踩过的坑）。
 *
 * 用法（在门禁里）：
 *   import { readThemeIds, runThemeMatrix, sampleManyScript } from "./lib/theme-matrix.mjs";
 *   const themeIds = await readThemeIds(page);                       // 20 套（排除 system / custom）
 *   const rows = await runThemeMatrix(page, themeIds, () => page.evaluate(sampleManyScript([".btn"])));
 *   const weak = rows.filter((r) => !(r.sample[".btn"]?.ratio >= 4.5));
 */

/** 最少应测到的主题数：低于这个数说明清单没读到或被人为缩小，直接失败。 */
export const MIN_EXPECTED_THEMES = 18;

/** 从应用读可测主题清单（排除「跟随系统」与「自定义背景」，理由见 src/theme-options.ts）。 */
export async function readThemeIds(page) {
  const raw = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-theme-options") || "");
  const ids = raw.split(/\s+/).filter(Boolean);
  if (ids.length < MIN_EXPECTED_THEMES) {
    throw new Error(`读不到可测主题清单（拿到 ${ids.length} 个：${raw || "空"}）——请确认 .app-shell 上有 data-theme-options；`
      + "门禁绝不能因为清单读不到就少测一堆主题。");
  }
  return ids;
}

/** 在页面里量一个选择器的「文字色 + 实际压住的底色」。放在字符串里注入，避免门禁各写一份。 */
const SAMPLE_ONE = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const parse = (css) => {
    const s = String(css || "");
    const srgb = /color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?/.exec(s);
    if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3]), srgb[4] === undefined ? 1 : Number(srgb[4])];
    const rgb = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?/.exec(s);
    if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, rgb[4] === undefined ? 1 : Number(rgb[4])];
    const hex = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\\b/i.exec(s);
    if (hex) {
      const raw = hex[1];
      const full = raw.length <= 4 ? raw.split("").map((c) => c + c).join("") : raw;
      return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255,
        full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
    }
    return null;
  };
  const firstColor = (css) => {
    const s = String(css || "");
    if (!s || s === "none") return null;
    const m = /color\\(srgb[^)]*\\)|rgba?\\([^)]*\\)/.exec(s);
    return m ? parse(m[0]) : null;
  };
  const lum = (c) => 0.2126 * (c[0] <= 0.03928 ? c[0] / 12.92 : ((c[0] + 0.055) / 1.055) ** 2.4)
    + 0.7152 * (c[1] <= 0.03928 ? c[1] / 12.92 : ((c[1] + 0.055) / 1.055) ** 2.4)
    + 0.0722 * (c[2] <= 0.03928 ? c[2] / 12.92 : ((c[2] + 0.055) / 1.055) ** 2.4);
  const style = getComputedStyle(el);
  // 底色：先沿祖先链**收集**所有带透明度的背景层（遇到不透明层就停），再**从最外层往元素方向**
  // 逐层叠上去。⚠ 顺序不能反：直接把祖先色叠在元素色上面，会让「深色按钮 + 浅色 body」
  // 变成浅底，量出 1.05:1 这种假故障（09-17 实测：blackgold/aurora/deepsea 三套全中招，
  // 真值其实 10:1 以上）。渐变取第一个色标（本项目底纹都是渐变）。
  const layers = [];
  let node = el;
  while (node && node !== document.documentElement.parentNode) {
    const s = getComputedStyle(node);
    const layer = parse(s.backgroundColor) || firstColor(s.backgroundImage);
    if (layer && layer[3] > 0) { layers.push(layer); if (layer[3] >= 1) break; }
    node = node.parentElement;
  }
  let bg = [1, 1, 1];
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const a = layers[i];
    bg = [a[0] * a[3] + bg[0] * (1 - a[3]), a[1] * a[3] + bg[1] * (1 - a[3]), a[2] * a[3] + bg[2] * (1 - a[3]), 1];
  }
  const fg = parse(style.color);
  const rect = el.getBoundingClientRect();
  const ratio = fg && bg ? Math.round(((Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05)) * 100) / 100 : null;
  return {
    color: style.color, backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor,
    ratio, display: style.display, opacity: Number(style.opacity),
    width: Math.round(rect.width), height: Math.round(rect.height),
  };
}`;

/** 量单个选择器（返回可直接交给 page.evaluate 的字符串）。 */
export const sampleContrastScript = (selector) => `(() => { const one = ${SAMPLE_ONE}; return one(${JSON.stringify(selector)}); })()`;

/** 一次量多个选择器，返回 { selector: sample }。 */
export const sampleManyScript = (selectors) => `(() => { const one = ${SAMPLE_ONE}; const out = {}; for (const s of ${JSON.stringify(selectors)}) out[s] = one(s); return out; })()`;

/**
 * 逐主题跑一遍：设置 `data-theme` → 等一帧 → 用 read(theme) 取样。
 * 返回 [{ theme, sample }]；门禁自己拿结果断言，失败时能直接看出是哪一套主题。
 */
export async function runThemeMatrix(page, ids, read) {
  const rows = [];
  const previous = await page.evaluate(() => {
    const root = document.documentElement;
    const names = ["--paper-with-alpha", "--line-with-alpha", "--action-surface", "--action-border"];
    return { theme: root.getAttribute("data-theme"), tokens: names.map((name) => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]) };
  });
  try {
    for (const theme of ids) {
      await page.evaluate((t) => {
        const root = document.documentElement;
        root.setAttribute("data-theme", t);
        // The app normally recomputes these inline alpha tokens when React's
        // theme state changes. This matrix bypasses React, so update the same
        // derived colours before sampling instead of retaining the old theme.
        const style = getComputedStyle(root);
        const shell = document.querySelector(".app-shell");
        const opacity = Number(shell ? getComputedStyle(shell).getPropertyValue("--action-opacity") : "1") || 1;
        const readColor = (name, fallback) => style.getPropertyValue(name).trim() || style.getPropertyValue(fallback).trim();
        for (const [target, source, fallback] of [
          ["--paper-with-alpha", "--paper", "--surface"], ["--line-with-alpha", "--line", "--surface-border"],
          ["--action-surface", "--surface", "--paper"], ["--action-border", "--surface-border", "--line"],
        ]) root.style.setProperty(target, `color-mix(in srgb, ${readColor(source, fallback)} ${opacity * 100}%, transparent)`);
      }, theme);
      await page.waitForTimeout(60);
      rows.push({ theme, sample: await read(theme) });
    }
  } finally {
    await page.evaluate((saved) => {
      const root = document.documentElement;
      if (saved.theme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", saved.theme);
      for (const [name, value, priority] of saved.tokens) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
    }, previous);
  }
  return rows;
}

/**
 * 取某套主题的取样：传了 selector 就从多选择器结果里取那一项，没传就整体当一个取样。
 * ⚠ 不能用 `??` 回退——元素缺失时值是 null，`null ?? row.sample` 会把**整个对象**当成取样，
 * 于是 ratio/width 都是 undefined，报出「无对比度/undefinedpx」这种读不出真相的消息
 * （09-17 实测：20 套主题全报同一句，其实是那一刻根本没有亮态栏）。
 */
export function pickSample(row, selector) {
  if (!row?.sample) return null;
  if (!selector) return row.sample;
  return Object.prototype.hasOwnProperty.call(row.sample, selector) ? row.sample[selector] : row.sample;
}

/**
 * 把「可见 + 对比度达标」的判定收成一句，返回不合格主题的描述（空数组 = 全过）。
 * minWidth 可配：细控件（功能区边界栏只有 12px 宽）用默认 20px 会被判成「不可见」。
 */
export function weakThemes(rows, selector, minRatio, { minWidth = 20 } = {}) {
  return rows
    .filter((row) => {
      const sample = pickSample(row, selector);
      return !sample || sample.display === "none" || sample.width < minWidth || !(sample.ratio >= minRatio);
    })
    .map((row) => {
      const sample = pickSample(row, selector);
      return `${row.theme}:${sample ? `${sample.ratio ?? "无对比度"}/${sample.width}px` : "元素缺失"}`;
    });
}

/** 所有主题里的最低对比度（用于断言消息里给出量级）。 */
export function minRatioOf(rows, selector) {
  const values = rows.map((row) => pickSample(row, selector)?.ratio).filter((value) => typeof value === "number");
  return values.length ? Math.min(...values) : null;
}
