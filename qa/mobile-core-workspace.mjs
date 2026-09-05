import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5181/";
const qaURL = new URL(baseURL);
qaURL.searchParams.set("qa", "1");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const metadata = (title) => ({ title, black: "黑方", white: "白方", event: "移动回归", date: "2026-08-31", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] });
const makeRecord = (id, title) => ({
  id, version: 1, rootId: `${id}-root`, savedCurrentId: `${id}-root`,
  createdAt: "2026-08-31T08:00:00.000Z", updatedAt: "2026-08-31T08:00:00.000Z", metadata: metadata(title),
  nodes: { [`${id}-root`]: { id: `${id}-root`, parentId: null, children: [], move: null, comment: "", marks: [] } },
});
const active = makeRecord("mobile-active", "移动验收棋谱");
const records = Array.from({ length: 24 }, (_, index) => makeRecord(`mobile-${index}`, `回归棋谱 ${String(index + 1).padStart(2, "0")}`));
const folders = ["未分类", "实战复盘", "定式研究", "攻防专题", "比赛收藏", "待整理", "连珠开局", "官子训练", "防守手筋", "进攻手筋", "名局精选", "临时棋谱"];
const assignments = Object.fromEntries([active, ...records].map((record, index) => [record.id, folders[index % folders.length]]));

const sourceCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
assert(sourceCss.includes(".bottom-sheet{max-height:min(82vh,720px)"), "缺少 Android legacy WebView 的 vh Sheet 回退");
assert(sourceCss.includes("@supports(height:100dvh)"), "缺少现代 WebView 的 dvh 增强");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.addInitScript(({ activeRecord, library, folderNames, recordAssignments }) => {
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("renju-note-active-v1", JSON.stringify(activeRecord));
    localStorage.setItem("renju-note-library-v1", JSON.stringify([activeRecord, ...library]));
    localStorage.setItem("renju-note-library-folders-v1", JSON.stringify({ recordFolders: folderNames, puzzleFolders: ["内置题库", "我的题库"], recordAssignments, puzzleAssignments: {} }));
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ tabletSplit: false, gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
  }, { activeRecord: active, library: records, folderNames: folders, recordAssignments: assignments });
  await page.goto(qaURL.href, { waitUntil: "domcontentloaded" });

  const statusMetrics = await page.locator(".unified-status").evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    modeHeights: [...element.querySelectorAll('[role="tab"]')].map((button) => button.getBoundingClientRect().height),
  }));
  assert(statusMetrics.height <= 110, `顶部工作区仍过高：${statusMetrics.height}px`);
  assert(Math.min(...statusMetrics.modeHeights) >= 44, "打谱/读谱/做题触控区小于 44px");

  await page.getByRole("button", { name: /切换棋谱/ }).click();
  const recordDialog = page.getByRole("dialog", { name: "选择棋谱" });
  await recordDialog.waitFor();
  const folderButtons = recordDialog.locator(".record-selector-folder-head");
  const folderLabels = await folderButtons.allTextContents();
  assert(await folderButtons.count() >= folders.length, "棋谱选择器没有显示全部测试文件夹");
  assert(folders.every((folder) => folderLabels.some((label) => label.includes(folder))), "棋谱选择器遗漏了测试文件夹");
  const expandedFolderCount = await folderButtons.evaluateAll((buttons) => buttons.filter((button) => button.getAttribute("aria-expanded") === "true").length);
  assert(expandedFolderCount === 1, `棋谱选择器应只展开当前棋谱所在文件夹，实际 ${expandedFolderCount} 个`);
  const recordList = recordDialog.locator(".record-selector-list");
  const recordScroll = await recordList.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  assert(recordScroll.scrollHeight > recordScroll.clientHeight, "多文件夹时棋谱选择器没有可滚动区");
  await recordList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert(await recordList.evaluate((element) => element.scrollTop) > 0, "棋谱选择器无法向下滚动");
  await page.goBack();
  await recordDialog.waitFor({ state: "detached" });

  await page.getByRole("tab", { name: "做题模式" }).click();
  await page.getByRole("button", { name: /切换棋题/ }).click();
  const puzzleDialog = page.getByRole("dialog", { name: "选择题目与题集" });
  await puzzleDialog.waitFor();
  await puzzleDialog.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  const puzzleMetrics = await puzzleDialog.evaluate((element) => {
    const list = element.querySelector(".puzzle-selector-list");
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight, clientHeight: list?.clientHeight || 0, scrollHeight: list?.scrollHeight || 0 };
  });
  assert(puzzleMetrics.top >= -1 && puzzleMetrics.bottom <= puzzleMetrics.viewportHeight + 1, `做题选择器越界：${JSON.stringify(puzzleMetrics)}`);
  assert(puzzleMetrics.scrollHeight > puzzleMetrics.clientHeight, "做题列表没有可滚动区");
  const puzzleList = puzzleDialog.locator(".puzzle-selector-list");
  await puzzleList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert(await puzzleList.evaluate((element) => element.scrollTop) > 0, "做题列表无法向下滚动");
  await page.goBack();
  await puzzleDialog.waitFor({ state: "detached" });

  await page.getByRole("button", { name: "AI", exact: true }).click();
  const aiDialog = page.getByRole("dialog", { name: "AI 人机对战" });
  await aiDialog.waitFor();
  await aiDialog.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  const aiMetrics = await aiDialog.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom,
    viewportHeight: innerHeight,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(aiMetrics.top >= -1 && aiMetrics.bottom <= aiMetrics.viewportHeight + 1, `AI 设置弹层越界：${JSON.stringify(aiMetrics)}`);
  assert(aiMetrics.scrollHeight > aiMetrics.clientHeight, "AI 设置弹层没有可滚动区");
  await aiDialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert(await aiDialog.evaluate((element) => element.scrollTop) > 0, "AI 设置弹层无法向下滚动");
  await page.goBack();
  await aiDialog.waitFor({ state: "detached" });
  assert(await page.locator(".app-shell").isVisible(), "返回关闭 AI 后应用主界面消失");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ pass: true, statusMetrics, recordScroll, puzzleMetrics, aiMetrics, historyBackKeepsApp: true }, null, 2));
} finally {
  await browser.close();
}
