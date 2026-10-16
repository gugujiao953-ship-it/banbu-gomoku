import { chromium } from "playwright";
const b = await chromium.launch();
for (const [w, h] of [[2560, 1440], [1512, 982]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
  await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2800);
  for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
  const g = await p.evaluate(() => {
    const q = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), r: Math.round(r.right), w: Math.round(r.width) }; };
    const far = getComputedStyle(document.querySelector(".ts-far"));
    return {
      board: q(".board-scroller"), right: q(".workspace-status"), scene: q(".theme-scene"),
      bgSize: far.backgroundSize, bgPos: far.backgroundPosition,
      vw: window.innerWidth,
    };
  });
  console.log(`──── ${w}×${h} ────  board x ${g.board.x}→${g.board.r} ｜ 右侧栏 x ${g.right.x}→${g.right.r} ｜ scene ${g.scene.w}px`);
  console.log(`   枝: size=${g.bgSize} pos=${g.bgPos}  ⇒ 枝占 x≈${Math.round(g.vw - (g.scene.w * 0.9) * 0) || "-"}（按 auto 100% 算宽≈${Math.round(h * 430 / 930)}px，贴右 ⇒ x ${g.vw - Math.round(h * 430 / 930)}→${g.vw}）`);
  await p.screenshot({ path: `qa/tmp-studio/plum-xwide-${w}.png` });
  await p.close();
}
await b.close();
