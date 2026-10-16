import { openTreeInspector } from "./tree-controls.mjs";
import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaURL = new URL(baseURL); qaURL.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const metadata = (title) => ({ title, black: "黑方", white: "白方", event: "树回归", date: "2026-08-30", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] });
const active = {
  id: "tree-active", version: 1, rootId: "root", savedCurrentId: "c",
  createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:30:00.000Z", metadata: metadata("树与书签回归棋谱"),
  nodes: {
    root: { id: "root", parentId: null, children: ["a", "target"], preferredChildId: "a", move: null, comment: "", marks: [] },
    a: { id: "a", parentId: "root", children: ["b"], preferredChildId: "b", move: { row: 7, col: 7, player: "black" }, comment: "主线起点", marks: [] },
    b: { id: "b", parentId: "a", children: ["c"], preferredChildId: "c", move: { row: 7, col: 8, player: "white" }, comment: "待复制分支", boardText: "应对分支", evaluation: "good", marks: [] },
    c: { id: "c", parentId: "b", children: [], move: { row: 6, col: 7, player: "black" }, comment: "多层后续", marks: [] },
    target: { id: "target", parentId: "root", children: [], move: { row: 6, col: 6, player: "black" }, comment: "粘贴目标", marks: [] },
  },
};
const spare = {
  id: "tree-spare", version: 1, rootId: "spare-root", savedCurrentId: "spare-root",
  createdAt: "2026-08-30T09:00:00.000Z", updatedAt: "2026-08-30T09:30:00.000Z", metadata: metadata("备用棋谱"),
  nodes: { "spare-root": { id: "spare-root", parentId: null, children: [], move: null, comment: "", marks: [] } },
};

const seed = ({ activeDocument, spareDocument }) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(activeDocument));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([activeDocument, spareDocument]));
  localStorage.setItem("renju-note-branch-bookmarks-v1", JSON.stringify({ [activeDocument.id]: [{ id: "legacy", name: "旧书签标题", nodeId: "a", createdAt: "2026-08-29T08:00:00.000Z" }] }));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
};

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.setDefaultTimeout(12_000);
  await page.addInitScript(seed, { activeDocument: active, spareDocument: spare });
  await page.goto(qaURL.href, { waitUntil: "domcontentloaded" });
  await page.getByLabel("当前工作状态").first().waitFor().catch(async (error) => {
    const diagnostics = await page.evaluate(() => ({ url: location.href, body: document.body.innerText, html: document.body.innerHTML.slice(0, 1000) }));
    throw new Error(`${error.message}\n${JSON.stringify({ diagnostics, errors })}`);
  });
  assert(await page.getByRole("dialog", { name: "分支树" }).count() === 0, "棋谱树首次进入不应默认展开");
  assert((await page.getByLabel("当前工作状态").first().textContent())?.includes("第 3 手"), "顶部状态区没有显示当前手数");
  assert((await page.getByLabel("当前工作状态").first().textContent())?.includes("白方落子"), "顶部状态区没有显示下一方");

  if (!await page.getByRole("button", { name: "打开分支树" }).isVisible()) await page.getByRole("button", { name: "行棋" }).click();
  await page.getByRole("button", { name: "打开分支树" }).click();
  const dialog = page.getByRole("dialog", { name: "分支树" });
  await dialog.getByRole("tab", { name: /图谱/ }).click();
  await dialog.waitFor();
  await openTreeInspector(dialog);

  /**
   * 打开图谱时画面默认对准「当前手」（用户 09-20），所以别的节点可能在可视区外、
   * 点不到。这里先拖动画布把目标节点带进视野——顺便也是在测拖动本身。
   */
  const panToNode = async (labelPrefix) => {
    const delta = await dialog.evaluate((element, prefix) => {
      const viewport = element.querySelector(".tree-viewport")?.getBoundingClientRect();
      const node = [...element.querySelectorAll(".tree-node")].find((item) => (item.getAttribute("aria-label") || "").startsWith(prefix));
      if (!viewport || !node) return null;
      const box = node.getBoundingClientRect();
      return {
        dx: (box.left + box.right) / 2 - (viewport.left + viewport.right) / 2,
        dy: (box.top + box.bottom) / 2 - (viewport.top + viewport.bottom) / 2,
        cx: viewport.left + viewport.width / 2,
        cy: viewport.top + viewport.height / 2,
      };
    }, labelPrefix);
    if (!delta) throw new Error(`panToNode：找不到 ${labelPrefix}`);
    await page.mouse.move(delta.cx, delta.cy);
    await page.mouse.down();
    await page.mouse.move(delta.cx - delta.dx, delta.cy - delta.dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };

  await panToNode("应对分支");
  await dialog.getByRole("button", { name: /^应对分支/ }).click();
  await dialog.getByLabel("节点操作 应对分支").waitFor();
  await dialog.getByRole("button", { name: "复制分支" }).click();
  // target(G9) 默认是收着的（用户 09-22：默认只有当前路径 + 主分支，次分支一个都不露），
  // 先在 root 上「展开下一层」把它露出来再粘贴。
  await panToNode("起始局面");
  await dialog.getByRole("button", { name: /^起始局面/ }).click();
  await dialog.getByLabel(/^节点操作 起始局面/).waitFor();
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(140);
  await panToNode("G9");
  await dialog.getByRole("button", { name: /^G9/ }).click();
  await dialog.getByLabel("节点操作 G9").waitFor();
  await dialog.getByRole("button", { name: "粘贴到这里" }).click();
  await page.getByText(/已粘贴 2 个节点/).waitFor().catch(async (error) => {
    const diagnostics = await page.evaluate(() => ({ toast: document.querySelector(".toast")?.textContent || "", dialog: document.querySelector('[role="dialog"]')?.textContent || "" }));
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics)}`);
  });
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("renju-note-draft-v2:tree-active") || "{}"));
  const subtreeOperation = draft.operations?.find((operation) => operation.type === "add-subtree");
  assert(subtreeOperation && Object.keys(subtreeOperation.nodes).length === 2, "粘贴没有记录为单条原子子树草稿");
  assert(!Object.keys(subtreeOperation.nodes).some((id) => ["b", "c"].includes(id)), "粘贴节点复用了原节点 ID");

  await dialog.getByRole("button", { name: "加书签" }).click();
  await dialog.getByRole("tab", { name: /书签/ }).click();
  await dialog.getByRole("button", { name: /编辑书签/ }).last().click();
  await dialog.getByRole("textbox", { name: "标题", exact: true }).fill("复制后的研究点");
  await dialog.getByRole("textbox", { name: "备注", exact: true }).fill("检查主变化与冲突处理");
  await dialog.getByRole("button", { name: /保存/ }).click();
  await dialog.getByLabel("搜索书签").fill("冲突处理");
  await dialog.getByText("复制后的研究点", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "复制后的研究点 检查主变化与冲突处理", exact: true }).click();
  assert(await page.getByRole("dialog", { name: "分支树" }).count() === 0, "书签跳转后棋谱树没有关闭");

  if (!await page.getByRole("button", { name: "打开分支树" }).isVisible()) await page.getByRole("button", { name: "行棋" }).click();
  await page.getByRole("button", { name: "打开分支树" }).click();
  const reopened = page.getByRole("dialog", { name: "分支树" });
  await reopened.getByRole("tab", { name: /图谱/ }).click();
  await openTreeInspector(reopened);
  // 默认视野会同时画出「当前路径 + 一条最长分支」，所以上面粘贴出来的副本（同样带 boardText
  // 「应对分支」）和原节点会同时出现。副本此刻是当前局面，无障碍名多出「，当前局面，已选中」，
  // 于是按精确名定位原节点，不要再退回前缀匹配。
  await panToNode("应对分支");
  await reopened.locator('.tree-node[aria-label="应对分支"]').click();
  await reopened.getByLabel("节点操作 应对分支").waitFor();
  await reopened.getByRole("button", { name: "复制分支" }).click();
  await panToNode("H8");
  await reopened.getByRole("button", { name: /^H8/ }).click();
  await reopened.getByLabel("节点操作 H8").waitFor();
  await reopened.getByRole("button", { name: "粘贴到这里" }).click();
  await page.getByText("目标节点下已经有相同着法，未覆盖原分支", { exact: true }).waitFor();
  await page.keyboard.press("Escape");

  if (errors.length) throw new Error(errors.join("\n"));
  await context.close();

  const visualCases = [
    { name: "360", width: 360, height: 800 },
    { name: "390", width: 390, height: 844 },
    { name: "412", width: 412, height: 915 },
    { name: "landscape", width: 844, height: 390 },
    { name: "dark", width: 390, height: 844, colorScheme: "dark" },
    { name: "reduced", width: 390, height: 844, reducedMotion: "reduce" },
  ];
  const visualResults = [];
  for (const item of visualCases) {
    const visualContext = await browser.newContext({ viewport: { width: item.width, height: item.height }, isMobile: item.width < 700, hasTouch: true, colorScheme: item.colorScheme || "light", reducedMotion: item.reducedMotion || "no-preference", serviceWorkers: "block" });
    const visualPage = await visualContext.newPage();
    await visualPage.addInitScript(seed, { activeDocument: active, spareDocument: spare });
    await visualPage.goto(qaURL.href, { waitUntil: "domcontentloaded" });
    if (!await visualPage.getByRole("button", { name: "打开分支树" }).isVisible()) await visualPage.getByRole("button", { name: "行棋" }).click();
    await visualPage.getByRole("button", { name: "打开分支树" }).click();
    await visualPage.getByRole("dialog", { name: "分支树" }).waitFor();
    await openTreeInspector(visualPage.getByRole("dialog", { name: "分支树" }));
    await visualPage.waitForTimeout(item.reducedMotion ? 40 : 320);
    const metrics = await visualPage.evaluate(() => {
      const status = document.querySelector(".unified-status")?.getBoundingClientRect();
      const sheet = document.querySelector(".bottom-sheet")?.getBoundingClientRect();
      const actionButtons = [...document.querySelectorAll(".tree-node-action-grid button")].map((button) => button.getBoundingClientRect());
      const modeButtons = [...document.querySelectorAll(".topbar .topbar-mode-toggle button")].map((button) => ({ rect: button.getBoundingClientRect(), fontSize: Number.parseFloat(getComputedStyle(button).fontSize) }));
      return { scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, viewportHeight: innerHeight, status: status && { left: status.left, right: status.right, top: status.top, bottom: status.bottom }, sheet: sheet && { top: sheet.top, bottom: sheet.bottom }, minAction: actionButtons.length ? Math.min(...actionButtons.map((rect) => Math.min(rect.width, rect.height))) : 0, minModeHeight: modeButtons.length ? Math.min(...modeButtons.map((item) => item.rect.height)) : 0, minModeFont: modeButtons.length ? Math.min(...modeButtons.map((item) => item.fontSize)) : 0, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
    });
    assert(metrics.scrollWidth <= item.width + 1, `${item.name} 出现横向溢出`);
    assert(metrics.status && metrics.status.left >= -1 && metrics.status.right <= item.width + 1, `${item.name} 顶部状态区越界`);
    if (item.width < 700 && item.name !== "landscape") assert(metrics.status.bottom - metrics.status.top <= 110, `${item.name} 顶部状态区过高：${metrics.status.bottom - metrics.status.top}px`);
    assert(metrics.sheet && metrics.sheet.top >= -1 && metrics.sheet.bottom <= metrics.viewportHeight + 1, `${item.name} 棋谱树 Sheet 越界：${JSON.stringify(metrics.sheet)}`);
    assert(metrics.minAction >= 44, `${item.name} 棋谱树触控目标小于 44px`);
    assert(metrics.minModeHeight >= 44, `${item.name} 核心模式按钮高度小于 44px`);
    assert(metrics.minModeFont >= 11, `${item.name} 核心模式按钮字号过小`);
    if (item.name === "reduced") assert(metrics.reduced, "减少动效媒体条件未生效");
    visualResults.push({ name: item.name, ...metrics });
    await visualContext.close();
  }

  const switchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const switchPage = await switchContext.newPage();
  await switchPage.addInitScript(seed, { activeDocument: active, spareDocument: spare });
  await switchPage.goto(qaURL.href, { waitUntil: "domcontentloaded" });
  const boardTopBeforeSelector = (await switchPage.locator(".renju-board").boundingBox())?.y;
  await switchPage.getByRole("button", { name: /切换棋谱/ }).click();
  const recordSelector = switchPage.getByRole("dialog", { name: "选择棋谱" });
  await recordSelector.waitFor();
  const folderButton = recordSelector.getByRole("button", { name: /未分类 2 份/ });
  assert(await folderButton.getAttribute("aria-expanded") === "true", "棋谱选择器应默认展开当前棋谱所在文件夹");
  await folderButton.click();
  assert(await folderButton.getAttribute("aria-expanded") === "false", "棋谱选择器文件夹无法折叠");
  await folderButton.click();
  assert(await folderButton.getAttribute("aria-expanded") === "true", "棋谱选择器文件夹无法展开");
  const boardTopDuringSelector = (await switchPage.locator(".renju-board").boundingBox())?.y;
  assert(Math.abs((boardTopDuringSelector || 0) - (boardTopBeforeSelector || 0)) <= 0.5, "棋谱选择器打开后挤动了棋盘");
  await recordSelector.getByRole("option", { name: /备用棋谱/ }).click();
  await switchPage.getByText("备用棋谱", { exact: true }).first().waitFor();
  assert(await switchPage.getByRole("dialog", { name: "分支树" }).count() === 0, "切换棋谱后棋谱树不应自动展开");
  await switchContext.close();

  console.log(JSON.stringify({ pass: true, currentFolderExpanded: true, atomicPaste: true, bookmarkMigrationEditSearchJump: true, duplicateRejected: true, visualResults }, null, 2));
} finally {
  await browser.close();
}
