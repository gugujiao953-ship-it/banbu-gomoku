import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";

const filePath = process.argv[2] || "D:\\五子棋\\其他\\九天指南v4-2.db";
const url = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:4173/");
url.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const read = () => page.evaluate(() => {
  const board = document.querySelector(".renju-board");
  const stones = [...document.querySelectorAll(".stone-piece")];
  const markers = [...document.querySelectorAll(".renlib-variation")];
  const center = (node) => { const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; };
  const stoneCenters = stones.map(center);
  return {
    stones: stones.length,
    markers: markers.map((node) => node.getAttribute("aria-label") || ""),
    hits: board?.querySelectorAll(".board-hit").length || 0,
    legacy: board?.querySelectorAll(".variation-node-hit").length || 0,
    overlaps: markers.map(center).filter((marker) => stoneCenters.some((stone) => Math.hypot(marker.x - stone.x, marker.y - stone.y) < 18)).length,
  };
});
const coordinateOf = (label) => label.replace(/^变化点\s*/, "");
const click = async (coordinate) => {
  const cell = page.getByRole("gridcell", { name: new RegExp(`^(?:切换到变化 )?${coordinate}(?:空位|已有棋子|禁手)?$`) }).first();
  await cell.waitFor({ timeout: 15_000 });
  await cell.click();
  await page.waitForTimeout(600);
  const state = await read();
  assert.equal(state.hits, 225);
  assert.equal(state.legacy, 0);
  assert.equal(state.overlaps, 0);
  assert.equal(new Set(state.markers).size, state.markers.length);
  return state;
};
const resetAndImport = async () => {
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.waitForTimeout(3200);
  const edited = await click("A1");
  assert.deepEqual(edited.markers, [], "新局面不得保留根局面的分支");
  await page.getByRole("button", { name: "到第一手" }).click();
  await page.waitForTimeout(500);
  return click("H8");
};

try {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);
  const first = await resetAndImport();
  const branches = first.markers.map(coordinateOf);
  assert.ok(branches.length > 1, "导入后应有多个可测试的下一手分支");
  for (const rootBranch of branches) {
    let state = await resetAndImport();
    state = await click(rootBranch);
    let maxDepth = state.stones;
    for (let depth = 0; depth < 16; depth += 1) {
      const next = state.markers[0];
      if (!next) break;
      const before = state.stones;
      state = await click(coordinateOf(next));
      if (state.stones !== before + 1) break;
      maxDepth = state.stones;
    }
    console.log(`branch ${rootBranch}: depth=${maxDepth}`);
  }
  assert.deepEqual(pageErrors, []);
  console.log("PASS: 多分支深度矩阵复现无标记叠加、无错误停步");
} finally {
  await context.close();
  await browser.close();
}
