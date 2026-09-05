import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(10_000);
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "打开快捷中心" }).click();
  const quickThemeValues = await page.getByLabel("选择应用主题").locator("option").evaluateAll((options) => options.map((option) => option.value));
  const quickBoardValues = await page.getByLabel("选择棋盘").locator("option").evaluateAll((options) => options.map((option) => option.value));
  const quickStoneValues = await page.getByLabel("选择棋子").locator("option").evaluateAll((options) => options.map((option) => option.value));
  for (const theme of ["blackgold", "pale", "kawaii", "aurora", "deepsea", "baroque"]) assert(quickThemeValues.includes(theme), `快捷中心缺少应用主题 ${theme}`);
  for (const board of ["blackgold", "pale", "kawaii", "aurora"]) assert(quickBoardValues.includes(board), `快捷中心缺少棋盘主题 ${board}`);
  for (const stone of ["gold", "diamond", "blackgold", "pale", "kawaii", "aurora"]) assert(quickStoneValues.includes(stone), `快捷中心缺少棋子主题 ${stone}`);
  await page.getByRole("dialog", { name: "快捷中心" }).getByRole("button", { name: "关闭快捷中心" }).click();

  const titleLayouts = [];
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator(".unified-status-name").evaluate((node) => {
      node.textContent = "一份用于验证手机端超长棋谱名称不会与副标题重叠的测试棋谱";
    });
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const name = rect(".unified-status-name");
      const subtitle = rect(".unified-status-subtitle");
      const kind = rect(".unified-status-kind");
      const copy = rect(".unified-status-copy");
      const chevron = rect(".unified-status-title > svg");
      const shell = document.querySelector(".app-shell");
      return {
        name, subtitle, kind, copy, chevron,
        overflow: shell ? shell.scrollWidth - shell.clientWidth : 999,
      };
    });
    assert(layout.name && layout.subtitle && layout.kind && layout.copy && layout.chevron, `${width}px 顶部状态区元素缺失`);
    assert(layout.name.bottom <= layout.subtitle.top + 0.5, `${width}px 棋谱名与副标题重叠`);
    assert(layout.copy.left >= layout.kind.right - 0.5, `${width}px 棋谱名向左侵入图标`);
    assert(layout.copy.right <= layout.chevron.left + 0.5, `${width}px 棋谱名侵入展开箭头`);
    assert(layout.overflow <= 1, `${width}px 页面横向溢出 ${layout.overflow}px`);
    titleLayouts.push({ width, overflow: layout.overflow });
  }

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("搜索设置").waitFor();

  const legacyHeadingCount = await page.locator(".settings-page .page-title h1").count();
  const pseudoHeading = await page.locator(".settings-page").evaluate((node) => getComputedStyle(node, "::before").content);
  assert(legacyHeadingCount === 0, "旧的设置页标题仍存在");
  assert(["none", "normal", "\"\""].includes(pseudoHeading), `设置页伪标题仍存在：${pseudoHeading}`);

  const groups = page.locator("details.settings-group");
  const groupCount = await groups.count();
  assert(groupCount >= 11, `设置分组数量异常：${groupCount}`);
  const missingIconCount = await groups.locator("summary.settings-section-toggle:not(:has(.settings-section-icon svg))").count();
  assert(missingIconCount === 0, `有 ${missingIconCount} 个主分类缺少图标`);

  await page.getByLabel("搜索设置").fill("字号");
  const visibleGroups = groups.filter({ visible: true });
  assert(await visibleGroups.count() === 1, `搜索字号后应只显示 1 个分类，实际 ${await visibleGroups.count()}`);
  assert((await visibleGroups.first().innerText()).includes("无障碍与字号"), "搜索字号未定位到无障碍分类");
  assert(await visibleGroups.first().getAttribute("open") !== null, "搜索命中的分类没有自动展开");

  await page.getByRole("button", { name: "清除设置搜索" }).click();
  assert(await groups.count() === groupCount, "清除搜索后分类未恢复");

  const appearance = groups.filter({ hasText: "外观与音效" }).first();
  assert(await appearance.count() === 1, "外观与音效不存在");
  if (await appearance.getAttribute("open") === null) await appearance.locator("summary").click();
  const appearanceSections = appearance.locator("details.appearance-center-subsection");
  assert(await appearanceSections.count() === 4, `外观与音效子目录数量异常：${await appearanceSections.count()}`);
  assert(await appearanceSections.evaluateAll((items) => items.every((item) => !item.open)), "外观与音效打开后子目录不应全部展开");
  await page.getByLabel("搜索设置").fill("棋盘透明度");
  assert(await groups.filter({ visible: true }).count() === 1, "搜索棋盘透明度后应只显示外观与音效");
  const searchedBoardSection = appearanceSections.filter({ hasText: "棋盘材质" }).first();
  assert(await searchedBoardSection.evaluate((item) => item.open), "搜索棋盘透明度未自动展开棋盘与棋子子目录");
  await appearance.getByRole("slider", { name: "棋盘透明度" }).waitFor();
  await page.getByRole("button", { name: "清除设置搜索" }).click();
  assert(await appearanceSections.evaluateAll((items) => items.every((item) => !item.open)), "清除搜索后外观子目录没有恢复收起");
  const boardSection = appearanceSections.filter({ hasText: "棋盘材质" }).first();
  await boardSection.locator(":scope > summary").click();
  await appearance.getByRole("slider", { name: "棋盘透明度" }).waitFor();
  const stoneSection = appearanceSections.filter({ hasText: "棋子材质" }).first();
  await stoneSection.locator(":scope > summary").click();
  await appearance.getByRole("slider", { name: "棋子透明度" }).waitFor();
  const soundSection = appearanceSections.filter({ hasText: "声音与音效" }).first();
  await soundSection.locator(":scope > summary").click();
  await appearance.getByText("界面动效", { exact: true }).waitFor();

  const accessibility = groups.filter({ hasText: "无障碍与字号" }).first();
  if (await accessibility.getAttribute("open") === null) await accessibility.locator("summary").click();
  await accessibility.getByRole("radio", { name: /特大字/ }).click();
  await page.waitForFunction(() => localStorage.getItem("banbu-font-scale-v1") === "xlarge");

  const about = groups.filter({ hasText: "关于" }).first();
  if (await about.getAttribute("open") === null) await about.locator("summary").click();
  await about.getByRole("button", { name: /关于半步五子棋打谱/ }).click();
  await page.getByText("检查更新", { exact: true }).waitFor();
  const aboutFocusInside = await page.evaluate(() => Boolean(document.activeElement?.closest(".bottom-sheet")));
  await page.keyboard.press("Escape");
  await page.locator(".bottom-sheet").waitFor({ state: "detached" });

  const help = groups.filter({ hasText: "使用手册与反馈" }).first();
  if (await help.getAttribute("open") === null) await help.locator("summary").click();
  await help.getByRole("button", { name: /使用手册/ }).click();
  await page.getByText("别担心，跟着做一遍就会了", { exact: true }).waitFor();
  await page.locator(".manual-item").filter({ hasText: "第一次打开：先认识主界面" }).first().waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".bottom-sheet").waitFor({ state: "detached" });

  assert(aboutFocusInside, "关于面板打开后焦点未进入 Sheet");
  if (errors.length) throw new Error(errors.join("\n"));

  console.log(JSON.stringify({
    pass: true,
    groupCount,
    titleLayouts,
    fontScale: await page.evaluate(() => localStorage.getItem("banbu-font-scale-v1")),
    searchRestored: true,
    allCategoryIconsPresent: true,
    aboutFocusInside,
    sheetsCloseWithEscape: true,
    quickThemeCount: quickThemeValues.length,
    quickBoardCount: quickBoardValues.length,
    quickStoneCount: quickStoneValues.length,
  }, null, 2));
} finally {
  await browser.close();
}
