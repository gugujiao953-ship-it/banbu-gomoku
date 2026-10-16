/** 棋魂外观取景（2026-10-09）：徽章 / 说明页 / 深色 / 平板。只看样子，不做断言。 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4325/";
const OUT = "artifacts/soul-2026-10-09";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

/** 造一份有内容的账本（含上涨/消费/大额，验证尾数写法与收支列表）。 */
const seed = (at) => {
  const entries = [];
  let t = at - 86400000 * 3;
  const push = (amount, reason, detail, dt = 600000) => {
    t += dt;
    entries.push({ id: `seed-${entries.length}`, at: t, amount, reason, detail });
  };
  push(30, "achievement", "解锁成就：初次交手");
  push(8, "duel-win", "战胜初级档 AI");
  push(5, "puzzle-solve", "攻克《三手胜1-入门题》第 3 题");
  push(60, "duel-win", "战胜大师档 AI");
  push(12, "review", "复盘 47 手");
  push(10, "recognition", "识谱导入 57 子");
  push(-40, "manual", "手动调整（示例）");
  push(15, "daily", "完成每日一题");
  push(4, "study", "导出完整备份");
  push(5, "puzzle-solve", "攻克《白先VCF》第 12 题");
  return entries;
};

// ── 手机竖屏（浅色）：徽章 + 说明页 ──
{
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.evaluate((entries) => localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify(entries)), seed(Date.now()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/1-对弈页-三枚徽章.png` });
  await page.locator("[data-soul-badge]").first().click();
  await page.waitForSelector("[data-soul-panel]", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/2-棋魂说明页-上部.png` });
  await page.locator("[data-soul-panel]").evaluate((node) => { node.closest(".bottom-sheet")?.scrollTo(0, 620); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/3-棋魂说明页-中部.png` });
  await page.locator("[data-soul-panel]").evaluate((node) => { node.closest(".bottom-sheet")?.scrollTo(0, 99999); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/4-棋魂说明页-收支.png` });
  await context.close();
}

// ── 深色 ──
{
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.evaluate((value) => localStorage.setItem("banbu-theme-preference-v1", value), "dark");
  await page.evaluate((entries) => localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify(entries)), seed(Date.now()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.waitForTimeout(1400);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/5-徽章-深色.png` });
  await page.locator("[data-soul-badge]").first().click();
  await page.waitForSelector("[data-soul-panel]", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/6-说明页-深色.png` });
  await context.close();
}

// ── 大数（过万 w / 过亿 e）验证尾数写法 ──
for (const [label, total] of [["万", 123456], ["亿", 234500000]]) {
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.evaluate((entries) => localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify(entries)), [
    { id: "big-1", at: Date.now() - 1000, amount: total, reason: "achievement", detail: "大额测试" },
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.waitForTimeout(1300);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/7-徽章-${label}.png` });
  await context.close();
}

// ── 平板横屏 ──
{
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.evaluate((entries) => localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify(entries)), seed(Date.now()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.waitForTimeout(1400);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/8-对弈页-平板.png` });
  await context.close();
}

await browser.close();
console.log(`截图已存到 ${OUT}`);
