import { openTreeInspector, chooseTreeZoom } from "./tree-controls.mjs";
import { chromium } from "playwright";

// 常驻门禁：图谱工作区（用户 09-20 第三轮定稿）
//  L1 四个标签页：图谱 / 导航 / 列表 / 书签；默认进图谱
//  L2 图谱页：画布 + 棋谱预览（默认收起），没有侧栏列表
//  L3 点节点 → 预览展开后显示那个局面（棋盘出现）
//  L4 列表页：默认＝默认视野（主线 13 行）；展开分叉点后支线行带缩进出现，
//            主分支工具条与「切回主分支」往返
//  L5 缩放预设只有一行 6 档；下限仍是 1%（滑杆拖到底）
// 注：L4 的「默认也只有主线」是用户 09-22 R78 定的默认视野（只画当前路径 + 主分支），
//     列表与画布共用同一棵可视树，所以两边默认都看不到未展开的支线。
// 用法：QA_BASE_URL=http://localhost:5297/ node qa/record-list-check.mjs
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaURL = new URL(baseURL); qaURL.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const metadata = { title: "变化列表回归", black: "黑方", white: "白方", event: "", date: "2026-09-20", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] };
const cell = (index) => ({ row: Math.floor(index / 15), col: index % 15 });
const nodes = { root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] } };
let mainIndex = 1;
for (let turn = 1; turn <= 12; turn += 1) {
  const id = `m${turn}`;
  const children = turn < 12 ? [`m${turn + 1}`] : [];
  if (turn === 4) children.push("b1", "b2");
  nodes[id] = { id, parentId: turn === 1 ? "root" : `m${turn - 1}`, children, move: { ...cell(mainIndex++), player: turn % 2 ? "black" : "white" }, comment: turn === 4 ? "这一手要记住" : "", marks: [], boardText: turn === 4 ? "斜月" : undefined };
}
nodes.b1 = { id: "b1", parentId: "m4", children: [], move: { ...cell(60), player: "white" }, comment: "", marks: [] };
nodes.b2 = { id: "b2", parentId: "m4", children: [], move: { ...cell(70), player: "white" }, comment: "", marks: [] };
const active = { id: "list-check", version: 1, rootId: "root", savedCurrentId: "root", createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z", metadata, nodes };
const seed = (doc) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(doc));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([doc]));
};

const openTree = async (page) => {
  await page.goto(qaURL.href, { waitUntil: "domcontentloaded" });
  await page.getByLabel("当前工作状态").waitFor();
  if (!await page.getByRole("button", { name: "打开分支树" }).isVisible()) await page.getByRole("button", { name: "行棋" }).click();
  await page.getByRole("button", { name: "打开分支树" }).click();
  const dialog = page.getByRole("dialog", { name: "分支树" });
  await dialog.waitFor();
  await page.waitForTimeout(250);
  return dialog;
};

try {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`); });
  page.setDefaultTimeout(15_000);
  await page.addInitScript(seed, active);
  const dialog = await openTree(page);

  // L1：四个标签页，默认图谱；导航独立分页覆盖画布预算以外的候选。
  const tabs = await dialog.locator(".record-tree-tabs button").allTextContents();
  assert(tabs.length === 4, `L1：标签页应为 4 个，实际 ${tabs.length}：${tabs}`);
  assert(tabs[0].includes("图谱") && tabs[1].includes("导航") && tabs[2].includes("列表") && tabs[3].includes("书签"), `L1：标签页文案不对：${tabs}`);
  assert(await dialog.getByRole("tab", { name: /^图谱/ }).getAttribute("aria-selected") === "true", "L1：默认标签页不是图谱");

  // L2：图谱页有画布与预览，且没有侧栏列表
  assert(await dialog.locator(".tree-canvas").count() === 1, "L2：图谱页没有画布");
  assert(await dialog.locator(".tree-preview").count() === 1, "L2：图谱页没有棋谱预览");
  assert(await dialog.locator(".tree-preview-body").count() === 0, "L2：棋谱预览应默认收起");
  assert(await dialog.locator(".tree-list").count() === 0, "L2：图谱页不应再出现侧栏列表");
  const canvasNodes = await dialog.locator(".tree-node").count();
  assert(canvasNodes >= 10, `L2：画布没画出节点（${canvasNodes}）`);
  const dots = await dialog.locator(".tree-node .tree-dot-face").count();
  assert(dots >= 5, `L2：无分叉的链条节点应压成圆点（只有 ${dots} 个圆点）`);

  // L2b：打开图谱时默认定位在「当前手」那一手（用户 09-20），且重置按钮也回到这个定位
  const focusState = () => dialog.evaluate((element) => {
    const viewport = element.querySelector(".tree-viewport")?.getBoundingClientRect();
    const current = element.querySelector(".tree-node.current")?.getBoundingClientRect();
    const reset = element.querySelector('.tree-zoom-controls button[aria-label^="重置视图"]');
    return viewport && current ? {
      inside: current.left >= viewport.left - 1 && current.right <= viewport.right + 1 && current.top >= viewport.top - 1 && current.bottom <= viewport.bottom + 1,
      dx: Math.abs((current.left + current.right) / 2 - (viewport.left + viewport.right) / 2),
      dy: Math.abs((current.top + current.bottom) / 2 - (viewport.top + viewport.bottom) / 2),
      viewportWidth: Math.round(viewport.width),
      resetLabel: reset?.getAttribute("aria-label") || "",
    } : null;
  });
  const focus = await focusState();
  assert(focus, "L2b：找不到当前手节点或画布");
  assert(focus.inside, `L2b：打开图谱时当前手应落在可视区内：${JSON.stringify(focus)}`);
  assert(focus.dx <= focus.viewportWidth * 0.3 && focus.dy <= 60, `L2b：打开图谱时当前手应大致居中：${JSON.stringify(focus)}`);
  // 先拖走画面，再点重置，应该回到同一个定位
  const canvas = dialog.locator(".tree-canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 - 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dragged = await focusState();
  assert(!dragged.inside || dragged.dx > focus.dx + 20 || dragged.dy > focus.dy + 20, `L2b：拖动后画面应该移动了：${JSON.stringify(dragged)}`);
  await dialog.locator('.tree-zoom-controls button[aria-label^="重置视图"]').click();
  await page.waitForTimeout(200);
  const reset = await focusState();
  assert(reset.inside, `L2b：重置后当前手应回到可视区内：${JSON.stringify(reset)}`);
  assert(Math.abs(reset.dx - focus.dx) <= 6 && Math.abs(reset.dy - focus.dy) <= 6, `L2b：重置应回到与打开时相同的定位：打开 ${JSON.stringify(focus)} vs 重置 ${JSON.stringify(reset)}`);

  // L3：点一个节点 → 预览展开显示那个局面
  // ⚠ 必须点一个**真的落在画布可视区**里的节点：画布是 viewBox 视窗（默认宽 660），默认视野把
  //    当前手摆在中间，落在右边缘之外的节点点不到——Playwright 会报「被 sheet 挡住指针事件」
  //    （不是真被挡，是那个坐标上本来就没有画布内容）。
  //    用户 09-26 把链条节点从 34px 圆点改成 64px「坐标 + 手数」胶囊后，原先按位置取的
  //    「第 5 个节点」（第 4 手 · 斜月）被推到了视窗外，所以这里改成按标签定位到第 3 手
  //    （D15，盘面 3 子，右侧仍有余量）。按标签取也顺带摆脱「第 N 个」这种与宽度耦合的写法。
  await chooseTreeZoom(dialog, "50%");
  await dialog.locator('.tree-node[aria-label^="D15"]').click();
  await page.waitForTimeout(200);
  await openTreeInspector(dialog);
  await dialog.getByRole("button", { name: "棋盘预览", exact: true }).click();
  await page.waitForTimeout(300);
  assert(await dialog.locator(".tree-preview-board").count() === 1, "L3：展开预览后没有棋盘");
  const stones = await dialog.locator(".tree-preview-board .stone").count();
  assert(stones >= 3, `L3：预览棋盘上的棋子太少（${stones}）`);
  await dialog.getByRole("button", { name: "棋盘预览", exact: true }).click();
  await page.waitForTimeout(200);
  assert(await dialog.locator(".tree-preview-body").count() === 0, "L3：再点一次应收起预览");

  // L4：列表标签页
  // 注意（用户 09-22 R78 改了默认视野）：图谱默认**只画当前路径 + 主分支**，
  // 一个次分支都不露。列表与画布共用同一棵可视树，所以列表默认也只有主线那些行，
  // A11 / K11 这两条支线**要先把分叉点展开**才会出现。
  // 本门禁原来直接按「A11 应该在列表里」断言（09-21 写的，早于 R78），
  // 那条断言已是陈旧假设：不是列表坏了，是它当时就不会画出没展开的分支。
  // 现在分两步验：① 默认列表＝默认视野（主线一行一手）；② 展开后分支行带缩进出现。
  await dialog.getByRole("tab", { name: /^列表/ }).click();
  await page.waitForTimeout(300);
  const rowsDefault = await dialog.locator(".tree-list-row").allTextContents();
  assert(rowsDefault.length === 13, `L4：默认视野应只排主线 13 行（起始局面 + 12 手），实际 ${rowsDefault.length}：${rowsDefault}`);
  assert(!rowsDefault.some((text) => text.includes("A11")), "L4：默认视野不该露出没展开的支线（A11 是挂在第 4 手下的次分支）");
  assert((rowsDefault[0] || "").includes("起始局面"), `L4：第一行不是起始局面：${rowsDefault[0]}`);
  assert((rowsDefault[4] || "").includes("4."), `L4：第 4 手不在主线第 4 位：${rowsDefault[4]}`);
  assert(rowsDefault.some((text) => text.includes("斜月")), "L4：盘面文字没有显示出来");
  const chip = await dialog.locator(".tree-list-row .tree-list-branch").allTextContents();
  assert(chip.some((text) => text.includes("3 支")), `L4：第 4 手的分支数没标出来：${chip}`);
  assert(await dialog.locator(".tree-list-mainline").count() === 1, "L4：列表没有标出「主分支」");
  assert(await dialog.locator(".tree-list-onmain").count() === 1, "L4：开局在主分支上，却没有「当前在主分支上」");
  // 回图谱，选中第 4 手那个分叉点（画布上 aria-label 含「这里分出 3 支」），展开下一层
  // ⚠ 先缩到 50% 再点：画布是 viewBox 视窗，默认 100% + 当前手居中时，第 4 手已经落到视窗
  //    右缘之外（用户 09-26 把链条节点从 34px 圆点改成 64px 胶囊，整棵树更宽了），
  //    那样点不到（Playwright 报「被 sheet 挡住」）。缩到 50% 是用户「看全一点再点」的正常操作。
  await dialog.getByRole("tab", { name: /^图谱/ }).click();
  await page.waitForTimeout(250);
  await chooseTreeZoom(dialog, "50%");
  await page.waitForTimeout(400);
  await dialog.locator('.tree-node[aria-label*="这里分出 3 支"]').first().click();
  await page.waitForTimeout(250);
  await openTreeInspector(dialog);
  await dialog.locator(".tree-node-action-grid button", { hasText: "展开下一层" }).first().click();
  await page.waitForTimeout(400);
  // 再回列表：支线行跟着长出来，并且带缩进
  await dialog.getByRole("tab", { name: /^列表/ }).click();
  await page.waitForTimeout(400);
  const rows = await dialog.locator(".tree-list-row").allTextContents();
  assert(rows.length >= 15, `L4：展开分支后列表应多出两条支线行（≥15），实际 ${rows.length}`);
  assert(rows.some((text) => text.includes("A11")), `L4：展开后支线 A11 没出现在列表里：${rows.join(" | ")}`);
  // 分支行缩进 + 点一行跳过去且面板不关
  const indentOf = (label) => dialog.locator(".tree-list-row", { hasText: label }).first().evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingLeft));
  assert(await indentOf("A11") > await indentOf("6."), "L4：分支行没有缩进");
  await dialog.locator(".tree-list-row", { hasText: "A11" }).first().click();
  await page.waitForTimeout(500);
  assert(await page.getByRole("dialog", { name: "分支树" }).isVisible(), "L4：点一行之后面板被关掉了");
  const status = (await page.locator(".unified-status").first().innerText()).replace(/\s+/g, " ");
  assert(/第 5 手/.test(status), `L4：点了第 5 手但状态栏是「${status.slice(0, 40)}」`);
  assert(!/未保存草稿/.test(status), `L4：在列表里点一手产生了草稿（读谱不该改棋谱）：${status.slice(0, 60)}`);
  const back = dialog.locator(".tree-list-toolbar button", { hasText: "切回主分支" });
  assert(await back.count() === 1, "L4：走到主分支之外后没有「切回主分支」");
  await back.click();
  await page.waitForTimeout(600);
  assert(await dialog.locator(".tree-list-onmain").count() === 1, "L4：切回主分支后没有回到「当前在主分支上」");

  // L5：缩放预设一行 6 档；下限仍是 1%（滑杆拖到底）
  await dialog.getByRole("tab", { name: /^图谱/ }).click();
  await page.waitForTimeout(250);
  await dialog.getByLabel("选择缩放比例", { exact: true }).click();
  const presets = await dialog.locator(".tree-zoom-presets button").allTextContents();
  assert(presets.join("/") === "5%/10%/20%/50%/100%/5×/50×/100×", `L5：缩放菜单的 8 档顺序不正确：${presets}`);
  const presetRows = await dialog.locator(".tree-zoom-presets button").evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size);
  assert(presetRows === 4, `L5：缩放菜单应排成两列四行，实际 ${presetRows} 行`);
  await dialog.getByLabel("选择缩放比例", { exact: true }).click();
  const range = dialog.locator(".tree-zoom-range");
  // React 受控 input：直接赋 element.value 不触发 onChange（React 覆盖了 value setter），
  // 必须走原生 setter 再派发 input 事件
  await range.evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, "0");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const label = await dialog.locator(".tree-zoom-menu summary").textContent();
  assert(label === "1%", `L5：滑杆拖到底应是 1%，实际「${label}」`);

  // L5b：改缩放要锚定画布中心——只改 scale 不动 pan 的话，缩小会把整棵树推出视野（画布变空）
  for (const preset of ["100%", "5%"]) {
    await chooseTreeZoom(dialog, preset);
    await page.waitForTimeout(250);
    const visible = await dialog.evaluate((element) => {
      const viewport = element.querySelector(".tree-viewport")?.getBoundingClientRect();
      const boxes = [...element.querySelectorAll(".tree-node")].map((node) => node.getBoundingClientRect());
      if (!viewport || !boxes.length) return null;
      const hit = boxes.filter((box) => box.right >= viewport.left && box.left <= viewport.right && box.bottom >= viewport.top && box.top <= viewport.bottom);
      return { total: boxes.length, hit: hit.length };
    });
    assert(visible && visible.hit >= Math.min(6, visible.total), `L5b：点「${preset}」后视野里几乎没内容了（${JSON.stringify(visible)}）`);
  }
  await chooseTreeZoom(dialog, "100%");
  await page.waitForTimeout(200);

  // 窄屏：不横向溢出，标签页与预览都在
  const narrowContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const narrowPage = await narrowContext.newPage();
  narrowPage.on("pageerror", (error) => errors.push(`narrow pageerror: ${error.message}`));
  await narrowPage.addInitScript(seed, active);
  const narrowDialog = await openTree(narrowPage);
  const overflowX = await narrowPage.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(overflowX <= 1, `窄屏横向溢出 ${overflowX}px`);
  assert(await narrowDialog.locator(".tree-preview").count() === 1, "窄屏：图谱页没有棋谱预览");
  await narrowDialog.getByRole("tab", { name: /^列表/ }).click();
  await narrowPage.waitForTimeout(300);
  // 窄屏与宽屏同一语义：默认只排主线 13 行（R78 默认视野＝当前路径 + 主分支，不露次分支）
  assert(await narrowDialog.locator(".tree-list-row").count() === 13, "窄屏：列表页没排出主线 13 行");
  await narrowContext.close();

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({
    pass: true,
    tabs,
    canvasNodes,
    chainDots: dots,
    previewStones: stones,
    listRows: rows.length,
    branchChip: chip.join("/"),
    presets,
  }, null, 2));
  await context.close();
  await browser.close();
} catch (error) {
  await browser.close();
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
