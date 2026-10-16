import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
await p.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await p.waitForTimeout(1500);
// 滚到外观
await p.evaluate(() => { const el=[...document.querySelectorAll("*")].find(e=>e.textContent?.trim()==="外观与音效"); el?.scrollIntoView({block:"center"}); });
await p.waitForTimeout(600);
await p.screenshot({ path: "qa/tmp-studio/appear-0.png" });
const info = await p.evaluate(() => {
  const out = [];
  const q = (sel) => { const el = document.querySelector(sel); if (!el) return `${sel}: ✗ 不存在`; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return `${sel}: ${r.width.toFixed(0)}×${r.height.toFixed(0)} ${cs.display} opacity=${cs.opacity}`; };
  out.push(q(".material-live-preview"));
  out.push(q(".material-preview-crop"));
  out.push(q(".material-crop"));
  out.push("material-crop 数量: " + document.querySelectorAll("svg.material-crop").length);
  out.push("board-preview 回退块: " + document.querySelectorAll("i.board-preview").length);
  return out.join("\n");
});
console.log(info);
await b.close();
