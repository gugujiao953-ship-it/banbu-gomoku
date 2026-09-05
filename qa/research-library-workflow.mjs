import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(10_000);
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

const metadata = (title) => ({ title, black: "黑方", white: "白方", event: "研究回归", date: "2026-08-30", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] });
const active = {
  id: "qa-active", version: 1, rootId: "root", savedCurrentId: "root",
  createdAt: "2026-08-30T08:00:00.000Z", updatedAt: "2026-08-30T08:30:00.000Z", metadata: metadata("研究工作流棋谱"),
  nodes: {
    root: { id: "root", parentId: null, children: ["n1"], preferredChildId: "n1", move: null, comment: "", marks: [] },
    n1: { id: "n1", parentId: "root", children: ["n2", "branch"], preferredChildId: "n2", move: { row: 7, col: 7, player: "black" }, comment: "研究起点", marks: [] },
    n2: { id: "n2", parentId: "n1", children: ["n3"], preferredChildId: "n3", move: { row: 7, col: 8, player: "white" }, comment: "研究应对", marks: [] },
    n3: { id: "n3", parentId: "n2", children: [], move: { row: 8, col: 7, player: "black" }, comment: "", marks: [] },
    branch: { id: "branch", parentId: "n1", children: [], move: { row: 8, col: 8, player: "white" }, comment: "旁支", marks: [] },
  },
};
const recent = {
  id: "qa-recent", version: 1, rootId: "recent-root", savedCurrentId: "recent-root",
  createdAt: "2026-08-29T08:00:00.000Z", updatedAt: "2026-08-29T09:00:00.000Z", metadata: metadata("有草稿的最近棋谱"),
  nodes: { "recent-root": { id: "recent-root", parentId: null, children: [], move: null, comment: "", marks: [] } },
};

await page.addInitScript(({ activeDocument, recentDocument }) => {
  localStorage.clear();
  localStorage.setItem("renju-note-active-v1", JSON.stringify(activeDocument));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([activeDocument, recentDocument]));
  localStorage.setItem("renju-note-draft-v2:qa-recent", JSON.stringify({ operations: [{ type: "update-node", nodeId: "recent-root", patch: { comment: "待整理" } }], redo: [], updatedAt: "2026-08-30T08:45:00.000Z" }));
  localStorage.setItem("renju-note-library-folders-v1", JSON.stringify({ recordFolders: ["未分类"], puzzleFolders: ["内置题库", "我的题库"], recordAssignments: {}, puzzleAssignments: {} }));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ tabletSplit: false, gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
}, { activeDocument: active, recentDocument: recent });

try {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "打开快捷中心" }).click();
  const quickDrawer = page.getByRole("dialog", { name: "快捷中心" });
  await quickDrawer.getByRole("button", { name: /自动演示/ }).click();
  await quickDrawer.getByLabel("选择播放速度").selectOption("2");
  await quickDrawer.getByLabel("选择分支处理").selectOption("pause");
  await quickDrawer.getByRole("button", { name: "关闭快捷中心" }).click();
  if (!await page.getByRole("button", { name: "到第一手" }).isVisible()) await page.getByRole("button", { name: "行棋" }).click();
  const recordMoveButtonTops = await page.locator(".moves-row button").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
  if (new Set(recordMoveButtonTops).size !== 1) throw new Error(`打谱走棋按钮没有保持单行：${recordMoveButtonTops.join(" / ")}`);
  if (await page.getByRole("button", { name: "播放自动演示" }).count()) throw new Error("打谱模式不应显示自动演示按钮");
  await page.getByRole("tab", { name: "读谱模式" }).click();
  const moveCommands = await page.locator(".moves-row button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") || button.textContent?.trim() || ""));
  const reviewMoveButtonTops = await page.locator(".moves-row button").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
  if (new Set(reviewMoveButtonTops).size !== 1) throw new Error(`读谱走棋按钮没有保持单行：${reviewMoveButtonTops.join(" / ")}`);
  const endIndex = moveCommands.indexOf("到最后一手");
  if (endIndex < 0 || moveCommands[endIndex + 1] !== "播放自动演示") throw new Error(`自动演示没有紧跟在终点右侧：${moveCommands.join(" | ")}`);
  if (await page.locator(".record-playback-controls").count()) throw new Error("主界面仍显示臃肿的自动演示配置卡片");
  await page.getByRole("button", { name: "播放自动演示" }).click();
  const stoppedPlaybackButton = page.getByRole("button", { name: "播放自动演示" });
  await stoppedPlaybackButton.waitFor({ timeout: 10_000 });
  if (await stoppedPlaybackButton.getAttribute("title") !== "自动演示已在分支处暂停") throw new Error("自动演示没有按配置停在分支处");
  await page.getByRole("button", { name: "打开快捷中心" }).click();
  await quickDrawer.getByLabel("选择分支处理").selectOption("mainline");
  await quickDrawer.getByRole("button", { name: "关闭快捷中心" }).click();
  await page.getByRole("button", { name: "播放自动演示" }).click();
  await stoppedPlaybackButton.waitFor({ timeout: 10_000 });
  const playbackStopTitle = await stoppedPlaybackButton.getAttribute("title");
  if (playbackStopTitle !== "自动演示已到当前变化末尾") throw new Error(`自动演示结束状态异常：${playbackStopTitle || "未知"}`);
  await page.getByRole("tab", { name: "打谱模式" }).click();

  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await page.getByPlaceholder("坐标、手数、标注、注释或局面文字").fill("研究");
  await page.getByText("找到 2 个节点（最多 20 个）", { exact: true }).waitFor();
  await page.getByRole("button", { name: "下一个查找结果" }).click();
  await page.getByText("2 / 2", { exact: true }).waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "打开导出方式" }).click();
  await page.locator(".export-scope-grid button").filter({ hasText: "当前变化" }).click();
  await page.getByRole("button", { name: /选择格式导出/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /SGF（当前变化）/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!download.suggestedFilename().includes("当前变化")) throw new Error(`当前变化导出文件名异常：${download.suggestedFilename()}`);
  if (!downloadPath) throw new Error("当前变化导出没有生成可读取文件");
  const sgf = await readFile(downloadPath, "utf8");
  if (sgf.includes("W[ii]")) throw new Error("当前变化导出错误包含旁支 W[ii]");

  await page.getByRole("button", { name: "棋谱库", exact: true }).click();
  await page.getByText("继续上次研究", { exact: true }).waitFor();
  await page.getByText("有草稿的最近棋谱", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "有草稿 1", exact: true }).click();
  await page.locator(".record-list article").filter({ hasText: "有草稿的最近棋谱" }).waitFor();
  await page.getByRole("button", { name: /资料安全/ }).click();
  await page.getByRole("button", { name: /打开回收站/ }).waitFor();
  await page.getByRole("button", { name: /导出完整备份/ }).waitFor();
  await page.getByRole("button", { name: /恢复完整备份/ }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("自动演示", { exact: true }).click();
  if (await page.getByLabel("播放速度").inputValue() !== "2") throw new Error("设置页没有同步快捷中心的播放速度");
  if (await page.getByLabel("分支处理").inputValue() !== "mainline") throw new Error("设置页没有同步快捷中心的分支策略");

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ pass: true, playbackOnlyInReview: true, recordMoveButtonsSingleLine: true, reviewMoveButtonsSingleLine: true, compactPlaybackButton: true, quickCenterPlaybackSettings: true, settingsPlaybackSync: true, playbackBranchPause: true, playbackMainline: true, searchSequentialNavigation: true, exportScopeFilename: download.suggestedFilename(), libraryContinue: true, draftFilter: true, dataSafetyHub: true }, null, 2));
} finally {
  await browser.close();
}
