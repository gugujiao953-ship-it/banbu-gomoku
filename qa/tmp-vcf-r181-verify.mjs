/** R181 实拍：五档起始等级 / 三级匹配 / 等级标签 —— 用户 10-12 段位制改版 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] ?? "http://127.0.0.1:8090/?qa=1";
const SHOTS = "qa/tmp-vcf-shots";
mkdirSync(SHOTS, { recursive: true });
const results = [];
const errs = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${detail ? " — " + detail : ""}`); };

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

const txt = (sel) => page.evaluate((s) => document.querySelector(s)?.innerText?.replace(/\s+/g, " ").trim() ?? null, sel);

await page.goto(BASE, { waitUntil: "commit", timeout: 90000 });
await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const n = document.querySelector('nav[aria-label="主导航"]');
  Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click();
});
await page.waitForTimeout(800);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);

// ── ① 初始等级分 0 = 等级 1 ──
const row = await txt(".vcfch-top-row");
check("新装即 0 分起步、显示等级 1", /等级分\s*0/.test(row || "") && /等级\s*1/.test(row || ""), row || "?");
const chipTip = await page.evaluate(() => document.querySelector(".vcfch-level-chip")?.getAttribute("title") ?? null);
check("等级 1 的本级分宽是 300（title 里写着）", /本级共 300 分/.test(chipTip || ""), chipTip || "?");

// ── ② 设置面板 → 重置面板五档 ──
await page.evaluate(() => { document.querySelector(".vcfch-top-actions button")?.click(); });
await page.waitForTimeout(600);
check("齿轮打开设置面板", /VCF 挑战设置/.test((await txt(".vcfch-sheet > header")) || ""), await txt(".vcfch-sheet > header") || "?");
await page.evaluate(() => { document.querySelector("[data-vcf-reset]")?.click(); });
await page.waitForTimeout(400);
const chips = await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-sheet-reset .vcfch-picker-row button")).map((x) => x.innerText.replace(/\s+/g, " ").trim()));
check("重置面板五档 = 1/3/6/9/12 级", chips.length === 5 && ["等级 1", "等级 3", "等级 6", "等级 9", "等级 12"].every((w, i) => (chips[i] || "").startsWith(w)), JSON.stringify(chips));
check("档位分值与新阶梯一致（0 … 3300）", /等级 1（0 分）/.test(chips[0] || "") && /3300/.test(chips[4] || ""), JSON.stringify(chips));
await page.screenshot({ path: `${SHOTS}/r181-reset-5tiers.png` });

const prices = [];
for (let idx = 0; idx < 5; idx += 1) {
  await page.evaluate((i) => { document.querySelectorAll(".vcfch-sheet-reset .vcfch-picker-row button")[i]?.click(); }, idx);
  await page.waitForTimeout(200);
  prices.push(await txt("[data-vcf-reset-price]"));
}
const nums = prices.map((p) => Number((p || "").match(/(\d+)\s*棋魂/)?.[1] ?? NaN));
check("五档价格严格递增（越高越贵）", nums.every((n, i) => i === 0 || n > nums[i - 1]), JSON.stringify(nums));
check("最低档最便宜（1 级 50 魂）", nums[0] === 50, `${nums[0]}`);
await page.evaluate(() => { const c = Array.from(document.querySelectorAll(".vcfch-sheet-actions button")).find((x) => x.innerText.trim() === "取消"); c?.click(); });
await page.waitForTimeout(400);

// ── ③ 帮助面板口径 ──
// ⚠ 「取消」是关**整个设置面板**的，所以要先把它重开，否则 [data-vcf-help] 根本不在 DOM 里
await page.evaluate(() => { document.querySelector(".vcfch-top-actions button")?.click(); });
await page.waitForTimeout(600);
await page.evaluate(() => { document.querySelector("[data-vcf-help]")?.click(); });
await page.waitForTimeout(600);
const help = await txt("[data-vcf-help-panel]");
check("帮助面板写明五档 1/3/6/9/12 级", /1 级 \/ 3 级 \/ 6 级 \/ 9 级 \/ 12 级/.test(help || ""), "");
check("帮助面板写明 1–13 每级 300、14 起每级 200", /1–13 级每级 300 分/.test(help || "") && /14 级起每级 200 分/.test(help || ""), "");
check("帮助面板写明三级匹配 80/10/10", /本级占 80%/.test(help || "") && /各 10%/.test(help || ""), "");
check("帮助面板写明下限 0、满级 44", /下限 0/.test(help || "") && /等级最高 44 级/.test(help || ""), "");
await page.screenshot({ path: `${SHOTS}/r181-help.png`, fullPage: true });
await page.evaluate(() => { document.querySelector("[data-vcf-help-back]")?.click(); });
await page.waitForTimeout(400);

// ── ④ 三级匹配：0 分（1 级）只出 1–2 手 ──
const depths = [];
for (let i = 0; i < 12; i += 1) {
  await page.evaluate(() => { document.querySelector(".vcfch-bottom .vcfch-primary")?.click(); });
  await page.waitForTimeout(1100);
  const meta = await txt(".vcfch-meta");
  const d = Number((meta || "").match(/(\d+)\s*手/)?.[1] ?? NaN);
  if (Number.isFinite(d)) depths.push(d);
  await page.evaluate(() => { Array.from(document.querySelectorAll("button")).find((x) => /放弃|退出/.test(x.innerText))?.click(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { Array.from(document.querySelectorAll("button")).find((x) => /^确定$/.test(x.innerText.trim()))?.click(); });
  await page.waitForTimeout(600);
}
check("0 分（1 级）抽到的题都在 1–2 手（三级匹配：1 级没有上一级，权重并回本级）", depths.length >= 5 && depths.every((d) => d <= 2), JSON.stringify(depths));

// ── ⑤ 设置页**不该**再有起始等级那节（10-11 已删、入口挪到 VCF 面板） ──
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "设置")?.click(); });
await page.waitForTimeout(2000);
const setBody = await page.evaluate(() => document.body.innerText);
check("设置页不再有「棋魂解锁」节（起始档只留在 VCF 面板）", !/棋魂解锁/.test(setBody) && !/自选起始难度/.test(setBody), "");

console.log(`\n=== 截图 ===\n${SHOTS}/r181-reset-5tiers.png\n${SHOTS}/r181-help.png`);
console.log(`\n=== 页面错误 ${errs.length} ===`);
errs.slice(0, 8).forEach((e) => console.log("  " + e.slice(0, 160)));
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} PASS`);
await b.close();
