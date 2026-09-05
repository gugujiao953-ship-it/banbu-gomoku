import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/?qa=1";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const now = "2026-09-04T00:00:00.000Z";
const record = {
  id: "annotation-mode-regression",
  version: 1,
  rootId: "root",
  savedCurrentId: "n1",
  createdAt: now,
  updatedAt: now,
  metadata: { title: "标注独立模式", black: "黑方", white: "白方", event: "", date: "2026-09-04", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] },
  nodes: {
    root: { id: "root", parentId: null, children: ["n1"], move: null, comment: "", marks: [], preferredChildId: "n1" },
    n1: { id: "n1", parentId: "root", children: ["n2", "n2-alt"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [], preferredChildId: "n2" },
    n2: { id: "n2", parentId: "n1", children: ["n3"], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [], preferredChildId: "n3" },
    "n2-alt": { id: "n2-alt", parentId: "n1", children: [], move: { row: 6, col: 7, player: "white" }, comment: "", marks: [] },
    n3: { id: "n3", parentId: "n2", children: [], move: { row: 8, col: 8, player: "black" }, comment: "", marks: [] },
  },
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await context.addInitScript(({ record }) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(record));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([record]));
  localStorage.setItem("banbu-last-session-v1", JSON.stringify({ documentId: record.id, nodeId: "n1", mode: "record", updatedAt: new Date().toISOString() }));
}, { record });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("grid", { name: "15路五子棋棋盘" }).waitFor();
  const marksButton = page.locator(".dock-tabs").getByRole("button", { name: "标注", exact: true });
  const commandBar = page.getByLabel("常驻打谱工具");
  const movesRow = page.getByLabel("走棋导航");
  // 走棋导航常驻在打谱工具栏下方，标注作为底部功能栏的一个标签页。
  assert(await movesRow.count() === 1, "走棋导航没有常驻显示");
  assert(await page.getByRole("button", { name: "下一手" }).count() >= 1, "走棋导航缺少下一手按钮");
  const commandLabels = await commandBar.locator(":scope > button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  assert(commandLabels[0]?.startsWith("收起注释"), "常驻栏首个按钮不是注释");
  assert(!commandLabels.includes("标注"), "命令栏仍保留了标注入口（应已移入底部功能栏）");
  assert(commandLabels.length === 5, `常驻栏独立按钮数量错误：${commandLabels.length}`);
  assert(await marksButton.count() === 1, "底部功能栏没有标注入口");
  assert(await page.locator(".dock-tabs").getByRole("button", { name: "行棋" }).count() === 0, "底部功能栏仍保留走棋入口（应已常驻到走棋导航区）");
  assert(await page.locator(".dock-tabs").getByRole("button", { name: "打开分支树" }).count() === 1, "底部功能栏没有分支树入口");
  const initialCommentTop = await page.locator(".comment-review").evaluate((element) => element.getBoundingClientRect().top);
  await marksButton.click();

  // 标注面板在底部功能栏内展开（dock-panel-annotation），走棋导航仍然常驻。
  const annotationStudio = page.locator(".dock-panel-annotation .mark-studio");
  await annotationStudio.waitFor();
  assert(await movesRow.count() === 1, "打开标注后走棋导航被收纳（应常驻）");
  const stackedMetrics = await page.evaluate(() => {
    const comment = document.querySelector(".comment-review")?.getBoundingClientRect();
    const moves = document.querySelector(".moves-row")?.getBoundingClientRect();
    const studio = document.querySelector(".dock-panel-annotation .mark-studio")?.getBoundingClientRect();
    const dock = document.querySelector(".context-dock")?.getBoundingClientRect();
    return { comment: comment && { top: comment.top, bottom: comment.bottom, height: comment.height }, moves: moves && { top: moves.top, bottom: moves.bottom, height: moves.height }, studio: studio && { top: studio.top, bottom: studio.bottom, height: studio.height }, dock: dock && { top: dock.top } };
  });
  assert(stackedMetrics.comment && stackedMetrics.moves && stackedMetrics.studio && stackedMetrics.dock, "注释、走棋导航、标注或功能栏没有渲染");
  assert(stackedMetrics.moves.top >= stackedMetrics.comment.bottom - 2, "走棋导航没有放在注释框下方");
  assert(stackedMetrics.studio.top >= stackedMetrics.dock.top - 2, "标注面板没有出现在底部功能栏内");

  await commandBar.locator(":scope > button").first().click();
  assert(await page.locator(".comment-review").count() === 0, "注释按钮未能关闭注释框");
  // 关闭注释后，走棋导航与标注面板仍然常驻/在位（不互相收纳）。
  assert(await movesRow.count() === 1, "关闭注释后走棋导航被收纳");
  assert(await page.locator(".dock-panel-annotation .mark-studio").count() === 1, "关闭注释后标注面板被收纳");
  await commandBar.locator(":scope > button").first().click();
  await page.locator(".comment-review").waitFor();

  assert(await page.getByRole("button", { name: /去标注模式/ }).count() === 0, "去标注模式入口仍然存在");
  assert(await page.getByRole("dialog", { name: "确认去标注" }).count() === 0, "去标注确认框仍然存在");

  const annotationLayer = page.locator(".board-annotation-layer");
  const visibleMarks = () => annotationLayer.locator(":scope > *").count();
  const branchPoint = page.getByRole("gridcell", { name: "切换到变化 I8" });

  // In annotation mode the branch point is edited on n1 instead of navigating
  // to n2. A second tap with the same mark removes it through setLabelMark.
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 1);
  assert(await page.locator(".stone-piece").count() === 1, "点击分支点标注时错误进入了分支");
  assert(await page.locator('.renlib-variation[data-node-id="n2"]').count() === 1, "标注分支点后分支入口消失");
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 0);
  assert(await page.locator(".stone-piece").count() === 1, "再次点击移除标注时错误进入了分支");

  // Re-add the branch-point mark, leave annotation mode, and verify ordinary
  // navigation still works. The mark belongs only to n1 and must not leak to n2.
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 1);
  await marksButton.click();
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".stone-piece").length === 2);
  assert(await visibleMarks() === 0, "n1 的标注泄漏到了子分支节点 n2");
  // 走棋导航常驻，上一手可直接点击。
  await page.getByRole("button", { name: "上一手" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".stone-piece").length === 1);
  assert(await visibleMarks() === 1, "返回 n1 后当前局面的标注丢失");

  await marksButton.click();
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 0);

  // Occupied points are also part of this independent editing mode and cannot
  // be mistaken for an attempted move.
  const occupiedPoint = page.getByRole("gridcell", { name: "H8已有棋子" });
  await occupiedPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 1);
  assert(await page.locator(".stone-piece").count() === 1, "标注已有棋子时局面发生变化");
  await occupiedPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 0);

  await page.getByRole("gridcell", { name: "J8空位" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 1);
  await page.waitForTimeout(700);
  const persisted = await page.evaluate((recordId) => ({
    active: JSON.parse(localStorage.getItem("renju-note-active-v1") || "null"),
    draft: JSON.parse(localStorage.getItem(`renju-note-draft-v2:${recordId}`) || "null"),
    session: JSON.parse(localStorage.getItem("banbu-last-session-v1") || "null"),
    erasePreference: localStorage.getItem("banbu-annotation-erase-confirmation-v1"),
  }), record.id);
  assert(persisted.active.nodes.n1.children.join(",") === "n2,n2-alt", "源棋谱分支列表被改写");
  assert(persisted.active.nodes.n2.children.join(",") === "n3", "源棋谱分支后代被改写");
  assert(persisted.active.nodes.n1.marks.length === 0, "未保存标注草稿错误写回了源棋谱");
  assert(persisted.session.nodeId === "n1", "完成标注回归后没有停在原节点");
  assert(persisted.erasePreference === null, "已移除的去标注偏好仍被写入");
  assert(persisted.draft.operations.length >= 1, "标注没有形成节点草稿补丁");
  assert(persisted.draft.operations.every((operation) => operation.type === "update-node" && operation.nodeId === "n1" && Object.keys(operation.patch).join(",") === "marks"), "标注草稿包含 marks 以外的数据修改");
  assert(persisted.draft.operations.at(-1).patch.marks.length === 1, "最终当前局面标注没有保存在草稿中");

  // Review mode uses the same interaction priority, but stores marks only in
  // the document+node scoped local review store.
  await marksButton.click();
  await page.getByRole("tab", { name: "读谱模式" }).click();
  await marksButton.click();
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 1);
  assert(await page.locator(".stone-piece").count() === 1, "读谱标注分支点时错误进入了分支");
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 0);
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".board-annotation-layer > *").length === 1);
  await marksButton.click();
  await branchPoint.click();
  await page.waitForFunction(() => document.querySelectorAll(".stone-piece").length === 2);
  assert(await visibleMarks() === 0, "读谱本机标注泄漏到了子分支节点");
  await page.getByRole("button", { name: "上一手" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".stone-piece").length === 1);
  assert(await visibleMarks() === 1, "返回原局面后读谱本机标注丢失");
  await page.waitForTimeout(100);
  const reviewStore = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-review-marks-v1") || "{}"));
  assert(Object.keys(reviewStore).join(",") === `${record.id}:n1`, "读谱标注没有按文档和当前节点隔离");
  assert(reviewStore[`${record.id}:n1`].length === 1, "读谱本机标注数量错误");

  const responsiveResults = [];
  for (const viewport of [{ width: 320, height: 700 }, { width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 900 }]) {
    await page.setViewportSize(viewport);
    if (await marksButton.getAttribute("aria-pressed") !== "true") await marksButton.click();
    const metrics = await page.evaluate(() => {
      const bar = document.querySelector(".record-command-bar");
      const comment = document.querySelector(".comment-review")?.getBoundingClientRect();
      const moves = document.querySelector(".moves-row")?.getBoundingClientRect();
      const studio = document.querySelector(".dock-panel-annotation .mark-studio")?.getBoundingClientRect();
      const dock = document.querySelector(".context-dock")?.getBoundingClientRect();
      const buttons = [...document.querySelectorAll(".record-command-bar > button")].map((button) => button.getBoundingClientRect());
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        barClientWidth: bar?.clientWidth || 0,
        barScrollWidth: bar?.scrollWidth || 0,
        buttonCount: buttons.length,
        minButtonHeight: Math.min(...buttons.map((rect) => rect.height)),
        maxButtonHeight: Math.max(...buttons.map((rect) => rect.height)),
        left: Math.min(...buttons.map((rect) => rect.left)),
        right: Math.max(...buttons.map((rect) => rect.right)),
        movesHeight: moves?.height || 0,
        studioHeight: studio?.height || 0,
        commentHeight: comment?.height || 0,
        coreBottom: dock?.bottom || 0,
        viewportHeight: innerHeight,
      };
    });
    assert(metrics.scrollWidth <= metrics.viewport + 1, `${viewport.width}px 出现页面横向溢出`);
    assert(metrics.barScrollWidth <= metrics.barClientWidth + 1, `${viewport.width}px 常驻按钮行发生横向溢出`);
    assert(metrics.buttonCount === 5, `${viewport.width}px 常驻按钮数量错误`);
    assert(metrics.minButtonHeight >= 40 && metrics.maxButtonHeight <= 46, `${viewport.width}px 常驻按钮高度不在 40–46px：${metrics.minButtonHeight}–${metrics.maxButtonHeight}`);
    assert(metrics.left >= -1 && metrics.right <= viewport.width + 1, `${viewport.width}px 常驻按钮越出屏幕`);
    // 走棋导航常驻、标注面板展开，且三者（注释/走棋/标注+功能栏）同屏不横向溢出。
    assert(metrics.movesHeight > 0 && metrics.studioHeight > 0 && metrics.commentHeight > 0, `${viewport.width}px 注释/走棋/标注三者未同时渲染`);
    responsiveResults.push({ width: viewport.width, ...metrics });
    await marksButton.click();
  }
  assert(pageErrors.length === 0, `页面出现异常：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({ pass: true, commandBarReflowed: true, annotationBelowComment: true, annotationReplacesClosedComment: true, treeMovedToDockTab: true, branchPointAnnotated: true, branchNavigationPreserved: true, nodeLocal: true, reviewLocalOnly: true, secondTapRemoves: true, eraseModeRemoved: true, responsiveResults }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
