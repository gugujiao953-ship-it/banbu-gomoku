import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
// 依次打开 分析 / 标注 / 编辑 / 更多 四个面板，把所有"有实底色"的元素类名列出来
const openPanel = async (label) => {
  const btn = p.locator(".action-bottom-row button", { hasText: label }).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(900); }
};
const report = async (tag) => {
  const rows = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") return;
      const m = bg.match(/[\d.]+/g);
      if (!m || (m[3] !== undefined && +m[3] < 0.05)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16) return;
      // 只收"看起来像按钮/卡片"的：有圆角或指针样式
      if (!(parseFloat(cs.borderRadius) > 0 || cs.cursor === "pointer")) return;
      const cls = (el.className || "").toString().split(/\s+/).filter(c => c && !/^(selected|active|on)$/.test(c)).slice(0, 3).join(".");
      if (cls) out.push(cls + "  " + bg);
    });
    return out;
  });
  const uniq = [...new Set(rows)];
  console.log(`── ${tag}: ${uniq.length} 条`);
  uniq.slice(0, 22).forEach(r => console.log("   " + r));
};
await report("打谱页（含常驻区）");
for (const label of ["分析", "标注", "编辑", "更多"]) {
  await openPanel(label);
  await report(`面板「${label}」`);
}
await b.close();
