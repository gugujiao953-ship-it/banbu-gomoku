import { chromium } from "playwright";
import assert from "node:assert/strict";

const baseURL = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const browser = await chromium.launch({ headless: true });

const clockSeconds = (text) => {
  const match = text.match(/(\d+):(\d{2})(?:\s+(?:剩余|$))/);
  assert.ok(match, `无法从状态栏读取时间：${text}`);
  return Number(match[1]) * 60 + Number(match[2]);
};

try {
  const viewportWidth = 320;
  const context = await browser.newContext({ viewport: { width: viewportWidth, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "AI" }).click();
  const setup = page.locator(".ai-game-setup");
  await setup.waitFor();

  const timeButtons = setup.locator(".ai-time-grid button");
  assert.equal(await timeButtons.count(), 4, "对局时长应提供四个预设选项");
  assert.match(await timeButtons.first().innerText(), /^不限/);
  assert.equal(await timeButtons.first().getAttribute("aria-pressed"), "true", "默认对局时长应为不限");

  const fixedStrengths = setup.locator(".ai-strength-grid.fixed button");
  assert.equal(await fixedStrengths.count(), 4, "固定 AI 难度应为四档");
  assert.deepEqual(await fixedStrengths.locator("span").allTextContents(), ["初级", "中级", "高级", "大师"]);
  assert.equal(await setup.locator(".ai-strength-grid.fixed").getByText("不限", { exact: true }).count(), 0, "AI 难度中不应保留不限");
  assert.equal(await setup.locator(".ai-strength-free-option").count(), 1, "自由难度应独立显示");
  const strengthBoxes = await fixedStrengths.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()));
  assert.equal(new Set(strengthBoxes.map((box) => Math.round(box.top))).size, 1, "四个固定难度应保持在同一行");
  assert.ok(strengthBoxes.every((box) => box.left >= 0 && box.right <= viewportWidth), "固定难度在 320px 窄屏不应横向溢出");

  await setup.getByRole("button", { name: /1 分钟/ }).click();
  await setup.getByRole("button", { name: /开始人机对战/ }).click();
  const clock = page.locator(".brand .ai-clock-status");
  await clock.waitFor();
  assert.match(await clock.innerText(), /你的回合 · 1:00 剩余/);
  await page.waitForTimeout(1350);
  const beforeMove = clockSeconds(await clock.innerText());
  assert.ok(beforeMove <= 59, "玩家回合时倒计时应开始减少");

  await page.getByRole("gridcell", { name: /^H8空位/ }).click();
  await page.getByText(/AI 思考中 · 暂停计时/).waitFor({ timeout: 3000 });
  const pausedAt = clockSeconds(await clock.innerText());
  await page.waitForTimeout(800);
  assert.equal(clockSeconds(await clock.innerText()), pausedAt, "AI 思考期间倒计时应暂停");

  await page.locator(".stone").nth(1).waitFor({ timeout: 30000 });
  await page.getByText(/你的回合/).waitFor({ timeout: 3000 });
  const resumedAt = clockSeconds(await clock.innerText());
  await page.waitForTimeout(1200);
  assert.ok(clockSeconds(await clock.innerText()) < resumedAt, "AI 落子后玩家计时应恢复");

  await page.getByRole("button", { name: "退出对弈" }).click();
  await clock.waitFor({ state: "detached" });

  await context.close();

  const timeoutContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const timeoutPage = await timeoutContext.newPage();
  await timeoutPage.clock.install();
  await timeoutPage.goto(baseURL);
  await timeoutPage.evaluate(() => localStorage.clear());
  await timeoutPage.reload();
  await timeoutPage.getByRole("button", { name: "AI" }).click();
  await timeoutPage.locator(".ai-game-setup").getByRole("button", { name: /1 分钟/ }).click();
  await timeoutPage.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
  await timeoutPage.clock.fastForward(61000);
  await timeoutPage.getByText("你的对局时长已用尽，本局结束").waitFor();
  assert.match(await timeoutPage.locator(".brand .ai-clock-status").innerText(), /本局结束 · 0:00 剩余/);
  assert.match(await timeoutPage.locator(".game-result-banner").innerText(), /本局结束/);
  await timeoutContext.close();

  console.log("AI clock browser verification passed: presets, fixed difficulty row, human-only countdown, AI pause, resume, timeout loss, and exit cleanup.");
} finally {
  await browser.close();
}
