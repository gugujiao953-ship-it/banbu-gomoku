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

const read = async () => page.evaluate(() => {
  const board = document.querySelector(".renju-board");
  const stones = [...document.querySelectorAll(".stone-piece")];
  const markers = [...document.querySelectorAll(".renlib-variation")];
  const center = (node) => { const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; };
  const stoneCenters = stones.map(center);
  const markerStoneOverlaps = markers.map(center).filter((marker) => stoneCenters.some((stone) => Math.hypot(marker.x - stone.x, marker.y - stone.y) < 18)).length;
  return { stones: stones.length, markers: markers.map((node) => node.getAttribute("aria-label") || ""), hits: board?.querySelectorAll(".board-hit").length || 0, legacy: board?.querySelectorAll(".variation-node-hit").length || 0, markerStoneOverlaps };
});
const click = async (coordinate) => {
  const cell = page.getByRole("gridcell", { name: new RegExp(`^(?:切换到变化 )?${coordinate}(?:空位|已有棋子|禁手)?$`) }).first();
  await cell.waitFor({ timeout: 15_000 });
  await cell.click();
  await page.waitForTimeout(650);
  const state = await read();
  console.log(`${coordinate}: stones=${state.stones} markers=${state.markers.length}`);
  assert.equal(state.hits, 225);
  assert.equal(state.legacy, 0);
  assert.equal(state.markerStoneOverlaps, 0);
  assert.equal(new Set(state.markers).size, state.markers.length);
  return state;
};

try {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.waitForTimeout(3500);
  const rootEdit = await click("A1");
  assert.deepEqual(rootEdit.markers, [], "新局面不得保留根局面的分支");
  await page.getByRole("button", { name: "到第一手" }).click();
  await page.waitForTimeout(500);
  let state = await click("H8");
  // Follow the first direct continuation to an already-loaded midgame point.
  for (let depth = 0; depth < 4; depth += 1) {
    const coordinate = state.markers[0]?.replace(/^变化点\s*/, "");
    if (!coordinate) throw new Error(`深度 ${depth} 没有可继续的原谱变化`);
    state = await click(coordinate);
  }
  const beforeEdit = state.stones;
  state = await click("A1");
  assert.equal(state.stones, beforeEdit + 1, "中途编辑应只新增一手草稿");
  assert.deepEqual(state.markers, [], "中途编辑的新局面不得保留上一局面的分支");
  // Return one step before switching to another branch, then keep advancing.
  await page.getByRole("button", { name: "上一手" }).click();
  await page.waitForTimeout(500);
  state = await read();
  const original = state.markers.find((label) => !label.endsWith(" A1")) || state.markers[0];
  if (!original) throw new Error("中途编辑后找不到原谱分支");
  state = await click(original.replace(/^变化点\s*/, ""));
  for (let step = 0; step < 8; step += 1) {
    const coordinate = state.markers[0]?.replace(/^变化点\s*/, "");
    if (!coordinate) break;
    const before = state.stones;
    const next = await click(coordinate);
    assert.equal(next.stones, before + 1, `中途编辑后第 ${step + 1} 手未推进`);
    state = next;
  }
  assert.deepEqual(pageErrors, []);
  console.log(`PASS: 中途编辑后仍可继续导航，最终棋子 ${state.stones}`);
} finally {
  await context.close();
  await browser.close();
}
