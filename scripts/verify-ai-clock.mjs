import { chromium } from "playwright";
import assert from "node:assert/strict";

const baseURL = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5181/";
const browser = await chromium.launch({ headless: true });

/** 从「剩余 4:12 / 本手 0:58 / 用时 10:24」这类文本里取秒数（前缀词随界面变，数字口径不变）。 */
const clockSeconds = (text) => {
  const match = text.match(/(\d+):(\d{2})/);
  assert.ok(match, `无法从时间格读取时间：${text}`);
  return Number(match[1]) * 60 + Number(match[2]);
};

try {
  const viewportWidth = 320;
  const context = await browser.newContext({ viewport: { width: viewportWidth, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // 首运行欢迎页会挡住底部导航（这条脚本一直是清空存储后跑的，得自己把欢迎页标记写掉）。
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(baseURL);
  await page.reload();

  await page.getByRole("button", { name: "对弈" }).click();
  await page.waitForTimeout(700);
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  const setup = page.locator(".ai-game-setup");
  await setup.waitFor();

  const closeFloat = async () => {
    // 浮层是模态的：必须关掉才能点到底下的格子与「开始人机对战」。
    // 用背景层点掉；浮层若已关（有些选项选完会自己收），这里什么都不做。
    if (await page.locator(".ai-float-backdrop").count()) {
      await page.locator(".ai-float-backdrop").first().click({ position: { x: 4, y: 4 }, force: true });
      await page.waitForTimeout(400);
    }
  };
  // ⚠ 设置浮层 09-19 起是「格子 + 浮层列表」形态（`.ai-setup-cell`），
  //   这条脚本原来按老的 `.ai-time-grid` / `.ai-strength-grid.fixed` 找控件，早就点空了
  //   （它不在正式清单里，所以一直没红）。这里按当前形态重写。
  const timeCell = setup.locator(".ai-setup-cell").filter({ hasText: /不限|分钟/ }).first();
  await timeCell.click();
  await page.waitForTimeout(500);
  // 时间浮层里两类选项同屏：先 4 档包干时长，再 3 档每手读秒（含「无」）。
  const timeTexts = await page.locator(".ai-float-list button").allTextContents();
  // ⚠ 「不限」这个词在两个分组里都有（包干档的「不限」与读秒档的「无 不限每手用时」），
  //   所以要按「分钟」或「不跟每手」来挑，否则会数出 5 档。
  const limitOptions = timeTexts.filter((text) => /分钟/.test(text) || (/不限/.test(text) && !/每手/.test(text)));
  assert.equal(limitOptions.length, 4, `包干档应四档（不限 / 1 / 5 / 30 分钟）：${JSON.stringify(timeTexts)}`);
  assert.match(limitOptions[0], /不限/);
  assert.match(limitOptions[1], /1 分钟/);
  assert.ok(timeTexts.some((text) => /30 秒/.test(text)) && timeTexts.some((text) => /60 秒/.test(text)), `读秒档应有 30 / 60 秒：${JSON.stringify(timeTexts)}`);

  // 难度档位：关掉时间浮层再开难度浮层（浮层是模态的，开着时点不到底下的格子）。
  await closeFloat();
  await page.waitForTimeout(400);
  const strengthCell = setup.locator(".ai-setup-cell").filter({ hasText: /初级|中级|高级|大师|自由/ }).first();
  await strengthCell.click();
  await page.waitForTimeout(500);
  const strengthNames = await page.locator(".ai-float-list button span").allTextContents();
  for (const name of ["初级", "中级", "高级", "大师"]) assert.ok(strengthNames.includes(name), `难度档应含「${name}」：${JSON.stringify(strengthNames)}`);
  await closeFloat();
  await page.waitForTimeout(400);

  // 选 1 分钟包干（时间浮层里第二档）
  await timeCell.click();
  await page.waitForTimeout(500);
  await page.locator(".ai-float-list button").filter({ hasText: /^1 分钟/ }).click();
  await page.waitForTimeout(500);
  await closeFloat();
  await setup.getByRole("button", { name: /开始人机对战/ }).click();
  // 09-28 起对局有自己的界面：我方时间格写「剩余 m:ss」（包干制式），AI 那格显示「思考中」
  // 而不是走动的钟——这里量的是同一条语义：只有人这一侧在倒数、AI 思考期间暂停。
  const myTime = page.locator("[data-duel-my-time]");
  await myTime.waitFor();
  assert.match(await myTime.innerText(), /^剩余 (?:1:00|0:59)$/);
  await page.waitForTimeout(1350);
  const beforeMove = clockSeconds(await myTime.innerText());
  assert.ok(beforeMove <= 59, "玩家回合时倒计时应开始减少");

  await page.getByRole("gridcell", { name: /^H8空位/ }).click();
  await page.locator("[data-duel-thinking]").waitFor({ timeout: 3000 });
  const pausedAt = clockSeconds(await myTime.innerText());
  await page.waitForTimeout(800);
  assert.equal(clockSeconds(await myTime.innerText()), pausedAt, "AI 思考期间倒计时应暂停");

  await page.locator(".stone").nth(1).waitFor({ timeout: 30000 });
  await page.locator("[data-duel-thinking]").waitFor({ state: "detached", timeout: 5000 });
  const resumedAt = clockSeconds(await myTime.innerText());
  await page.waitForTimeout(1200);
  assert.ok(clockSeconds(await myTime.innerText()) < resumedAt, "AI 落子后玩家计时应恢复");

  // 「完成」离开对局界面（未终局的对局会留在「上次对局」里，下次点人机对战会问）
  await page.locator("[data-duel-close]").click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator("[data-duel-screen]").count(), 0, "点完成后应离开对弈界面");
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator("[data-duel-resume-yes]").count(), 1, "未下完的对局应能从这里回到上次对局");
  await page.locator("[data-duel-resume-yes]").click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator("[data-duel-screen]").count(), 1, "回到后应重新进入对弈界面");

  await context.close();

  const timeoutContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const timeoutPage = await timeoutContext.newPage();
  await timeoutPage.clock.install();
  await timeoutPage.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await timeoutPage.goto(baseURL);
  await timeoutPage.reload();
  await timeoutPage.getByRole("button", { name: "对弈" }).click();
  await timeoutPage.waitForTimeout(700);
  await timeoutPage.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await timeoutPage.locator(".ai-game-setup .ai-setup-cell").filter({ hasText: /不限|分钟/ }).first().click();
  await timeoutPage.waitForTimeout(500);
  await timeoutPage.locator(".ai-float-list button").filter({ hasText: /^1 分钟/ }).click();
  await timeoutPage.waitForTimeout(500);
  if (await timeoutPage.locator(".ai-float-backdrop").count()) {
    await timeoutPage.locator(".ai-float-backdrop").first().click({ position: { x: 4, y: 4 }, force: true });
    await timeoutPage.waitForTimeout(400);
  }
  await timeoutPage.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
  await timeoutPage.clock.fastForward(61000);
  // ⚠ 别去等那条「你的对局时长已用尽…」的 toast：它几秒后就淡出，而这里装的是假时钟、
  //   时间推进随时可能把它带走（实测就卡在这条上）。终局面板是常驻的，断言它更稳。
  await timeoutPage.locator("[data-duel-result]").waitFor({ timeout: 8000 });
  assert.match(await timeoutPage.locator("[data-duel-my-time]").innerText(), /^剩余 0:00$/);
  // 终局面板要说清为什么结束（超时），不能只写「你输了」。
  assert.match(await timeoutPage.locator("[data-duel-result]").innerText(), /超时/);
  await timeoutContext.close();

  console.log("AI clock browser verification passed: presets, fixed difficulty row, human-only countdown, AI pause, resume, timeout loss, and exit cleanup.");
} finally {
  await browser.close();
}
