/**
 * qa/pelican-svg-view.mjs — 把单个素材 SVG 放大铺开看，并画出 viewBox 边界与每条路径的包围盒。
 * 用途：判断「尾羽是没接上身体，还是被 viewBox 裁掉了」这类问题——只有量出来才说得清。
 *
 *   node qa/pelican-svg-view.mjs pelican-body.svg
 *   node qa/pelican-svg-view.mjs pelican-body.svg --vb 0 66 430 264
 */
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const file = process.argv[2] || "pelican-body.svg";
const i = process.argv.indexOf("--vb");
const vb = i > 0 ? process.argv.slice(i + 1).join(" ") : "0 66 430 264";
const [vx, vy, vw, vh] = vb.split(/\s+/).map(Number);
const scale = Number(process.env.S || 2.6);
mkdirSync("qa/tmp-studio", { recursive: true });

const raw = readFileSync(`public/theme-assets/${file}`, "utf8");
// 顺便报一下素材自己的 viewBox，两者不一致＝被裁
const own = (raw.match(/viewBox="([^"]+)"/) || [, "?"])[1];
console.log(`${file}: 素材 viewBox="${own}"，本次按 "${vb}" 显示`);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#191428}
.wrap{position:relative;width:${vw * scale}px;height:${vh * scale}px}
svg{position:absolute;inset:0;width:100%;height:100%}
.vb{position:absolute;inset:0;border:1.5px dashed #ff5ec7}
.tag{position:absolute;font:11px ui-monospace,monospace;color:#7ef;background:#000a;padding:0 3px;white-space:nowrap}
</style></head><body><div class="wrap">
<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>[\s\S]*$/, "")}</svg>
<div class="vb"></div></div></body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Math.round(vw * scale) + 20, height: Math.round(vh * scale) + 20 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: "load" });
// 逐条 path 量包围盒（素材坐标），并标注
const boxes = await p.evaluate(([sx, sy, sw, sh, sc]) => {
  const out = [];
  const g = document.querySelector('svg g');
  const svg = document.querySelector('svg');
  svg.querySelectorAll("path,circle,rect").forEach((el, k) => {
    if (el.closest(".vb")) return;
    let bb;
    try { bb = el.getBBox ? el.getBBox() : null; } catch { bb = null; }
    if (!bb) return;
    const c = el.getAttribute("stroke"), f = el.getAttribute("fill");
    out.push({ k, x: +bb.x.toFixed(1), y: +bb.y.toFixed(1), w: +bb.width.toFixed(1), h: +bb.height.toFixed(1),
      color: c || f || "?", d: (el.getAttribute("d") || "").slice(0, 34) });
    // 标注
    const t = document.createElement("div");
    t.className = "tag"; t.textContent = `#${k} ${bb.x.toFixed(0)},${bb.y.toFixed(0)}`;
    t.style.left = ((bb.x - sx) * sc) + "px";
    t.style.top = ((bb.y + bb.height - sy) * sc) + "px";
    document.querySelector(".wrap").appendChild(t);
  });
  void g; void sw; void sh;
  return out;
}, [vx, vy, vw, vh, scale]);
console.log("素材坐标下的包围盒：");
for (const b2 of boxes) console.log(`  #${b2.k} x${b2.x} y${b2.y} w${b2.w} h${b2.h}  ${b2.color}  ${b2.d}`);
const outOf = boxes.filter((b2) => b2.y < vy || b2.y + b2.h > vy + vh || b2.x < vx || b2.x + b2.w > vx + vw);
if (outOf.length) console.log("⚠ 超出 viewBox（会被裁）:", outOf.map((b2) => `#${b2.k}`).join(","));
await p.screenshot({ path: `qa/tmp-studio/svg-${file.replace(/\.svg$/, "")}.png` });
console.log("→", `qa/tmp-studio/svg-${file.replace(/\.svg$/, "")}.png`);
await b.close();
