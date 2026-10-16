/**
 * 一次性探针（2026-10-12，P1 验证）：九天指南真实库里「候选 > 12 支」的局面确实存在，
 * 且按节点读取（App.loadTreeBranch → session.loadBranchByNodeId）之后全部候选都能读回来。
 *
 * 修复前：树面板 `readChildren` 一律窗口 12 支，第 13 支之后永远画不出来——
 * 徽标写 29、画布只有 12，点「展开下一层」也不变（那一层早就"够"了）。
 * 修复后：这一手被用户摊开过（openLevels > 0）就不设上限。
 *
 * 用法：QA_BASE_URL=http://localhost:5173/?qa=1 node qa/probe-p1-wide-fork.mjs
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5173/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".app-shell", { timeout: 60000 });

await page.evaluate(async () => {
  const { DpViewSession } = await import("/src/dp-view-session.ts");
  const response = await fetch("/records/九天指南v5-1.db");
  const file = new File([await response.arrayBuffer()], "九天指南v5-1.db", { type: "application/octet-stream" });
  window.__p1 = { session: new DpViewSession(), file };
  await window.__p1.session.open(file);
});

await page.waitForTimeout(4000); // 等异步预取铺开

// 投影里每个「已加载」节点的候选总数 = children.length + unloadedChildren
const scan = await page.evaluate(async () => {
  const view = await window.__p1.session.root();
  const wide = [];
  for (const node of Object.values(view.document.nodes)) {
    const total = (node.children || []).length + (node.unloadedChildren || 0);
    if (total > 12) wide.push({ id: node.id, total, loaded: (node.children || []).length, unloaded: node.unloadedChildren || 0 });
  }
  wide.sort((a, b) => b.total - a.total);
  return { loaded: Object.keys(view.document.nodes).length, wideCount: wide.length, top: wide.slice(0, 6) };
});
console.log("已加载局面:", scan.loaded, "· 候选>12支的局面:", scan.wideCount);
console.log("最宽的几处:", JSON.stringify(scan.top, null, 1));

// 按节点读取：最宽那一处读回来之后，候选应当全部变成 children
const widest = scan.top[0];
const after = await page.evaluate(async (nodeId) => {
  const before = await window.__p1.session.root();
  const beforeNode = before.document.nodes[nodeId];
  await window.__p1.session.loadBranchByNodeId(nodeId);
  const now = await window.__p1.session.root();
  const node = now.document.nodes[nodeId];
  return {
    before: { loaded: (beforeNode?.children || []).length, unloaded: beforeNode?.unloadedChildren || 0 },
    after: { loaded: (node?.children || []).length, unloaded: node?.unloadedChildren || 0 },
  };
}, widest.id);
console.log("最宽那一处 按节点读取前后:", JSON.stringify(after));

const ok = after.after.unloaded === 0 && after.after.loaded === widest.total;
console.log(ok ? "PASS 读回来之后候选无遗漏（载入数 == 候选总数，未加载归零）" : "FAIL 读取后仍有缺口");
await browser.close();
if (errors.length) console.log("页面错误:", errors.join(" | "));
