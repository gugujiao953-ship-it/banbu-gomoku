import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
console.log(await p.evaluate(() => {
  const el = document.querySelector(".record-command-bar > button");
  const out = ["该按钮的 class = " + el.className];
  // 我的规则命不命中
  const mySel = "html:root .app-shell :is(.record-command-bar > button:not(.command-save):not(.command-delete):not(.command-comment))";
  try { out.push("我的选择器命中 = " + el.matches(mySel)); } catch (e) { out.push("我的选择器语法错: " + e.message); }
  // 逐条列出所有命中且声明 background-color 的规则（带 important 标记）
  for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; }
    const walk = (l) => { for (const r of l) {
      if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
      if (!r.selectorText || !r.style) continue;
      const bc = r.style.getPropertyValue("background-color");
      const imp = r.style.getPropertyPriority("background-color");
      if (!bc) continue;
      try { if (el.matches(r.selectorText)) out.push(`   ${r.selectorText.slice(0,70)} → background-color:${bc}${imp ? " !important" : ""}`); } catch {}
    } };
    walk(rules); }
  return out.join("\n");
}));
await b.close();
