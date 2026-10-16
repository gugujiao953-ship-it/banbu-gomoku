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
// 切到特效
await p.locator(".appearance-pane-tabs > button").nth(2).click();
await p.waitForTimeout(1500);
console.log(await p.evaluate(() => {
  const previews = document.querySelectorAll("svg.material-crop").length;
  const stages = document.querySelectorAll(".motion-effects-preview-stage").length;
  const stones = document.querySelectorAll(".material-crop-stones").length;
  const demo = document.querySelectorAll("[data-preview-stone]").length;
  const replay = document.querySelectorAll(".motion-effects-preview-replay").length;
  const secs = [...document.querySelectorAll(".appearance-pane-body .motion-effects-settings")].length;
  return [`预览棋盘(material-crop): ${previews} ｜ 独立舞台(motion-stage): ${stages} ｜ 静态棋子组: ${stones} ｜ 演出棋子: ${demo} ｜ 重播按钮: ${replay} ｜ 特效面板: ${secs}`,
    `预览块高度: ${document.querySelector(".material-live-preview")?.getBoundingClientRect().height.toFixed(0)}px`].join("\n");
}));
await p.screenshot({ path: "qa/tmp-studio/panes3-motion.png" });
await b.close();
