/**
 * qa/pelican-studio.mjs — 鹈鹕骑行「离线放大预览台」。
 *
 * 为什么要有它：这一幕在真机上只有约 236×145 px，腿宽不到 5 px。肉眼和普通截图都看不清
 * 「到底几只脚、哪只在动、有没有每圈抽一下」——前几轮反复改不对，根因就是没看清。
 * 本脚本把场景搬进浏览器，**直接读 src/styles.css**（不复制粘贴，永不失同步），
 * 把 SVG 资源内联成 data URI（不需要 dev/preview 服务器），再用
 * `animation-delay: -相位秒数` + `animation-play-state: paused` 把每个动画钉死在指定相位，
 * 最后把指定区域放大截图。于是「几只脚、哪只在蹬、抽不抽」变成一眼能看的事。
 *
 * ⚠ 两个坑（都踩过）：
 *  ① 预览台必须**自己钉死 430×264 的宽高比**：生产 CSS 里那条
 *     `@media (orientation:landscape){.ts-ride{width:min(100%,calc(44dvh*1.6288))}}`
 *     在宽屏浏览器里会命中，把画布压成 430×396（纵向拉长 1.5 倍），看出来的东西全是错的。
 *  ② 带状特写必须让**带子紧挨着排**：画布是 430 单位宽而带子只有 170 单位，
 *     若按画布尺寸排格子，图里会有 2/3 是空隙，缩略图糊成一片什么都看不见。
 *
 * 用法：
 *   node qa/pelican-studio.mjs rig        # 整体 2×2 相位网格（看结构：脚的数量、层次）
 *   node qa/pelican-studio.mjs legs       # 腿部带状特写（看细节：脱节、脚掌姿态、抽动）
 *   node qa/pelican-studio.mjs body       # 上身带状特写（尾羽 / 翅膀 / 喙）
 *   node qa/pelican-studio.mjs all        # 全出（默认）
 *   PHASES=0,0.5 BAND=150,140,320,300 FILE=x.png node qa/pelican-studio.mjs custom
 */

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "qa/tmp-studio";
const ASSET_DIR = "public/theme-assets";
const VB = { x: 0, y: 66, w: 430, h: 264 };   // 场景 viewBox（与素材一致）
const CRANK_PERIOD = 1.5;                     // 与 styles.css 里的 pelican-* 一致
const missing = new Set();

/* ── 1. 生产 CSS → 内联 data URI ── */
function svgUri(name) {
  const p = `${ASSET_DIR}/${name}`;
  if (!existsSync(p)) {
    missing.add(name);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 430 264">
      <rect width="430" height="264" fill="#ff00ff" opacity=".4"/>
      <text x="215" y="140" font-size="24" text-anchor="middle" fill="#fff">缺 ${name}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
  return `data:image/svg+xml;base64,${readFileSync(p).toString("base64")}`;
}
const cache = new Map();
const css = readFileSync("src/styles.css", "utf8").replace(
  /url\(\s*["']?\/theme-assets\/([A-Za-z0-9_.\-]+\.svg)(\?[^"')]*)?["']?\s*\)/g,
  (_m, f) => `url("${cache.get(f) ?? (cache.set(f, svgUri(f)), cache.get(f))}")`,
);

/* ── 2. 图层（与 src/App.tsx 的 .ts-ride 子元素一一对应，顺序＝绘制顺序）── */
const LAYERS = [ "tr-wheel tr-wheel-rear", "tr-wheel tr-wheel-front",
  "tr-crank-far", "tr-far-thigh", "tr-far-shin", "tr-far-foot",
  "tr-frame",
  "tr-crank", "tr-thigh", "tr-shin", "tr-foot", "tr-body",
];

const S = Number(process.env.S || 2);          // 放大倍数
const CW = VB.w * S, CH = VB.h * S;            // 一个「完整画布」的尺寸
const GAP = 16, PAD = 20;

/** 相位 → animation-delay 秒数 */
const delay = (phase) => (-phase * CRANK_PERIOD).toFixed(4);

function layerTags(phase) {
  const inner = LAYERS.map((c) => `<b class="${c}"></b>`).join("");
  return `<div class="theme-scene"><span class="ts-ride" style="--d:${delay(phase)}s">${inner}</span></div>`;
}

/**
 * 排版：band 为空＝一格格整幅画布；给了 band 就让每格的**带区**左右紧挨着排。
 * band = [x0,y0,x1,y1]（场景坐标）
 */
function layout(phases, band) {
  const cols = phases.length;
  const off = band ? { x: (band[0] - VB.x) * S, y: (band[1] - VB.y) * S } : { x: 0, y: 0 };
  const step = band ? (band[2] - band[0]) * S + GAP : CW + GAP;
  const cellW = band ? (band[2] - band[0]) * S : CW;
  const cellH = band ? (band[3] - band[1]) * S : CH;
  const cells = phases.map((p, i) => {
    const left = PAD + i * step - off.x, top = PAD - off.y;
    const capL = band ? (band[0] - VB.x) * S + 6 - (left - PAD) : 6;
    const capT = band ? (band[1] - VB.y) * S + 4 - (top - PAD) : 4;
    return `<div class="cell" style="left:${left}px;top:${top}px">
      ${layerTags(p)}<div class="cap" style="left:${capL}px;top:${capT}px">φ=${p.toFixed(3)}</div></div>`;
  }).join("");
  const W = PAD * 2 + cols * cellW + (cols - 1) * GAP;
  const H = PAD * 2 + cellH;
  return { cells, W, H };
}

function pageHtml(phases, band) {
  const { cells, W, H } = layout(phases, band);
  return `<!doctype html><html data-theme="pelican"><head><meta charset="utf-8">
<style>${css}</style>
<style>
  /* ── 预览台覆盖：只改「摆在哪、多大、冻在哪一帧」，动画与素材全部沿用生产 CSS ── */
  html,body{margin:0!important;background:#141020!important;background-image:none!important}
  body{position:relative;width:${W}px;height:${H}px;overflow:hidden}
  .cell{position:absolute;width:${CW}px;height:${CH}px}
  .cell .theme-scene{position:static!important;left:auto!important;top:auto!important;
    width:${CW}px!important;height:${CH}px!important;transform:none!important;
    display:block!important;overflow:visible!important;border-radius:0!important}
  .cell .ts-ride{display:block!important;position:relative!important;
    left:0!important;right:auto!important;top:0!important;bottom:auto!important;margin:0!important;
    width:${CW}px!important;height:${CH}px!important;aspect-ratio:auto!important;animation:none!important}
  /* 全部冻结在 --d 指定的相位；远侧（对面那条腿／曲柄）固定差半圈 */
  .cell .ts-ride>*{animation-play-state:paused!important;animation-delay:var(--d,0s)!important}
  .cell .tr-crank-far{animation-delay:calc(var(--d,0s) - ${CRANK_PERIOD / 2}s)!important}
  /* 地面层在生产里是「横贯整个视口」（left:50% + margin-left:-50vw + width:100vw）；
     预览台里一格挨着一格，那样会糊到隔壁格上，所以这里把宽度收回本格。
     纵向定位（top:50.7576%／height:49.2424%）保持生产值，看的仍是真实高度。 */
  .cell .ts-ride::before{left:0!important;margin-left:0!important;width:100%!important}
  .cap{position:absolute;font:10px/1.2 ui-monospace,monospace;color:#ffd9a4;
    background:#000000bb;padding:1px 4px;border-radius:3px;z-index:9;pointer-events:none}
</style></head><body>${cells}</body></html>`;
}

async function shoot(browser, html, file, dsf = 2) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dsf });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  await page.close();
  console.log("→", `${OUT}/${file}`);
}

const BAND = { legs: [150, 150, 320, 300], body: [110, 62, 420, 200] };
const mode = process.argv[2] || "all";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

if (mode === "rig" || mode === "all") {
  for (const [i, ph] of [[0, [0, 0.125, 0.25, 0.375]], [1, [0.5, 0.625, 0.75, 0.875]]]) {
    await shoot(browser, pageHtml(ph), `rig-${i}.png`, 1);
  }
}
if (mode === "legs" || mode === "all") {
  await shoot(browser, pageHtml([0, 0.125, 0.25, 0.375, 0.5, 0.625], BAND.legs), "legs-a.png");
  await shoot(browser, pageHtml([0.75, 0.833, 0.875, 0.938, 0.97, 0.995], BAND.legs), "legs-b.png");
  // 两只脚同框：近 0 相位 vs 远 0 相位（远侧差半圈，应当恰好互补）
  await shoot(browser, pageHtml([0, 0.25, 0.5, 0.75], BAND.legs), "legs-quarters.png");
}
if (mode === "body" || mode === "all") {
  await shoot(browser, pageHtml([0, 0.25, 0.5], BAND.body), "body-a.png");
}
if (mode === "custom") {
  const ph = (process.env.PHASES || "0,0.5").split(",").map(Number);
  const bd = (process.env.BAND || "").split(",").map(Number);
  await shoot(browser, pageHtml(ph, bd.length === 4 ? bd : null), process.env.FILE || "custom.png");
}

await browser.close();
if (missing.size) console.log("⚠ 缺失素材（已用洋红占位）：", [...missing].join(", "));
else console.log("素材齐全");
