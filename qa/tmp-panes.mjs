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
  const tabs = [...document.querySelectorAll(".appearance-pane-tabs > button")].map(b2 => b2.textContent.trim() + (b2.classList.contains("selected") ? "(选中)" : ""));
  const prev = document.querySelector(".material-live-preview");
  if (prev) prev.scrollIntoView({ block: "start" });
  return `标签: ${tabs.join(" | ")}\n预览: ${prev ? prev.getBoundingClientRect().height.toFixed(0) + "px 高" : "无"} ｜ crop 层 ${document.querySelectorAll("svg.material-crop").length} 个 ｜ 角标: ${document.querySelector(".pane-badge")?.textContent || "无"}`;
}));
await p.waitForTimeout(500);
await p.screenshot({ path: "qa/tmp-studio/panes-board.png" });
// 切到「棋子」
await p.locator(".appearance-pane-tabs > button").nth(1).click();
await p.waitForTimeout(900);
console.log("切到棋子后角标:", await p.locator(".pane-badge").textContent());
await p.screenshot({ path: "qa/tmp-studio/panes-stone.png" });
// 切到「特效」
await p.locator(".appearance-pane-tabs > button").nth(2).click();
await p.waitForTimeout(900);
console.log("切到特效后角标:", await p.locator(".pane-badge").textContent());
await p.screenshot({ path: "qa/tmp-studio/panes-motion.png" });
await b.close();
