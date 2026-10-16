import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
// 冻结粒子看静态构图
await p.evaluate(() => { const s = document.createElement("style"); s.textContent = ".ts-parts i{animation-play-state:paused!important;animation-delay:0s!important}"; document.head.appendChild(s); });
await p.waitForTimeout(300);
console.log("主题:", await p.evaluate(() => document.documentElement.dataset.theme));
await p.screenshot({ path: "qa/tmp-studio/plum-before.png" });
// 只看背景（把内容藏掉）
await p.evaluate(() => { const s = document.createElement("style"); s.textContent = ".app-shell{visibility:hidden}"; document.head.appendChild(s); });
await p.waitForTimeout(300);
await p.screenshot({ path: "qa/tmp-studio/plum-bg.png" });
console.log("→ plum-before.png + plum-bg.png");
await b.close();
