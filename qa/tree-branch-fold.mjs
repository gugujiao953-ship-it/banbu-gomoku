import { openTreeInspector } from "./tree-controls.mjs";
import { chromium } from "playwright";

// 分支树「默认画一条主分支 + 多分支点标记 + 展开/收起 + 设为主分支」回归门禁。
// 断言四件事：① 默认视野 = 当前路径 + 一条主分支，多分支点带数量徽标（离线分支加金环）
// ② 单枝展开/收起的可视线数 + 「设为主分支」（整树展开/收起已按用户 09-19 要求移除）
// ③ 操作区触控目标 ≥44px、多视口不横向溢出
// ④ 全部主题下徽标数字、节点标题、手数文字对比度 ≥4.5:1（读 getComputedStyle，不看截图）
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaURL = new URL(baseURL); qaURL.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const metadata = { title: "分支树回归", black: "黑方", white: "白方", event: "树回归", date: "2026-09-17", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] };
const mv = (id, parentId, children, player, row, col) => [id, { id, parentId, children, move: parentId ? { row, col, player } : null, comment: "", marks: [] }];

// root ├ a ─ a1 ─ a2(当前) 、a9 ─ a9a ─ a9b
//      └ b ─ b1 ─ b2 ─ b3 ─ b4（最长线）、b5 ─ b5a ─ b5b / b5c、b6
const active = {
  id: "tree-fold-gate", version: 1, rootId: "root", savedCurrentId: "a2",
  createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z", metadata,
  nodes: Object.fromEntries([
    mv("root", null, ["a", "b"]),
    mv("a", "root", ["a1", "a9"], "black", 7, 7),
    mv("a1", "a", ["a2"], "white", 7, 8),
    mv("a2", "a1", [], "black", 6, 7),
    mv("a9", "a", ["a9a"], "white", 8, 8),
    mv("a9a", "a9", ["a9b"], "black", 8, 9),
    mv("a9b", "a9a", [], "white", 9, 9),
    mv("b", "root", ["b1", "b5", "b6"], "white", 6, 6),
    mv("b1", "b", ["b2"], "black", 6, 8),
    mv("b2", "b1", ["b3"], "white", 5, 8),
    mv("b3", "b2", ["b4"], "black", 4, 8),
    mv("b4", "b3", [], "white", 3, 8),
    mv("b5", "b", ["b5a", "b5c"], "black", 9, 7),
    mv("b5a", "b5", ["b5b"], "white", 9, 6),
    mv("b5b", "b5a", [], "black", 10, 6),
    mv("b5c", "b5", [], "white", 9, 5),
    mv("b6", "b", [], "white", 10, 9),
  ]),
};
const seed = ({ activeDocument }) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(activeDocument));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([activeDocument]));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
};

const openTree = async (page) => {
  await page.goto(qaURL.href, { waitUntil: "domcontentloaded" });
  // 「当前工作状态」现在同时挂在状态区和标题上，取第一个（.first()）免得 strict 模式报冲突
  await page.getByLabel("当前工作状态").first().waitFor();
  if (!await page.getByRole("button", { name: "打开分支树" }).isVisible()) await page.getByRole("button", { name: "行棋" }).click();
  await page.getByRole("button", { name: "打开分支树" }).click();
  await page.getByRole("tab", { name: /图谱/ }).click();
  await page.getByRole("dialog", { name: "分支树" }).waitFor();
  await page.waitForTimeout(120);
};

const treeState = (page) => page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".tree-node")];
  return {
    count: nodes.length,
    labels: nodes.map((node) => (node.getAttribute("aria-label") || "").split("，")[0]),
    classNames: nodes.map((node) => node.getAttribute("class")),
    /** 用户自己点开的那一枝（往右下、金色连线）。 */
    revealed: nodes.filter((node) => node.classList.contains("revealed")).map((node) => (node.getAttribute("aria-label") || "").split("，")[0]),
    goldEdges: document.querySelectorAll(".tree-edges path.revealed").length,
    marks: [...document.querySelectorAll(".tree-branch-mark")].map((mark) => ({
      text: mark.querySelector("text")?.textContent,
      folded: mark.classList.contains("folded"),
      parentLabel: (mark.closest(".tree-node")?.getAttribute("aria-label") || "").split("，")[0],
    })),
    goldRects: [...document.querySelectorAll(".tree-node.branching:not(.path):not(.current)")].map((node) => (node.getAttribute("aria-label") || "").split("，")[0]),
    toolbar: {
      title: document.querySelector(".tree-toolbar b")?.textContent,
      subtitle: document.querySelector(".tree-toolbar small")?.textContent,
      presets: [...document.querySelectorAll(".tree-zoom-presets button")].map((button) => button.textContent),
    },
    grid: (() => {
      const buttons = [...document.querySelectorAll(".tree-node-action-grid button")];
      const rows = new Map();
      for (const button of buttons) {
        const top = Math.round(button.getBoundingClientRect().top);
        rows.set(top, (rows.get(top) || 0) + 1);
      }
      return {
        buttons: buttons.map((button) => button.textContent),
        perRow: [...rows.values()],
        minWidth: buttons.length ? Math.min(...buttons.map((button) => Math.round(button.getBoundingClientRect().width))) : 0,
        minHeight: buttons.length ? Math.min(...buttons.map((button) => Math.round(button.getBoundingClientRect().height))) : 0,
        overflowing: buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent),
        disabled: buttons.filter((button) => button.disabled).map((button) => button.textContent),
      };
    })(),
    legend: [...document.querySelectorAll(".tree-legend span")].map((span) => span.textContent),
    overflowX: document.documentElement.scrollWidth - innerWidth,
  };
});

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  // onnxruntime 在本机 CPU 上打的 `[W:onnxruntime …]` 是 **warning**，Chrome 归到 console 的
  // error 类型里；它不是页面报错，别把它算进"未捕获异常"（同 qa/duel-undo-check.mjs 的口径）。
  page.on("console", (message) => { if (message.type() === "error" && !/\[W:onnxruntime/.test(message.text())) errors.push(`console: ${message.text()}`); });
  page.setDefaultTimeout(12_000);
  await page.addInitScript(seed, { activeDocument: active });
  await openTree(page);
  await openTreeInspector(page.getByRole("dialog", { name: "分支树" }));

  const initial = await treeState(page);
  // 默认（用户 09-22 定稿）：**只有当前路径 + 主分支这一条横线**，次分支一个都不自动露。
  // 当前路径 root-a-a1-a2（起始局面/H8/I8/H9）+ 主分支 root-b-b1..b4（G9/I9/I10/I11/I12）= 9。
  // 以前每个分叉自动露一条次分支当折叠入口，用户看起来像「默认就给展开了一个子分支」，撤掉了。
  assert(initial.count === 9, `默认可视节点应为 9，实际 ${initial.count}`);
  assert(initial.labels.join(",") === "起始局面,H8,I8,H9,G9,I9,I10,I11,I12", `默认可视节点不符：${initial.labels}`);
  assert(!initial.labels.includes("I7") && !initial.labels.includes("H6"), `默认不该露任何次分支（a9=I7、b5=H6 都不该画）：${initial.labels}`);
  assert(!initial.labels.includes("J5"), `默认不该把 b 的第二条次分支（b6=J5）也画出来：${initial.labels}`);
  assert(initial.marks.length === 3, `分支点徽标应为 3 个（root/a/b），实际 ${initial.marks.length}`);
  assert(initial.marks.map((mark) => mark.text).join(",") === "2,2,3", `分支点数量应为 2,2,3，实际 ${initial.marks.map((mark) => mark.text)}`);
  assert(initial.goldRects.join(",") === "G9", `离线分支点应加金色描边（G9），实际 ${initial.goldRects}`);
  assert(initial.marks.filter((mark) => mark.folded).map((mark) => mark.parentLabel).join(",") === "H8,G9", `还有没画出来的分叉应用虚线徽标（H8 藏了 I7、G9 藏了 H6/J5），实际 ${JSON.stringify(initial.marks)}`);
  assert(initial.revealed.length === 0, `默认视野不该有「用户摊开的那一枝」：${initial.revealed}`);
  assert(await page.evaluate(() => !document.querySelector(".tree-fold-presets")), "整树展开/收起应已按用户要求移除");
  assert(initial.toolbar.title === "变化总览", "工具栏标题未更新");
  assert(initial.toolbar.subtitle.includes("3 个分支点"), `工具栏未统计分支点：${initial.toolbar.subtitle}`);
  assert(initial.toolbar.presets.join("/") === "5%/10%/20%/50%/100%/5×/50×/100×", `缩放快捷比例不符：${initial.toolbar.presets}`);
  assert(initial.legend.includes("多分支点"), "图例未加多分支点");
  assert(initial.overflowX <= 1, `默认视图横向溢出 ${initial.overflowX}px`);

  // 徽标几何：必须落在节点方块内，且与手数文字不重叠（长标签也不许压字）
  const badgeBoxes = await page.evaluate(() => [...document.querySelectorAll(".tree-branch-mark")].map((mark) => {
    const circle = mark.querySelector("circle").getBBox();
    const node = mark.closest(".tree-node");
    const rect = node.querySelector("rect").getBBox();
    const meta = node.querySelector(".tree-node-meta").getBBox();
    return { circle: { x: circle.x, y: circle.y, w: circle.width, h: circle.height }, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, meta: { x: meta.x, y: meta.y, w: meta.width, h: meta.height } };
  }));
  assert(badgeBoxes.length === 3, "徽标几何取样数量不符");
  for (const box of badgeBoxes) {
    assert(box.circle.x >= box.rect.x && box.circle.x + box.circle.w <= box.rect.x + box.rect.w, `徽标横向超出节点方块：${JSON.stringify(box)}`);
    assert(box.circle.y >= box.rect.y && box.circle.y + box.circle.h <= box.rect.y + box.rect.h, `徽标纵向超出节点方块：${JSON.stringify(box)}`);
    assert(box.circle.x >= box.meta.x + box.meta.w - 1, `徽标与手数文字重叠：${JSON.stringify(box)}`);
  }

  // The record's main branch (b, the longest fallback) continues on the root lane.
  // The current off-main path (a) gets its own lane below, without mixing the two subtrees.
  const verticalShape = await page.evaluate(() => {
    const yOf = (prefix) => {
      const node = [...document.querySelectorAll(".tree-node")].find((item) => (item.getAttribute("aria-label") || "").startsWith(prefix));
      const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node?.getAttribute("transform") || "");
      return match ? Number(match[2]) : null;
    };
    return { root: yOf("起始局面"), a: yOf("H8"), main: yOf("I8"), b: yOf("G9") };
  });
  assert(Object.values(verticalShape).every((value) => value !== null), `找不到主线/支线节点：${JSON.stringify(verticalShape)}`);
  assert(verticalShape.b === verticalShape.root && verticalShape.a > verticalShape.root, `主分支横平、当前旁支独立分区：${JSON.stringify(verticalShape)}`);

  // 整树展开 / 收起（用户 09-20 第二轮要求加回操作区，做成三个看得出区别的状态）
  // 默认＝当前路径 + 主分支；展开全部＝整树摊开到节点上限；收起全部＝只剩当前路径一条线
  const countNodes = async () => (await treeState(page)).count;
  const defaultCount = await countNodes();
  await page.getByRole("button", { name: "展开全部" }).click();
  await page.waitForTimeout(150);
  const expandedCount = await countNodes();
  assert(expandedCount > defaultCount, `展开全部应比默认视野多画节点：${defaultCount} → ${expandedCount}`);
  assert(Number(await page.locator(".tree-viewport").getAttribute("data-layout-nodes")) >= expandedCount, "布局应包含全部已展开节点");
  await page.getByRole("button", { name: "收起全部" }).click();
  await page.waitForTimeout(150);
  const collapsedCount = await countNodes();
  assert(collapsedCount < defaultCount, `收起全部应比默认视野少画节点（上一版「点了没反应」就是这么来的）：${defaultCount} → ${collapsedCount}`);
  assert(await page.evaluate(() => document.querySelectorAll(".tree-node.branching").length) >= 1, "收起全部后仍应留下当前路径上的分支点");
  await page.getByRole("button", { name: "收起全部" }).click();
  await page.waitForTimeout(150);
  assert(await countNodes() === defaultCount, `再点一次收起全部应回到默认视野：${await countNodes()} vs ${defaultCount}`);

  // 节点级展开 / 收起（用户 09-22：要**单独的、按层**的展开与收起）
  const dialog = page.getByRole("dialog", { name: "分支树" });

  /**
   * 横铺布局下节点铺得很开，打开时画面又只对准当前手，
   * 目标节点可能在可视区外点不到——先拖动画布把它带进视野（顺带也在测拖动）。
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
  // 选中分叉点 a（H8）：默认它下面只露着当前路径那一手（I8），所以「收起这一层」该是禁用的
  await panToNode("H8");
  await dialog.getByRole("button", { name: /^H8/ }).click();
  await dialog.getByLabel(/^节点操作 H8/).waitFor();
  let grid = (await treeState(page)).grid;
  // 操作区按钮**按容器宽度自动排列**（用户 2026-10-10：「就算是三行就三行吧，
  // 不过排列要自动调整」）。所以这里不再钉死「2 排 / 每排 ≤6」——那是写死列数时代的口径，
  // 现在按钮一多、屏幕一窄，折成三排是正确的，钉死反而会拦住正当的排布。
  // 改成钉**真正不许破的三条**：不溢出、触控目标达标、每排不少于 3 个（太少说明挤坏了）。
  assert(grid.perRow.every((size) => size >= 3), `操作区每排至少 3 个按钮（排布被挤坏），实际 ${grid.perRow}`);
  assert(grid.minWidth >= 44 && grid.minHeight >= 44, `触控目标过小：${grid.minWidth}x${grid.minHeight}`);
  assert(grid.overflowing.length === 0, `按钮文字溢出：${grid.overflowing}`);
  assert(grid.buttons.includes("展开下一层") && grid.buttons.includes("收起这一层"), `缺少按层的展开/收起：${grid.buttons}`);
  assert(grid.buttons.includes("设为主分支"), `离主分支的节点应有「设为主分支」：${grid.buttons}`);
  assert(grid.disabled.includes("收起这一层") && !grid.disabled.includes("展开下一层"), `只露着路径那一手时「收起这一层」应禁用（收了也没变化）：${grid.disabled}`);
  // 点一次「展开下一层」＝只摊开**一层**（a9=I7 出来），不是把整枝一次扯出来
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(160);
  const oneLevel = await treeState(page);
  assert(oneLevel.count === 10, `展开一层后应为 10 个节点，实际 ${oneLevel.count}`);
  assert(oneLevel.labels.includes("I7"), `展开一层应画出 a9=I7：${oneLevel.labels}`);
  assert(!oneLevel.labels.includes("J7"), `只展开一层，a9 的孩子（J7）不该出来：${oneLevel.labels}`);
  assert(oneLevel.grid.disabled.includes("展开下一层") === false, "还有下一层没摊开，「展开下一层」不该禁用");
  assert(!oneLevel.grid.disabled.includes("收起这一层"), "摊开一层后「收起这一层」应可点");
  assert(oneLevel.grid.buttons.includes("收起这一层 (1)"), `按钮上应标出已摊开 1 层：${oneLevel.grid.buttons}`);
  assert(!oneLevel.marks.some((mark) => mark.parentLabel.startsWith("H8") && mark.folded), "展开后 a 的徽标应为实心");
  // 摊开的这一层走金色连线（默认框架是素色线），一眼分得出「哪些是我自己点开的」
  assert(oneLevel.revealed.includes("I7"), `摊开的这一层应标 revealed：${oneLevel.revealed}`);
  assert(oneLevel.goldEdges >= 1, `摊开的枝应用金色连线：${oneLevel.goldEdges}`);
  // 再点一次「展开下一层」：往下**再**摊一层（a9 的孩子 a9a=J7 出来），再点一次才是 J6
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(160);
  const twoLevels = await treeState(page);
  assert(twoLevels.count === 11, `展开两层后应为 11 个节点，实际 ${twoLevels.count}`);
  assert(twoLevels.labels.includes("J7") && !twoLevels.labels.includes("J6"), `第二层应只画出 J7，J6 还在下一层：${twoLevels.labels}`);
  assert(twoLevels.grid.buttons.includes("收起这一层 (2)"), `按钮上应标出已摊开 2 层：${twoLevels.grid.buttons}`);
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(160);
  const threeLevels = await treeState(page);
  assert(threeLevels.labels.includes("J6"), `展开三层应画出 J6：${threeLevels.labels}`);
  assert(threeLevels.grid.buttons.includes("收起这一层 (3)"), `按钮上应标出已摊开 3 层：${threeLevels.grid.buttons}`);
  // 「收起这一层」一次只收一层：先收掉 J6，J7/I7 留着
  await dialog.getByRole("button", { name: "收起这一层" }).click();
  await page.waitForTimeout(160);
  const backToOne = await treeState(page);
  assert(backToOne.count === twoLevels.count, `收起一层应回到摊开两层的状态，实际 ${backToOne.count} vs ${twoLevels.count}`);
  assert(backToOne.labels.includes("J7") && !backToOne.labels.includes("J6"), `收起一层只该收掉最外面那层：${backToOne.labels}`);
  // 再收两次：整枝回到默认框架，且按钮重新禁用
  await dialog.getByRole("button", { name: "收起这一层" }).click();
  await page.waitForTimeout(160);
  await dialog.getByRole("button", { name: "收起这一层" }).click();
  await page.waitForTimeout(160);
  const fullyCollapsed = await treeState(page);
  assert(fullyCollapsed.count === initial.count, `收完应回到默认视野，实际 ${fullyCollapsed.count}`);
  assert(fullyCollapsed.revealed.length === 0, `收完后不该还有摊开的枝：${fullyCollapsed.revealed}`);
  assert(fullyCollapsed.grid.disabled.includes("收起这一层"), "收回默认框架后「收起这一层」应重新禁用");

  // 默认框架上的分叉也能收：root 收起后主分支整条让位，只剩当前路径
  await panToNode("起始局面");
  await dialog.getByRole("button", { name: /^起始局面/ }).click();
  await dialog.getByLabel(/^节点操作 起始局面/).waitFor();
  await dialog.getByRole("button", { name: "收起这一层" }).click();
  await page.waitForTimeout(160);
  const pathOnly = await treeState(page);
  assert(pathOnly.count === 4, `收起 root 应只剩当前路径 4 个节点，实际 ${pathOnly.count}`);
  assert(!pathOnly.labels.includes("G9"), `收起的 root 仍画着主分支：${pathOnly.labels}`);
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(160);
  assert((await treeState(page)).count === initial.count, `在 root 上展开一层应回到默认视野`);

  // Unfold a and check complete node geometry, fork stems and independent continuations.
  await panToNode("H8");
  await dialog.getByRole("button", { name: /^H8/ }).click();
  await dialog.getByLabel(/^节点操作 H8/).waitFor();
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(140);
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(140);
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(160);
  const geometry = await page.evaluate(() => {
    const points = [...document.querySelectorAll(".tree-node")].map((node) => {
      const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute("transform") || "");
      return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
    });
    const seen = new Set();
    let overlapping = 0;
    for (const point of points) {
      const key = `${point.x}|${point.y}`;
      if (seen.has(key)) overlapping += 1;
      seen.add(key);
    }
    return { nodes: points.length, overlapping, stems: [...document.querySelectorAll(".tree-edges path")].filter((path) => (path.getAttribute("d") || "").includes(" V ")).length };
  });
  assert(geometry.overlapping === 0, `同列同行不能重叠（这套布局的意义所在）：${geometry.overlapping} 处`);
  assert(geometry.stems === geometry.nodes - 1, `每条父子关系都有分叉连线：${geometry.stems} / ${geometry.nodes - 1}`);
  const nodeY = (labelPrefix) => page.evaluate((prefix) => {
    const node = [...document.querySelectorAll(".tree-node")].find((item) => (item.getAttribute("aria-label") || "").startsWith(prefix));
    const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node?.getAttribute("transform") || "");
    return match ? Number(match[2]) : null;
  }, labelPrefix);
  // Single-child continuations remain horizontal; a side subtree is kept intact.
  const primary = { b: await nodeY("G9"), b1: await nodeY("I9"), b2: await nodeY("I10"), b3: await nodeY("I11"), b4: await nodeY("I12") };
  assert(new Set(Object.values(primary)).size === 1, "主分支延续应保持横平");
  const side = { fork: await nodeY("H8"), anchor: await nodeY("I7"), child: await nodeY("J7"), grand: await nodeY("J6") };
  assert(Object.values(side).every((value) => value !== null), "展开后的旁支节点完整显示");
  assert(side.child === side.anchor && side.grand === side.child, "单线后续留在自己的同一条线路");
  assert(side.anchor > side.fork, "旁支有独立的线路空间");

  // 选中节点的呼吸动效（微微发光、一闪一闪）
  const breathe = await page.evaluate(() => {
    const rect = document.querySelector(".tree-node.selected rect") || document.querySelector(".tree-node.selected .tree-dot-face");
    if (!rect) return null;
    const style = getComputedStyle(rect);
    return { name: style.animationName, duration: style.animationDuration, iteration: style.animationIterationCount };
  });
  assert(breathe && breathe.name === "tree-node-breathe", `选中节点应有呼吸动效：${JSON.stringify(breathe)}`);
  assert(breathe.iteration === "infinite", `呼吸动效应循环播放：${breathe.iteration}`);

  // 「设为主分支」（用户 09-19 新增）：把这一手所在的整条线写成棋谱主线。
  // H6=b5 在默认视野里是收着的（b 只画了主分支那一支），先在 b（G9）上展开一层把它露出来。
  // b5 的上方有两处分岔（root 在 a/b 之间选了 a、b 在 b1/b5 之间选了 b1），都要指过来。
  await panToNode("G9");
  await dialog.getByRole("button", { name: /^G9/ }).click();
  await dialog.getByLabel(/^节点操作 G9/).waitFor();
  await dialog.getByRole("button", { name: "展开下一层" }).click();
  await page.waitForTimeout(160);
  await panToNode("H6");
  await dialog.getByRole("button", { name: /^H6/ }).click();
  await dialog.getByLabel(/^节点操作 H6/).waitFor();
  await dialog.getByRole("button", { name: "设为主分支" }).click();
  await page.getByText(/已把这一手所在分支设为主分支（调整了 2 处分岔）/).waitFor();
  const mainlineHead = await page.locator(".tree-node-action-head small").textContent();
  assert(mainlineHead?.includes("在主分支上"), `设为主分支后应显示主分支标识：${mainlineHead}`);
  assert(!(await treeState(page)).grid.buttons.includes("设为主分支"), "已在主分支上的节点不应再出现「设为主分支」");
  assert(await page.evaluate(() => !document.querySelector(".tree-minimap")), "不该再有独立的缩略图窗口（用户 09-22：要和主画布同一块画布）");

  // 多视口：不横向溢出、触控目标达标
  const viewports = [{ name: "360", width: 360, height: 800 }, { name: "390", width: 390, height: 844 }, { name: "412", width: 412, height: 915 }, { name: "landscape", width: 844, height: 390 }];
  const visual = [];
  for (const item of viewports) {
    const viewContext = await browser.newContext({ viewport: { width: item.width, height: item.height }, isMobile: item.width < 700, hasTouch: true, serviceWorkers: "block" });
    const viewPage = await viewContext.newPage();
    viewPage.on("pageerror", (error) => errors.push(`${item.name} pageerror: ${error.message}`));
    await viewPage.addInitScript(seed, { activeDocument: active });
    await openTree(viewPage);
    await openTreeInspector(viewPage.getByRole("dialog", { name: "分支树" }));
    const state = await treeState(viewPage);
    assert(state.overflowX <= 1, `${item.name} 横向溢出 ${state.overflowX}px`);
    assert(state.grid.minWidth >= 44 && state.grid.minHeight >= 44, `${item.name} 触控目标过小 ${state.grid.minWidth}x${state.grid.minHeight}`);
    assert(state.grid.overflowing.length === 0, `${item.name} 按钮文字溢出：${state.grid.overflowing}`);
    assert(state.grid.perRow.every((size) => size >= 3), `${item.name} 操作区排布被挤坏（每排应 ≥3）：${state.grid.perRow}`);
    const sheet = await viewPage.evaluate(() => { const rect = document.querySelector(".bottom-sheet")?.getBoundingClientRect(); return rect ? { top: rect.top, bottom: rect.bottom, innerHeight } : null; });
    assert(sheet && sheet.top >= -1 && sheet.bottom <= sheet.innerHeight + 1, `${item.name} Sheet 越界 ${JSON.stringify(sheet)}`);
    visual.push({ name: item.name, nodes: state.count, perRow: state.grid.perRow, min: `${state.grid.minWidth}x${state.grid.minHeight}` });
    await viewContext.close();
  }

  // 主题：徽标对比度 + 节点可读性（读 getComputedStyle，不看截图）
  const contrastPage = await context.newPage();
  await contrastPage.addInitScript(seed, { activeDocument: active });
  await openTree(contrastPage);
  const themes = ["", "dark", "rain", "jiangnan", "firefly", "pixel", "cyber", "blackgold", "mono", "pale", "bamboo", "snow", "porcelain", "plum", "rice", "kawaii", "eye"];
  const parse = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = (color) => {
    // 解析失败要吵：历史上有过 --accent 从未定义、开关恒用兜底色而没人发现的情况。
    const { r, g, b } = color || {};
    if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
      throw new Error(`门禁读到的颜色不是 rgb（可能是未定义变量或 color-mix）：${JSON.stringify(color)}`);
    }
    const channel = (value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => { const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]; return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)); };
  const themeResults = [];
  for (const theme of themes) {
    const metrics = await contrastPage.evaluate((name) => {
      if (name) document.documentElement.setAttribute("data-theme", name);
      else document.documentElement.removeAttribute("data-theme");
      const mark = document.querySelector(".tree-branch-mark circle");
      const markText = document.querySelector(".tree-branch-mark text");
      const rect = document.querySelector(".tree-node rect");
      const label = document.querySelector(".tree-node-label");
      const meta = document.querySelector(".tree-node-meta");
      const offRect = document.querySelector(".tree-node:not(.path) rect");
      const offLabel = document.querySelector(".tree-node:not(.path) .tree-node-label");
      const offMeta = document.querySelector(".tree-node:not(.path) .tree-node-meta");
      const zoomBtn = document.querySelector(".tree-zoom-presets button");
      const style = (element) => (element ? getComputedStyle(element) : null);
      return {
        markFill: style(mark)?.fill || "",
        markStroke: style(mark)?.stroke || "",
        markTextFill: style(markText)?.fill || "",
        nodeFill: style(rect)?.fill || "",
        nodeStroke: style(rect)?.stroke || "",
        labelFill: style(label)?.fill || "",
        metaFill: style(meta)?.fill || "",
        offFill: style(offRect)?.fill || "",
        offLabelFill: style(offLabel)?.fill || "",
        offMetaFill: style(offMeta)?.fill || "",
        zoomColor: style(zoomBtn)?.color || "",
        zoomBg: style(zoomBtn)?.backgroundColor || "",
      };
    }, theme);
    const badge = ratio(parse(metrics.markTextFill), parse(metrics.markFill));
    const label = ratio(parse(metrics.labelFill), parse(metrics.nodeFill));
    const zoomPreset = ratio(parse(metrics.zoomColor), parse(metrics.zoomBg));
    const offLabel = ratio(parse(metrics.offLabelFill), parse(metrics.offFill));
    const offMeta = ratio(parse(metrics.offMetaFill), parse(metrics.offFill));
    themeResults.push({ theme: theme || "default", badge, label, zoomPreset, offLabel, offMeta, nodeFill: metrics.nodeFill, offFill: metrics.offFill, markStroke: metrics.markStroke });
    assert(badge >= 4.5, `${theme || "default"} 主题分支徽标数字对比度不足：${badge}`);
    assert(label >= 4.5, `${theme || "default"} 主题节点标题对比度不足：${label}（${metrics.labelFill} on ${metrics.nodeFill}）`);
    assert(offLabel >= 4.5, `${theme || "default"} 主题离线节点标题对比度不足：${offLabel}（${metrics.offLabelFill} on ${metrics.offFill}）`);
    assert(offMeta >= 4.5, `${theme || "default"} 主题离线节点手数对比度不足：${offMeta}`);
    assert(zoomPreset >= 4.5, `${theme || "default"} 主题缩放预设按钮对比度不足：${zoomPreset}`);
  }
  await contrastPage.evaluate(() => document.documentElement.removeAttribute("data-theme"));

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({
    pass: true,
    defaultView: { nodes: initial.count, branchPoints: initial.marks.map((mark) => mark.text).join("/"), offPathGold: initial.goldRects.join("/") },
    mainBranch: { toastAndFlag: mainlineHead?.includes("在主分支上") === true, setButtonGone: true },
    wholeTree: { default: defaultCount, expanded: expandedCount, collapsed: collapsedCount },
    perLevel: { oneLevel: oneLevel.count, twoLevels: twoLevels.count, backToOne: backToOne.count, pathOnly: pathOnly.count },
    sideBelowMain: verticalShape,
    grid: { branchNodeRows: oneLevel.grid.perRow, leafNodeRows: initial.grid.perRow, minTarget: `${oneLevel.grid.minWidth}x${oneLevel.grid.minHeight}` },
    viewports: visual,
    themes: themeResults.map(({ theme, badge, label, offLabel, offMeta }) => ({ theme, badge, label, offLabel, offMeta })),
  }, null, 2));
  await context.close();
  await browser.close();
} catch (error) {
  console.error(`FAIL ${error.message}`);
  await browser.close();
  process.exit(1);
}
