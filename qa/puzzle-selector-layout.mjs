import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 首运行欢迎页必须关掉，否则它的 .first-run-backdrop（position:fixed; inset:0;
 * z-index:120）会盖住顶栏，连「做题模式」这个 tab 都点不动
 * （报「first-run-dialog … intercepts pointer events」）。
 *
 * 关掉的方式**只有一种**：URL 上的 `?qa=1`。别再靠写
 * `banbu-first-run-welcome-v1="true"` —— 自 09-14 起那个键改成**按版本号**存
 * （见 src/features/onboarding/onboarding.ts 与提交 d5f5c5c），字面量 "true"
 * 只代表「在更早的版本上看过」，当前版本一律再弹一次。run-qa 注入的 QA_BASE_URL
 * 自带 ?qa=1；手动导出 QA_BASE_URL 时多半没有，所以这里统一补一次
 * （已有查询串就不动，避免变成 ?qa=1?qa=1）。与 qa/lib-ui-roundtrip.mjs 写法一致。
 */
const rawBaseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const baseURL = rawBaseURL.includes("?") ? rawBaseURL : `${rawBaseURL}?qa=1`;
const output = resolve(process.env.QA_OUTPUT_DIR || "artifacts");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const target of [
    { name: "portrait-360", viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme: "light" },
    { name: "portrait-390", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "light" },
    { name: "portrait-412", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, colorScheme: "light" },
    { name: "landscape", viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, colorScheme: "light" },
    { name: "tablet-dark-environment", viewport: { width: 768, height: 1024 }, isMobile: false, hasTouch: true, colorScheme: "dark" },
  ]) {
    const context = await browser.newContext({ viewport: target.viewport, isMobile: target.isMobile, hasTouch: target.hasTouch, colorScheme: target.colorScheme, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      // 欢迎页靠 URL 的 ?qa=1 抑制（见文件头）；这里只放主题相关设置，
      // 让青花瓷配色在每个视口下都一致。
      localStorage.setItem("banbu-theme-preference-v1", "porcelain");
      localStorage.setItem("banbu-board-theme-v1", "porcelain");
      localStorage.setItem("banbu-stone-theme-v1", "porcelain");
    });
    // 用 domcontentloaded + .app-shell 再点：`commit` 只是「导航开始」，React 还没挂上
    // 事件处理器，此时点「做题模式」是个空点击（实测点完仍停在打谱模式），等到超时也
    // 等不到「第 1 题」。与 qa/lib-ui-roundtrip.mjs 的等待方式一致。
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 30_000 });
    // 但 .app-shell 出现也还不够：内置题库是**异步 fetch** 进来的
    // （App.tsx 的 loadNativeKaibaoCollections() → puzzles/kaibao/*.json），
    // 而 switchMode("puzzle") → openPuzzle() 里有一句
    // `if (!puzzle) return;`——题库还没到就**静默什么都不做**（不切模式、不报错）。
    // 实测 .app-shell 之后约 1s 题库才就位，期间点「做题模式」全部是空点击，
    // 于是这条 waitFor 必然超时（这就是本门禁原报的「第 1 题」找不到的真实原因；
    // 与首运行欢迎页是两个独立问题）。
    // 这里改成**点到见效为止**：每轮点一下再确认「做题」tab 已选中，最多等 15s。
    const puzzleTab = page.getByRole("tab", { name: "做题模式" });
    const puzzleReady = Date.now() + 15_000;
    for (;;) {
      await puzzleTab.click().catch(() => {});
      if (await puzzleTab.getAttribute("aria-selected") === "true") break;
      if (Date.now() > puzzleReady) throw new Error("内置题库在 15s 内没有就位：点「做题模式」始终不生效（App.tsx openPuzzle 的 `if (!puzzle) return` 静默失败）");
      await page.waitForTimeout(150);
    }
    await page.locator(".workspace-current").filter({ hasText: /第 1 题/ }).waitFor({ timeout: 10_000 });
    const measureViewport = () => page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const board = document.querySelector(".renju-board");
      if (!shell || !board) return null;
      const shellRect = shell.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const shellLeft = shellRect.left + shell.clientLeft;
      const shellRight = shellLeft + shell.clientWidth;
      const coordinates = [...board.querySelectorAll(".coordinates text")]
        .map((node) => node.getBoundingClientRect())
        .map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
      const within = (rect) => rect.left >= shellLeft - 0.5 && rect.right <= shellRight + 0.5
        && rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5;
      return {
        shellScrollLeft: shell.scrollLeft,
        shellOverflow: shell.scrollWidth - shell.clientWidth,
        board: { left: boardRect.left, right: boardRect.right, top: boardRect.top, bottom: boardRect.bottom },
        boardWithinShell: within(boardRect),
        coordinatesCount: coordinates.length,
        coordinatesWithinShell: coordinates.every(within),
      };
    });
    const beforeViewport = await measureViewport();
    const before = await page.locator(".renju-board").boundingBox();
    await page.locator(".workspace-current").click();
    const selector = page.getByRole("dialog", { name: "选择题目与题集" });
    await selector.waitFor();
    await selector.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    const duringViewport = await measureViewport();
    const during = await page.locator(".renju-board").boundingBox();
    await page.screenshot({ path: resolve(output, `puzzle-selector-porcelain-${target.name}.png`), fullPage: false });
    await page.goBack();
    await selector.waitFor({ state: "detached" });
    const afterViewport = await measureViewport();
    const after = await page.locator(".renju-board").boundingBox();
    await page.screenshot({ path: resolve(output, `puzzle-board-porcelain-${target.name}.png`), fullPage: false });
    const theme = await page.evaluate(() => ({ dataTheme: document.documentElement.dataset.theme, colorScheme: getComputedStyle(document.documentElement).colorScheme }));
    const stable = before && during && after
      && Math.abs(before.x - during.x) <= 0.5 && Math.abs(before.y - during.y) <= 0.5 && Math.abs(before.width - during.width) <= 0.5
      && Math.abs(before.x - after.x) <= 0.5 && Math.abs(before.y - after.y) <= 0.5 && Math.abs(before.width - after.width) <= 0.5;
    const viewportMeasurements = { before: beforeViewport, during: duringViewport, after: afterViewport };
    const viewportHealthy = [beforeViewport, duringViewport, afterViewport].every((state) => state
      && state.shellScrollLeft <= 0.5
      && state.shellOverflow <= 0.5
      && state.boardWithinShell
      && state.coordinatesCount === 60
      && state.coordinatesWithinShell);
    results.push({ ...target, stable, viewportHealthy, measurements: { before, during, after }, viewportMeasurements, theme, errors });
    await context.close();
  }

  // 打谱态的首行另有负外边距样式，单测题模式的 bottom/moves 两行无法
  // 覆盖它。平板上单独验证首行滑动栏也不会把整个应用外壳撑出视口。
  const recordContext = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true, serviceWorkers: "block" });
  const recordPage = await recordContext.newPage();
  recordPage.on("pageerror", (error) => results.push({ name: "tablet-record-top-rail", errors: [error.message] }));
  await recordPage.addInitScript(() => {
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ buttonOverflow: "scroll" }));
  });
  await recordPage.goto(baseURL, { waitUntil: "domcontentloaded" });
  await recordPage.waitForSelector("nav.bottom-nav button", { timeout: 30_000 });
  await recordPage.evaluate(() => {
    [...document.querySelectorAll("nav.bottom-nav button")].find((button) => (button.textContent || "").includes("打谱"))?.click();
  });
  await recordPage.waitForSelector('.app-shell .action-railbar[data-rail-zone="top"]', { timeout: 20_000 });
  await recordPage.waitForTimeout(500);
  const topRails = [];
  for (const viewport of [{ width: 700, height: 1024 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    await recordPage.setViewportSize(viewport);
    await recordPage.waitForTimeout(250);
    topRails.push(await recordPage.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const rail = document.querySelector('.action-railbar[data-rail-zone="top"]');
      if (!shell || !rail) return null;
      const shellRect = shell.getBoundingClientRect();
      const shellLeft = shellRect.left + shell.clientLeft;
      const shellRight = shellLeft + shell.clientWidth;
      const rect = rail.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        shellLeft, shellRight, shellScrollLeft: shell.scrollLeft,
        shellOverflow: shell.scrollWidth - shell.clientWidth,
        railLeft: rect.left, railRight: rect.right,
        railWithinShell: rect.left >= shellLeft - 0.5 && rect.right <= shellRight + 0.5,
      };
    }));
  }
  results.push({ name: "tablet-record-top-rail", topRails, errors: [] });
  await recordContext.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.name === "tablet-record-top-rail"
  ? result.topRails.length !== 3 || result.topRails.some((topRail) => !topRail || topRail.shellScrollLeft > 0.5 || topRail.shellOverflow > 0.5 || !topRail.railWithinShell) || result.errors.length
  : !result.stable || !result.viewportHealthy || result.theme.dataTheme !== "porcelain" || result.theme.colorScheme !== "light" || result.errors.length)) process.exitCode = 1;
