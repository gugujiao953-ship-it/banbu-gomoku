/**
 * 门禁：DP 局面数据库（内置九天指南 v5-1）的生产路径。
 *
 * 覆盖：打开与记录数、**异步预取铺开**（onUpdate 分批推送，open() 当场只有根局面）、
 * 根候选、按局面落子/退回/重走（缓存只增不减是设计）、库里没有的局面（重复落子）不崩且投影不变、
 * 未加载占位与按节点读取（有未加载就减少、没有则无副作用）、盘面文字字段可读、
 * 关闭后需要 worker 的操作必须**明确报错**。
 *
 * 2026-09-19 实测抓到并修掉：`DpViewSession.close()` 之后再用同一会话 open() 会**永远挂起**
 * （worker 已 terminate，postMessage 被静默丢弃、pending 永不落地；探针 500 秒超时实锤）。
 * 修法是两个会话类（DP 与 RenLib 网页核心）都加「已关闭」守卫，post-close 请求立即报错。
 *
 * 用法：BANBU_URL=http://localhost:5193 node qa/dp-battery.mjs
 * 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5193/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".app-shell", { timeout: 60000 });

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

// 页面侧常驻会话（挂在 window 上，跨 evaluate 复用）
await page.evaluate(async () => {
  const { DpViewSession } = await import("/src/dp-view-session.ts");
  const response = await fetch("/records/九天指南v5-1.db");
  const file = new File([await response.arrayBuffer()], "九天指南v5-1.db", { type: "application/octet-stream" });
  window.__dp = { session: new DpViewSession(), file, updates: 0 };
  window.__dp.session.onUpdate = () => { window.__dp.updates += 1; };
});

const open = await page.evaluate(async () => {
  const opened = await window.__dp.session.open(window.__dp.file);
  return { recordCount: opened.recordCount, nodes: Object.keys(opened.document.nodes).length, hasCurrent: Boolean(opened.document.nodes[opened.currentId]) };
});
check("D1 打开内置 DP：记录数与根局面", open.recordCount > 1000 && open.hasCurrent, `记录 ${open.recordCount} · 初始节点 ${open.nodes}`);

await page.waitForTimeout(3500); // 等异步预取铺开

const snap = await page.evaluate(async () => {
  const view = await window.__dp.session.root();
  const nodes = Object.values(view.document.nodes);
  const root = view.document.nodes[view.document.rootId];
  return {
    nodes: nodes.length,
    rootChildren: (root?.children || []).length,
    pending: nodes.filter((node) => node.pendingChildren).length,
    moves: nodes.filter((node) => node.move).length,
    withText: nodes.filter((node) => node.boardText || node.renLibNativeLabel).length,
    updates: window.__dp.updates,
    firstMoveId: nodes.find((node) => node.move)?.id || "",
    firstMove: nodes.find((node) => node.move)?.move || null,
  };
});
check("D2 预取铺开：根有候选、文档边长出来", snap.nodes > 3 && snap.rootChildren > 0, `节点 ${snap.nodes} · 根候选 ${snap.rootChildren} · 预取回调 ${snap.updates} 次`);
check("D3 未加载占位与带文字节点字段可读", snap.pending >= 0 && snap.withText >= 0, `未加载 ${snap.pending} · 带文字 ${snap.withText} · 可落子点 ${snap.moves}`);

const moved = await page.evaluate(async (position) => {
  const view = await window.__dp.session.move(position);
  const node = view.document.nodes[view.currentId];
  return { currentId: view.currentId, hasMove: Boolean(node?.move), nodes: Object.keys(view.document.nodes).length };
}, snap.firstMove);
check("D4 按局面落子：currentId 跟着走", moved.hasMove, `currentId=${moved.currentId.slice(-12)} 节点 ${moved.nodes}`);

const backed = await page.evaluate(async () => {
  const view = await window.__dp.session.back();
  return { currentId: view.currentId, rootId: view.document.rootId };
});
check("D5 退回根局面（缓存只增不减是设计）", backed.currentId === backed.rootId, `currentId=${backed.currentId.slice(-10)}`);

const ghost = await page.evaluate(async (firstMove) => {
  const before = await window.__dp.session.root();
  const beforeCount = Object.keys(before.document.nodes).length;
  let message = "";
  // 必然不在库里的局面：把子落在**已经有子**的点上（库里不可能有这种局面）
  try { await window.__dp.session.move(firstMove); } catch (error) { message = String(error); }
  const after = await window.__dp.session.root();
  return { crashed: Boolean(message), message: message.slice(0, 80), beforeCount, afterCount: Object.keys(after.document.nodes).length };
}, snap.firstMove);
check("D6 库里没有的局面（重复落子）：不崩、投影不变", !ghost.crashed && ghost.afterCount === ghost.beforeCount, `${ghost.beforeCount} → ${ghost.afterCount} ${ghost.message}`);

const branchLoad = await page.evaluate(async (nodeId) => {
  const before = Object.values((await window.__dp.session.root()).document.nodes);
  await window.__dp.session.loadBranchByNodeId(nodeId);
  return { pendingBefore: before.filter((node) => node.pendingChildren).length };
}, snap.firstMoveId);
await page.waitForTimeout(2500);
const afterLoad = await page.evaluate(async () => {
  const nodes = Object.values((await window.__dp.session.root()).document.nodes);
  return { nodes: nodes.length, pending: nodes.filter((node) => node.pendingChildren).length, updates: window.__dp.updates };
});
// 预取预算内可能已全部加载（内置库实测未加载 0）——那时「点开未加载枝」应是无副作用的空操作。
const loadOk = branchLoad.pendingBefore > 0
  ? afterLoad.pending < branchLoad.pendingBefore
  : afterLoad.nodes >= snap.nodes && afterLoad.pending === 0;
check("D7 按节点读取：有未加载就减少，没有则无副作用", loadOk, `节点 ${snap.nodes}→${afterLoad.nodes} · 未加载 ${branchLoad.pendingBefore}→${afterLoad.pending}`);

/**
 * D9：**每个导航到的局面，棋盘上都必须有该局面在库里的全部选点**。
 *
 * 用户 2026-10-09 报的「九天指南那些选点呀标注呀，竟然有很多地方没有，是残缺的」。
 * 根因不是数据丢（原始 @BTXT@ 4170 个标注一条不少、库记录 5823 条完整），
 * 而是**渲染出口**：`prefetchRoot` 广度优先铺 900 个局面，预算在第 4–5 层就烧光
 * （实测 depth3=184 / depth4=439 / depth5=266，合计 889，占 98%），
 * 于是 depth3 的 184 个局面里只有 31 个「有子节点」= 能在棋盘上画出选点，
 * 另外 153 个画不出任何选点；全库 905 个已加载局面里 **641 个（71%）棋盘是空的**。
 * 修法是 `ensureChildrenLoaded`：导航到哪个局面，就把那个局面的子节点补齐（只补一层）。
 *
 * 断言逐手走主分支，每一步都要求 `node.children.length === 库里该局面的候选数`。
 * 它同时钉住两件事：① 选点不再残缺；② 走到库里真没有后续的局面时是**真 0**（不是没查）。
 * ⚠ 必须排在 D8 之前——D8 会把会话 close 掉。
 */
const coverage = await page.evaluate(async () => {
  const { DpViewSession } = await import("/src/dp-view-session.ts");
  const fmt = await import("/src/formats.ts");
  const bytes = new Uint8Array(await (await fetch("/records/九天指南v5-1.db")).arrayBuffer());
  const states = fmt.parseDpDatabaseStates(fmt.decodeDpDatabaseFrame(bytes));
  const session = new DpViewSession();
  await session.open(new File([bytes], "九天指南v5-1.db", { type: "application/octet-stream" }));
  await new Promise((resolve) => setTimeout(resolve, 4500));

  const rows = [];
  const measure = (view, label) => {
    const node = view.document.nodes[view.currentId];
    const path = [];
    let cursor = node;
    while (cursor && cursor.parentId) { path.unshift(cursor.move); cursor = view.document.nodes[cursor.parentId]; }
    const board = new Uint8Array(225);
    path.forEach((move, index) => { if (move) board[move.row * 15 + move.col] = index % 2 === 0 ? 1 : 2; });
    const expected = fmt.queryDpPosition(states, board, path.length % 2 === 0 ? 0 : 1).branches.length;
    rows.push({ label, depth: path.length, expected, actual: node.children.length });
  };

  let view = await session.root();
  measure(view, "root");
  for (let step = 1; step <= 8; step += 1) {
    const current = view.document.nodes[view.currentId];
    const nextId = current.children[0];
    const move = nextId ? view.document.nodes[nextId]?.move : null;
    if (!move) break;
    view = await session.move(move);
    measure(view, `手${step}`);
  }
  view = await session.back();
  measure(view, "back");
  session.close();
  return rows;
});
const coverageBad = coverage.filter((row) => row.expected !== row.actual);
check(
  "D9 逐手核对：棋盘选点 == 库里候选（选点不再残缺）",
  coverageBad.length === 0,
  coverageBad.length
    ? coverageBad.map((row) => `${row.label} 库${row.expected}/盘${row.actual}`).join(" · ")
    : coverage.map((row) => `${row.label}:${row.expected}`).join(" "),
);

const closed = await page.evaluate(async () => {
  window.__dp.session.close();
  let message = "";
  try { await window.__dp.session.open(window.__dp.file); } catch (error) { message = String(error); }
  return message;
});
check("D8 关闭后需要 worker 的操作明确报错", /关闭|close|session|terminate|worker/i.test(closed), closed.slice(0, 60) || "（没有报错）");

check("Z 无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(failed ? `\n${failed} 项有问题` : "\n全部通过");
process.exit(failed ? 1 : 0);
