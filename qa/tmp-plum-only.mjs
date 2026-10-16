import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
await p.evaluate(() => {
  const s = document.createElement("style");
  s.textContent = ".app-shell{visibility:hidden}.ts-parts i{animation-play-state:paused!important;animation-delay:-2s!important}";
  document.head.appendChild(s);
});
await p.waitForTimeout(400);
await p.screenshot({ path: "qa/tmp-studio/plum-bg2.png" });
// 量一下枝到底落在哪
console.log(await p.evaluate(() => {
  const el = document.querySelector(".ts-far");
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return `ts-far 元素 ${r.width.toFixed(0)}×${r.height.toFixed(0)}；background-size=${cs.backgroundSize} position=${cs.backgroundPosition}`;
}));
await b.close();
