import { chromium } from "playwright";
const b = await chromium.launch();
// 用旧版 Chrome 内核 + 强制 reduced-motion，模拟 K20 的 WebView
for (const [name, opts] of [
  ["正常", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ["K20 模拟（reduced-motion: reduce）", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }],
]) {
  const p = await b.newPage(opts);
  await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
  await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
  const r = await p.evaluate(() => {
    const far = document.querySelector(".ts-far");
    const parts = [...document.querySelectorAll(".ts-parts i")].slice(0, 2);
    return {
      mq: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      htmlMotion: document.documentElement.dataset.motion,
      farAnim: far ? getComputedStyle(far).animationName : "ts-far 不存在",
      partAnim: parts.map(x => getComputedStyle(x).animationName),
      partDur: parts.map(x => getComputedStyle(x).animationDuration),
      legacy: document.documentElement.classList.contains("legacy-webview"),
    };
  });
  console.log(`── ${name}`);
  console.log(`   prefers-reduced-motion = ${r.mq} ｜ data-motion = ${r.htmlMotion} ｜ legacy-webview = ${r.legacy}`);
  console.log(`   .ts-far animation = ${r.farAnim} ｜ 粒子 animation = ${JSON.stringify(r.partAnim)} ｜ 时长 = ${JSON.stringify(r.partDur)}`);
  await p.close();
}
await b.close();
