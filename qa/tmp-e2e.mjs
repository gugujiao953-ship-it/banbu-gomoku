import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:5211/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
p.on("pageerror", e => console.log("[pageerror]", e.message.slice(0, 110)));
await p.addInitScript(b2 => {
  localStorage.setItem("banbu-theme-preference-v1", "pelican");
  localStorage.setItem("banbu-puzzle-generator-settings-v2", JSON.stringify(
    { engine: 'vcf', kind: 'ordinary', attacker: 'black', rules: 'renju', depth: 14, count: 10, expand: true, maxSize: 30, seconds: 60 }));
});
await p.goto(BASE, { waitUntil: "load" });
await p.waitForTimeout(2600);
const boot = await p.evaluate(() => ({ shell: !!document.querySelector(".app-shell"), nav: document.querySelectorAll(".bottom-nav button").length }));
console.log("启动自检:", JSON.stringify(boot));
if (!boot.shell) { console.log("✗ 应用没起来"); await b.close(); process.exit(1); }
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(900); break; } }
await p.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
for (let i = 0; i < 20 && !(await p.locator("button", { hasText: "进入生成器" }).count()); i++) await p.waitForTimeout(500);
await p.locator("button", { hasText: "进入生成器" }).first().click();
await p.waitForTimeout(2200);
await p.locator(".generator-primary").first().click();
for (let i = 0; i < 30 && !(await p.locator(".wait-overlay").count()); i++) await p.waitForTimeout(60);
const ok = await p.locator(".wait-overlay").count();
console.log("等待弹窗:", ok ? "✓" : "✗", "| 木盘(无外框):", await p.locator(".wait-vcf__wood").count(),
  "| 解的子:", await p.locator(".wait-vcf__move").count(), "| 题面:", await p.locator(".wait-vcf__stone").count(),
  "| 星位:", await p.locator(".wait-vcf__stars circle").count());
if (ok) {
  await p.screenshot({ path: "qa/tmp-studio/e2e-live.png" });
  const box = await p.evaluate(() => { const r = document.querySelector(".wait-card").getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; });
  for (const [i, ph] of [[1, 0.02], [2, 0.4], [3, 0.85]].entries()) {
    await p.evaluate((v) => { let s = document.getElementById("__w__"); if (!s) { s = document.createElement("style"); s.id = "__w__"; document.head.appendChild(s); }
      s.textContent = `.wait-vcf__move{animation-delay:calc(var(--wait-cycle) * ${-v})!important;animation-play-state:paused!important}`; }, ph);
    await p.waitForTimeout(150);
    await p.screenshot({ path: `qa/tmp-studio/e2e-${i}.png`, clip: box });
  }
  console.log("→ e2e-live.png + e2e-0/1/2.png");
}
await b.close();
