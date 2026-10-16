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
await p.waitForTimeout(1200);
await p.locator(".appearance-pane-tabs > button").nth(2).click();
await p.waitForTimeout(1200);
console.log(await p.evaluate(() => {
  const body = document.querySelector(".appearance-pane-body");
  const rows = [...body.querySelectorAll(".setting-row")].map(r => (r.textContent||"").replace(/\s+/g,"").slice(0,14));
  const sels = [...body.querySelectorAll("select")].map(s => s.getAttribute("aria-label"));
  const enabled = [...body.querySelectorAll(".setting-row input")].map(i => i.checked);
  return [
    `预览块: ${document.querySelectorAll("svg.material-crop").length} ｜ 独立舞台: ${document.querySelectorAll(".motion-effects-preview-stage").length} ｜ 演出棋子: ${document.querySelectorAll("[data-preview-stone]").length}`,
    `开关行(${rows.length}): ${rows.join(" / ")}`,
    `下拉(${sels.length}): ${sels.join(" / ")}`,
    `开关状态: ${enabled.join(", ")}`,
  ].join("\n");
}));
await p.screenshot({ path: "qa/tmp-studio/panes4-motion.png" });
await b.close();
