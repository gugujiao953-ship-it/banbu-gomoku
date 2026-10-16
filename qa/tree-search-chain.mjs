import { chooseTreeZoom } from "./tree-controls.mjs";
import { chromium } from "playwright";

// 分支树门禁（用户 09-26 三条）：
//   ① 链条节点不再只有手数——胶囊上同时有坐标与手数（用户：「连坐标都没有」）
//   ② 双指缩放以**两指中点**为锚（用户：「不知道是在哪个地方缩的、看的点跑出视线」），
//      并且缩到 5% 后整棵树仍在视野里（缩放会把画面夹回内容附近）
//   ③ 搜索按钮：搜手数 / 坐标 / 注释 / 标注，输入即跳到最近的命中，「上一个 / 下一个」
//      按「从近到远」逐个翻（用户要的 Word 式查找）
// 用法：QA_BASE_URL=http://127.0.0.1:5173/ node qa/tree-search-chain.mjs
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaURL = new URL(baseURL); qaURL.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const metadata = { title: "树搜索回归", black: "黑方", white: "白方", event: "", date: "2026-09-26", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] };
// 30 手一条主线，第 12 手一个分叉（两个兄弟分支）、第 20 手两个分支；
// 第 5 手一条注释、第 17 手一条提到 H8 的注释、第 9 手一个 H8 三角标注、第 22 手一个圆圈标注。
const line = [[7, 7], [7, 8], [6, 7], [8, 8], [6, 8], [8, 7], [5, 7], [9, 8], [5, 8], [9, 7],
  [4, 7], [10, 8], [4, 8], [10, 7], [3, 7], [11, 8], [3, 8], [11, 7], [2, 7], [12, 8],
  [2, 8], [12, 7], [1, 7], [13, 8], [1, 8], [13, 7], [0, 7], [14, 8], [0, 8], [14, 7]];
const nodes = { root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] } };
line.forEach(([row, col], index) => {
  const id = `m${index + 1}`;
  const children = index + 1 < line.length ? [`m${index + 2}`] : [];
  if (index === 11) children.push("b12");
  if (index === 19) children.push("b20a", "b20b");
  nodes[id] = {
    id, parentId: index === 0 ? "root" : `m${index}`, children,
    move: { row, col, player: index % 2 === 0 ? "black" : "white" },
    comment: index === 4 ? "黑棋这里要小心双三" : index === 16 ? "白棋需要防守 H8 这一手交换" : "",
    marks: index === 8 ? [{ row: 7, col: 7, kind: "triangle" }] : index === 21 ? [{ row: 8, col: 8, kind: "circle" }] : [],
  };
});
nodes.b12 = { id: "b12", parentId: "m12", children: [], move: { row: 9, col: 9, player: "black" }, comment: "分支：换一边挡", marks: [] };
nodes.b20a = { id: "b20a", parentId: "m20", children: [], move: { row: 10, col: 10, player: "black" }, comment: "", marks: [] };
nodes.b20b = { id: "b20b", parentId: "m20", children: [], move: { row: 10, col: 11, player: "black" }, comment: "", marks: [{ row: 10, col: 11, kind: "cross" }] };
const active = { id: "tree-search-gate", version: 1, rootId: "root", savedCurrentId: "m24", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z", metadata, nodes };
const seed = (doc) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(doc));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([doc]));
};

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
// onnxruntime 在部分 CPU（本机 cpuinfo_vendor=0）上会把一条 Unknown CPU vendor 警告写到 stderr，
// 浏览器按 console error 报出来。它不影响推理（识谱用例全绿），但不许再冒充"页面出错"。
page.on("console", (message) => { const t = message.text(); if (message.type() === "error" && !/onnxruntime[\s\S]{0,80}(Unknown CPU vendor|cpuinfo_vendor)/i.test(t)) errors.push(`console: ${t}`); });
page.setDefaultTimeout(15_000);
await page.addInitScript(seed, active);
await page.goto(qaURL.href, { waitUntil: "domcontentloaded" });
await page.getByLabel("当前工作状态").first().waitFor();
if (!await page.getByRole("button", { name: "打开分支树" }).isVisible()) await page.getByRole("button", { name: "行棋" }).click();
await page.getByRole("button", { name: "打开分支树" }).click();
await page.getByRole("tab", { name: /图谱/ }).click();
await page.getByRole("dialog", { name: "分支树" }).waitFor();
await page.waitForTimeout(600);

// ── ① 链条胶囊：坐标 + 手数都在 ────────────────────────────────────────────────
const chain = await page.evaluate(() => [...document.querySelectorAll(".tree-node")].filter((node) => node.querySelector(".tree-chain-label")).map((node) => ({
  label: node.querySelector(".tree-chain-label").textContent,
  num: node.querySelector(".tree-chain-num").textContent,
  aria: (node.getAttribute("aria-label") || "").split("，")[0],
})));
assert(chain.length >= 8, `① 默认视野里应有足够多的链条胶囊（只有 ${chain.length} 个）`);
assert(chain.every((item) => /^[A-O]\d{1,2}$/.test(item.label)), `① 胶囊左边必须是坐标：${JSON.stringify(chain.slice(0, 5))}`);
assert(chain.every((item) => Number(item.num) > 0), `① 胶囊右边必须是手数：${JSON.stringify(chain.slice(0, 5))}`);
assert(new Set(chain.map((item) => item.label)).size === chain.length, `① 每手坐标应各不相同：${JSON.stringify(chain.map((item) => item.label))}`);

// ── ② 双指缩放以指中为锚；缩到 5% 内容仍在视野里 ───────────────────────────────
const transform = () => page.evaluate(() => {
  const group = document.querySelector(".tree-canvas > g");
  const nums = (group.getAttribute("transform") || "").match(/[-\d.]+/g).map(Number);
  return { panX: nums[0], panY: nums[1], scale: nums[2] };
});
const nodeCenters = () => page.evaluate(() => [...document.querySelectorAll(".tree-node")].slice(0, 6).map((node) => {
  const rect = node.getBoundingClientRect();
  return { label: (node.getAttribute("aria-label") || "").split("，")[0], cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
}));
// 用 CDP 派发**真实的两指触摸**（playwright 的 touchscreen 只能点，合成 PointerEvent 又会让
// 应用里的 setPointerCapture 报「没有这个指针」——那是合成事件的假错误，不是应用的问题）。
const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
const mid = { x: 195, y: 300 };
const before = { ...await transform(), nodes: await nodeCenters() };
await touch("touchStart", [{ x: mid.x - 100, y: mid.y, id: 1 }, { x: mid.x + 100, y: mid.y, id: 2 }]);
await touch("touchMove", [{ x: mid.x - 60, y: mid.y, id: 1 }, { x: mid.x + 60, y: mid.y, id: 2 }]);
await touch("touchEnd", []);
await page.waitForTimeout(250);
const after = { ...await transform(), nodes: await nodeCenters() };
const ratio = after.scale / before.scale;
assert(Math.abs(ratio - 0.6) < 0.03, `② 双指收拢到 0.6 倍：实际 ${ratio.toFixed(3)}（${before.scale} → ${after.scale}）`);
const drifts = before.nodes.map((node) => {
  const now = after.nodes.find((item) => item.label === node.label);
  assert(now, `② 缩放后节点 ${node.label} 不见了`);
  return Math.hypot(now.cx - (mid.x + (node.cx - mid.x) * ratio), now.cy - (mid.y + (node.cy - mid.y) * ratio));
});
const worst = Math.max(...drifts);
assert(worst < 8, `② 双指缩放应以指中为锚（最大漂移 ${worst.toFixed(1)}px，锚点算法不对）`);

await chooseTreeZoom(page.getByRole("dialog", { name: "分支树" }), "5%");
await page.waitForTimeout(400);
const atFive = await page.evaluate(() => ({
  scale: Number((document.querySelector(".tree-canvas > g").getAttribute("transform") || "").match(/[-\d.]+/g)[2]),
  visible: [...document.querySelectorAll(".tree-node")].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  }).length,
  total: document.querySelectorAll(".tree-node").length,
}));
assert(Math.abs(atFive.scale - 0.05) < 0.002, `② 应缩到 5%：实际 ${atFive.scale}`);
assert(atFive.visible > 0, "② 缩到 5% 后一个节点都看不见（画面被推出视野了）");

// ── ③ 搜索：输入即跳到最近的命中，「上一个/下一个」从近到远逐个翻 ──────────────
await page.locator(".tree-search-toggle").click();
await page.locator(".tree-search-field input").fill("H8");
await page.waitForTimeout(500);
const search = await page.evaluate(() => ({
  nav: document.querySelector(".tree-search-nav span")?.textContent,
  rows: [...document.querySelectorAll(".tree-search-hit")].map((row) => ({
    turn: row.querySelector("b")?.textContent,
    kinds: row.querySelector("span")?.textContent,
    detail: row.querySelector("small")?.textContent,
  })),
  hit: [...document.querySelectorAll(".tree-node.search-hit")].map((node) => (node.getAttribute("aria-label") || "").split("，")[0]),
}));
// 当前在第 24 手：第 17 手（注释提到 H8）比第 9 手（H8 三角标）比第 1 手（落子 H8）都近
assert(search.rows.length === 3, `③ 「H8」应有 3 条命中（注释 / 标注 / 坐标各一），实际 ${JSON.stringify(search.rows)}`);
assert(search.rows.map((row) => row.turn).join(",") === "第 17 手,第 9 手,第 1 手", `③ 命中应从近到远排：${JSON.stringify(search.rows.map((row) => row.turn))}`);
assert(search.rows.map((row) => row.kinds).join("|") === "注释|标注|坐标", `③ 命中类型应分别是注释/标注/坐标：${JSON.stringify(search.rows.map((row) => row.kinds))}`);
assert(search.nav === "第 1 / 3 个命中", `③ 命中计数不对：${search.nav}`);
assert(search.hit.length === 1, `③ 画布上应把当前命中圈出来：${JSON.stringify(search.hit)}`);
const firstTurn = await page.evaluate(() => document.querySelector(".unified-status")?.textContent?.match(/第 \d+ 手/)?.[0] || "");
assert(firstTurn === "第 17 手", `③ 输入后应自动跳到最近的命中（第 17 手）：状态栏是「${firstTurn}」`);
await page.locator(".tree-search-nav button", { hasText: "下一个" }).click();
await page.waitForTimeout(400);
const second = await page.evaluate(() => ({
  nav: document.querySelector(".tree-search-nav span")?.textContent,
  turn: document.querySelector(".unified-status")?.textContent?.match(/第 \d+ 手/)?.[0] || "",
}));
assert(second.nav === "第 2 / 3 个命中" && second.turn === "第 9 手", `③ 「下一个」应翻到第 9 手：${JSON.stringify(second)}`);

// 标注按中文名搜；手数、坐标、注释也各来一发
const navOf = async (query) => {
  await page.locator(".tree-search-field input").fill(query);
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    nav: document.querySelector(".tree-search-nav span")?.textContent,
    rows: [...document.querySelectorAll(".tree-search-hit")].map((row) => `${row.querySelector("b")?.textContent}/${row.querySelector("small")?.textContent}`),
  }));
};
const byMark = await navOf("三角");
assert(byMark.nav === "第 1 / 1 个命中" && byMark.rows[0].includes("三角 H8"), `③ 按标注名「三角」应搜到 H8 那个标注：${JSON.stringify(byMark)}`);
const byTurn = await navOf("第 5 手");
assert(byTurn.rows.some((row) => row.startsWith("第 5 手")), `③ 按手数「第 5 手」应搜到：${JSON.stringify(byTurn)}`);
const byComment = await navOf("双三");
assert(byComment.nav === "第 1 / 1 个命中" && byComment.rows[0].includes("双三"), `③ 按注释「双三」应搜到：${JSON.stringify(byComment)}`);
const empty = await navOf("不存在的词");
assert(empty.nav === "没有命中", `③ 没有命中时要说清楚：${JSON.stringify(empty)}`);

if (errors.length) throw new Error(errors.join("\n"));
console.log(JSON.stringify({
  pass: true,
  chain: { count: chain.length, sample: chain.slice(0, 4).map((item) => `${item.label}·${item.num}`) },
  pinch: { ratio: Number(ratio.toFixed(3)), worstDriftPx: Number(worst.toFixed(1)) },
  fivePercent: atFive,
  search: { hits: search.rows.map((row) => `${row.turn}(${row.kinds})`), first: firstTurn, second: second.turn },
}, null, 2));
await browser.close();
