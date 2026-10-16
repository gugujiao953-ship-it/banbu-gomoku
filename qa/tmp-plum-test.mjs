import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(700); break; } }
const info = await p.evaluate(() => {
  const far = document.querySelector(".ts-far");
  const cs = getComputedStyle(far);
  const shell = getComputedStyle(document.querySelector(".app-shell"));
  // 找出所有命中 .ts-far 的规则
  const hits = [];
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules; } catch { continue; }
    const walk = (l) => { for (const r of l) { if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
      if (!r.selectorText) continue;
      try { if (far.matches(r.selectorText) && /background|opacity|z-index/.test(r.style.cssText || "")) hits.push(r.selectorText.slice(0,70) + " {" + (r.style.cssText||"").slice(0,90) + "}"); } catch {} } };
    walk(rules);
  }
  return [
    "app-shell background-image = " + shell.backgroundImage.slice(0, 80),
    "app-shell background-color = " + shell.backgroundColor,
    "ts-far background-image = " + cs.backgroundImage.slice(0, 110),
    "ts-far background-size = " + cs.backgroundSize,
    "ts-far opacity = " + cs.opacity,
    "── 命中 .ts-far 的规则：",
    ...hits.map(h => "   " + h),
  ].join("\n");
});
console.log(info);
await p.evaluate(() => { const s = document.createElement("style"); s.textContent = ".app-shell{background:transparent!important}.app-shell::before,.app-shell::after{background:transparent!important;background-image:none!important}"; document.head.appendChild(s); });
await p.waitForTimeout(400);
await p.screenshot({ path: "qa/tmp-studio/plum-transparent-shell.png" });
console.log("→ plum-transparent-shell.png");
await b.close();
