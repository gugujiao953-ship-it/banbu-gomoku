import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(900); break; } }

/** 列出页面上所有"可见 + 有实底色 + 像按钮/卡片"的元素，带可点击的稳定类名 */
const list = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll("button, [role=button], summary, .dock-panel, .context-dock, .stone-color-switch, .rule-toggle").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 28 || r.height < 20) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const bg = cs.backgroundColor;
    const m = bg.match(/[\d.]+/g);
    if (!bg || bg === "rgba(0, 0, 0, 0)" || (m && m[3] !== undefined && +m[3] < 0.02)) return;
    const classes = (el.className || "").toString().split(/\s+/).filter(Boolean);
    out.push({
      text: (el.textContent || "").replace(/\s+/g, "").slice(0, 8),
      tag: el.tagName.toLowerCase(),
      cls: classes.slice(0, 4).join("."),
      bg,
      box: `${Math.round(r.width)}×${Math.round(r.height)}@${Math.round(r.y)}`,
    });
  });
  return out;
});
console.log("可见实底元素 " + list.length + " 个（按纵向位置）：");
list.sort((a, b) => parseInt(a.box.split("@")[1]) - parseInt(b.box.split("@")[1]))
  .forEach((x) => console.log(`  y=${x.box.split("@")[1].padStart(4)} ${x.box.split("@")[0].padStart(9)}  <${x.tag} class="${x.cls}">  ${x.bg}  「${x.text}」`));
await b.close();
