import { chromium } from "playwright";
const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
  await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
  console.log("──── " + w + "×" + h + " ────");
  console.log(await p.evaluate(() => {
    const q = (sel) => { const el = document.querySelector(sel); if (!el) return `${sel}: 无`; const r = el.getBoundingClientRect(); return `  ${sel}: x ${r.x.toFixed(0)}→${r.right.toFixed(0)}  y ${r.y.toFixed(0)}→${r.bottom.toFixed(0)}  ${r.width.toFixed(0)}×${r.height.toFixed(0)}`; };
    return [".theme-scene", ".app-shell", ".board-scroller", ".renju-board", ".workspace-status", ".action-bottom-row"].map(q).join("\n");
  }));
  await p.screenshot({ path: `qa/tmp-studio/plum-wide-${w}.png` });
  await p.close();
}
await b.close();
