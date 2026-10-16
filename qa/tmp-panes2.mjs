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
// ① 预览是否三版面同一块（记下 viewBox 与 demo 类）② 标注高亮位置
const snap = async (tag) => {
  const r = await p.evaluate(() => {
    const crop = document.querySelector("svg.material-crop");
    const demo = document.querySelector(".crop-stone-demo");
    const highlight = document.querySelector(".annotation-highlight-setting");
    const preview = document.querySelector(".material-live-preview");
    return {
      viewBox: crop?.getAttribute("viewBox") || "无",
      demo: !!demo,
      hlBefore: highlight && preview ? (highlight.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING ? "在上方 ✓" : "在下方 ✗") : "缺",
      cropCount: document.querySelectorAll("svg.material-crop").length,
    };
  });
  console.log(`${tag}: viewBox=${r.viewBox} ｜ 弹动效棋子=${r.demo ? "有 ✓" : "无"} ｜ 标注高亮${r.hlBefore} ｜ crop层=${r.cropCount}`);
  return r;
};
const a = await snap("棋盘");
await p.screenshot({ path: "qa/tmp-studio/panes2-board.png" });
await p.locator(".appearance-pane-tabs > button").nth(1).click();
await p.waitForTimeout(700);
const b2 = await snap("棋子");
await p.locator(".appearance-pane-tabs > button").nth(2).click();
await p.waitForTimeout(700);
const c = await snap("特效");
console.log("\n三版面预览一致性：", a.viewBox === b2.viewBox && b2.viewBox === c.viewBox ? "同一块 ✓" : "不一致 ✗");
await p.screenshot({ path: "qa/tmp-studio/panes2-motion.png" });
await b.close();
