import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("artifacts");
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 412, height: 915 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(baseURL, { waitUntil: "commit" });
    await page.getByText("新建棋谱", { exact: true }).waitFor();

    const board = page.locator(".renju-board");
    const boardWidth = (await board.boundingBox())?.width || 0;
    if (await page.locator(".coordinates").count() === 0) throw new Error("棋盘坐标没有显示");
    await page.getByRole("gridcell", { name: "H8空位" }).click();
    await page.getByRole("gridcell", { name: "I8空位" }).click();
    await page.locator(".dock-panel").getByRole("button", { name: "上一手" }).click();
    await page.locator(".dock-panel").getByRole("button", { name: "下一手" }).click();

    await page.locator(".dock-tabs").getByRole("button", { name: "编辑" }).click();
    await page.locator(".dock-panel").getByRole("button", { name: "注释" }).click();
    await page.locator("textarea").fill("移动端工作区回归");
    await page.getByRole("button", { name: "完成" }).click();

    await page.locator(".workspace-current").click();
    await page.getByLabel("本页切换棋谱").getByRole("button", { name: /选择棋谱/ }).click();
    await page.locator(".inline-record-list > button").first().waitFor();
    if (viewport.width === 412) await page.screenshot({ path: resolve(output, "inline-record-picker-412x915.png"), fullPage: false });
    await page.locator(".workspace-current").click();

    const modeSwitch = page.locator(".workspace-mode-toggle");
    await modeSwitch.click();
    const draftGuard = page.getByRole("dialog", { name: "未保存草稿" });
    await draftGuard.waitFor();
    await draftGuard.getByRole("button", { name: "放弃草稿并切换" }).click();
    try {
      await page.waitForFunction(() => document.querySelector(".workspace-mode-toggle")?.getAttribute("aria-checked") === "true", null, { timeout: 5_000 });
    } catch {
      if (await draftGuard.isVisible().catch(() => false)) await draftGuard.getByRole("button", { name: "放弃草稿并切换" }).click();
      else await modeSwitch.click();
      await page.waitForFunction(() => document.querySelector(".workspace-mode-toggle")?.getAttribute("aria-checked") === "true", null, { timeout: 10_000 });
    }
    await page.locator(".topbar").getByText(/\d+ 道题已就绪/).waitFor({ timeout: 10_000 });
    await page.locator(".workspace-current").click();
    await page.getByLabel("本页切换题目").getByRole("button", { name: /选择题集与题目/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".collection-accordion-head").length === 8);
    const collectionCounts = (await page.locator(".collection-accordion-head small").allTextContents()).map((text) => text.replace(" 已完成", ""));
    const expectedCounts = ["0/30", "0/30", "0/30", "0/30", "0/100", "0/100", "0/35", "0/78"];
    if (collectionCounts.join("|") !== expectedCounts.join("|")) throw new Error(`题集数量不符：${collectionCounts.join(",")}`);
    await page.locator(".collection-accordion-head").filter({ hasText: "三手胜1-入门题" }).click();
    if (await page.locator(".inline-puzzle-list > button").count() !== 30) throw new Error("入门题没有完整显示 30 道");
    if (viewport.width === 412) await page.screenshot({ path: resolve(output, "inline-puzzle-picker-412x915.png"), fullPage: false });
    await page.getByPlaceholder("输入题号或关键词").fill("15");
    await page.locator(".inline-puzzle-list > button").filter({ hasText: "第 15 题" }).click();
    await page.locator(".workspace-current").filter({ hasText: "三手胜1-入门题" }).waitFor();

    await page.locator(".dock-tabs").getByRole("button", { name: "题目" }).click();
    await page.locator(".dock-panel").getByRole("button", { name: "下一题" }).click();
    await page.locator(".workspace-current").filter({ hasText: "第 16 题" }).waitFor();
    await page.locator(".dock-tabs").getByRole("button", { name: "题目" }).click();
    await page.locator(".dock-panel").getByRole("button", { name: "上一题" }).click();
    await page.locator(".workspace-current").filter({ hasText: "第 15 题" }).waitFor();

    await page.locator('input[accept=".json,application/json"]').first().setInputFiles({ name: "兼容题集.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([["★", "H8,1", "H9,2"]])) });
    await page.locator(".workspace-current").filter({ hasText: "兼容题集" }).waitFor();
    await page.reload({ waitUntil: "commit" });
    await page.getByText("半步五子棋", { exact: true }).waitFor();
    await page.getByRole("button", { name: "棋谱库" }).click();
    await page.getByRole("tab", { name: /题库/ }).click();
    await page.locator(".library-folder-head").filter({ hasText: "我的题库" }).click();
    await page.getByText("兼容题集", { exact: true }).waitFor();

    await page.getByRole("button", { name: "设置" }).click();
    await page.locator("details.settings-collapsible").filter({ hasText: "项目说明、维护计划" }).locator("summary").click();
    await page.getByRole("button", { name: /关于半步五子棋/ }).click();
    await page.getByRole("dialog", { name: "关于半步五子棋" }).getByText(/个人 Vibecoding 项目/).waitFor();
    const repositoryHref = await page.getByRole("link", { name: /GitHub 项目主页与下载/ }).getAttribute("href");
    if (!repositoryHref?.includes("gugujiao953-ship-it")) throw new Error("关于页 GitHub 仓库链接不正确");
    await page.locator(".bottom-sheet").evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    if (viewport.width === 412) await page.screenshot({ path: resolve(output, "about-banbu-412x915.png"), fullPage: false });
    await page.getByRole("button", { name: "关闭" }).click();

    const layout = await page.evaluate((measuredBoardWidth) => ({
      viewport: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      boardWidth: measuredBoardWidth,
      navBottom: document.querySelector(".bottom-nav")?.getBoundingClientRect().bottom,
    }), boardWidth);
    await page.screenshot({ path: resolve(output, `unified-mobile-${viewport.width}x${viewport.height}.png`), fullPage: true });
    results.push({ viewport, layout, collectionCounts, errors });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some(({ layout, errors }) => layout.pageWidth > layout.viewport + 1 || layout.boardWidth < layout.viewport - 8 || errors.length)) process.exitCode = 1;
