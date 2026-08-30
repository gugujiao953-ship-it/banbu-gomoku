import { chromium } from "playwright";

const file = process.argv[2] || String.raw`D:\五子棋\其他\九天指南v4-2.db`;
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5182/";
const path = ["H8", "G9", "J6"];
const branch = process.argv[3] || "G10";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(file);
await page.waitForFunction(() => Boolean(window.__banbuImportDiagnostic) || Boolean(document.querySelector(".toast")), null, { timeout: 120000 });
await page.waitForTimeout(500);

const snapshot = async (name) => ({
  name,
  status: (await page.locator(".workspace-status").textContent())?.trim() || "",
  stones: await page.locator(".stone").count(),
  variations: await page.locator(".renlib-variation").evaluateAll((nodes) => nodes.map((node) => ({ aria: node.getAttribute("aria-label"), text: node.textContent?.trim() || "" }))),
  nextEnabled: await page.locator('button[aria-label="下一手"]').isEnabled().catch(() => false),
});

const snapshots = [await snapshot("opened")];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const coordinate of path) {
  const before = await page.locator(".stone").count();
  await page.locator(`[role="gridcell"][aria-label^="${coordinate}"]`).first().click();
  await page.waitForFunction((count) => document.querySelectorAll(".stone").length > count, before, { timeout: 5000 });
  await page.waitForTimeout(120);
  snapshots.push(await snapshot(`path-${coordinate}`));
}

const branchLocator = page.locator(`[role="gridcell"][aria-label^="${branch}"]`).first();
const branchVisual = page.locator(`.renlib-variation[aria-label="变化点 ${branch}"]`).filter({ hasText: "A" }).first();
assert(await branchVisual.count() === 1, `没有找到带 A 标记的 ${branch} 变化点`);
assert(Boolean(await branchVisual.getAttribute("data-node-id")), `${branch} 变化点没有绑定节点 ID`);
const branchCountBefore = await page.locator(".stone").count();
await branchLocator.click();
await page.waitForTimeout(500);
snapshots.push(await snapshot(`clicked-${branch}`));
const branchCountAfter = await page.locator(".stone").count();
assert(branchCountAfter === branchCountBefore + 1, `点击带 A 的 ${branch} 没有进入下一手`);
assert(await page.locator(".database-edit-hint").count() === 1, "点击已有 A 分支不应立即创建编辑副本");
assert(snapshots.at(-1).variations.length === 0, "A 分支到达终点后不应继续显示上一层的兄弟 A 分支");

const next = page.locator('button[aria-label="下一手"]');
const enabledAfterBranch = await next.isEnabled().catch(() => false);
assert(!enabledAfterBranch, "样本数据库中 A 终点的下一手状态异常；应明确显示为终点");
if (enabledAfterBranch) await next.click();
await page.waitForTimeout(500);
snapshots.push(await snapshot(`next-after-${branch}`));

const continueEditing = page.getByRole("button", { name: "在此处继续编辑" });
assert(await continueEditing.count() === 1, "数据库终点没有显示继续编辑入口");
await continueEditing.click();
await page.waitForTimeout(150);
assert(await page.locator(".database-edit-hint").count() === 0, "点击继续编辑后仍停留在数据库只读视图");

// The selected branch label is stored on the parent query as an edge label.
// After entering the editable projection, walking back must retain that
// label; otherwise the child is incorrectly rendered as a gray neutral dot.
const expectedBacktrackLabels = [
  { coordinate: "G10", label: "A" },
  { coordinate: "J6", label: "彗" },
  { coordinate: "G9", label: "斜" },
];
for (const expected of expectedBacktrackLabels) {
  await page.locator('button[aria-label="上一手"]').click();
  await page.waitForTimeout(250);
  const variation = page.locator(`.renlib-variation[aria-label="变化点 ${expected.coordinate}"]`).first();
  assert(await variation.count() === 1, `编辑副本回退后没有找到 ${expected.coordinate} 变化点`);
  assert((await variation.textContent())?.trim() === expected.label, `编辑副本回退后 ${expected.coordinate} 标签丢失，实际为 ${(await variation.textContent())?.trim() || "灰点"}`);
  assert(await variation.locator(".renlib-variation-dot").count() === 0, `编辑副本回退后 ${expected.coordinate} 被错误绘制为灰点`);
}

// Return to the terminal position before checking the existing continuation
// behavior below.
await page.locator('button[aria-label="到最后一手"]').click();
await page.waitForTimeout(250);

// A terminal continuation must also be able to reuse a point that belonged to
// a sibling A branch as a new move. This is the regression case that used to
// jump back to the sibling variation instead of creating an editable move.
const oldSiblingPoint = branch === "G10" ? "H10" : "G10";
const beforeSiblingContinuation = await page.locator(".stone").count();
await page.locator(`[role="gridcell"][aria-label^="${oldSiblingPoint}"]`).first().click();
await page.waitForTimeout(500);
assert(await page.locator(".stone").count() === beforeSiblingContinuation + 1, `终点续谱时点击旧分支点 ${oldSiblingPoint} 没有创建新落子`);
assert(await page.locator(".database-edit-hint").count() === 0, "终点续谱后又回到了数据库只读视图");
snapshots.push(await snapshot(`continuation-on-old-${oldSiblingPoint}`));

const manualPoint = "K10";
await page.locator(`[role="gridcell"][aria-label^="${manualPoint}"]`).first().click();
await page.waitForTimeout(500);
snapshots.push(await snapshot(`manual-after-${branch}`));

console.log(JSON.stringify({ file, base, path, branch, branchCountBefore, branchCountAfter, snapshots, errors }, null, 2));
if (errors.length) process.exitCode = 1;
await browser.close();
