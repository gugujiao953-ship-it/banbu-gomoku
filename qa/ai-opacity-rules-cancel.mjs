import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/?qa=1";
const browser = await chromium.launch({ headless: true });
const errors = [];

const trackErrors = (page) => {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
};

const openSettingsOpacity = async (page) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const group = page.locator("details.settings-group").filter({ has: page.locator(".settings-section-title > b").filter({ hasText: /^外观与音效$/ }) });
  if (await group.getAttribute("open") === null) await group.locator(":scope > summary.settings-section-toggle").click();
  const boardSection = group.locator("details.appearance-center-subsection").filter({ hasText: "棋盘材质" }).first();
  if (await boardSection.getAttribute("open") === null) await boardSection.locator(":scope > summary").click();
  const stoneSection = group.locator("details.appearance-center-subsection").filter({ hasText: "棋子材质" }).first();
  if (await stoneSection.getAttribute("open") === null) await stoneSection.locator(":scope > summary").click();
  await page.getByRole("slider", { name: "棋子透明度" }).waitFor();
  return group;
};

try {
  for (const width of [360, 390, 412]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      colorScheme: "dark",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
    const page = await context.newPage();
    trackErrors(page);
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    const group = await openSettingsOpacity(page);
    const settingBox = await group.locator(".stone-opacity-setting").boundingBox();
    if (!settingBox || settingBox.x < 0 || settingBox.x + settingBox.width > width + 1) throw new Error(`${width}px 下透明度设置溢出`);
    // 材质预览已重构为 MaterialLivePreview；旧 .stone-opacity-preview 类只剩死 CSS，测试对齐现行类名
    const previewBox = await group.locator(".stone-opacity-setting .material-live-preview").boundingBox();
    if (!previewBox || previewBox.width < 250) throw new Error(`${width}px 下透明度预览过窄`);
    await context.close();
  }

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  const page = await context.newPage();
  trackErrors(page);
  page.setDefaultTimeout(15_000);
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  const settingsGroup = await openSettingsOpacity(page);
  const opacitySlider = page.getByRole("slider", { name: "棋子透明度" });
  await opacitySlider.fill("62");
  await settingsGroup.getByText("62%", { exact: true }).waitFor();
  const previewOpacity = await settingsGroup.locator(".stone-opacity-setting .material-preview-stone.black").evaluate((element) => getComputedStyle(element).opacity);
  if (previewOpacity !== "0.62") throw new Error(`预览透明度未即时更新：${previewOpacity}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openSettingsOpacity(page);
  if (await page.getByRole("slider", { name: "棋子透明度" }).inputValue() !== "62") throw new Error("透明度刷新后未持久化");
  await settingsGroup.getByRole("button", { name: "恢复默认" }).last().click();
  if (await page.getByRole("slider", { name: "棋子透明度" }).inputValue() !== "100") throw new Error("透明度未恢复默认值");
  await page.getByRole("button", { name: "打谱", exact: true }).click();

  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("button", { name: "查看完整规则说明" }).click();
  await page.getByText("禁手怎么判断", { exact: true }).waitFor();
  const forbiddenDetails = page.locator("details.rule-detail-card").filter({ hasText: "禁手怎么判断" });
  if (!(await forbiddenDetails.getAttribute("open")) && !(await forbiddenDetails.evaluate((element) => element.open))) throw new Error("禁手说明没有默认展开");
  await page.getByText("真三、假三与重复计算", { exact: true }).waitFor();
  await page.getByRole("button", { name: /打开使用手册中的 AI 条目/ }).click();
  await page.locator("details.manual-item").filter({ hasText: "AI 人机对战" }).locator("summary").click();
  await page.getByRole("button", { name: "打开完整规则说明" }).first().waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.locator(".ai-rule-choice").filter({ hasText: "无禁6不胜" }).click();
  await page.locator(".ai-strength-free-option").click();
  await page.getByRole("button", { name: /不限时思考/ }).click();
  await page.getByRole("button", { name: /开始人机对战/ }).click();
  await page.getByRole("gridcell", { name: "H8空位" }).click();
  const stoneBodyOpacity = await page.locator(".stone-piece .stone-body").first().evaluate((element) => getComputedStyle(element).opacity);
  if (stoneBodyOpacity !== "1") throw new Error("棋盘棋子默认透明度未恢复为 100%");
  if (await page.locator(".stone-body .move-number, .stone-body .last-dot, .stone-body .board-feedback, .stone-body .thinking-point").count()) throw new Error("棋子之外的标记被包入透明度层");
  await page.locator('.app-shell[data-ai-worker-state="running"]').waitFor();
  const firstRequest = await page.locator(".app-shell").getAttribute("data-ai-request-id");
  await page.getByRole("button", { name: "停止人机 AI 思考" }).click();
  await page.locator('.app-shell[data-ai-worker-state="idle"]').waitFor();
  const stoneCountAfterStop = await page.locator(".stone-piece").count();
  await page.waitForTimeout(900);
  if (await page.locator(".stone-piece").count() !== stoneCountAfterStop) throw new Error("停止后旧 Worker 仍自动落子");

  await page.getByRole("button", { name: "继续人机 AI 思考" }).click();
  await page.locator('.app-shell[data-ai-worker-state="running"]').waitFor();
  const secondRequest = await page.locator(".app-shell").getAttribute("data-ai-request-id");
  if (!firstRequest || !secondRequest || firstRequest === secondRequest) throw new Error("重新思考没有分配新的 requestId");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.locator('.app-shell[data-ai-worker-state="idle"]').waitFor();
  await page.waitForTimeout(700);
  if (await page.locator(".stone-piece").count() !== stoneCountAfterStop) throw new Error("页面挂起后旧 Worker 仍自动落子");

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({
    pass: true,
    widths: [360, 390, 412],
    darkMode: true,
    reducedMotion: true,
    opacityPersistence: true,
    ruleGuideAndManualCrossLink: true,
    unlimitedStop: true,
    pagehideCancel: true,
    staleMoveRejected: true,
    workerRecreated: firstRequest !== secondRequest,
  }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
