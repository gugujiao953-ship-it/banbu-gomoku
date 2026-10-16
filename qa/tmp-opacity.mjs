import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
await p.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await p.waitForTimeout(1200);
// 展开「棋盘显示」
const btns = p.locator("button, summary, [role=button]");
const n = await btns.count();
for (let i = 0; i < n; i++) { const t = (await btns.nth(i).textContent() || "").replace(/\s+/g, ""); if (t.startsWith("棋盘显示")) { await btns.nth(i).click(); break; } }
await p.waitForTimeout(1200);
console.log(await p.evaluate(() => {
  const out = [];
  const rows = [...document.querySelectorAll(".setting-row")].slice(0, 3);
  rows.forEach(r => { const cs = getComputedStyle(r); out.push(`设置项「${(r.textContent||'').replace(/\s+/g,'').slice(0,10)}」: border=${cs.borderWidth} radius=${cs.borderRadius} bg=${cs.backgroundColor} padding=${cs.padding}`); });
  for (const sel of [".board-opacity-setting", ".stone-opacity-setting"]) {
    const el = document.querySelector(sel);
    if (!el) { out.push(sel + ": 无"); continue; }
    const cs = getComputedStyle(el);
    out.push(`${sel}: border=${cs.borderWidth} ${cs.borderColor} radius=${cs.borderRadius} bg=${cs.backgroundColor} padding=${cs.padding} margin=${cs.margin}`);
  }
  // 滑杆样式对比
  const sliders = [...document.querySelectorAll('input[type=range]')].map(i => ({ label: i.getAttribute("aria-label"), cls: i.className, h: getComputedStyle(i).height }));
  out.push("滑杆: " + JSON.stringify(sliders));
  return out.join("\n");
}));
await p.locator(".board-opacity-setting").scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
await p.screenshot({ path: "qa/tmp-studio/opacity-before.png" });
await b.close();
