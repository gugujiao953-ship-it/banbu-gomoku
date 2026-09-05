import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl = process.env.BANBU_QA_URL || "http://127.0.0.1:4173/?qa=1";
const outputDir = resolve("qa-artifacts/glm-2026-09-01/fixes");
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = {};
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const board = page.locator(".renju-board");
  await board.waitFor();
  const box = await board.boundingBox();
  if (!box) throw new Error("棋盘没有布局框");
  await board.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const undo = page.getByRole("button", { name: "撤销编辑" });
  const redo = page.getByRole("button", { name: "重做编辑" });
  await undo.waitFor();
  if (await undo.isDisabled()) throw new Error("落子后撤销仍不可用");
  if (!(await redo.isDisabled())) throw new Error("撤销前重做不应可用");
  await undo.click();
  if (await redo.isDisabled()) throw new Error("撤销后重做没有启用");
  const staleAfterUndo = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("renju-note-draft-v2:")));
  if (staleAfterUndo.length) throw new Error(`撤销为空后仍有草稿键：${staleAfterUndo.join(",")}`);
  await redo.click();
  if (await undo.isDisabled()) throw new Error("重做后撤销没有恢复");

  const dockMetrics = await page.locator(".moves-row").evaluate((panel) => ({
    clientWidth: panel.clientWidth,
    scrollWidth: panel.scrollWidth,
    tops: [...panel.querySelectorAll(":scope > button")].map((button) => Math.round(button.getBoundingClientRect().top)),
  }));
  if (dockMetrics.scrollWidth > dockMetrics.clientWidth + 1) throw new Error(`走棋栏横向溢出 ${dockMetrics.scrollWidth}/${dockMetrics.clientWidth}`);
  if (Math.max(...dockMetrics.tops) - Math.min(...dockMetrics.tops) > 1) throw new Error(`走棋按钮没有保持单行：${dockMetrics.tops.join(",")}`);
  await page.screenshot({ path: resolve(outputDir, "record-redo-360.png"), fullPage: true });

  const deletedAt = "2026-09-01T00:00:00.000Z";
  await page.evaluate(({ deletedAt }) => {
    const makeEntry = (id, title) => ({ id, kind: "record", folder: "研究", deletedAt, item: { id, rootId: "root", updatedAt: deletedAt, metadata: { title, black: "黑方", white: "白方", boardSize: 15, rule: "gomoku" }, nodes: { root: { id: "root", parentId: null, children: [], move: null, comment: "", marks: [] } } } });
    localStorage.setItem("banbu-recycle-bin-v1", JSON.stringify([makeEntry("trash-1", "待确认棋谱一"), makeEntry("trash-2", "待确认棋谱二")]));
  }, { deletedAt });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "棋谱库", exact: true }).click();
  await page.getByRole("button", { name: /资料安全/ }).first().click();
  await page.getByRole("button", { name: /打开回收站/ }).click();
  const permanentDelete = page.getByRole("button", { name: /彻底删除“待确认棋谱一”/ });
  let permanentMessage = "";
  page.once("dialog", async (dialog) => { permanentMessage = dialog.message(); await dialog.dismiss(); });
  await permanentDelete.click();
  await permanentDelete.waitFor();
  if (!permanentMessage.includes("无法撤销")) throw new Error(`永久删除确认文案不完整：${permanentMessage}`);

  const empty = page.getByRole("button", { name: /清空回收站/ });
  let emptyMessage = "";
  page.once("dialog", async (dialog) => { emptyMessage = dialog.message(); await dialog.accept(); });
  await empty.click();
  await page.getByText("回收站是空的").waitFor();
  if (!emptyMessage.includes("2 项") || !emptyMessage.includes("无法恢复")) throw new Error(`清空确认文案不完整：${emptyMessage}`);
  if (errors.length) throw new Error(`控制台错误：${errors.join(" | ")}`);
  results.modern = { staleAfterUndo, dockMetrics, permanentMessage, emptyMessage, consoleErrors: errors };
  await context.close();

  const bookmarkContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await bookmarkContext.addInitScript(() => {
    const now = "2026-09-01T00:00:00.000Z";
    const document = {
      id: "bookmark-draft-regression", version: 1, rootId: "root", savedCurrentId: "root",
      createdAt: now, updatedAt: now,
      metadata: { title: "书签撤销回归", black: "黑方", white: "白方", event: "", date: "2026-09-01", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] },
      nodes: { root: { id: "root", parentId: null, children: [], move: null, comment: "", marks: [] } },
    };
    const pastedBookmark = { id: "pasted-bookmark", nodeId: "pasted-node", title: "粘贴书签", note: "", createdAt: now, updatedAt: now };
    const draft = {
      operations: [{
        type: "add-subtree", parentId: "root", rootId: "pasted-node",
        nodes: { "pasted-node": { id: "pasted-node", parentId: "root", children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] } },
        bookmarks: [pastedBookmark],
      }],
      redo: [], updatedAt: now,
    };
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("renju-note-active-v1", JSON.stringify(document));
    localStorage.setItem("renju-note-library-v1", JSON.stringify([document]));
    localStorage.setItem("renju-note-draft-v2:bookmark-draft-regression", JSON.stringify(draft));
    localStorage.setItem("renju-note-branch-bookmarks-v1", JSON.stringify({ [document.id]: [pastedBookmark] }));
  });
  const bookmarkPage = await bookmarkContext.newPage();
  await bookmarkPage.goto(baseUrl, { waitUntil: "networkidle" });
  await bookmarkPage.getByRole("button", { name: "撤销编辑" }).click();
  await bookmarkPage.waitForFunction(() => {
    const store = JSON.parse(localStorage.getItem("renju-note-branch-bookmarks-v1") || "{}");
    return (store["bookmark-draft-regression"] || []).every((item) => item.id !== "pasted-bookmark");
  });
  await bookmarkPage.getByRole("button", { name: "重做编辑" }).click();
  await bookmarkPage.waitForFunction(() => {
    const store = JSON.parse(localStorage.getItem("renju-note-branch-bookmarks-v1") || "{}");
    return (store["bookmark-draft-regression"] || []).filter((item) => item.id === "pasted-bookmark").length === 1;
  });
  const bookmarkCountAfterRedo = await bookmarkPage.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("renju-note-branch-bookmarks-v1") || "{}");
    return (store["bookmark-draft-regression"] || []).filter((item) => item.id === "pasted-bookmark").length;
  });
  results.bookmarks = { removedOnUndo: true, restoredOnceOnRedo: bookmarkCountAfterRedo === 1 };
  await bookmarkContext.close();

  const legacyContext = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: "block" });
  await legacyContext.addInitScript(() => {
    Object.defineProperty(CSS, "supports", { configurable: true, value: () => false });
  });
  const legacyPage = await legacyContext.newPage();
  await legacyPage.goto(baseUrl, { waitUntil: "networkidle" });
  if (!(await legacyPage.locator("html.legacy-webview").count())) throw new Error("旧 WebView 能力不足时未启用兼容类");
  await legacyPage.locator(".dock-tabs").getByRole("button", { name: "编辑" }).click();
  await legacyPage.locator(".dock-panel button").first().waitFor();
  const legacyDockColor = await legacyPage.locator(".dock-panel button").first().evaluate((element) => getComputedStyle(element).color);
  if (!legacyDockColor || legacyDockColor === "rgba(0, 0, 0, 0)") throw new Error("旧 WebView 兼容层按钮文字不可见");
  await legacyPage.screenshot({ path: resolve(outputDir, "legacy-webview-360.png"), fullPage: true });
  results.legacy = { classApplied: true, dockColor: legacyDockColor };
  await legacyContext.close();

  writeFileSync(resolve(outputDir, "bugfix-regression.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, outputDir, results }, null, 2));
} finally {
  await browser.close();
}
