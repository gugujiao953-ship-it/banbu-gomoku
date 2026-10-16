import { openTreeInspector, chooseTreeZoom } from "./tree-controls.mjs";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const url = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:5173/");
url.searchParams.set("qa", "1");
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const record = {
  id: "tree-navigation-qa", version: 1, rootId: "root", savedCurrentId: "root",
  metadata: { title: "大谱分层浏览回归", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", nodes: {},
};
record.nodes.root = { id: "root", parentId: null, children: [], preferredChildId: "b20", move: null, comment: "", marks: [] };
for (let i = 1; i <= 29; i += 1) {
  const id = `b${i}`, point = { row: Math.floor((i - 1) / 15), col: (i - 1) % 15, player: "black" };
  record.nodes.root.children.push(id);
  record.nodes[id] = { id, parentId: "root", children: [], move: point, boardText: `候选${i}`, comment: i === 29 ? "最后一支的完整注释，用于验证候选没有被图谱显示预算截断。" : "", marks: [] };
  for (let j = 1; j <= 18; j += 1) {
    const childId = `${id}-r${j}`;
    record.nodes[id].children.push(childId);
    record.nodes[childId] = { id: childId, parentId: id, children: [], move: { row: 3 + Math.floor((j - 1) / 15), col: (j - 1) % 15, player: "white" }, boardText: `应对${j}`, comment: "", marks: [] };
  }
}
const seed = (doc) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(doc));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([doc]));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ coachMarks: false, gestureSwipe: false, gestureZoom: false }));
};
const browser = await chromium.launch({ headless: true });
const output = [];
try {
  await mkdir("qa/screenshots/tree-navigation", { recursive: true });
  for (const viewport of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.addInitScript(seed, record);
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "打开分支树" }).click();
    const dialog = page.getByRole("dialog", { name: "分支树" });
    await dialog.getByRole("tab", { name: "图谱" }).click();
    await openTreeInspector(dialog);
    assert(await dialog.locator('.tree-node[aria-label^="候选20"]').count() === 1, "页外主分支没有显示");
    await dialog.getByRole("button", { name: "展开下一层", exact: true }).click();
    assert(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes") === "31", "第29支未纳入展开范围");
    await dialog.getByRole("button", { name: "展开下一层", exact: true }).click();
    assert(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes") === "552", "展开范围仍被240节点截断");
    assert(await dialog.locator(".tree-node").count() < 100, "屏幕外节点没有裁剪");
    assert(await dialog.locator(".tree-window-note").count() === 0, "完整棋谱不应显示截断提示");
    await page.waitForFunction(() => { const svg = document.querySelector(".tree-canvas"); return Math.abs(svg.viewBox.baseVal.width - svg.closest(".tree-viewport").clientWidth) <= 1; }).catch(async (error) => {
      const sizing = await dialog.locator(".tree-canvas").evaluate((svg) => {
        const canvas = svg.closest(".tree-viewport"), sheet = svg.closest(".bottom-sheet");
        return { viewBox: svg.getAttribute("viewBox"), canvas: { width: canvas.clientWidth, height: canvas.clientHeight }, sheet: { client: sheet.clientHeight, scroll: sheet.scrollHeight } };
      });
      console.error(JSON.stringify({ viewport, sizing }));
      await page.screenshot({ path: `qa/screenshots/tree-navigation/sizing-failure-${viewport.width}x${viewport.height}.png` });
      throw error;
    });
    const titleSize = await dialog.locator('.tree-node[aria-label^="起始局面"] .tree-node-label').evaluate((element) => {
      const matrix = element.getScreenCTM();
      return Number.parseFloat(getComputedStyle(element).fontSize) * Math.hypot(matrix.a, matrix.b);
    });
    assert(titleSize >= 10, `100% 时标题字号不应被手机视口缩小：${titleSize}`);
    const normalHeight = await dialog.locator(".tree-viewport").evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.clientHeight)))));
    await dialog.getByRole("button", { name: "放大图谱", exact: true }).click();
    await page.waitForFunction((height) => document.querySelector(".tree-viewport").clientHeight >= height, normalHeight);
    assert(await dialog.locator(".tree-node-actions").isHidden(), "放大图谱仍占用编辑操作空间");
    const map = dialog.getByRole("button", { name: "图谱小地图，点按移动视野，方向键平移" });
    const graphTransform = () => dialog.locator(".tree-canvas > g").getAttribute("transform");
    const beforeMap = await graphTransform();
    await map.click({ position: { x: 35, y: 55 } });
    assert(await graphTransform() !== beforeMap, "小地图点击没有移动视野");
    await map.press("ArrowDown");
    assert(await graphTransform() !== beforeMap, "小地图方向键没有移动视野");
    const geometry = await dialog.locator(".tree-node").evaluateAll((nodes) => {
      const points = nodes.map((node) => { const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute("transform")); return { x: Number(m[1]), y: Number(m[2]), w: Number(node.querySelector("rect").getAttribute("width")) }; });
      return points.every((a, i) => points.slice(i + 1).every((b) => Math.abs(a.y - b.y) >= 44 || a.x + a.w <= b.x || b.x + b.w <= a.x));
    });
    assert(geometry, "大图谱存在节点重叠");
    await dialog.getByRole("button", { name: "分区总览", exact: true }).click();
    assert(await dialog.locator(".tree-viewport").getAttribute("data-display") === "atlas", "分区总览没有切换");
    assert(await dialog.locator(".tree-atlas-region").count() > 0, "分区总览没有变化卡片");
    await dialog.getByRole("button", { name: "切换逐手图谱", exact: true }).click();
    assert(await dialog.locator(".tree-viewport").getAttribute("data-display") !== "atlas", "逐手图谱没有恢复");
    await dialog.getByRole("button", { name: "总览全部已展开分支", exact: true }).click();
    assert(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes") === "552", "缩放总览丢失节点");
    const overviewCheck = await dialog.evaluate((element) => {
      const hint = element.querySelector(".tree-structure-hint")?.getBoundingClientRect();
      const current = element.querySelector(".tree-node.current").getBoundingClientRect();
      return { mode: element.querySelector(".tree-viewport").getAttribute("data-display"), labels: element.querySelectorAll(".tree-node-label, .tree-chain-label, .tree-compact-label").length,
        transparent: [...element.querySelectorAll(".tree-structure-hit")].every((hit) => ["transparent", "rgba(0, 0, 0, 0)"].includes(getComputedStyle(hit).fill)),
        hintClear: !hint || current.right <= hint.left || current.left >= hint.right || current.bottom <= hint.top || current.top >= hint.bottom };
    });
    assert(overviewCheck.transparent && overviewCheck.hintClear, `结构总览被点击区或提示遮挡：${JSON.stringify(overviewCheck)}`);
    if (overviewCheck.mode === "detail") assert(overviewCheck.labels > 0, "细节模式总览应保留文字");
    await page.screenshot({ path: `qa/screenshots/tree-navigation/graph-${viewport.width}x${viewport.height}.png` });
    for (const preset of ["50%", "20%"]) {
      await chooseTreeZoom(dialog, preset);
      assert(await dialog.locator(".tree-viewport").getAttribute("data-display") === "detail", `${preset} 不应隐藏逐手细节`);
      assert(await dialog.locator(".tree-node-label, .tree-chain-label, .tree-compact-label").count() > 0, `${preset} 丢失文字`);
      assert(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes") === "552", `${preset} 丢失节点`);
    }
    await dialog.getByRole("button", { name: "退出放大图谱", exact: true }).click();
    assert(await dialog.locator(".tree-node-actions").isVisible(), "退出放大图谱后丢失节点编辑操作");
    await dialog.getByRole("tab", { name: "导航", exact: true }).click();
    assert(await dialog.locator(".tree-navigator-row").count() === 16, "导航首页不是16个候选");
    assert(await dialog.locator(".tree-preview-candidate").count() === 16, "棋盘候选与第一页不一致");
    await dialog.getByRole("button", { name: "下一页", exact: true }).click();
    assert(await dialog.locator(".tree-navigator-paging [role=status]").innerText() === "17–29 / 29 支", "第二页范围不正确");
    await dialog.getByRole("button", { name: /落点 .*，候选 29$/ }).click();
    assert((await dialog.locator(".tree-navigator-heading").innerText()).includes("18 个后续"), "没有进入第29支");
    assert(await dialog.getByRole("button", { name: "下一支", exact: true }).isDisabled(), "最后一支不应继续循环");
    await dialog.getByRole("button", { name: "上一支", exact: true }).click();
    assert((await dialog.locator(".tree-navigator-heading").innerText()).includes("候选28"), "同层上一支不正确");
    await dialog.getByRole("button", { name: "下一支", exact: true }).click();
    await dialog.getByRole("button", { name: "下一页", exact: true }).click();
    await dialog.getByRole("button", { name: /^查看分支 .* 应对18$/ }).click();
    assert(await dialog.locator(".tree-navigator-empty").isVisible(), "末端状态不准确");
    assert(await dialog.locator(".tree-preview-board .stone").count() === 2, "导航预览不是所选局面");
    await dialog.getByRole("button", { name: "返回分叉", exact: true }).click();
    assert(await dialog.locator(".tree-navigator-paging [role=status]").innerText() === "17–18 / 18 支", "返回父分叉丢失页码");
    await dialog.getByRole("button", { name: "上一层", exact: true }).click();
    assert(await dialog.locator(".tree-navigator-paging [role=status]").innerText() === "17–29 / 29 支", "返回根分叉丢失页码");
    await dialog.getByRole("button", { name: /^查看分支 .* 候选29$/ }).click();
    await dialog.getByRole("button", { name: /^查看分支 .* 应对18$/ }).click();
    const overflow = await dialog.evaluate((element) => {
      const nav = element.querySelector(".tree-navigator");
      const tabs = element.querySelector(".record-tree-tabs");
      return { nav: nav.scrollWidth - nav.clientWidth, tabs: tabs.scrollWidth - tabs.clientWidth, page: document.documentElement.scrollWidth - innerWidth };
    });
    assert(Object.values(overflow).every((value) => value <= 2), `布局横向溢出：${JSON.stringify(overflow)}`);
    // Screenshot with a full candidate page as well as the selected board preview.
    await dialog.getByRole("button", { name: "上一层", exact: true }).click();
    await page.screenshot({ path: `qa/screenshots/tree-navigation/${viewport.width}x${viewport.height}.png` });
    await dialog.getByRole("button", { name: /^查看分支 .* 应对18$/ }).click();
    await dialog.getByRole("button", { name: "在图谱查看", exact: true }).click();
    assert(await dialog.locator('.tree-node.selected[aria-label^="应对18"]').count() === 1, "页外选中节点没有带回图谱");
    const visible = await dialog.locator(".tree-node.selected").evaluate((element) => {
      const rect = element.getBoundingClientRect(), viewportRect = element.closest(".tree-viewport").getBoundingClientRect();
      return rect.right > viewportRect.left && rect.left < viewportRect.right && rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
    });
    assert(visible, "带回图谱的选中节点仍在视野外");
    await dialog.getByRole("button", { name: "定位", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert((await page.getByLabel("当前工作状态").first().innerText()).includes("第 2 手"), "定位没有更新主棋盘");
    assert(errors.length === 0, `浏览器运行错误：${errors.join("; ")}`);
    output.push({ viewport, pass: true, nodes: Object.keys(record.nodes).length, overflow });
    await context.close();
  }

  // A smaller nested fork keeps every SVG node/edge available for checking
  // the actual rendered routes, alongside the large-tree clipping checks above.
  const nested = structuredClone(record);
  nested.id = "tree-nested-layout-qa";
  nested.nodes = { root: { ...nested.nodes.root, children: [], preferredChildId: "b5" } };
  for (let i = 1; i <= 8; i += 1) {
    const id = `b${i}`;
    nested.nodes.root.children.push(id);
    nested.nodes[id] = { ...record.nodes[id], children: [] };
    for (let j = 1; j <= 6; j += 1) {
      const childId = `${id}-r${j}`;
      nested.nodes[id].children.push(childId);
      nested.nodes[childId] = { ...record.nodes[childId], boardText: `应对${i}-${j}`, children: [] };
      if ((i + j) % 3 === 0) {
        const tailId = `${childId}-end`;
        nested.nodes[childId].children.push(tailId);
        nested.nodes[tailId] = { id: tailId, parentId: childId, children: [], move: { row: 8, col: 8, player: "black" }, comment: "", marks: [] };
      }
    }
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const nestedErrors = [];
  page.on("pageerror", (error) => nestedErrors.push(error.message));
  await page.addInitScript(seed, nested);
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "打开分支树" }).click();
  const dialog = page.getByRole("dialog", { name: "分支树" });
  await openTreeInspector(dialog);
  await dialog.locator(".tree-node-action-grid").getByRole("button", { name: "展开全部", exact: true }).click();
  const layoutCheck = await dialog.evaluate((element) => {
    const boxes = [...element.querySelectorAll(".tree-node")].map((node) => {
      const values = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute("transform"));
      return { label: node.getAttribute("aria-label").split("，")[0], x: Number(values[1]), y: Number(values[2]), w: Number(node.querySelector("rect").getAttribute("width")), h: 44 };
    });
    const overlap = boxes.some((a, i) => boxes.slice(i + 1).some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y));
    let crossings = 0, disconnected = 0;
    const edges = [...element.querySelectorAll(".tree-edge")];
    for (const edge of edges) {
      const tokens = edge.getAttribute("d").match(/[MHV]|-?\d+(?:\.\d+)?/g);
      const points = [];
      let point = { x: 0, y: 0 };
      for (let i = 0; i < tokens.length;) {
        const cmd = tokens[i++];
        point = cmd === "M" ? { x: Number(tokens[i++]), y: Number(tokens[i++]) }
          : cmd === "H" ? { ...point, x: Number(tokens[i++]) } : { ...point, y: Number(tokens[i++]) };
        points.push(point);
      }
      const first = points[0], last = points.at(-1);
      if (!boxes.some((box) => box.x + box.w === first.x && box.y + 22 === first.y)
        || !boxes.some((box) => box.x === last.x && box.y + 22 === last.y)) disconnected += 1;
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1], b = points[i];
        for (const box of boxes) {
          if (a.y === b.y
            ? a.y > box.y && a.y < box.y + box.h && Math.min(a.x, b.x) < box.x + box.w && Math.max(a.x, b.x) > box.x
            : a.x > box.x && a.x < box.x + box.w && Math.min(a.y, b.y) < box.y + box.h && Math.max(a.y, b.y) > box.y) crossings += 1;
        }
      }
    }
    const candidates = boxes.filter((box) => /^候选\d+$/.test(box.label));
    return { nodes: boxes.length, edges: edges.length, columns: new Set(candidates.map((box) => box.x)).size, overlap, crossings, disconnected,
      mainLineHorizontal: boxes.find((box) => box.label === "起始局面").y === boxes.find((box) => box.label === "候选5").y };
  });
  assert(layoutCheck.nodes === Object.keys(nested.nodes).length && layoutCheck.edges === layoutCheck.nodes - 1, `嵌套图谱不完整：${JSON.stringify(layoutCheck)}`);
  assert(layoutCheck.columns > 1 && layoutCheck.mainLineHorizontal, `嵌套图谱没有分栏或主线偏移：${JSON.stringify(layoutCheck)}`);
  assert(!layoutCheck.overlap && layoutCheck.crossings === 0 && layoutCheck.disconnected === 0, `嵌套图谱走线错误：${JSON.stringify(layoutCheck)}`);
  await dialog.getByRole("button", { name: "放大图谱", exact: true }).click();
  await dialog.getByRole("button", { name: "总览全部已展开分支", exact: true }).click();
  await page.screenshot({ path: "qa/screenshots/tree-navigation/nested-graph.png" });
  await dialog.locator('.tree-node[aria-label^="候选5，"]').click();
  await dialog.locator(".tree-mapbar-context").getByRole("button", { name: "只看这支", exact: true }).click();
  const focusedCount = Number(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes"));
  assert(focusedCount > 6 && focusedCount < layoutCheck.nodes, "只看这支没有收拢到完整子树");
  await dialog.getByRole("button", { name: "总览全部已展开分支", exact: true }).click();
  await page.screenshot({ path: "qa/screenshots/tree-navigation/nested-focused.png" });
  await dialog.locator(".tree-mapbar-context").getByRole("button", { name: "返回全谱", exact: true }).click();
  assert(Number(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes")) === layoutCheck.nodes, "从子树返回后丢失完整分栏");
  assert(nestedErrors.length === 0, `嵌套图谱运行错误：${nestedErrors.join("; ")}`);
  output.push({ scenario: "nested-layout", pass: true, ...layoutCheck });
  await context.close();
  console.log(JSON.stringify({ pass: true, checks: output }, null, 2));
} finally {
  await browser.close();
}
