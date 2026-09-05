import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";

const url = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:4173/");
url.searchParams.set("qa", "1");
const filePath = process.argv[2] || "D:\\五子棋\\其他\\九天指南v4-2.db";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") console.log("console-error", message.text()); });

const snapshot = async (label) => {
  const data = await page.evaluate(() => {
    const board = document.querySelector(".renju-board");
    const status = document.querySelector(".workspace-status");
    const summary = document.querySelector(".record-summary");
    const stones = [...document.querySelectorAll(".stone-piece")];
    const markers = [...document.querySelectorAll(".renlib-variation")];
    return {
      title: summary?.textContent?.trim(),
      status: status?.textContent?.trim(),
      currentNode: board?.getAttribute("data-current-id") || null,
      stones: stones.length,
      markerIds: markers.map((node) => node.getAttribute("data-node-id")),
      markerLabels: markers.map((node) => node.textContent?.trim()),
      markerAria: markers.map((node) => node.getAttribute("aria-label")),
      boardHits: board?.querySelectorAll(".board-hit").length || 0,
      legacyVariationHits: board?.querySelectorAll(".variation-node-hit").length || 0,
      toast: document.querySelector(".app-toast")?.textContent?.trim() || document.querySelector(".toast")?.textContent?.trim() || "",
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => node.textContent?.trim().slice(0, 180)),
    };
  });
  console.log(JSON.stringify({ label, ...data }, null, 2));
  return data;
};

const gridCell = (coordinate) => page.getByRole("gridcell", { name: new RegExp(`^(?:切换到变化 )?${coordinate}(?:空位|已有棋子|禁手)?$`) }).first();
const clickCoordinate = async (coordinate) => {
  const cell = gridCell(coordinate);
  await cell.waitFor({ timeout: 15_000 });
  console.log("click", coordinate, await cell.getAttribute("aria-label"));
  await cell.click();
  await page.waitForTimeout(500);
  return snapshot(`after-${coordinate}`);
};

try {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: "networkidle" });
  await snapshot("initial");
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(filePath);
  await page.waitForTimeout(3500);
  const imported = await snapshot("after-import");
  assert.equal(imported.stones, 0, "导入后应停在根局面");
  assert.ok(imported.markerAria.some((label) => label?.includes("变化点 H8")), "导入后应显示原谱首个分支 H8");
  // User's actual repro: leave the imported root position. The old root
  // branches belong to the previous position and must disappear immediately.
  const afterRootEdit = await clickCoordinate("A1");
  assert.equal(afterRootEdit.stones, 1, "编辑副本首手应落在 A1");
  assert.deepEqual(afterRootEdit.markerAria, [], "进入新局面后不应继续显示根局面的 H8 分支");

  const afterNewH8 = await clickCoordinate("H8");
  assert.equal(afterNewH8.stones, 2, "旧分支坐标在新局面应成为真正的第二手");
  assert.deepEqual(afterNewH8.markerAria, [], "新建第二手后不应重新冒出根局面的分支标记");

  await page.getByRole("button", { name: "到第一手" }).click();
  await page.waitForTimeout(500);
  const returnedRoot = await snapshot("returned-root");
  assert.equal(returnedRoot.stones, 0, "返回起点后应恢复根局面");
  assert.ok(returnedRoot.markerAria.some((label) => label?.includes("变化点 H8")), "只有返回起点后才应再次显示原谱 H8");
  assert.ok(returnedRoot.markerAria.some((label) => label?.includes("变化点 A1")), "返回起点后应同时显示本地草稿 A1");

  const afterH8 = await clickCoordinate("H8");
  assert.equal(afterH8.stones, 1, "从起点点击原谱 H8 应进入原谱首手");
  assert.ok(afterH8.markerAria.some((label) => label?.includes("变化点 G9")), "进入原谱 H8 后必须加载当前局面的下一手 G9");
  assert.ok(!afterH8.markerAria.some((label) => label?.includes("变化点 A1")), "进入 H8 后根局面的 A1 分支必须消失");

  const afterG9 = await clickCoordinate("G9");
  assert.equal(afterG9.stones, 2, "点击 G9 应推进到第二手，而不是切换同手分支");
  assert.ok(afterG9.markerAria.some((label) => label?.includes("变化点 J6")), "推进到 G9 后应显示下一手 J6");

  const afterJ6 = await clickCoordinate("J6");
  assert.equal(afterJ6.stones, 3, "点击 J6 应推进到第三手");
  assert.ok(afterJ6.markerAria.some((label) => label?.includes("变化点 G10")), "推进到 J6 后应显示下一手 G10");

  const final = await clickCoordinate("G10");
  assert.equal(final.stones, 4, "点击 G10 应推进到第四手");
  for (const state of [imported, afterRootEdit, afterNewH8, returnedRoot, afterH8, afterG9, afterJ6, final]) {
    assert.equal(state.boardHits, 225, "棋盘每个交叉点应只有一个点击层");
    assert.equal(state.legacyVariationHits, 0, "不应存在旧的透明变化点击层");
  }
  assert.deepEqual(pageErrors, [], "真实复现流程不应产生页面错误");
  console.log("PASS: 新局面只显示自己的下一手，上一局面的分支不会残留");
} finally {
  await context.close();
  await browser.close();
}
