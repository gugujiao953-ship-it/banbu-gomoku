import assert from "node:assert/strict";
import { chromium } from "playwright";

const sourceURL = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const url = new URL(sourceURL);
url.searchParams.set("qa", "1");

const timestamp = "2026-09-01T00:00:00.000Z";
const moveNode = (id, parentId, children, row, col, player, boardText) => ({
  id,
  parentId,
  children,
  move: { row, col, player },
  comment: "",
  marks: [],
  ...(boardText ? { boardText } : {}),
});
const record = {
  id: "record-branch-marker-regression",
  version: 1,
  rootId: "root",
  nodes: {
    root: { id: "root", parentId: null, children: ["n1"], move: null, comment: "", marks: [], preferredChildId: "n1" },
    n1: { ...moveNode("n1", "root", ["n2main", "n2alt"], 7, 7, "black"), preferredChildId: "n2main" },
    n2main: { ...moveNode("n2main", "n1", ["n3main", "n3alt"], 7, 8, "white", "A"), preferredChildId: "n3main" },
    n2alt: moveNode("n2alt", "n1", [], 6, 7, "white", "B"),
    n3main: { ...moveNode("n3main", "n2main", ["n4main", "n4alt"], 8, 8, "black", "C"), preferredChildId: "n4main" },
    n3alt: moveNode("n3alt", "n2main", [], 7, 6, "black", "D"),
    n4main: { ...moveNode("n4main", "n3main", ["n5main"], 6, 7, "white", "E"), preferredChildId: "n5main" },
    n4alt: moveNode("n4alt", "n3main", [], 8, 9, "white", "F"),
    n5main: moveNode("n5main", "n4main", [], 5, 7, "black", "G"),
  },
  metadata: {
    title: "分支标记回归谱",
    black: "黑方",
    white: "白方",
    event: "",
    date: "2026-09-01",
    result: "",
    rule: "renju",
    openingRule: "free",
    boardSize: 15,
    tags: [],
  },
  createdAt: timestamp,
  updatedAt: timestamp,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

const variationIds = () => page.locator(".renlib-variation").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-node-id")));
const clickEmpty = (coordinate) => page.getByRole("gridcell", { name: new RegExp(`^${coordinate}(?:空位|禁手)`) }).click();
const clickVariation = (coordinate) => page.getByRole("gridcell", { name: `切换到变化 ${coordinate}`, exact: true }).click();

async function assertBoardInvariants(label) {
  const state = await page.locator(".renju-board").evaluate((svg) => {
    const markerElements = [...svg.querySelectorAll(".renlib-variation")];
    const stoneElements = [...svg.querySelectorAll(".stone-piece")];
    const pointOf = (element, stone) => {
      const visual = stone ? element.querySelector("circle.stone") : element.querySelector("text, circle");
      if (!visual) return null;
      const x = visual.getAttribute(stone ? "cx" : visual.tagName.toLowerCase() === "text" ? "x" : "cx");
      const y = visual.getAttribute(stone ? "cy" : visual.tagName.toLowerCase() === "text" ? "y" : "cy");
      return x !== null && y !== null ? `${Number(x).toFixed(3)},${Number(y).toFixed(3)}` : null;
    };
    const markerPoints = markerElements.map((element) => pointOf(element, false)).filter(Boolean);
    const stonePoints = new Set(stoneElements.map((element) => pointOf(element, true)).filter(Boolean));
    const markerLabels = markerElements.map((element) => element.getAttribute("aria-label"));
    const firstStone = stoneElements[0];
    const markerBeforeStones = !firstStone || markerElements.every((marker) => Boolean(marker.compareDocumentPosition(firstStone) & Node.DOCUMENT_POSITION_FOLLOWING));
    return {
      boardHits: svg.querySelectorAll(".board-hit").length,
      legacyVariationHits: svg.querySelectorAll(".variation-node-hit").length,
      duplicateMarkerPoints: markerPoints.length - new Set(markerPoints).size,
      duplicateMarkerLabels: markerLabels.length - new Set(markerLabels).size,
      markerStoneOverlaps: markerPoints.filter((point) => stonePoints.has(point)).length,
      markerBeforeStones,
    };
  });
  assert.equal(state.boardHits, 225, `${label}: 15x15 棋盘必须保持每格一个点击入口`);
  assert.equal(state.legacyVariationHits, 0, `${label}: 不得恢复独立透明变化点击层`);
  assert.equal(state.duplicateMarkerPoints, 0, `${label}: 同一坐标出现了多个变化标记`);
  assert.equal(state.duplicateMarkerLabels, 0, `${label}: 同一变化标签被重复绘制`);
  assert.equal(state.markerStoneOverlaps, 0, `${label}: 变化标记覆盖了已有棋子`);
  assert.equal(state.markerBeforeStones, true, `${label}: 变化标记必须位于棋子绘制层下方`);
}

try {
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.locator('input[type="file"][accept="*/*"]').setInputFiles({
    name: "分支标记回归谱.renju",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(record), "utf8"),
  });
  await page.waitForFunction(() => window.__banbuImportState?.state === "import-success");
  await page.getByText("分支标记回归谱", { exact: true }).first().waitFor();

  await clickVariation("H8");
  assert.deepEqual(await variationIds(), ["n2main", "n2alt"], "第一手后应显示 A/B 两个直接子变化");
  await assertBoardInvariants("第一手");

  await clickEmpty("F6");
  assert.equal(await page.locator(".stone-piece").count(), 2, "谱外落子应创建第二手草稿分支");
  assert.deepEqual(await variationIds(), ["n2main", "n2alt"], "创建草稿后原导入分支 A/B 不应消失");
  await assertBoardInvariants("草稿分支");

  await clickVariation("I8");
  assert.equal(await page.locator(".stone-piece").count(), 2, "点击 A 应切换到导入分支的第二手");
  assert.deepEqual((await variationIds()).slice(0, 3), ["n3main", "n3alt", "n2alt"], "A 节点应显示直接 children 与同层 B");
  assert.equal((await variationIds()).length, 4, "A 节点还应保留刚创建的同层草稿分支");
  await assertBoardInvariants("切换到 A");

  await clickVariation("I7");
  assert.equal(await page.locator(".stone-piece").count(), 3, "点击 C 应前进到第三手");
  assert.deepEqual(await variationIds(), ["n4main", "n4alt", "n3alt"], "第三手只应显示直接子变化 E/F 与同层 D");
  assert.ok(!(await variationIds()).includes("n2alt"), "进入下一层后祖先分支 B 必须退出棋盘");
  await assertBoardInvariants("第三手");

  await clickVariation("H9");
  assert.equal(await page.locator(".stone-piece").count(), 4, "点击 E 应落到与旧 B 同坐标的第四手");
  assert.deepEqual(await variationIds(), ["n5main", "n4alt"], "第四手只应显示直接子 G 与同层 F");
  await assertBoardInvariants("第四手占用旧分支坐标");

  await clickVariation("H10");
  assert.equal(await page.locator(".stone-piece").count(), 5, "点击 G 应前进到第五手");
  assert.deepEqual(await variationIds(), [], "深入五手后不得残留任何祖先变化标记");
  await assertBoardInvariants("第五手深层叶节点");

  await page.getByRole("gridcell", { name: "H9已有棋子", exact: true }).click();
  assert.equal(await page.locator(".stone-piece").count(), 5, "点击旧分支同坐标的已有棋子不得发生跳转");

  await clickEmpty("G8");
  assert.equal(await page.locator(".stone-piece").count(), 6, "点击已退出的祖先分支坐标应新增下一手，而不是同手换点");
  assert.equal(await page.getByRole("gridcell", { name: "G8已有棋子", exact: true }).count(), 1, "新增下一手必须落在用户点击的 G8");
  await assertBoardInvariants("旧分支坐标新增下一手");

  if (process.env.BANBU_BRANCH_SCREENSHOT) {
    await Promise.all([
      page.locator(".board-feedback").waitFor({ state: "detached", timeout: 5_000 }),
      page.locator(".import-progress").waitFor({ state: "detached", timeout: 5_000 }),
      page.locator(".app-toast").waitFor({ state: "detached", timeout: 5_000 }),
    ]);
    await page.screenshot({ path: process.env.BANBU_BRANCH_SCREENSHOT, fullPage: true });
  }
  assert.deepEqual(pageErrors, [], `页面运行错误：${pageErrors.join(" | ")}`);
  assert.deepEqual(consoleErrors, [], `控制台错误：${consoleErrors.join(" | ")}`);
  console.log("Record branch marker browser verification passed: import, draft branch, sibling/child navigation, deep cleanup, occupied-point guard, and old-coordinate continuation.");
} finally {
  await context.close();
  await browser.close();
}
