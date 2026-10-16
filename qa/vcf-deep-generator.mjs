/**
 * qa/vcf-deep-generator.mjs — 13 手以上真的由生成器出题（用户 2026-10-06：
 * 「后面生成器应该是会生成13手以上的，比如14,15手的吧」）。
 *
 * 路径：把等级分写进存档到 **20 级（= 20 手，入门分 5700）** → 开始挑战 → 题池没有 14 手以上的题
 * （静态池最深 13 手），必须由**棋题生成器那台引擎**即时出一道 ~20 手的，并在题目说明里标「生成器出题」。
 * 用法：node qa/vcf-deep-generator.mjs [base]
 * ⚠ **必须打在产线构建（vite build + preview）上**：dev 服务器上按需出题的 worker 起不来
 *   （classic Worker 指到 ESM 源码，见 memory「VCF 挑战排查十一条坑」第 1 条），在 dev 上跑
 *   会得到「出不来深题」的假结论。2026-10-14 前这条点的是商店里的「20 手档」chip，
 *   五档改版（等级 1/3/6/9/12）后那个档名不存在，`find()` 拿到 null 就静默空跑。
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5199/";
const clickByText = (page, text) => page.evaluate((t) => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().includes(t));
  if (b) { b.click(); return true; }
  return false;
}, text);
const clickNav = (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const b = nav ? Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === l) : null;
  if (b) b.click();
}, label);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) { await clickByText(page, "先自己试试"); await page.waitForTimeout(400); }
await clickNav(page, "对弈");
await page.waitForTimeout(600);
await clickByText(page, "开始挑战");
await page.waitForSelector(".vcfch-board", { timeout: 20000 });
await page.waitForTimeout(1200);

// 把等级分摆到 **20 级（= 20 手，入门分 5700）**：题池里没有这么深的题，只能靠生成器。
// ⚠ 这一段以前点的是商店里的「20 手档」chip —— 那个档名在 2026-10-12 五档改版（等级 1/3/6/9/12）
//   之后就不存在了，`find()` 拿到 null 就静默空跑，等级分根本没变、测的其实是 12 手档。
//   现在直接写存档再刷新（与 qa/vcf-flow-sweep.mjs 同一套做法），不依赖商店档位名。
await page.evaluate(() => {
  const key = "vcfch-state-v1";
  const raw = JSON.parse(localStorage.getItem(key) || "{}");
  localStorage.setItem(key, JSON.stringify({ ...raw, rating: 5700 }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await clickNav(page, "对弈");
await page.waitForTimeout(600);
await clickByText(page, "开始挑战");
await page.waitForSelector(".vcfch-board", { timeout: 20000 });
await page.waitForTimeout(1200);
const chip = "存档写 5700 分（20 级）";
const rating = await page.evaluate(() => document.querySelector(".vcfch-rating-inline b")?.textContent ?? null);
console.log(`重置档位：${chip} → 面板显示等级分 ${rating}`);

// 开始挑战：等生成器出题（20 手大概几秒）
const t0 = Date.now();
await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
let meta = null, message = null;
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1000);
  meta = await page.evaluate(() => document.querySelector(".vcfch-meta")?.textContent?.trim() ?? null);
  message = await page.evaluate(() => document.querySelector(".vcfch-message")?.textContent?.trim() ?? null);
  if (meta) break;
}
const seconds = Math.round((Date.now() - t0) / 1000);
console.log(`出题耗时 ${seconds}s：${meta}｜说明：${message}`);
const depth = Number((meta ?? "").match(/^(\d+) 手/)?.[1] ?? 0);
const ok = depth >= 14 && /生成器出题/.test(message ?? "");
console.log(ok ? `✓ 生成器出到了 ${depth} 手题（>13 手）` : "✗ 没出到 14 手以上 / 没标生成器出题");
if (errors.length) console.log("页面报错：" + errors.slice(0, 4).join(" | "));
await browser.close();
process.exit(ok ? 0 : 1);
