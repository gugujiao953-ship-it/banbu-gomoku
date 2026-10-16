/**
 * 门禁：自调档块布局（用户 09-16 两轮反馈后定稿）。
 *
 * 关键约束：
 *  - 多线程**不是**自调特有的（它跟引擎档位无关），所以做成紧贴标题行右侧的小按钮，
 *    不单独占一行、也不跟内存条挤在同一行；
 *  - 分析内存滑杆占满整行（曾被按钮挤掉一半）；
 *  - 关着多线程时不出现线程数，打开后才在下方出现且同样占满整行。
 */
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
let failed = 0;
for (const width of [360, 412]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-ai-engine-choice-v1", "tuned");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ engineMultiThread: false }));
  });
  const page = await context.newPage();
  const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5193/";
  const gateUrl = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
  await page.goto(gateUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("设置"))?.click(); });
  await page.waitForTimeout(2500);
  const read = () => page.evaluate(() => {
    const block = document.querySelector(".tuned-engine-block");
    if (!block) return { missing: true };
    const head = block.querySelector(".tuned-engine-head");
    const slider = block.querySelector('input[type="range"]');
    const toggle = block.querySelector(".tuned-mini-toggle");
    const threads = block.querySelector(".tuned-engine-threads");
    const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; };
    return {
      blockWidth: Math.round(block.getBoundingClientRect().width),
      head: b(head), slider: b(slider), toggle: b(toggle), threads: b(threads),
      toggleOnHeadRow: head && toggle ? Math.abs(head.getBoundingClientRect().top - toggle.getBoundingClientRect().top) < 8 : null,
      sliderFullWidth: slider ? Math.round(slider.getBoundingClientRect().width) : null,
    };
  });
  const off = await read();
  console.log(`\n=== ${width}px · 多线程关 ===`);
  console.log("  ", JSON.stringify(off));
  if (!off.missing) {
    if (!off.toggleOnHeadRow) { console.log("  FAIL 多线程按钮不在标题行"); failed += 1; }
    if (off.threads) { console.log("  FAIL 关着多线程却出现了线程数"); failed += 1; }
    if (off.slider.w < off.blockWidth * 0.9) { console.log(`  FAIL 内存滑杆没占满（${off.slider.w}/${off.blockWidth}）`); failed += 1; }
    if (off.toggle.h > 32) { console.log(`  FAIL 多线程按钮太高 ${off.toggle.h}px`); failed += 1; }
  }
  await page.evaluate(() => { document.querySelector(".tuned-mini-toggle")?.click(); });
  await page.waitForTimeout(700);
  const on = await read();
  console.log(`=== ${width}px · 多线程开 ===`);
  console.log("  ", JSON.stringify(on));
  if (!on.missing) {
    if (!on.threads) { console.log("  FAIL 开了多线程却没出现线程数"); failed += 1; }
    if (on.slider.w < on.blockWidth * 0.9) { console.log(`  FAIL 内存滑杆没占满（${on.slider.w}/${on.blockWidth}）`); failed += 1; }
    if (on.threads && on.threads.w < on.blockWidth * 0.9) { console.log(`  FAIL 线程数没占满（${on.threads.w}/${on.blockWidth}）`); failed += 1; }
  }
  await context.close();
}
await browser.close();
console.log(failed ? `\n${failed} 项失败` : "\n自调档块断言全部通过");
process.exit(failed ? 1 : 0);
