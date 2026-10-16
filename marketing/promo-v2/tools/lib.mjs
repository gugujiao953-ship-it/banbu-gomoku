// 半步五子棋 v1.1.8 宣传素材共用工具
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
export const STILLS = path.join(ROOT, "stills");
export const SEQ = path.join(ROOT, "seq");

export const BASE = process.env.BANBU_URL || "http://localhost:5195/";

// 手机视口（与仓库既有营销脚本一致，390x844 是硬前提）
export const PHONE = { width: 390, height: 844 };
export const DSF = 3;

export async function launch({ theme = "light", dsf = DSF } = {}) {
  await mkdir(STILLS, { recursive: true });
  await mkdir(SEQ, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.BANBU_HEADED ? false : true });
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: dsf,
    isMobile: true,
    hasTouch: true,
    colorScheme: theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    locale: "zh-CN",
  });
  // 关掉首启欢迎遮罩 + 新手引导，避免挡住点击
  await context.addInitScript(() => {
    try {
      localStorage.setItem("banbu-first-run-welcome-v1", "true");
      localStorage.setItem("banbu-onboarding-tour-v1", "seen");
    } catch {}
  });
  const page = await context.newPage();
  // 短超时：失败要快速暴露，不要每次干等 30s
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(30000);
  return { browser, context, page };
}

/** 安全点击：禁用/隐藏/动画期都不阻塞流程 */
export async function safeClick(loc, { timeout = 2500, force = true } = {}) {
  try {
    await loc.first().click({ timeout, force, noWaitAfter: true });
    return true;
  } catch { return false; }
}

/** 关闭可能存在的 toast，避免遮挡 */
export async function dismissToast(page) {
  const btn = page.locator(".app-toast-close");
  if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
}

/** 等动画稳定 */
export async function settle(page, ms = 260) {
  await page.waitForTimeout(ms);
}

/** 等到所有 CSS 动画结束（浮层进入动画用） */
export async function waitAnimations(page, selector) {
  await page.locator(selector).evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
  }).catch(() => {});
}

export async function shot(page, dir, name) {
  await dismissToast(page);
  const file = path.join(dir, name);
  await page.screenshot({ path: file });
  return file;
}

/** 进入 App 并等到打谱工作区就绪 */
export async function boot(page, { url } = {}) {
  console.log("[boot] goto", url || BASE);
  await page.goto(`${url || BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log("[boot] dom ready, waiting for workspace");
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 30_000 });
  console.log("[boot] workspace ready");
  await settle(page, 500);
}

/** 通过 aria-label 前缀点棋盘交叉点（真实 DOM 分发点击） */
export async function clickPoint(page, name) {
  await page.evaluate((pt) => {
    const cell = [...document.querySelectorAll('[role="gridcell"]')]
      .find((el) => (el.getAttribute("aria-label") || "").startsWith(pt));
    if (!cell) throw new Error("no gridcell " + pt);
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, name);
}

/** 鼠标模拟长按（放/去圆圈标注） */
export async function longPressPoint(page, name, ms = 700) {
  const box = await page.locator(`[role="gridcell"][aria-label^="${name}"]`).boundingBox();
  if (!box) throw new Error("no box " + name);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** 切换工作模式：打谱 / 读谱 / 做题 */
export async function switchMode(page, label) {
  await page.locator('.topbar-mode-toggle [role="tab"]').filter({ hasText: label }).first().click();
  await settle(page, 450);
}

/** 处理「未保存草稿」确认弹窗：action = "discard" | "keep" | "cancel" */
export async function resolveDraftModal(page, action = "discard") {
  const map = {
    discard: ["放弃草稿并切换"],
    keep: ["保存草稿并切换"],
    cancel: ["取消"],
  };
  const labels = map[action] || map.discard;
  for (const l of labels) {
    const b = page.getByRole("button", { name: l, exact: true });
    if (await b.first().isVisible().catch(() => false)) {
      const hit = await safeClick(b);
      if (hit) { await settle(page, 400); return true; }
    }
  }
  return false;
}

/** 清掉一切可能挡住点击的东西（注意：不再盲按 Esc——会误关后续要用的弹窗） */
export async function clearBlockers(page) {
  await dismissToast(page);
  await resolveDraftModal(page, "cancel");
}

/** 关闭当前打开的底部弹层 */
export async function closeSheet(page) {
  const dlg = page.locator('[role="dialog"]').filter({ has: page.locator('button[aria-label="关闭"]') }).first();
  if (await dlg.isVisible().catch(() => false)) { await safeClick(dlg.locator('button[aria-label="关闭"]')); await settle(page, 350); return true; }
  return false;
}
