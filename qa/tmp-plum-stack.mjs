import { chromium } from "playwright";
const b = await chromium.launch();
for (const theme of ["plum", "pelican"]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.addInitScript(t => localStorage.setItem("banbu-theme-preference-v1", t), theme);
  await p.goto("http://localhost:5173/", { waitUntil: "load" });
  await p.waitForTimeout(2000);
  console.log(`── ${theme} ──`);
  console.log(await p.evaluate(() => {
    const g = (sel, props) => { const el = document.querySelector(sel); if (!el) return `${sel}: 不存在`;
      const cs = getComputedStyle(el); return `${sel}: ${props.map(k => k + "=" + String(cs[k]).slice(0, 60)).join(" ")}`; };
    return [
      g("body", ["background", "backgroundColor"]),
      g("#root", ["background", "backgroundColor", "position", "zIndex"]),
      g(".app-shell", ["background", "backgroundColor", "backgroundImage", "position", "zIndex", "opacity"]),
      g(".theme-scene", ["zIndex", "position", "opacity", "display"]),
      g(".ts-far", ["zIndex", "opacity", "display"]),
    ].join("\n");
  }));
  // 把 app-shell 变透明，看枝是否出现
  await p.evaluate(() => { const s = document.createElement("style"); s.textContent = ".app-shell{background:transparent!important}"; document.head.appendChild(s); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `qa/tmp-studio/plum-stack-${theme}.png` });
  await p.close();
}
console.log("→ plum-stack-plum.png / plum-stack-pelican.png");
await b.close();
