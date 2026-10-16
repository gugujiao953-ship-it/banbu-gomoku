import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(700); break; } }
console.log(await p.evaluate(async () => {
  const out = [];
  for (const sel of [".theme-scene", ".ts-far", ".ts-mid", ".ts-near"]) {
    const el = document.querySelector(sel);
    if (!el) { out.push(`${sel}: 不存在`); continue; }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    out.push(`${sel}: ${r.width.toFixed(0)}×${r.height.toFixed(0)}@${r.x.toFixed(0)},${r.y.toFixed(0)} display=${cs.display} opacity=${cs.opacity} size=${cs.backgroundSize} pos=${cs.backgroundPosition} repeat=${cs.backgroundRepeat}`);
    out.push(`   bg=${(cs.backgroundImage || "").slice(0, 90)}`);
  }
  // SVG 能否取到、有多大
  try { const r = await fetch("/theme-assets/scene-plum.svg"); const t = await r.text();
    out.push(`scene-plum.svg fetch: ${r.status}, ${t.length} 字节, 含 plumBranch=${t.includes("plumBranch")}, 含 ellipse=${t.includes("ellipse")}`); }
  catch (e) { out.push("fetch 失败: " + e.message); }
  return out.join("\n");
}));
// 把 ts-far 单独放大到 200% 看有没有枝
await p.evaluate(() => { const s = document.createElement("style"); s.textContent = ".app-shell{visibility:hidden}.ts-mid,.ts-near,.ts-parts{display:none!important}.ts-far{background-size:100% 100%!important;background-repeat:no-repeat!important}"; document.head.appendChild(s); });
await p.waitForTimeout(400);
await p.screenshot({ path: "qa/tmp-studio/plum-far-only.png" });
console.log("→ plum-far-only.png");
await b.close();
