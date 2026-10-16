// 金/钻棋子渲染取证：导入 8 子图 → 量「每颗子的元素数 + 棋盘像素指纹」（改法必须逐像素等价）
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const stoneTheme = process.env.STONE_THEME || "gold-diamond";
const image = resolve(process.cwd(), "qa/fixtures/recognition/app-played-game.png");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: "block", deviceScaleFactor: 2 });
await context.addInitScript(({ stoneTheme }) => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-stone-theme-v1", stoneTheme);
}, { stoneTheme });
const page = await context.newPage();
const url = new URL(base); url.searchParams.set("qa", "1");
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#board", { timeout: 60_000 });
await page.evaluate(() => { document.querySelector(".bottom-nav .nav-center")?.click(); });
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(image);
await page.waitForSelector(".board-fs-actions", { timeout: 30_000 });
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120_000 });
await page.locator(".image-verify-confirm").click();
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const stones = [...document.querySelectorAll(".stone-piece")];
  const sample = stones[0];
  return {
    stones: stones.length,
    elementsPerStone: sample ? sample.querySelectorAll("*").length : 0,
    firstStoneHtml: sample ? sample.innerHTML.replace(/\s+/g, " ").slice(0, 220) : "(无)",
    totalBoardElements: document.querySelector("#board")?.querySelectorAll("*").length ?? 0,
  };
});
const shot = await page.locator("#board").screenshot();
const hash = createHash("sha256").update(shot).digest("hex").slice(0, 16);
console.log(`棋子主题=${stoneTheme}：${info.stones} 颗子，每颗子元素数=${info.elementsPerStone}，棋盘总元素=${info.totalBoardElements}`);
console.log(`  首颗子 markup：${info.firstStoneHtml}`);
console.log(`  棋盘像素指纹 ${hash}`);
await browser.close();
