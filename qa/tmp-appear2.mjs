import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
await p.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await p.waitForTimeout(1200);
// 点「外观与音效」展开
await p.locator("text=外观与音效").first().click();
await p.waitForTimeout(900);
// 再点「棋盘」
const boardSec = p.locator("text=棋盘材质").first();
if (await boardSec.count()) { await boardSec.click(); } else { await p.locator("summary", { hasText: "棋盘" }).first().click().catch(()=>{}); }
await p.waitForTimeout(1200);
const info = await p.evaluate(() => {
  const el = document.querySelector(".material-live-preview");
  const out = [];
  if (el) { const r = el.getBoundingClientRect(); el.scrollIntoView({ block: "center" }); out.push(`预览: ${r.width.toFixed(0)}×${r.height.toFixed(0)} @${r.y.toFixed(0)}`); }
  else out.push("预览: 不存在");
  out.push("material-crop 数: " + document.querySelectorAll("svg.material-crop").length);
  const svg = document.querySelector("svg.material-crop");
  if (svg) out.push("viewBox: " + svg.getAttribute("viewBox") + " 子元素数: " + svg.children.length);
  return out.join("\n");
});
console.log(info);
await p.waitForTimeout(500);
await p.screenshot({ path: "qa/tmp-studio/appear-1.png" });
await b.close();
