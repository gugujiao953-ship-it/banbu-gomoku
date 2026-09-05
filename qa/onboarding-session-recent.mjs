import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const onboardingUrl = new URL(baseUrl);
onboardingUrl.searchParams.delete("qa");
const browser = await chromium.launch({ headless: true });
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
// 欢迎弹窗按钮文案经历过「我知道了/使用手册」→「先自己试试/带我看看怎么用」改名，测试两种写法都匹配，避免再脆断。
const DISMISS_RE = /先自己试试|我知道了/;
const MANUAL_RE = /带我看看怎么用|使用手册/;

try {
  const acknowledgement = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await acknowledgement.newPage();
  page.on("pageerror", (error) => errors.push(error.stack || String(error)));
  await page.goto(onboardingUrl.href, { waitUntil: "commit" });
  await page.getByRole("dialog").waitFor();
  assert(await page.getByRole("dialog").isVisible(), "首次启动没有显示欢迎弹窗");
  await page.getByRole("button", { name: DISMISS_RE }).click();
  assert(await page.getByRole("dialog").count() === 0, "我知道了没有关闭欢迎弹窗");
  await page.reload({ waitUntil: "commit" });
  assert(await page.getByRole("dialog").count() === 0, "已读欢迎弹窗重复出现");
  await acknowledgement.close();

  const manualContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const manualPage = await manualContext.newPage();
  await manualPage.goto(onboardingUrl.href, { waitUntil: "commit" });
  await manualPage.evaluate(() => localStorage.clear());
  await manualPage.reload({ waitUntil: "commit" });
  await manualPage.getByRole("dialog").waitFor();
  await manualPage.getByRole("button", { name: MANUAL_RE }).click();
  assert(await manualPage.getByRole("heading", { name: "使用手册" }).count() === 1, "使用手册按钮没有打开手册");
  await manualContext.close();

  const restoreContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const restorePage = await restoreContext.newPage();
  await restorePage.goto(onboardingUrl.href, { waitUntil: "commit" });
  await restorePage.getByRole("dialog").waitFor();
  await restorePage.getByRole("button", { name: DISMISS_RE }).click();
  await restorePage.getByRole("gridcell", { name: /^H8空位$/ }).click();
  await restorePage.getByRole("gridcell", { name: /^H8已有棋子$/ }).waitFor();
  await restorePage.waitForFunction(() => JSON.parse(localStorage.getItem("banbu-last-session-v1") || "{}").nodeId?.startsWith("node-"));
  await restorePage.reload({ waitUntil: "commit" });
  await restorePage.getByRole("gridcell", { name: /^H8已有棋子$/ }).waitFor();
  assert(await restorePage.getByRole("gridcell", { name: /^H8已有棋子$/ }).count() === 1, "开启恢复时没有恢复具体局面");
  await restorePage.getByRole("button", { name: "设置" }).click();
  await restorePage.locator(".settings-group").filter({ hasText: "文件与存储" }).locator("summary").click();
  const restoreRow = restorePage.locator(".setting-row").filter({ hasText: "退出后恢复上次局面" });
  await restoreRow.click();
  assert(!(await restoreRow.locator("input").isChecked()), "恢复开关没有关闭");
  await restorePage.reload({ waitUntil: "commit" });
  await restorePage.getByRole("gridcell", { name: /^H8空位$/ }).waitFor();
  assert(await restorePage.getByRole("gridcell", { name: /^H8空位$/ }).count() === 1, "关闭恢复后没有进入空白棋局");
  await restoreContext.close();

  const puzzleContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const puzzlePage = await puzzleContext.newPage();
  await puzzlePage.goto(onboardingUrl.href, { waitUntil: "commit" });
  await puzzlePage.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify([{ id: "qa-set", title: "QA题集", source: "QA", license: "", puzzles: [{ id: "qa-puzzle", title: "QA最近题", prompt: "黑先", difficulty: 1, stones: [{ row: 7, col: 7, player: "black" }], player: "white" }] }]));
    localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify({ "qa-set/qa-puzzle": { solved: false, attempts: 1, updatedAt: "2026-08-30T00:00:00.000Z" } }));
  });
  await puzzlePage.reload({ waitUntil: "commit" });
  if (await puzzlePage.getByRole("dialog").count()) await puzzlePage.getByRole("button", { name: DISMISS_RE }).click();
  await puzzlePage.getByRole("button", { name: "棋谱库" }).click();
  await puzzlePage.getByRole("tab", { name: /题库/ }).click();
  assert(await puzzlePage.getByRole("region", { name: "最近棋题" }).isVisible(), "最近棋题区域没有显示");
  await puzzlePage.getByRole("button", { name: /QA最近题/ }).click();
  const puzzleModeButton = puzzlePage.getByRole("tab", { name: "做题模式", exact: true });
  assert(await puzzleModeButton.count() === 1 && (await puzzleModeButton.getAttribute("class"))?.includes("selected"), "最近棋题没有打开做题模式");
  await puzzleContext.close();

  assert(errors.length === 0, "页面运行错误：" + errors.join("\n"));
  console.log(JSON.stringify({ pass: true, welcomeAcknowledgement: true, welcomeManual: true, restoreOnOff: true, recentPuzzleOpen: true }, null, 2));
} finally {
  await browser.close();
}

