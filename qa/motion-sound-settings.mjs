import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });

const installAudioCounter = async (context, initialSettings) => {
  await context.addInitScript((settings) => {
    if (!sessionStorage.getItem("banbu-qa-initialized")) {
      localStorage.clear();
      if (settings) localStorage.setItem("banbu-sound-settings-v1", JSON.stringify(settings));
      sessionStorage.setItem("banbu-qa-initialized", "true");
    }
    const Original = window.AudioContext || window.webkitAudioContext;
    window.__banbuAudioContextCount = 0;
    if (!Original) return;
    class CountedAudioContext extends Original {
      constructor(...args) {
        super(...args);
        window.__banbuAudioContextCount += 1;
      }
    }
    window.AudioContext = CountedAudioContext;
    window.webkitAudioContext = CountedAudioContext;
  }, initialSettings);
};

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await installAudioCounter(context, null);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByText("声音与反馈", { exact: true }).click();
  await page.getByLabel("启用音效").check();
  await page.getByRole("radio", { name: /木石/ }).click();
  await page.getByRole("button", { name: "试听落子" }).click();
  await page.getByRole("radio", { name: /清响/ }).click();
  await page.getByRole("button", { name: "试听落子" }).click();

  const audioContextCount = await page.evaluate(() => window.__banbuAudioContextCount);
  if (audioContextCount !== 1) throw new Error(`expected one reused AudioContext, received ${audioContextCount}`);
  const savedSound = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-sound-settings-v1") || "null"));
  if (savedSound?.profile !== "crystal") throw new Error(`sound profile was not persisted: ${JSON.stringify(savedSound)}`);

  await page.getByText("棋盘显示", { exact: true }).click();
  if (!await page.getByLabel("界面动效").isChecked()) throw new Error("motion should default to enabled");
  if (await page.evaluate(() => document.documentElement.dataset.motion) !== "on") throw new Error("data-motion should default to on");
  await page.getByLabel("界面动效").uncheck();
  const motionStored = await page.evaluate(() => localStorage.getItem("banbu-motion-enabled-v2"));
  if (motionStored !== "false") throw new Error(`motion setting was not persisted: ${motionStored}`);
  if (await page.evaluate(() => document.documentElement.dataset.motion) !== "off") throw new Error("data-motion was not set to off");

  await page.getByRole("button", { name: "打谱" }).click();
  const board = page.locator(".renju-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("board is not visible");
  const clickPoint = async (row, col) => {
    const coordinate = (index) => (34 + index * 36) / 572;
    await board.click({ position: { x: box.width * coordinate(col), y: box.height * coordinate(row) } });
  };
  for (const [row, col] of [[7, 5], [9, 5], [7, 6], [9, 6], [7, 7], [9, 7], [7, 8], [9, 8], [7, 9]]) await clickPoint(row, col);

  const lastStoneAnimation = await page.locator(".stone-piece").last().evaluate((element) => getComputedStyle(element).animationName);
  if (lastStoneAnimation !== "none") throw new Error(`motion-off stone animation is ${lastStoneAnimation}`);
  const winningLine = page.locator(".winning-line").first();
  if (!await winningLine.count()) throw new Error("winning line was not rendered");
  const winningStyle = await winningLine.evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    dashOffset: getComputedStyle(element).strokeDashoffset,
  }));
  if (winningStyle.animationName !== "none" || !["0", "0px"].includes(winningStyle.dashOffset)) throw new Error(`winning line is not static and complete: ${JSON.stringify(winningStyle)}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByText("声音与反馈", { exact: true }).click();
  if (await page.getByRole("radio", { name: /清响/ }).getAttribute("aria-checked") !== "true") throw new Error("sound profile was not restored");
  await page.getByText("棋盘显示", { exact: true }).click();
  if (await page.getByLabel("界面动效").isChecked()) throw new Error("motion setting was not restored");
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
  await context.close();

  const mutedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await installAudioCounter(mutedContext, { enabled: false, moveEnabled: true, feedbackEnabled: true, volume: 0.55, profile: "classic" });
  const mutedPage = await mutedContext.newPage();
  await mutedPage.goto(baseUrl, { waitUntil: "networkidle" });
  await mutedPage.getByRole("button", { name: "设置" }).click();
  await mutedPage.getByText("声音与反馈", { exact: true }).click();
  await mutedPage.getByRole("radio", { name: /木石/ }).click();
  if (!await mutedPage.getByRole("button", { name: "试听落子" }).isDisabled()) throw new Error("muted preview should stay disabled");
  const mutedAudioContextCount = await mutedPage.evaluate(() => window.__banbuAudioContextCount);
  if (mutedAudioContextCount !== 0) throw new Error(`muted profile selection created ${mutedAudioContextCount} AudioContext instance(s)`);
  await mutedContext.close();

  console.log(JSON.stringify({ ok: true, baseUrl, audioContextCount, mutedAudioContextCount, savedSound, motionStored, lastStoneAnimation, winningStyle, pageErrors }));
} finally {
  await browser.close();
}
