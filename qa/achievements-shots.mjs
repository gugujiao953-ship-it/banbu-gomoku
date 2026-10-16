/** 成就外观取景：弹窗（浅色 / 深色）+ 面板两个视口。只看样子，不做断言。 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4321/";
const OUT = "artifacts/progress-2026-10-09";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const seedHistory = (at) => {
  const history = [
    { id: "s1", at: at - 40000, outcome: "won", reason: "你连成五子", humanPlayer: "black", strength: "大师", engine: "strong", timeLimitMs: 0, thinkTimeMs: 5000, thinkDepth: 64, moves: 31, humanElapsedMs: 60000, forbidden: true },
    { id: "s2", at: at - 30000, outcome: "won", reason: "你连成五子", humanPlayer: "black", strength: "初级", engine: "strong", timeLimitMs: 0, thinkTimeMs: 600, thinkDepth: 32, moves: 8, humanElapsedMs: 5000, forbidden: false },
    { id: "s3", at: at - 20000, outcome: "lost", reason: "黑方三三禁手判负", humanPlayer: "black", strength: "中级", engine: "strong", timeLimitMs: 0, thinkTimeMs: 2000, thinkDepth: 48, moves: 14, humanElapsedMs: 9000, forbidden: true },
    { id: "s4", at: at - 10000, outcome: "won", reason: "你连成五子", humanPlayer: "white", strength: "高级", engine: "strong", timeLimitMs: 300000, thinkTimeMs: 5000, thinkDepth: 64, moves: 47, humanElapsedMs: 120000, forbidden: true },
  ];
  localStorage.setItem("banbu-duel-history-v1", JSON.stringify(history));
};

// ── 手机竖屏：弹窗 + 面板 ──
{
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.evaluate(seedHistory, Date.now());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/1-解锁弹窗-竖屏.png` });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/2-解锁弹窗-后续条.png` });
  // 面板
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(500);
  await page.locator("[data-duel-achievements]").first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/3-成就面板-上部.png` });
  await page.locator("[data-achievements-panel]").evaluate((node) => { node.closest(".bottom-sheet")?.scrollTo(0, 900); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/4-成就面板-中部.png` });
  await page.locator("[data-achievements-panel]").evaluate((node) => { node.closest(".bottom-sheet")?.scrollTo(0, 99999); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/5-成就面板-底部.png` });
  await context.close();
}

// ── 深色主题 ──
{
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "networkidle" });
  // ⚠ 主题存的是**裸字符串**（`App.tsx:3292` 直接 setItem(key, themePreference)），
  // 不是 JSON——包一层 JSON.stringify 会存成 "\"dark\""，读回来判不出深色（实测踩过）。
  await page.evaluate(() => localStorage.setItem("banbu-theme-preference-v1", "dark"));
  await page.evaluate(seedHistory, Date.now());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/6-解锁弹窗-深色.png` });
  await page.waitForTimeout(4500);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(400);
  await page.locator("[data-duel-achievements]").first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/7-成就面板-深色.png` });
  await context.close();
}

// ── 平板横屏 ──
{
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.evaluate(seedHistory, Date.now());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/8-解锁弹窗-平板.png` });
  await context.close();
}

await browser.close();
console.log(`截图已存到 ${OUT}`);
