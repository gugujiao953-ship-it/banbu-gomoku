import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
await p.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await p.waitForTimeout(1200);
await p.locator("text=外观与音效").first().click();
await p.waitForTimeout(800);
// 展开「棋盘」子节
const btns = p.locator("button, summary, [role=button]");
const n = await btns.count();
let clicked = false;
for (let i = 0; i < n; i++) {
  const t = (await btns.nth(i).textContent() || "").replace(/\s+/g, "");
  if (t.startsWith("棋盘棋盘材质") || t === "棋盘棋盘材质、标注高亮和新建路数") { await btns.nth(i).click(); clicked = true; break; }
}
console.log("点中「棋盘」子节:", clicked);
await p.waitForTimeout(1200);
console.log(await p.evaluate(() => {
  const el = document.querySelector(".material-live-preview");
  if (!el) return "预览不存在";
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return `预览 ${r.width.toFixed(0)}×${r.height.toFixed(0)}；crop 数 ${document.querySelectorAll("svg.material-crop").length}`;
}));
await p.waitForTimeout(600);
await p.screenshot({ path: "qa/tmp-studio/appear-2.png" });
await b.close();
