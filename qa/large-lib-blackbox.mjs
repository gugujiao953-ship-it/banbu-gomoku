import { chromium } from "playwright";

const files = process.argv.slice(2);
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
if (!files.length) throw new Error("用法：node qa/large-lib-blackbox.mjs 松月.lib [其它大型.lib]");

const browser = await chromium.launch({ headless: true });
const report = [];
for (const file of files) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  const longTasks = [];
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.stack || String(error)));
  await page.exposeFunction("recordLongTask", (entry) => longTasks.push(entry));
  await page.addInitScript(() => {
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.recordLongTask({ duration: entry.duration }))).observe({ type: "longtask", buffered: true });
  });

  const started = performance.now();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    localStorage.clear();
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(databases.map((database) => database.name ? new Promise((resolve) => { const request = indexedDB.deleteDatabase(database.name); request.onsuccess = request.onerror = request.onblocked = () => resolve(); }) : Promise.resolve()));
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForFunction(() => !document.querySelector(".import-progress"), null, { timeout: 600000 });
  await page.waitForFunction(() => Boolean(window.__banbuImportDiagnostic) || Boolean(document.querySelector(".toast")), null, { timeout: 600000 });
  const importMs = performance.now() - started;
  const importedTitle = await page.locator(".workspace-current b").textContent().catch(() => "");
  const importToast = await page.locator(".toast").textContent().catch(() => "");
  const importDiagnostics = await page.evaluate(() => ({ importDiagnostic: window.__banbuImportDiagnostic || null, workerMessage: window.__banbuWorkerMessage || null, importState: window.__banbuImportState || null, storageDiagnostic: window.__banbuStorageDiagnostic || null }));
  const importSucceeded = importDiagnostics.workerMessage?.ok === true && ["import-success", "compact-created"].includes(importDiagnostics.importState?.state) && importDiagnostics.importDiagnostic?.hasCompact === true;
  if (!importSucceeded) {
    report.push({ file, importMs: +importMs.toFixed(1), importedTitle, importToast, ...importDiagnostics, status: "import-failed", consoleErrors });
    await page.close();
    continue;
  }

  const navigation = await page.evaluate(async () => {
    const next = document.querySelector('button[aria-label="下一手"]');
    const prev = document.querySelector('button[aria-label="上一手"]');
    if (!next || !prev) throw new Error("导航按钮不可用");
    const run = async (button) => { const values = []; for (let i = 0; i < 100; i += 1) { const t = performance.now(); button.click(); await new Promise(requestAnimationFrame); values.push(performance.now() - t); } return values; };
    const stats = (values) => { const sorted = [...values].sort((a, b) => a - b); return { p50: +sorted[49].toFixed(2), p95: +sorted[94].toFixed(2), max: +Math.max(...values).toFixed(2), total: +values.reduce((a, b) => a + b, 0).toFixed(2) }; };
    return { forward: stats(await run(next)), backward: stats(await run(prev)) };
  });

  const branch = await page.evaluate(async () => {
    const branchDiagnostic = window.__banbuFindBranch?.();
    await new Promise(requestAnimationFrame);
    const next = document.querySelector('button[aria-label="下一手"]');
    const first = document.querySelector('button[aria-label="到第一手"]');
    const openBranch = async () => {
      const button = [...document.querySelectorAll(".dock-panel button")].find((item) => item.textContent?.trim() === "变化");
      if (!button) return null;
      button.click(); await new Promise(requestAnimationFrame);
      const note = document.querySelector(".sheet-body .section-note")?.textContent || "";
      const list = document.querySelector(".branch-list");
      const rows = list ? [...list.querySelectorAll("button")].filter((item) => !item.classList.contains("secondary-button")) : [];
      document.querySelector(".sheet-head button")?.click(); await new Promise(requestAnimationFrame);
      return { note, rows: rows.length };
    };
    let found = null;
    const diagnostic = branchDiagnostic;
    if (diagnostic?.firstBranchId && (diagnostic.firstBranchChildCount || 0) > 1) {
      found = { depth: "indexed", note: `当前支点后续有 ${diagnostic.firstBranchChildCount} 个变化`, rows: diagnostic.firstBranchChildCount };
    }
    const button = [...document.querySelectorAll(".dock-panel button")].find((item) => item.textContent?.trim() === "变化");
    if (!button) return { opened: false, reason: "未找到行棋变化按钮", found, diagnostic };
    if (!diagnostic?.firstBranchId || (diagnostic.firstBranchChildCount || 0) <= 1) return { opened: false, reason: "没有找到真实多分支节点", found, diagnostic };
    button.click(); await new Promise(requestAnimationFrame);
    const list = document.querySelector(".branch-list");
    if (!list) return { opened: false, reason: "变化面板未打开", found };
    const note = document.querySelector(".sheet-body .section-note")?.textContent || "";
    const rowButtons = [...list.querySelectorAll("button")].filter((item) => !item.classList.contains("secondary-button"));
    const firstId = rowButtons[0]?.textContent?.trim() || "";
    const before = list.scrollTop;
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.dispatchEvent(new Event("scroll"));
    await new Promise(requestAnimationFrame);
    const afterScrollRows = [...list.querySelectorAll("button")].filter((item) => !item.classList.contains("secondary-button")).length;
    let clicked = false;
    if (rowButtons[0]) { rowButtons[0].click(); await new Promise(requestAnimationFrame); clicked = true; }
    return { opened: true, branchDiagnostic, found, note, rowsBefore: rowButtons.length, rowsAfterScroll: afterScrollRows, firstRow: firstId, scrollHeight: list.scrollHeight, scrolled: list.scrollTop !== before || list.scrollHeight <= list.clientHeight, clicked };
  });
  const domBeforeRefresh = await page.evaluate(() => document.querySelectorAll("*").length);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(15000);
  const recovery = await page.evaluate(() => ({ title: document.querySelector(".workspace-current b")?.textContent || "", progress: Boolean(document.querySelector(".import-progress")), domNodes: document.querySelectorAll("*").length }));
  report.push({ file, importMs: +importMs.toFixed(1), importedTitle, importToast, ...importDiagnostics, navigation, branch, domBeforeRefresh, recovery, longTasks: longTasks.length, maxLongTaskMs: +Math.max(0, ...longTasks.map((item) => item.duration)).toFixed(1), consoleErrors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
