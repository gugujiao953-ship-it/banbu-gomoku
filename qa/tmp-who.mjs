import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
console.log(await p.evaluate(() => {
  const el = document.querySelector(".record-command-bar > button");
  const out = ["命中该按钮且设了 background 的规则（按样式表顺序）："];
  for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; }
    const walk = (l, media) => { for (const r of l) {
      if (r.cssRules && !r.selectorText) { walk(r.cssRules, r.conditionText || media); continue; }
      if (r.selectorText && r.style && /background/.test(r.style.cssText || "")) {
        try { if (el.matches(r.selectorText)) out.push(`   [${ss.href ? ss.href.split("/").pop() : "inline"}${media ? " @media " + media : ""}] ${r.selectorText.slice(0, 76)} {${(r.style.cssText || "").slice(0, 80)}}`); } catch {}
      } } };
    walk(rules); }
  out.push("实际 = " + getComputedStyle(el).backgroundColor);
  return out.join("\n");
}));
await b.close();
