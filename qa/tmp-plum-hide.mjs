import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(700); break; } }
// 把内容整体隐藏，只看场景层构图
await p.evaluate(() => { const s = document.createElement("style"); s.textContent = ".app-main,.topbar,.bottom-nav{visibility:hidden!important}"; document.head.appendChild(s); });
await p.waitForTimeout(400);
await p.screenshot({ path: "qa/tmp-studio/plum-scene-only.png" });
console.log("→ plum-scene-only.png");
await b.close();
