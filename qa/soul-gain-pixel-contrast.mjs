/**
 * 棋魂获得提示条的**真实场景像素对比度**门禁（2026-10-11）。
 *
 * ## 用户报的问题
 *
 * 「我们那个跳出棋魂的弹窗，在一些深色主题下，似乎那些字都好暗看不清楚」。
 *
 * ## 为什么必须量**真实场景**，而不是"干净底"
 *
 * 这条门禁的第一版把提示条渲染在**一块纯色底**上量（受控条件，量的是"配色本身"）。
 * 那个版本**全绿** —— 但用户看到的是真实场景：提示条浮在**页面**上
 * （`.topbar` 区、底下压着棋盘/卡片、还有 `backdrop-filter: blur` 糊进来的内容）。
 * 两者能不一致，实测就撞上了：干净底全过、真实场景 **42/66 条不合格**。
 *
 * 所以这一版**不清理页面**，把提示条按真实位置（`position: fixed` 的 right/top）
 * 挂上去，底就是真实页面。判据也只看**眼睛能看到的东西**：
 * 逐元素截图 + 像素分析（中位像素当背景、离背景最远的 5% 当字形）。
 *
 * ## 为什么不能只用 `getComputedStyle`（那条已有的 `achievements-contrast.mjs`）
 *
 * 那个探针量的是"计算样式的文字色 vs 祖先背景合成"。它对"配色写错了"很有效
 * （抓过 25 条），但看不到两件事：
 *  · `-webkit-text-stroke`（描边画在字形外圈/内部，计算样式只给填充色）；
 *  · **柔光渐变只铺了一半**这个几何问题 —— 而这正是本次的真凶（见下）。
 *
 * ## 真凶：柔光衬底的 `closest-side` 对"横长的胶囊"是错的
 *
 * ```
 * .soul-gain::before { background: radial-gradient(closest-side, …) }
 * ```
 *
 * `closest-side` 的半径取**最近的边**：提示条是横长的（宽 170+px、高 40px），
 * 最近的边是**上下**，于是渐变在**左右两侧早早透明** —— 右边那两行小字
 * （来源与"共 N"）落在**完全没有柔光**的页面上，亮金/暖白字压在浅色页面上就糊了。
 *
 * 修法：显式尺寸的椭圆（`120% 105%`），横向也铺满，边缘仍完全透明（还是"柔光"不是框）。
 * 实测：真实场景 42/66 不合格 → **0/66**（最低 3.26 → 6.46）。
 *
 * ⚠ 那圈椭圆柔光后来被换成了 `.soul-gain-mist` 墨形衬底（2026-10-12 的"按画面内容动"）。
 * 结论不变：**这枚提示的文字靠的是身后那层暗底**，所以夹具必须把那层一起造出来，
 * 否则量的是"没有衬底"的版本 ⇒ 全主题齐红（见下面 `mistSvg`）。
 *
 * 阈值 4.5:1（正文）。跑法：先起 dev/preview（默认 4510，可用 QA_BASE_URL 覆盖）。
 */
import { chromium } from "playwright";
import { SOUL_MIST_FILTER, SOUL_MIST_GRADIENT, SOUL_MIST_INK, SOUL_MIST_SIZE, SOUL_MIST_STOPS, soulMistPath } from "../src/features/progress/soul-gain-shape.ts";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4510/";
const THRESHOLD = 4.5;

/**
 * **那层墨形衬底必须跟着一起造**（2026-10-15 修门禁自身的假红）。
 *
 * 组件早已把 `::before` 的椭圆柔光换成了 `<svg class="soul-gain-mist">` 一条墨形
 * （见 `ProgressReward.tsx` 与 `soul-gain-shape.ts`），而这份夹具的 `innerHTML`
 * 是手写的、没跟着换 ⇒ 量到的是"没有衬底"的提示条 ⇒ 23 套主题**齐刷刷**低于阈值
 * （数字/来源/共N 每套主题都是同一个值，正是"缺了那层衬底"的指纹：
 * 真实缺陷只会在部分主题上红）。
 * 这里直接从**同一个源**取常量与路径，不再抄第二份颜色。
 */
const mistSvg = (uid = "qa") => `<svg class="soul-gain-mist" viewBox="0 0 ${SOUL_MIST_SIZE.W} ${SOUL_MIST_SIZE.H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<defs>
<filter id="sgm-f-${uid}" x="-20%" y="-45%" width="140%" height="190%">
<feTurbulence type="fractalNoise" baseFrequency="${SOUL_MIST_FILTER.baseFrequency}" numOctaves="${SOUL_MIST_FILTER.octaves}" seed="1" result="t"/>
<feDisplacementMap in="SourceGraphic" in2="t" scale="${SOUL_MIST_FILTER.scale}" xChannelSelector="R" yChannelSelector="G"/>
<feGaussianBlur stdDeviation="${SOUL_MIST_FILTER.blur}"/>
</filter>
<radialGradient id="sgm-g-${uid}" cx="${SOUL_MIST_GRADIENT.cx}%" cy="${SOUL_MIST_GRADIENT.cy}%" r="${SOUL_MIST_GRADIENT.r}%">
${SOUL_MIST_STOPS.map((stop) => `<stop offset="${stop.offset}" stop-color="${SOUL_MIST_INK}" stop-opacity="${stop.opacity}"/>`).join("")}
</radialGradient>
</defs>
<path d="${soulMistPath(1)}" fill="url(#sgm-g-${uid})" filter="url(#sgm-f-${uid})"/>
</svg>`;

/** 在页面里把 PNG 解码 + 量对比度（Playwright 序列化注入，不能闭包外部变量）。 */
const measureBase64 = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: "image/png" })).then((bitmap) => {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const luminance = (r, g, b) => {
      const channel = (value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const values = [];
    for (let i = 0; i < data.length; i += 4) values.push(luminance(data[i], data[i + 1], data[i + 2]));
    values.sort((a, b) => a - b);
    const count = values.length;
    if (!count) return null;
    // 中位 = 背景（描边/填充混在一起时，中位最接近"大面积"的那个）
    const background = values[Math.floor(count / 2)];
    const darkest = values[Math.floor(count * 0.05)];
    const brightest = values[Math.ceil(count * 0.95) - 1];
    // 字形 = 离背景**最远**的那个方向（文字可能是"亮填充 + 深描边"，也可能相反）
    const glyph = (brightest - background) > (background - darkest) ? brightest : darkest;
    return Math.round(((Math.max(glyph, background) + 0.05) / (Math.min(glyph, background) + 0.05)) * 100) / 100;
  }).catch(() => null);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
const page = await context.newPage();
await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(1500);

const { readThemeIds } = await import("../scripts/lib/theme-matrix.mjs");
const themes = await readThemeIds(page);

const failures = [];
let measured = 0;

for (const theme of themes) {
  await page.evaluate(({ t, mist }) => {
    document.documentElement.setAttribute("data-theme", t);
    document.querySelectorAll("[data-realprobe]").forEach((n) => n.remove());
    const node = document.createElement("div");
    node.className = "soul-gain";
    node.setAttribute("data-realprobe", "1");
    node.style.animation = "none";       // 停在原地，别在截图时飞走
    // ⚠ **不覆盖 position/top/right**：就让它按 CSS 的"右上角"贴在真实页面上。
    node.innerHTML = `${mist}<span class="soul-gain-flame"><svg class="soul-flame" width="34" height="34" viewBox="0 0 32 32"><path d="M16 3c2 5 7 7 7 13a7 7 0 0 1-14 0c0-6 5-8 7-13Z" fill="#1d2226"/></svg></span><span class="soul-gain-gain"><b data-real-amount="">+12</b></span><span class="soul-gain-copy"><small>战胜大师档 AI</small><small class="soul-gain-total">共 480</small></span>`;
    document.body.appendChild(node);
  }, { t: theme, mist: mistSvg() });
  await page.waitForTimeout(120);

  for (const [label, selector] of [["数字", "[data-real-amount]"], ["来源", ".soul-gain-copy small:not(.soul-gain-total)"], ["共N", ".soul-gain-total"]]) {
    const target = page.locator(selector).first();
    if (await target.count() === 0) continue;
    const buffer = await target.screenshot();
    const ratio = await page.evaluate(measureBase64, buffer.toString("base64"));
    if (typeof ratio !== "number") continue;
    measured += 1;
    if (ratio < THRESHOLD) failures.push({ theme, label, ratio });
  }
}

await browser.close();

console.log(`量了 ${measured} 条像素（真实场景：提示条浮在页面上；${themes.length} 套主题 × 数字/来源/共N）`);
if (failures.length === 0) {
  console.log(`✅ 全部 ≥ ${THRESHOLD}:1（棋魂提示条的文字在每套主题下都读得清）`);
} else {
  console.log(`❌ ${failures.length} 条低于 ${THRESHOLD}:1：`);
  for (const item of failures.sort((a, b) => a.ratio - b.ratio)) {
    console.log(`   ${item.theme} · ${item.label} = ${item.ratio}`);
  }
  process.exit(1);
}
