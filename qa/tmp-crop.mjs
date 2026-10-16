import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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
for (let i = 0; i < n; i++) { const t = (await btns.nth(i).textContent() || "").replace(/\s+/g, ""); if (t.startsWith("棋盘棋盘材质")) { await btns.nth(i).click(); break; } }
await p.waitForTimeout(1200);
console.log(await p.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg.material-crop")];
  const out = [`material-crop 共 ${svgs.length} 个`];
  svgs.forEach((s, i) => {
    const spans = s.parentElement;
    out.push(`  [${i}] className=${s.getAttribute("class")} viewBox=${s.getAttribute("viewBox")} 子节点=${s.children.length}`);
    out.push(`      父 span opacity=${getComputedStyle(spans).opacity}`);
    // 有多少 circle（棋子=5个 circle，网格星位也有）
    out.push(`      circle 数=${s.querySelectorAll("circle").length}  g 数=${s.querySelectorAll("g").length}  path 数=${s.querySelectorAll("path").length}`);
  });
  return out.join("\n");
}));
await b.close();
