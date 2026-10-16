/**
 * qa/baroque-app-check.mjs — 验证巴洛克已回到 1.1.9 的样子（2026-10-08 回退后的断言）。
 * 1.1.9 的巴洛克＝外壳自己的 background 上平铺 baroque.svg（1200×800，未写 repeat → repeat）
 *   ＋ baroque-glow（暖光层缓移）＋ .app-shell::before 的 baroque-lustre 扫光；没有场景层。
 *   （改动前考古：baroque.svg 自 v1.1.6 基线到 1.1.8.7/HEAD 逐字节相同，这就是「1.1.9 那一版」。）
 * 断言：① 结构（background 各层 / 动画名 / ::before）② 中间方案（壁纸砖、场景角饰）确已撤干净
 *   ③ 屏面上确实画出了平铺纹样（A/B：摘掉 baroque.svg 那一层再截一张相减）。
 *
 *   QA_BASE_URL=http://localhost:5173/ node qa/baroque-app-check.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://localhost:5173/";
const F = [];
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) F.push(m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "baroque"));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
for (const t of ["先自己试试", "我知道了"]) {
  const btn = page.getByRole("button", { name: t });
  if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(500); break; }
}
await page.waitForTimeout(400);
// dev 服务的 HMR 可能刚触发整页刷新，等它稳定，并给 evaluate 一次重试
await page.waitForLoadState("load").catch(() => {});
await page.waitForTimeout(1200);

/* ── ① 结构断言 ── */
const st = await (async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.evaluate(() => {
  const shell = document.querySelector(".app-shell");
  const cs = getComputedStyle(shell);
  const before = getComputedStyle(shell, "::before");
  const far = document.querySelector(".ts-far") ? getComputedStyle(document.querySelector(".ts-far")) : null;
  // 全部样式表里是否还有中间方案的残留
  let stray = 0;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) if (/baroque-tile|baroque-ornament|baroque-sheen|baroque-beam|baroque-sparkle/.test(r.cssText)) stray++;
  }
  return {
    theme: document.documentElement.dataset.theme,
    bg: cs.backgroundImage, size: cs.backgroundSize, rep: cs.backgroundRepeat, pos: cs.backgroundPosition,
    anim: cs.animationName, dur: cs.animationDuration,
    beforeAnim: before.animationName, beforeDur: before.animationDuration,
    farBg: far ? far.backgroundImage : "(无 .ts-far)",
    stray,
  };
      });
    } catch (e) {
      if (attempt === 2) throw e;
      await page.waitForTimeout(1800);          // HMR 整页刷新后重试
      await page.reload({ waitUntil: "load" }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
})();
ok(st.theme === "baroque", `主题生效（${st.theme}）`);
ok(/baroque\.svg/.test(st.bg.split(",")[0]), "外壳背景第一层＝baroque.svg（1.1.9 的平铺纹样）");
ok(/^1200px 800px/.test(st.size), `平铺尺寸 1200×800（实际 ${st.size.split(",")[0].trim()}）`);
ok(/^repeat/.test(st.rep), `repeat（1.1.9 就是靠默认 repeat 铺满整面外壳；实际 ${st.rep.split(",")[0].trim()}）`);
ok(st.anim === "baroque-glow" && st.dur === "18s", `外壳动画 baroque-glow 18s（实际 ${st.anim} ${st.dur}）`);
ok(st.beforeAnim === "baroque-lustre" && st.beforeDur === "10s", `::before 扫光 baroque-lustre 10s（实际 ${st.beforeAnim} ${st.beforeDur}）`);
ok(st.stray === 0, `中间方案零残留（壁纸砖/角饰/sheen/beam/sparkle 在样式表里的命中 ${st.stray}）`);
ok(!/ornament/.test(st.farBg), "巴洛克不再占用场景层（pelican 等其它主题不受影响）");

/* ── ③ 屏面像素：A/B 摘掉 baroque.svg 那一层再相减 ── */
const withTile = await page.screenshot();
await page.addStyleTag({ content: `.app-shell{background-image:radial-gradient(ellipse at 50% -15%,#fff7d2 0 14%,transparent 48%),linear-gradient(105deg,#8f64120a,#fff3c240 44%,#9b6b140d 55%),linear-gradient(#f7ebc9,#efda9f)!important;background-size:100% 100%,160% 100%,100% 100%!important;background-position:center,center,center!important;background-repeat:repeat,no-repeat,repeat!important}` });
await page.waitForTimeout(250);
const withoutTile = await page.screenshot();
const px = await page.evaluate(async ([a, b]) => {
  const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; });
  const [ia, ib] = [await load(a), await load(b)];
  if (!ia || !ib) return { err: "截图解码失败" };
  const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const draw = (img) => { cx.clearRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h); return cx.getImageData(0, 0, w, h).data; };
  const da = draw(ia), db = draw(ib);
  let diff = 0, rowDiff = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    if (d > 10) { diff++; rowDiff[y]++; }
  }
  const third = (f0, f1) => { let n = 0; for (let y = Math.floor(f0); y < Math.floor(f1); y++) n += rowDiff[y]; return +(n / ((f1 - f0) * w) * 100).toFixed(2); };
  return { coverage: +(diff / (w * h) * 100).toFixed(2), top: third(0, h / 3), mid: third(h / 3, 2 * h / 3), bot: third(2 * h / 3, h) };
}, [
  "data:image/png;base64," + withTile.toString("base64"),
  "data:image/png;base64," + withoutTile.toString("base64"),
]);
if (px.err) { console.log("FAIL " + px.err); await browser.close(); process.exit(1); }
console.log(`平铺纹样在屏面上的贡献：${px.coverage}%（上 ${px.top}%／中 ${px.mid}%／下 ${px.bot}%）`);
ok(px.coverage > 2, `1.1.9 的平铺纹样确实画在屏面上（${px.coverage}% > 2%）`);

console.log(F.length ? `\n未通过 ${F.length} 项` : "\n巴洛克已回到 1.1.9 的样子");
await browser.close();
process.exit(F.length ? 1 : 0);
