import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const output = path.resolve("marketing/v1.1.4/screenshots");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
  reducedMotion: "reduce",
  serviceWorkers: "block",
});
const page = await context.newPage();

const shot = async (name, resetScroll = true) => {
  const toastClose = page.locator(".app-toast-close");
  if (await toastClose.isVisible().catch(() => false)) await toastClose.click();
  if (resetScroll) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, name), fullPage: false });
};

const frameSection = async (section) => {
  await section.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 145)));
  await page.waitForTimeout(150);
};

try {
  await page.goto(`${baseUrl}?marketing=${Date.now()}`, { waitUntil: "networkidle" });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 20_000 });

  // 01 · 打谱与变化：构造一段清晰、居中的实战局面。
  for (const point of ["H8", "I8", "H9", "I9", "G8", "J8", "G9", "J9", "F8", "K8", "F9"]) {
    await page.locator(`[role="gridcell"][aria-label^="${point}"]`).click();
  }
  await page.locator(".command-save").click();
  await page.waitForTimeout(700);
  await shot("01-record-board.png");

  // 02 · AI 人机对战设置。
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("dialog", { name: "AI 人机对战" }).waitFor();
  await page.locator(".bottom-sheet").evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await shot("02-ai-game.png");
  await page.getByRole("dialog", { name: "AI 人机对战" }).getByRole("button", { name: "关闭", exact: true }).click();

  // 03 · 导出棋谱和分享当前局面。
  await page.getByRole("button", { name: "打开导出方式" }).click();
  await page.getByRole("dialog", { name: "导出与分享" }).waitFor();
  await shot("03-export-share.png");
  await page.getByRole("dialog", { name: "导出与分享" }).getByRole("button", { name: "关闭", exact: true }).click();

  // 04 · 多格式棋谱导入与图片识谱。
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.getByRole("dialog", { name: "选择导入方式" }).waitFor();
  await shot("04-import.png");
  await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "关闭", exact: true }).click();

  // 05 · 做题训练与题库切换。
  await page.locator(".workspace-mode-toggle").click();
  await page.waitForFunction(() => document.querySelector(".workspace-mode-toggle")?.getAttribute("aria-checked") === "true", null, { timeout: 15_000 });
  await page.locator(".topbar").getByText(/道题已就绪/).waitFor({ timeout: 15_000 });
  await page.locator(".dock-tabs").getByRole("button", { name: "应战" }).click();
  await shot("05-puzzle-training.png");

  // 06 · 棋谱库、题库和搜索。
  await page.getByRole("button", { name: "棋谱库" }).click();
  await page.getByRole("tab", { name: /题库/ }).click();
  await page.locator(".library-search").waitFor();
  await shot("06-library.png");

  // 07 · 外观主题、棋盘和棋子样式。
  await page.getByRole("button", { name: "设置" }).click();
  const themeSection = page.locator("details.settings-collapsible").filter({ hasText: "外观主题" });
  await themeSection.locator("summary").click();
  await frameSection(themeSection);
  await shot("07-themes.png", false);

  // 08 · 备份恢复与格式兼容。
  const dataSection = page.locator("details.settings-collapsible").filter({ hasText: "数据与兼容" });
  await dataSection.locator("summary").click();
  await frameSection(dataSection);
  await shot("08-backup-compatibility.png", false);

  console.log(JSON.stringify({ ok: true, output, files: 8 }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
