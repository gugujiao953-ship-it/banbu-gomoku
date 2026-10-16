import { chromium } from "playwright";
const b = await chromium.launch();
// 竖屏 + 横屏 + 设置页，三处都看一眼
for (const [w, h, tag] of [[390, 844, "portrait"], [844, 390, "landscape"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
  await p.goto("http://localhost:5173/", { waitUntil: "load" });
  await p.waitForTimeout(2200);
  for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(700); break; } }
  await p.screenshot({ path: `qa/tmp-studio/plum-${tag}.png` });
  if (tag === "portrait") {
    await p.locator(".bottom-nav button", { hasText: "设置" }).first().click();
    await p.waitForTimeout(1200);
    await p.screenshot({ path: "qa/tmp-studio/plum-settings.png" });
  }
  await p.close();
}
console.log("→ plum-portrait / plum-landscape / plum-settings");
await b.close();
