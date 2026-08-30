import { chromium } from "playwright";

const baseUrl = process.env.BANBU_BASE_URL || "http://127.0.0.1:5181/";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
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
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByText("声音与反馈", { exact: true }).click();
  await page.getByText("启用音效", { exact: true }).click();
  await page.getByLabel("音效音量").fill("28");
  for (let index = 0; index < 12; index += 1) await page.getByRole("button", { name: index % 3 === 0 ? "试听警告" : "试听落子" }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-sound-settings-v1") || "null"));
  const contextCount = await page.evaluate(() => window.__banbuAudioContextCount);
  if (contextCount !== 1) throw new Error(`expected one reused AudioContext, received ${contextCount}`);
  if (saved?.volume !== 0.28) throw new Error(`volume was not persisted: ${JSON.stringify(saved)}`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByText("声音与反馈", { exact: true }).click();
  if (await page.getByLabel("音效音量").inputValue() !== "28") throw new Error("volume was not restored after reload");
  const mutedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await mutedContext.addInitScript(() => {
    localStorage.setItem("banbu-sound-settings-v1", JSON.stringify({ enabled: false, moveEnabled: true, feedbackEnabled: true, volume: 0.55 }));
    const Original = window.AudioContext || window.webkitAudioContext;
    window.__banbuAudioContextCount = 0;
    if (!Original) return;
    class CountedAudioContext extends Original {
      constructor(...args) { super(...args); window.__banbuAudioContextCount += 1; }
    }
    window.AudioContext = CountedAudioContext;
    window.webkitAudioContext = CountedAudioContext;
  });
  const mutedPage = await mutedContext.newPage();
  await mutedPage.goto(baseUrl, { waitUntil: "networkidle" });
  const board = mutedPage.locator(".renju-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("board is not visible");
  await board.click({ position: { x: box.width * 0.42, y: box.height * 0.42 } });
  const mutedContextCount = await mutedPage.evaluate(() => window.__banbuAudioContextCount);
  await mutedContext.close();
  if (mutedContextCount !== 0) throw new Error(`muted play created ${mutedContextCount} AudioContext instance(s)`);
  console.log(JSON.stringify({ ok: true, baseUrl, contextCount, mutedContextCount, saved, pageErrors }));
} finally {
  await browser.close();
}
