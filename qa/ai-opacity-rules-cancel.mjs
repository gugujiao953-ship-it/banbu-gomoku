import { chromium } from "playwright";

// 首运行欢迎层的 .first-run-backdrop 会拦住后面每一次点击；那个键 09-14 起按版本号存，
// addInitScript 写的 "true" 只管更早的版本，真正关掉它的只有 URL 上的 ?qa=1。
// run-qa 注入的地址自带 ?qa=1，手动导出 QA_BASE_URL 时常常没有——这里补上（与
// scripts/verify-ai-rules.mjs、qa/settings-page-regression.mjs 同一套写法）。
const rawBaseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaURL = new URL(rawBaseURL);
qaURL.searchParams.set("qa", "1");
const baseURL = qaURL.href;
const browser = await chromium.launch({ headless: true });
const errors = [];

const trackErrors = (page) => {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // 外链遥测噪声过滤：本机直连 GitHub 更新检查会 403（需代理），与产品代码无关；
    // 本地资源（同源 localhost）的加载失败仍然计入。
    const source = message.location()?.url || "";
    if (/github/i.test(source)) return;
    errors.push(`console: ${message.text()} @${source.slice(0, 80)}`);
  });
};

const openSettingsOpacity = async (page) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const group = page.locator("details.settings-group").filter({ has: page.locator(".settings-section-title > b").filter({ hasText: /^棋盘显示$/ }) });
  if (await group.getAttribute("open") === null) await group.locator(":scope > summary.settings-section-toggle").click();
  // ⚠ 10-08 起透明度两项搬到了「棋盘显示」区（用户：「把外观、棋盘里面的透明度设置放到
  // 棋盘显示的设置里面」），不再在「外观与音效 → 棋子」下。这里连着上面那行一起改成新位置，
  // 那三行老的子目录展开逻辑（棋盘/棋子）随之删掉 —— 它们锚定的 details 已经不存在了。
  await group.getByRole("slider", { name: "棋子透明度" }).waitFor();
  return group;
};

const openAppearanceBoardPreview = async (page) => {
  // 当前外观共用预览，棋盘/棋子/特效在其下通过 tab 切换。
  const appearance = page.locator("details.settings-group").filter({ has: page.locator('summary b:text-is("外观与音效")') });
  if (await appearance.count() !== 1) throw new Error("找不到「外观与音效」分区");
  await appearance.evaluate((el) => { if (!el.open) el.querySelector("summary").click(); });
  const sub = appearance.locator("details.appearance-center-subsection").filter({ has: page.locator('summary b:text-is("棋盘与棋子")') });
  if (await sub.count() !== 1) throw new Error("找不到「棋盘与棋子」分区");
  await sub.evaluate((el) => { if (!el.open) el.querySelector("summary").click(); });
  await sub.getByRole("tab", { name: "棋盘", exact: true }).click();
  await sub.locator(".material-live-preview").waitFor();
  return sub;
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
    // 滑杆旁边**不该再有棋盘预览**（那是这次改动要抓回来的东西）；预览改由「外观 → 棋盘」渲染。
    if (await group.locator(".stone-opacity-setting .material-live-preview, .board-opacity-setting .material-live-preview").count() !== 0) {
      throw new Error(`${width}px：「棋盘显示」的透明度设置里又长出棋盘预览了（应只在「外观 → 棋盘」）`);
    }
    const previewBox = await (await openAppearanceBoardPreview(page)).locator(".material-live-preview").first().boundingBox();
    if (!previewBox || previewBox.width < 250) throw new Error(`${width}px 下材质预览过窄`);
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
  const opacitySlider = settingsGroup.getByRole("slider", { name: "棋子透明度" });
  await opacitySlider.fill("62");
  await settingsGroup.getByText("62%", { exact: true }).waitFor();
  // 透明度要真的作用到预览上 —— **跨两节**：滑杆在「棋盘显示」，预览块在「外观 → 棋盘」
  // （用户 10-09 定的位置），两处读同一份 App 状态，所以这一条同时钉住"挪位置没挪断联动"。
  // 元素由 src/appearance/preview.tsx 的 MaterialBoardCrop 出，预览是两层
  // `.material-preview-crop`：第 1 层 part="board" 吃棋盘透明度、第 2 层 part="stones" 吃棋子透明度，
  // 值挂在 crop 的内联 style 上。⚠ 两层都验：只查棋子层的话「两个滑杆接到同一层」抓不到。
  const previewCrops = (await openAppearanceBoardPreview(page)).locator(".material-live-preview .material-preview-crop");
  const cropCount = await previewCrops.count();
  if (cropCount !== 2) throw new Error(`材质预览分层数异常：${cropCount}（应为棋盘/棋子两层 .material-preview-crop，一层都不许缺）`);
  const stoneLayerOpacity = await previewCrops.nth(1).evaluate((element) => getComputedStyle(element).opacity);
  if (stoneLayerOpacity !== "0.62") throw new Error(`预览棋子层透明度未即时更新：${stoneLayerOpacity}`);
  const boardLayerOpacity = await previewCrops.nth(0).evaluate((element) => getComputedStyle(element).opacity);
  // 棋盘透明度的默认值就是 1（src/board-opacity.ts DEFAULT_BOARD_OPACITY），滑棋子不该动它。
  if (boardLayerOpacity !== "1") throw new Error(`棋子透明度串到了棋盘层：${boardLayerOpacity}`);
  // 反向再钉一次：滑棋盘透明度只动棋盘层，棋子层留在 62%。
  await settingsGroup.getByRole("slider", { name: "棋盘透明度" }).fill("45");
  if (await previewCrops.nth(0).evaluate((element) => getComputedStyle(element).opacity) !== "0.45") throw new Error("棋盘透明度没作用到棋盘层");
  if (await previewCrops.nth(1).evaluate((element) => getComputedStyle(element).opacity) !== "0.62") throw new Error("棋盘透明度串到了棋子层");
  await page.reload({ waitUntil: "domcontentloaded" });
  await openSettingsOpacity(page);
  if (await settingsGroup.getByRole("slider", { name: "棋子透明度" }).inputValue() !== "62") throw new Error("透明度刷新后未持久化");
  // 当前精简滑杆没有独立的恢复按钮；从外观预览调回默认，验证双入口同步。
  const appearanceGroup = await openAppearanceBoardPreview(page);
  await appearanceGroup.getByRole("slider", { name: "棋子透明度" }).fill("100");
  await appearanceGroup.getByRole("slider", { name: "棋盘透明度" }).fill("100");
  if (await settingsGroup.getByRole("slider", { name: "棋子透明度" }).inputValue() !== "100"
    || await settingsGroup.getByRole("slider", { name: "棋盘透明度" }).inputValue() !== "100") throw new Error("外观入口与棋盘显示透明度未同步");
  await page.getByRole("button", { name: "打谱", exact: true }).click();

  await page.getByRole("button", { name: "对弈", exact: true }).click();
  await page.waitForTimeout(700);
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.getByRole("button", { name: "查看所有规则说明" }).click();
  await page.getByText("禁手怎么判断", { exact: true }).waitFor();
  const forbiddenDetails = page.locator("details.rule-detail-card").filter({ hasText: "禁手怎么判断" });
  if (!(await forbiddenDetails.getAttribute("open")) && !(await forbiddenDetails.evaluate((element) => element.open))) throw new Error("禁手说明没有默认展开");
  await page.getByText("真三、假三与重复计算", { exact: true }).waitFor();
  await page.getByRole("button", { name: /打开使用手册中的 AI 条目/ }).click();
  await page.locator("details.manual-item").filter({ hasText: "AI 人机对战" }).locator("summary").click();
  await page.getByRole("button", { name: "打开完整规则说明" }).first().waitFor();
  await page.keyboard.press("Escape");

  // 现行 AI 弹窗（2efc4e3 重构后）：规则双 cell + 浮层选规则；难度单 cell + 浮层选「自由」
  await page.getByRole("button", { name: "对弈", exact: true }).click();
  await page.waitForTimeout(700);
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(700);
  await page.locator('[data-ai-rule="no-forbidden"]').click();
  await page.waitForTimeout(400);
  await page.locator(".ai-float-list button").filter({ hasText: "无禁6不胜" }).first().click();
  await page.waitForTimeout(300);
  await page.locator(".ai-game-setup .ai-setup-cell.single").first().click();
  await page.waitForTimeout(400);
  await page.locator(".ai-float-list button").filter({ hasText: "自由" }).first().click();
  await page.waitForTimeout(300);
  // 自由档的展开控件在浮层内且会拦截 Playwright 命中检测：DOM 直点 + 收起浮层
  await page.evaluate(() => { const b = document.querySelector(".ai-unlimited-option"); if (!b) throw new Error("未出现不限时思考选项"); b.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await page.waitForTimeout(300);
  const unlimitedPressed = await page.locator(".ai-unlimited-option").getAttribute("aria-pressed");
  if (unlimitedPressed !== "true") throw new Error(`不限时思考未开启（aria-pressed=${unlimitedPressed}）`);
  await page.evaluate(() => { const x = [...document.querySelectorAll(".ai-float-wrap button")].find((element) => element.getAttribute("aria-label") === "关闭"); x?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll(".ai-game-setup button")].find((element) => (element.textContent || "").includes("开始人机对战")); b?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await page.getByRole("gridcell", { name: "H8空位" }).click();
  const stoneBodyOpacity = await page.locator(".stone-piece .stone-body").first().evaluate((element) => getComputedStyle(element).opacity);
  if (stoneBodyOpacity !== "1") throw new Error("棋盘棋子默认透明度未恢复为 100%");
  if (await page.locator(".stone-body .move-number, .stone-body .last-dot, .stone-body .board-feedback, .stone-body .thinking-point").count()) throw new Error("棋子之外的标记被包入透明度层");
  await page.locator('.app-shell[data-ai-worker-state="running"]').waitFor();
  const firstRequest = await page.locator(".app-shell").getAttribute("data-ai-request-id");
  // T29 语义：不限时思考中点「停止思考」= 先落当前已算的最强点再停。
  // 等 progress 流至少写入一次（100ms 一更，2.5s 富余），停止后必须恰好 +1 子。
  await page.waitForTimeout(2500);
  if (await page.locator(".app-shell").getAttribute("data-ai-worker-state") !== "running") throw new Error("不限时思考 2.5s 后已不在 running（可能未真正启用不限时）");
  const stonesBeforeStop = await page.locator(".stone-piece").count();
  const stopProbe = await page.evaluate(() => {
    /**
     * 「思考中」浮标必须**坐在坐标带里、不压棋盘交点**（用户 2026-10-13：右下角那样才对，
     * 不占棋盘；右上角那档以前 top:12px + 30px 高，一定越过第一行线）。
     * 量法：首/末网格线的位置 = viewBox 边距比例 × 渲染高度（比例由 App 写在
     * `.board-scroller` 的 `--board-axis-band-frac` 上，浮标高度就是跟着它缩的）。
     * 两档都量：当前这一档量真实元素，另一档注入一枚同 markup 的克隆量完就删。
     * 正值 = 压进棋盘多少 px（允许 1.5px 的取整余量）。
     */
    const measure = (el, svg, below) => {
      const vb = svg.viewBox.baseVal.width || 572;
      const frac = Number(getComputedStyle(document.querySelector(".board-scroller")).getPropertyValue("--board-axis-band-frac")) || 34 / vb;
      const r = svg.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return below ? Math.round((r.top + (1 - frac) * r.height - b.top) * 10) / 10 : Math.round((b.bottom - (r.top + frac * r.height)) * 10) / 10;
    };
    const svg = document.querySelector(".board-scroller svg");
    const live = document.querySelector(".board-thinking-indicator");
    const isBelow = Boolean(live?.classList.contains("below"));
    const overlaps = { [isBelow ? "below" : "corner"]: live && svg ? measure(live, svg, isBelow) : null };
    if (live && svg) {
      const other = isBelow ? "corner" : "below";
      const clone = live.cloneNode(true);
      clone.className = `board-thinking-indicator ${other}`;
      live.parentElement.appendChild(clone);
      overlaps[other] = measure(clone, svg, other === "below");
      clone.remove();
    }
    return {
      indicator: Boolean(document.querySelector(".board-thinking-indicator")),
      stones: document.querySelectorAll(".stone-piece").length,
      state: document.querySelector(".app-shell")?.getAttribute("data-ai-worker-state"),
      setupOpen: Boolean(document.querySelector(".ai-game-setup")),
      toasts: [...document.querySelectorAll("[class*=toast]")].map((element) => element.textContent?.trim()).join("|").slice(0, 80),
      overlaps,
    };
  });
  if (!stopProbe.indicator) throw new Error(`思考灯缺失：${JSON.stringify(stopProbe)}`);
  const crossed = Object.entries(stopProbe.overlaps ?? {}).filter(([, px]) => px === null || px > 1.5);
  if (crossed.length) throw new Error(`思考浮标压进棋盘：${JSON.stringify(stopProbe.overlaps)}`);
  console.log(`  ✓ 思考浮标坐在坐标带里（两档压进棋盘 ${JSON.stringify(stopProbe.overlaps)}，允许 ≤1.5px）`);
  await page.evaluate(() => document.querySelector(".board-thinking-indicator")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.locator('.app-shell[data-ai-worker-state="idle"]').waitFor();
  await page.waitForFunction((count) => document.querySelectorAll(".stone-piece").length === count + 1, stonesBeforeStop, { timeout: 5000 });
  const stoneCountAfterStop = await page.locator(".stone-piece").count();
  if (stoneCountAfterStop !== stonesBeforeStop + 1) throw new Error(`停止未按 T29 语义落最强点：${stonesBeforeStop}→${stoneCountAfterStop}`);
  await page.waitForTimeout(900);
  if (await page.locator(".stone-piece").count() !== stoneCountAfterStop) throw new Error("停止后旧 Worker 仍继续落子");

  // 「继续思考」按钮已随旧弹窗退役：用人类再落一手重新触发思考来验证
  // worker 重建与新 requestId；pagehide 取消后不得有任何自动落子。
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((element) => (element.getAttribute("aria-label") || "").endsWith("空位"));
    cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.locator('.app-shell[data-ai-worker-state="running"]').waitFor();
  const secondRequest = await page.locator(".app-shell").getAttribute("data-ai-request-id");
  if (!firstRequest || !secondRequest || firstRequest === secondRequest) throw new Error("重新思考没有分配新的 requestId");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.locator('.app-shell[data-ai-worker-state="idle"]').waitFor();
  const stonesAfterHide = await page.locator(".stone-piece").count();
  await page.waitForTimeout(700);
  if (await page.locator(".stone-piece").count() !== stonesAfterHide) throw new Error("页面挂起后旧 Worker 仍自动落子");

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({
    pass: true,
    widths: [360, 390, 412],
    darkMode: true,
    reducedMotion: true,
    opacityPersistence: true,
    ruleGuideAndManualCrossLink: true,
    stopPlaysBestMove: true,
    pagehideCancel: true,
    staleMoveRejected: true,
    workerRecreated: firstRequest !== secondRequest,
  }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
