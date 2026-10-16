import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2400);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(700); break; } }
console.log(await p.evaluate(() => {
  const out = [];
  const sc = document.querySelector(".theme-scene");
  const r = sc.getBoundingClientRect();
  out.push(`.theme-scene: ${r.width.toFixed(0)}×${r.height.toFixed(0)}@${r.x.toFixed(0)}`);
  for (const sel of [".ts-far", ".ts-mid", ".ts-near"]) {
    const el = document.querySelector(sel); if (!el) { out.push(sel + ": 无"); continue; }
    const cs = getComputedStyle(el); const b2 = el.getBoundingClientRect();
    out.push(`${sel}: ${b2.width.toFixed(0)}×${b2.height.toFixed(0)} size=${cs.backgroundSize} pos=${cs.backgroundPosition} repeat=${cs.backgroundRepeat}`);
  }
  return out.join("\n");
}));
await p.screenshot({ path: "qa/tmp-studio/plum-desktop-before.png" });
console.log("→ plum-desktop-before.png");
await b.close();
