import { chromium } from "playwright";

// 大型谱编辑生命周期黑盒：覆盖 GPT 026/027 验收场景。
// 用法：node qa/large-edit-lifecycle.mjs D:\五子棋\定式谱\雨.lib
const files = process.argv.slice(2);
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
if (!files.length) throw new Error("用法：node qa/large-edit-lifecycle.mjs 雨.lib");

const browser = await chromium.launch({ headless: true });
const report = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const file of files) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.stack || String(error)));

  const snapshot = () => page.evaluate(() => {
    const stoneCount = document.querySelectorAll(".renju-board .stone").length;
    const workspaceSmall = document.querySelector(".workspace-current small")?.textContent || "";
    const depthMatch = workspaceSmall.match(/第 (\d+) 手/);
    return {
      title: document.querySelector(".workspace-current b")?.textContent || "",
      header: document.querySelector(".topbar .brand small")?.textContent?.trim() || "",
      status: document.querySelector(".workspace-status")?.textContent?.trim() || "",
      toast: document.querySelector(".toast")?.textContent?.trim() || "",
      depth: depthMatch ? Number(depthMatch[1]) : null,
      stoneCount,
      hasDraftText: (document.querySelector(".topbar .brand small")?.textContent || "").includes("未保存草稿"),
    };
  });
  const idbSnapshot = () => page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => {
      const req = indexedDB.open("banbu-gomoku-large-library");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const db = await open();
    const tx = db.transaction(["documents", "summaries", "drafts"], "readonly");
    const docReq = tx.objectStore("documents").getAll();
    const sumReq = tx.objectStore("summaries").getAll();
    const draftReq = tx.objectStore("drafts").getAll();
    const docs = await new Promise((r) => (docReq.onsuccess = () => r(docReq.result)));
    const sums = await new Promise((r) => (sumReq.onsuccess = () => r(sumReq.result)));
    const drafts = await new Promise((r) => (draftReq.onsuccess = () => r(draftReq.result)));
    db.close();
    return {
      activeLargeId: localStorage.getItem("banbu-active-large-record-v1"),
      documents: docs.map((d) => ({ id: d.id, baseId: d.baseId || null, rootBaseId: d.rootBaseId || null, hasCompact: !!d.compactIndex, chunked: !!d.chunkedIndex, ops: d.operations?.length || 0 })),
      summaries: sums.map((s) => ({ id: s.id, baseId: s.baseId || null })),
      drafts: drafts.map((d) => ({ documentId: d.documentId, ops: d.operations?.length || 0 })),
    };
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      localStorage.clear();
      if (indexedDB.databases) {
        const databases = await indexedDB.databases();
        await Promise.all(databases.map((database) => database.name ? new Promise((resolve) => { const request = indexedDB.deleteDatabase(database.name); request.onsuccess = request.onerror = request.onblocked = () => resolve(); }) : Promise.resolve()));
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    // --- 导入真实大型谱 ---
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.waitForFunction(() => !document.querySelector(".import-progress"), null, { timeout: 600000 });
    await page.waitForFunction(() => Boolean(window.__banbuImportDiagnostic) || Boolean(document.querySelector(".toast")), null, { timeout: 600000 });
    await page.waitForTimeout(500);

    const importDiag = await page.evaluate(() => ({ ...(window.__banbuImportDiagnostic || {}), storage: window.__banbuStorageDiagnostic || null }));
    const idbAfterImport = await idbSnapshot();
    const diag = await page.evaluate(() => ({ ...(window.__banbuFindBranch ? window.__banbuFindBranch() : {}) }));
    const nodeCount = importDiag.nodeCount;

    const results = {};

    // --- 场景 A：大谱注释不改 compact ---
    // 定位第一个真实分叉节点
    await page.evaluate(() => window.__banbuFindBranch?.());
    await page.waitForTimeout(200);
    // 打开 编辑→注释
    await page.evaluate(() => {
      const notes = [...document.querySelectorAll(".dock-tabs button")].find((b) => b.textContent?.trim() === "编辑");
      notes?.click();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const comment = [...document.querySelectorAll(".dock-panel button")].find((b) => b.textContent?.trim() === "注释");
      comment?.click();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const textarea = document.querySelector(".sheet-body textarea");
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter.call(textarea, "GPT验收注释");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      [...document.querySelectorAll(".sheet-body .primary-button")].find((b) => b.textContent?.includes("完成"))?.click();
    });
    await page.waitForTimeout(1500);
    const idbAfterComment = await idbSnapshot();
    const diagAfterComment = await page.evaluate(() => window.__banbuFindBranch?.() || {});
    results.commentKeepsCompact = {
      nodeCountSame: diagAfterComment.nodeCount === nodeCount,
      branchSame: diagAfterComment.branchCount === diag.branchCount,
      draftWritten: idbAfterComment.drafts.some((d) => d.ops > 0),
      after: diagAfterComment,
    };
    assert(results.commentKeepsCompact.nodeCountSame, "注释后 compact 节点数变化");
    assert(results.commentKeepsCompact.branchSame, "注释后 compact 分支数变化");
    assert(results.commentKeepsCompact.draftWritten, "注释草稿未写入 IndexedDB");

    // --- 场景 B：连续新增 3 步草稿 ---
    // 从主线终点开始，确保每个新增动作都接在当前节点后面
    await page.evaluate(() => {
      document.querySelector('button[aria-label="到最后一手"]')?.click();
    });
    await page.waitForTimeout(300);
    // 每步从当前棋盘动态取空位，并在动作后断言深度、棋子和草稿均 +1。
    const addSnapshots = [];
    for (let index = 0; index < 3; index += 1) {
      const before = await snapshot();
      const beforeDraft = await idbSnapshot();
      const hit = page.locator('[role="gridcell"][aria-label$="空位"]').first();
      const label = await hit.getAttribute("aria-label");
      assert(label, `第 ${index + 1} 步没有可用空位`);
      await hit.click();
      await page.waitForTimeout(1300);
      const after = await snapshot();
      const afterDraft = await idbSnapshot();
      const beforeOps = beforeDraft.drafts.reduce((sum, item) => sum + item.ops, 0);
      const afterOps = afterDraft.drafts.reduce((sum, item) => sum + item.ops, 0);
      assert(after.depth === before.depth + 1, `第 ${index + 1} 步深度错误：${before.depth} -> ${after.depth}`);
      assert(after.stoneCount === before.stoneCount + 1, `第 ${index + 1} 步棋子数错误：${before.stoneCount} -> ${after.stoneCount}`);
      assert(afterOps === beforeOps + 1, `第 ${index + 1} 步草稿数错误：${beforeOps} -> ${afterOps}`);
      addSnapshots.push({ label, before, after, beforeOps, afterOps });
    }
    const stonesAfterAdds = (await snapshot()).stoneCount;
    const idbAfterAdds = await idbSnapshot();
    results.addThree = {
      stonesVisible: stonesAfterAdds,
      draftOps: idbAfterAdds.drafts.reduce((sum, d) => sum + d.ops, 0),
      addSnapshots,
    };
    assert(results.addThree.addSnapshots.length === 3, "没有完成三次独立新增");

    // --- 场景 C：保存后内容不消失、切到派生 ID ---
    await page.evaluate(() => {
      const save = document.querySelector('button[aria-label="保存草稿"]');
      save?.click();
    });
    await page.waitForTimeout(2000);
    const afterSave = await snapshot();
    const idbAfterSave = await idbSnapshot();
    results.save = {
      stonesAfter: afterSave.stoneCount,
      headerAfter: afterSave.header,
      documentId: idbAfterSave.activeLargeId,
      derivedExists: idbAfterSave.summaries.some((s) => s.id === idbAfterSave.activeLargeId && s.baseId),
      draftsCleared: idbAfterSave.drafts.length === 0,
    };
    assert(results.save.stonesAfter === results.addThree.stonesVisible, "保存后棋盘内容消失");
    assert(results.save.derivedExists, "保存后 active summary 不是派生版本");
    assert(results.save.draftsCleared, "保存后草稿未清理");

    // --- 场景 D：保存后刷新，仍位于派生版本 ---
    await page.reload({ waitUntil: "domcontentloaded" });
    // 逐秒检查 workspace 是否已恢复
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await page.waitForTimeout(1000);
      const title = await page.evaluate(() => document.querySelector(".workspace-current b")?.textContent || "");
      if (title && title !== "新建棋谱") break;
    }
    // 诊断：直接从浏览器检查派生版本是否能被加载
    const loadDiag = await page.evaluate(async () => {
      // 复用应用内部 loadLargeDocument 直接加载派生版本
      const dynamicImport = async (url) => {
        // 通过动态 import 应用模块（Vite 已编译）
        const mod = await import(url);
        return mod;
      };
      // 直接读取原始记录验证 compact 识别
      const open = () => new Promise((resolve, reject) => { const req = indexedDB.open("banbu-gomoku-large-library"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const db = await open();
      const tx = db.transaction("documents", "readonly");
      const activeId = localStorage.getItem("banbu-active-large-record-v1");
      const get = tx.objectStore("documents").get(activeId || "");
      const doc = await new Promise((r) => (get.onsuccess = () => r(get.result)));
      db.close();
      return { activeId, docFound: !!doc, docId: doc?.id, title: String(doc?.metadata?.title || ""), hasBaseId: !!doc?.baseId, rootBaseId: doc?.rootBaseId, ops: doc?.operations?.length };
    });
    await page.waitForTimeout(500);
    const afterReload = await snapshot();
    const idbAfterReload = await idbSnapshot();
    results.reload = {
      title: afterReload.title,
      stonesAfter: afterReload.stoneCount,
      activeLargeId: idbAfterReload.activeLargeId,
      isDerived: idbAfterReload.summaries.some((s) => s.id === idbAfterReload.activeLargeId && s.baseId),
      loadDiag,
    };
    assert(results.reload.isDerived, "刷新后 active record 不是派生版本");
    assert(results.reload.title === "雨", `刷新后标题错误：${results.reload.title}`);
    assert(results.reload.stonesAfter === results.save.stonesAfter, "刷新后棋盘内容丢失");

    // --- 场景 E：切谱草稿门禁 ---
    // 在派生版本上再新增一步，触发未保存草稿，然后尝试打开另一谱
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('.board-hit')].find((el) => (el.getAttribute('aria-label') || '').endsWith('空位'));
      if (!hit) throw new Error('没有找到可创建草稿的空位');
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForFunction(() => (document.querySelector('.topbar .brand small')?.textContent || '').includes('未保存草稿'), null, { timeout: 5000 });
    await page.waitForTimeout(700);
    // 触发切谱（打开棋谱库，展开记录文件夹，再点另一谱）
    await page.evaluate(() => {
      const libTab = [...document.querySelectorAll(".bottom-nav button")].find((b) => b.textContent?.includes("棋谱库"));
      libTab?.click();
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const folder = document.querySelector(".library-folder-head");
      if (folder && !folder.closest("section")?.querySelector(".folder-items")) folder.click();
    });
    await page.waitForTimeout(300);
    // 尝试打开原始谱（非派生）
    const hasGuardDialog = await page.evaluate(async () => {
      const articles = [...document.querySelectorAll(".record-list article")];
      const target = articles.find((a) => a.textContent?.includes("694,910")) || articles[0];
      if (target) target.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      return Boolean([...document.querySelectorAll(".sheet-body .primary-button")].find((b) => b.textContent?.includes("保存草稿并切换")));
    });
    results.switchGuard = { dialogShown: hasGuardDialog };
    assert(results.switchGuard.dialogShown, "切换棋谱未弹出草稿门禁");

    report.push({ file, nodeCount, importDiag: { nodeCount, branchCount: diag.branchCount }, idbAfterImport, results, consoleErrors });
  } catch (error) {
    report.push({ file, error: String(error), consoleErrors });
  } finally {
    await page.close();
  }
}
await browser.close();
if (report.some((item) => item.error)) process.exitCode = 1;
console.log(JSON.stringify(report, null, 2));
