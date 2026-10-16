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
const btns = p.locator("button, summary, [role=button]");
const n = await btns.count();
for (let i = 0; i < n; i++) { const t = (await btns.nth(i).textContent() || "").replace(/\s+/g, ""); if (t.startsWith("棋盘与棋子")) { await btns.nth(i).click(); break; } }
await p.waitForTimeout(1300);
console.log(await p.evaluate(() => {
  const row = document.querySelector(".appearance-opacity-row");
  const labels = row ? [...row.querySelectorAll("label > span")].map(s => s.textContent) : [];
  const hl = document.querySelector(".annotation-highlight-setting");
  const hlText = hl ? hl.textContent.replace(/\s+/g, " ").trim() : "无";
  const note = document.querySelector(".visual-theme-note");
  const vl = document.querySelectorAll(".visual-theme-label").length;
  return [
    `预览上方滑杆: ${labels.join(" / ") || "无"}`,
    `标注高亮区文字: 「${hlText}」`,
    `旧说明段(visual-theme-note): ${note ? "仍在 ✗" : "已删 ✓"} ｜ 旧标题(visual-theme-label): ${vl} 个`,
  ].join("\n");
}));
// 拖棋盘透明度到 50%，看预览是否跟着变
const before = await p.evaluate(() => getComputedStyle(document.querySelectorAll(".material-preview-crop")[0]).opacity);
await p.evaluate(() => { const el = document.querySelector('input[aria-label="棋盘透明度"]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(el, "50"); el.dispatchEvent(new Event("input", { bubbles: true })); });
await p.waitForTimeout(500);
const after = await p.evaluate(() => getComputedStyle(document.querySelectorAll(".material-preview-crop")[0]).opacity);
console.log(`预览棋盘层 opacity: ${before} → ${after}  ${before !== after ? "✓ 跟着变" : "✗ 没变"}`);
await p.screenshot({ path: "qa/tmp-studio/final-pane.png" });
await b.close();
