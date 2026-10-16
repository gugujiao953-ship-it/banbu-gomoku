import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
// 直接问页面：当前棋子材质、以及材质库里有没有
console.log(await p.evaluate(() => {
  const out = [];
  const keys = Object.keys(localStorage).filter(k => /stone|board|theme/i.test(k));
  keys.forEach(k => out.push(`${k} = ${String(localStorage.getItem(k)).slice(0, 60)}`));
  return out.join("\n") || "（没有相关 localStorage 键）";
}));
// 从设置页读 UI
await p.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await p.waitForTimeout(1200);
await p.locator("text=外观与音效").first().click();
await p.waitForTimeout(800);
console.log(await p.evaluate(() => {
  const sel = [...document.querySelectorAll("select")].map(s => `${s.getAttribute("aria-label")||""}=${s.value}`);
  return "下拉: " + (sel.join(" | ") || "无");
}));
await b.close();
