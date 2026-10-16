import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
// 找出三排功能区里按钮的实际底色来源（哪条规则给了白底）
console.log(await p.evaluate(() => {
  const out = [];
  const probe = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) { out.push(`${label}: 元素不存在`); return; }
    const cs = getComputedStyle(el);
    out.push(`${label}: bg=${cs.backgroundColor} bgImg=${(cs.backgroundImage||"none").slice(0,40)} border=${cs.borderColor}`);
    // 找命中的规则里带 background 的
    for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; }
      const walk = (l) => { for (const r of l) { if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; } if (!r.selectorText) continue;
        try { if (el.matches(r.selectorText) && /background/.test(r.style.cssText||"")) out.push(`    ← ${r.selectorText.slice(0,60)} {${(r.style.cssText||"").slice(0,70)}}`); } catch {} } };
      walk(rules); }
  };
  probe(".action-bottom-row button", "首行功能区按钮");
  probe(".record-command-bar > button", "常驻操作区按钮");
  probe(".bottom-nav button", "底部导航按钮");
  return out.join("\n");
}));
await b.close();
