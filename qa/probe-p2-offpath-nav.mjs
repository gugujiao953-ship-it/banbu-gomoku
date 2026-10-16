/**
 * 一次性探针（2026-10-12，P2 验证）：真实 RenLib 课件里**旁支外的局面**按节点导航。
 *
 * 修复前：App 用 `moveFromDepth(pivotDepth, ...)`，而 pivotDepth 是投影层数、LIB 核心只认
 * idx 序列 —— 旁支上两者错位，`move()` 抛「这个位置不在当前 RenLib 分支中」。
 * 修复后：走 `session.moveToNodeId(nodeId, position)`（id 里自带 idx 路径）。
 *
 * 用法：QA_BASE_URL=http://localhost:5173/?qa=1 node qa/probe-p2-offpath-nav.mjs
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

for (const name of ["lektion2.lib", "lektion3.lib"]) {
  const result = await page.evaluate(async (fileName) => {
    const { RenLibWebViewSession } = await import("/src/renlib-web/renlib-web-view-session.ts");
    const response = await fetch(`/renlib-fixtures/${fileName}`);
    const file = new File([await response.arrayBuffer()], fileName, { type: "application/octet-stream" });
    const session = new RenLibWebViewSession();
    // open() 直接返回投影（document 与 currentId 都在里面）
    const opened = await session.open(file);
    let doc = opened.document;
    // 收集：已加载节点里「路径之外」的那些（旁支）——每个都试着按 id 走一次
    const seen = new Set();
    const queue = [doc.rootId];
    const targets = [];
    while (queue.length && targets.length < 6) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const node = doc.nodes[id];
      if (!node) continue;
      for (const childId of node.children) {
        const child = doc.nodes[childId];
        if (!child) continue;
        if (child.move && child.id.includes("-branch-")) targets.push({ id: child.id, move: child.move, boardText: child.boardText });
        queue.push(childId);
      }
    }
    // 没找到旁支形 id 就展开一层再找（真实课件第一层展开后旁支才出现）
    if (!targets.length) {
      const root = doc.nodes[doc.rootId];
      for (const childId of root.children) {
        await session.loadBranch(childId);
      }
      const reloaded = await session.root();
      doc = reloaded.document;
      const seen2 = new Set();
      const q2 = [doc.rootId];
      while (q2.length && targets.length < 6) {
        const id = q2.shift();
        if (!id || seen2.has(id)) continue;
        seen2.add(id);
        const node = doc.nodes[id];
        if (!node) continue;
        for (const childId of node.children) {
          const child = doc.nodes[childId];
          if (!child) continue;
          if (child.move && child.id.includes("-branch-")) targets.push({ id: child.id, move: child.move, boardText: child.boardText });
          q2.push(childId);
        }
      }
    }
    // 逐个按 id 导航
    let ok = 0;
    const failures = [];
    for (const target of targets) {
      try {
        const moved = await session.moveToNodeId(target.id, target.move);
        const landed = moved.document.nodes[moved.currentId];
        if (landed?.move && landed.move.row === target.move.row && landed.move.col === target.move.col) ok += 1;
        else failures.push(`${target.boardText}: 落点不符`);
      } catch (error) {
        failures.push(`${target.boardText}: ${String(error).slice(0, 60)}`);
      }
      await session.root();
    }
    return { file: fileName, targets: targets.length, ok, failures };
  }, name);
  console.log(`${result.file}: 旁支目标 ${result.targets} 个 · 导航成功 ${result.ok} 个`);
  if (result.failures.length) console.log("  失败:", result.failures.join(" | "));
  else if (result.targets) console.log("  PASS 全部按 id 走到（无一「不在当前分支中」）");
}

await browser.close();
if (errors.length) console.log("页面错误:", errors.join(" | "));
