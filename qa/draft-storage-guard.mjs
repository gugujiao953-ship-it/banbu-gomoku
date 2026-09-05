import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const newCleanContext = async () => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    if (localStorage.getItem("__banbu_qa_cleaned") !== "1") {
      localStorage.clear();
      localStorage.setItem("__banbu_qa_cleaned", "1");
    }
  });
  return context;
};

try {
  const padding = "x".repeat(4 * 1024 * 1024 + 1024);
  const context = await newCleanContext();
  let page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-current b").waitFor({ state: "visible" });
  await page.waitForTimeout(550);
  const recordId = await page.evaluate(async () => {
    const { createDocument } = await import("/src/game.ts");
    const { saveDraftToLocal, saveToLibrary } = await import("/src/storage.ts");
    const { saveLastSession } = await import("/src/features/session/session-restore.ts");
    const document = createDocument("草稿删除门禁");
    saveToLibrary(document);
    saveDraftToLocal(document.id, { operations: [{ type: "set-metadata", metadata: { title: "尚未保存" } }], redo: [] });
    saveLastSession({ documentId: document.id, nodeId: document.rootId, mode: "record" });
    return document.id;
  });
  await page.close();
  const firstPage = await context.newPage();
  await firstPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  page = firstPage;
  await page.getByRole("button", { name: "棋谱库" }).click();
  const draftRecord = page.locator(".record-list article", { hasText: "草稿删除门禁" });
  await draftRecord.waitFor({ state: "visible", timeout: 15_000 });
  await draftRecord.locator("button.delete-record").click();
  await page.getByRole("dialog", { name: "未保存草稿" }).waitFor({ state: "visible" });
  assert(await page.getByRole("dialog", { name: "未保存草稿" }).count() === 1, "删除带草稿棋谱时没有弹出草稿门禁");
  assert(await page.locator(".record-list article", { hasText: "草稿删除门禁" }).count() === 1, "确认处理草稿前棋谱已被删除");
  await page.getByRole("button", { name: "放弃草稿并切换" }).click();
  await page.waitForTimeout(300);
  const deletionState = await page.evaluate((id) => ({
    library: JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]").map((item) => item.id),
    active: localStorage.getItem("renju-note-active-v1"),
    draft: localStorage.getItem(`renju-note-draft-v2:${id}`),
  }), recordId);
  assert(!deletionState.library.includes(recordId), "确认放弃草稿后棋谱仍在库中");
  assert(deletionState.active === null, "删除当前棋谱后活动快照没有清理");
  assert(deletionState.draft === null, "删除当前棋谱后本地草稿没有清理");
  await context.close();

  const deferredContext = await newCleanContext();
  let deferredPage = await deferredContext.newPage();
  await deferredPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await deferredPage.locator(".workspace-current b").waitFor({ state: "visible" });
  await deferredPage.waitForTimeout(550);
  await deferredPage.evaluate(async () => {
    const { createDocument } = await import("/src/game.ts");
    const { saveDraftToLocal, saveToLibrary } = await import("/src/storage.ts");
    const { saveLastSession } = await import("/src/features/session/session-restore.ts");
    const document = createDocument("保留当前草稿");
    saveToLibrary(document);
    saveDraftToLocal(document.id, { operations: [{ type: "update-node", nodeId: document.rootId, patch: { comment: "未保存" } }], redo: [] });
    saveLastSession({ documentId: document.id, nodeId: document.rootId, mode: "record" });
  });
  await deferredPage.close();
  const deferredAppPage = await deferredContext.newPage();
  await deferredAppPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  deferredPage = deferredAppPage;
  await deferredPage.locator('input[type="file"]').first().setInputFiles({
    name: "deferred-large.sgf",
    mimeType: "application/x-go-sgf",
    buffer: Buffer.from(`(;GM[40]FF[4]SZ[15]GN[延后打开]C[${padding}];B[hh])`),
  });
  await deferredPage.getByRole("dialog", { name: "未保存草稿" }).waitFor({ state: "visible", timeout: 120_000 });
  assert(await deferredPage.getByRole("dialog", { name: "未保存草稿" }).count() === 1, "导入大型棋谱时没有等待处理当前草稿");
  assert(await deferredPage.locator(".workspace-current b").innerText() === "保留当前草稿", "确认切换前已经打开导入棋谱");
  assert(await deferredPage.evaluate(() => localStorage.getItem("banbu-active-large-record-v1")) === null, "确认切换前提前写入了大型棋谱活动 ID");
  await deferredPage.getByRole("button", { name: "取消" }).last().click();
  assert(await deferredPage.locator(".workspace-current b").innerText() === "保留当前草稿", "取消切换后当前棋谱发生变化");
  assert(await deferredPage.evaluate(() => localStorage.getItem("banbu-active-large-record-v1")) === null, "取消切换后残留大型棋谱活动 ID");
  await deferredContext.close();

  const failureContext = await newCleanContext();
  let failurePage = await failureContext.newPage();
  await failurePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await failurePage.evaluate(() => {
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: () => { throw new DOMException("forced persistence failure", "QuotaExceededError"); },
    });
  });
  const initialTitle = await failurePage.locator(".workspace-current b").innerText();
  await failurePage.locator('input[type="file"]').first().setInputFiles({
    name: "ghost-large.sgf",
    mimeType: "application/x-go-sgf",
    buffer: Buffer.from(`(;GM[40]FF[4]SZ[15]GN[幽灵候选]C[${padding}];B[hh])`),
  });
  await failurePage.waitForFunction(() => window.__banbuStorageDiagnostic?.ok === false, null, { timeout: 120_000 });
  await failurePage.waitForTimeout(300);
  const failureState = await failurePage.evaluate(() => ({
    title: document.querySelector(".workspace-current b")?.textContent || "",
    activeLargeId: localStorage.getItem("banbu-active-large-record-v1"),
    diagnostic: window.__banbuStorageDiagnostic || null,
    toast: document.querySelector(".toast")?.textContent || "",
  }));
  assert(failureState.diagnostic?.ok === false, `没有触发预期的持久化失败：${JSON.stringify(failureState)}`);
  assert(failureState.title === initialTitle, `持久化失败后打开了幽灵候选：${failureState.title}`);
  assert(failureState.activeLargeId === null, "持久化失败后仍写入了大型棋谱活动 ID");
  assert(failureState.toast.includes("写入大型棋谱库失败"), `持久化失败提示不明确：${failureState.toast}`);
  await failureContext.close();

  console.log(JSON.stringify({ pass: true, deletionDraftGuard: true, deferredImportActivation: true, failedPersistenceDoesNotOpenCandidate: true }, null, 2));
} finally {
  await browser.close();
}

