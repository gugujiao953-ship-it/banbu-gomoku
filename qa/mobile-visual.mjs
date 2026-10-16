import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("artifacts");
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
// 欢迎页现在按**版本号**记（onboarding.ts）：老脚本写的 "true" 已不表示「这一版看过了」，
// 抑制它的官方办法是 URL 带 ?qa=1（该参数只关欢迎页，不改界面）。不带就会卡在欢迎层上点不动。
const qaURL = new URL(baseURL); qaURL.searchParams.set("qa", "1");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
    if (viewport.width === 390) await page.addInitScript(() => {
      localStorage.setItem("banbu-theme-preference-v1", "porcelain");
      localStorage.setItem("banbu-board-theme-v1", "porcelain");
      localStorage.setItem("banbu-stone-theme-v1", "porcelain");
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(qaURL.href, { waitUntil: "commit" });
    await page.getByText("新建棋谱", { exact: true }).waitFor();

    const board = page.locator(".renju-board");
    const boardWidth = (await board.boundingBox())?.width || 0;
    if (await page.locator(".coordinates").count() === 0) throw new Error("棋盘坐标没有显示");
    await page.getByRole("gridcell", { name: "H8空位" }).click();
    await page.getByRole("gridcell", { name: "I8空位" }).click();
    await page.getByRole("button", { name: "上一手", exact: true }).click();
    await page.getByRole("button", { name: "下一手", exact: true }).click();

    await page.locator(".dock-tabs").getByRole("button", { name: "更多" }).click();
    await page.locator(".dock-panel").getByRole("button", { name: "查找", exact: true }).waitFor();
    await page.locator(".dock-panel").getByRole("button", { name: "跨谱查找", exact: true }).waitFor();
    await page.locator(".dock-tabs").getByRole("button", { name: "更多" }).click();

    await page.locator(".dock-tabs").getByRole("button", { name: "编辑" }).click();
    await page.locator(".dock-panel").getByRole("button", { name: "注释" }).click();
    await page.locator("textarea:not([readonly])").fill("移动端工作区回归");
    await page.getByRole("button", { name: "完成" }).click();

    const readBoardLayout = () => board.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const bodyTop = Number.parseFloat(document.body.style.top) || 0;
      return { width: rect.width, layoutTop: rect.top + scrollY - bodyTop };
    });
    const recordBoardBefore = await readBoardLayout();
    await page.locator(".workspace-current").click();
    const recordSelector = page.getByRole("dialog", { name: "选择棋谱" });
    await recordSelector.waitFor();
    const firstRecordFolder = recordSelector.locator(".record-selector-folder-head").first();
    await firstRecordFolder.waitFor();
    if (await firstRecordFolder.getAttribute("aria-expanded") === "false") await firstRecordFolder.click();
    await recordSelector.getByRole("option").first().waitFor();
    const recordBoardDuring = await readBoardLayout();
    if (Math.abs(recordBoardDuring.width - recordBoardBefore.width) > 0.5 || Math.abs(recordBoardDuring.layoutTop - recordBoardBefore.layoutTop) > 0.5) throw new Error("棋谱选择器打开后棋盘尺寸或文档位置发生变化");
    if (viewport.width === 412) await page.screenshot({ path: resolve(output, "record-picker-sheet-412x915.png"), fullPage: false });
    await recordSelector.getByRole("button", { name: "关闭" }).click();

    const modeMetrics = await page.locator(".topbar .topbar-mode-toggle button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, fontSize: Number.parseFloat(getComputedStyle(button).fontSize) };
    }));
    if (modeMetrics.some((item) => item.height < 44 || item.fontSize < 11)) throw new Error(`核心模式按钮尺寸不足：${JSON.stringify(modeMetrics)}`);

    const modeSwitch = page.getByRole("tab", { name: "做题模式" });
    await modeSwitch.click();
    const draftGuard = page.getByRole("dialog", { name: "未保存草稿" });
    if (await draftGuard.isVisible().catch(() => false)) await draftGuard.getByRole("button", { name: "放弃草稿并切换" }).click();
    await page.getByRole("tab", { name: "做题模式" }).waitFor({ state: "visible" });
    await page.locator(".workspace-current").filter({ hasText: /第 1 题/ }).waitFor({ timeout: 10_000 });
    const puzzleBoardBefore = await page.locator(".renju-board").boundingBox();
    await page.locator(".workspace-current").click();
    let puzzleSelector = page.getByRole("dialog", { name: "选择题目与题集" });
    await puzzleSelector.waitFor();
    await page.goBack();
    await puzzleSelector.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.classList.contains("workspace-current"));
    await page.locator(".workspace-current").click();
    puzzleSelector = page.getByRole("dialog", { name: "选择题目与题集" });
    await puzzleSelector.waitFor();
    await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
    await page.getByRole("dialog", { name: "选择导入方式" }).waitFor();
    if (await page.getByRole("dialog", { name: "选择题目与题集" }).count()) throw new Error("题目选择器与其他 Sheet 同时打开");
    if (await page.locator(".sheet-backdrop").count() !== 1) throw new Error("Sheet 互斥后仍有多层遮罩");
    await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "关闭" }).click();
    await page.locator(".workspace-current").click();
    puzzleSelector = page.getByRole("dialog", { name: "选择题目与题集" });
    await puzzleSelector.waitFor();
    await puzzleSelector.getByRole("button", { name: "定位到当前题库" }).click();
    if (await puzzleSelector.locator('.puzzle-selector-list [role="option"]').count() !== 30) throw new Error("入门题没有完整显示 30 道");
    const collectionCounts = await puzzleSelector.locator(".puzzle-selector-progress small").textContent();
    await puzzleSelector.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    if (viewport.width === 412) await page.screenshot({ path: resolve(output, "inline-puzzle-picker-412x915.png"), fullPage: false });
    if (viewport.width === 390) await page.screenshot({ path: resolve(output, "puzzle-selector-porcelain-390x844.png"), fullPage: false });
    const puzzleBoardDuring = await page.locator(".renju-board").boundingBox();
    if (Math.abs((puzzleBoardDuring?.width || 0) - (puzzleBoardBefore?.width || 0)) > 0.5 || Math.abs((puzzleBoardDuring?.y || 0) - (puzzleBoardBefore?.y || 0)) > 0.5) throw new Error("题目选择器打开后棋盘尺寸或位置发生变化");
    await puzzleSelector.getByPlaceholder("搜索文件夹、题库、题号或题面").fill("15");
    await puzzleSelector.getByLabel("三手胜1-入门题题目列表").getByRole("option", { name: /第 15 题/ }).click();
    await page.locator(".workspace-current").filter({ hasText: "三手胜1-入门题" }).waitFor();
    if (viewport.width === 390) await page.screenshot({ path: resolve(output, "puzzle-porcelain-390x844.png"), fullPage: false });
    const puzzleBoardAfter = await page.locator(".renju-board").boundingBox();
    if (Math.abs((puzzleBoardAfter?.width || 0) - (puzzleBoardBefore?.width || 0)) > 0.5 || Math.abs((puzzleBoardAfter?.y || 0) - (puzzleBoardBefore?.y || 0)) > 0.5) throw new Error("题目选择器关闭后棋盘尺寸或位置发生变化");

    // 「更多」同样归布局槽位（puzzle.bottom 里的 "view"），不假定轨。
    const puzzleMore = () => page
      .locator(".action-top-row, .dock-tabs, .moves-row")
      .getByRole("button", { name: "更多", exact: true });
    await puzzleMore().click();
    if (await page.locator(".dock-panel").getByRole("button", { name: "查找", exact: true }).count()) throw new Error("做题更多菜单仍显示查找");
    if (await page.locator(".dock-panel").getByRole("button", { name: "跨谱查找", exact: true }).count()) throw new Error("做题更多菜单仍显示跨谱查找");
    await puzzleMore().click();

    // 做题的「上一题/下一题」在**常驻走棋区**（.moves-row.puzzle-nav-row，App.tsx 的
    // puzzleNavRow，固定五键、不进布局池），不在 .dock-tabs / .dock-panel 里——这是
    // 2026-09-10 的 T36 布局改版（commit a91770a）之后的行为。本门禁原写成
    // 「点 .dock-tabs 的『应战』→ 在 .dock-panel 里点下一题」，而 T36 之后
    // 应战/摆棋是**同一枚按钮的互斥两态**（默认显示摆棋，进入摆棋才显示应战），
    // 应战存在时根本不存在「下一题」。按现行 UI 改写：先做摆棋切换的往返校验，
    // 再用常驻走棋区翻题。
    const puzzleNav = page.locator(".moves-row.puzzle-nav-row");
    await puzzleNav.getByRole("button", { name: "下一题" }).click();
    await page.locator(".workspace-current").filter({ hasText: "第 16 题" }).waitFor();
    await puzzleNav.getByRole("button", { name: "上一题" }).click();
    await page.locator(".workspace-current").filter({ hasText: "第 15 题" }).waitFor();

    // 摆棋 ⇄ 应战 是同一枚首行按钮的两态：默认「摆棋」，点开后翻成「应战」，
    // 再点回「摆棋」。同时校验摆棋面板出的是局面导航（起点/上一手/下一手/终点）。
    //
    // ⚠ 不能再写 `.dock-tabs`：自「我的布局」改版（enhancementSettings.buttonOverflow，
    //    原先叫 actionRails）
    // 起，功能区每一枚动作按钮都归用户配置的槽位管（localStorage
    // banbu-action-layout-v1 的 modes.puzzle.top / bottom），应战/摆棋默认落在
    // 底部轨 `.dock-tabs.action-bottom-row`，但用户把它们拖到顶部轨后就在
    // `.action-top-row` 里，`.dock-tabs` 里一个都没有（本机实测：puzzle.top =
    // ["play","setup","vcf"] 时 `.dock-tabs` 只剩「分析/规则/更多」）。
    // 所以按**可访问名在整个工作区动作区里找**，不假定哪条轨——两条轨合起来就是
    // 动作区的全集，按钮的可见名/aria-label 才是稳定契约。
    const workspaceAction = (name) => page
      .locator(".action-top-row, .dock-tabs, .moves-row")
      .getByRole("button", { name, exact: true });
    await workspaceAction("摆棋").click();
    await page.locator(".dock-panel").getByRole("button", { name: "摆棋下一手" }).waitFor();
    await workspaceAction("应战").click();
    await workspaceAction("摆棋").waitFor();

    await page.locator('input[accept=".json,.zip,application/json,application/zip"]').first().setInputFiles({ name: "兼容题集.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([["★", "H8,1", "H9,2"]])) });
    await page.locator(".workspace-current").filter({ hasText: "兼容题集" }).waitFor();
    await page.reload({ waitUntil: "commit" });
    // 顶栏的「半步五子棋打谱」品牌文字在 T40（commit 116d7d3）已下架（品牌只留 logo，
    // 模式切换上移顶栏）——该字符串现在只出现在「关于」页/诊断文件名/异常页，工作界面
    // 上不再渲染。这里真正要等的是应用外壳重新挂载出来（底部主导航可用），不是品牌文字。
    await page.locator(".bottom-nav").getByRole("button", { name: "棋谱库" }).waitFor();
    await page.getByRole("button", { name: "棋谱库" }).click();
    await page.getByRole("tab", { name: /题库/ }).click();
    await page.locator(".library-folder-head").filter({ hasText: "我的题库" }).click();
    await page.getByText("兼容题集", { exact: true }).waitFor();

    await page.getByRole("button", { name: "设置" }).click();
    await page.locator("details.settings-collapsible").filter({ hasText: "项目说明、维护计划" }).locator("summary").click();
    await page.getByRole("button", { name: /关于半步五子棋打谱/ }).click();
    await page.getByRole("dialog", { name: "关于半步五子棋打谱" }).getByText(/个人 Vibecoding 项目/).waitFor();
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
      theme: document.documentElement.dataset.theme,
      themeText: getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim(),
      themeAccent: getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
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
