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

const snapshot = async (label) => {
  const data = await page.evaluate((snapshotLabel) => {
    const board = document.querySelector(".renju-board");
    const stones = [...document.querySelectorAll(".stone-piece")];
    const markers = [...document.querySelectorAll(".renlib-variation")];
    const center = (node) => { const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; };
    const stoneCenters = stones.map(center);
    const markerCenters = markers.map(center);
    const overlaps = markerCenters.filter((marker) => stoneCenters.some((stone) => Math.hypot(marker.x - stone.x, marker.y - stone.y) < 18)).length;
    return {
      label: snapshotLabel,
      stones: stones.length,
      markerAria: markers.map((node) => node.getAttribute("aria-label") || ""),
      boardHits: board?.querySelectorAll(".board-hit").length || 0,
      legacyVariationHits: board?.querySelectorAll(".variation-node-hit").length || 0,
      markerStoneOverlaps: overlaps,
    };
  }, label);
  console.log(JSON.stringify(data));
  return data;
};

const clickCoordinate = async (coordinate) => {
  const cell = page.getByRole("gridcell", { name: new RegExp(`^(?:切换到变化 )?${coordinate}(?:空位|已有棋子|禁手)?$`) }).first();
  await cell.waitFor({ timeout: 15_000 });
  await cell.click();
  await page.waitForTimeout(650);
  return snapshot(`after-${coordinate}`);
};

try {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(filePath);
  await page.waitForTimeout(3500);
  await snapshot("after-import");
  const edited = await clickCoordinate("A1");
  assert.deepEqual(edited.markerAria, [], "新局面不得保留起点分支");
  await page.getByRole("button", { name: "到第一手" }).click();
  await page.waitForTimeout(500);
  await clickCoordinate("H8");

  let state = await snapshot("deep-start");
  for (let step = 1; step <= 30; step += 1) {
    assert.equal(state.boardHits, 225, `第${step}步棋盘点击层数量异常`);
    assert.equal(state.legacyVariationHits, 0, `第${step}步仍存在旧透明点击层`);
    assert.equal(state.markerStoneOverlaps, 0, `第${step}步变化标记覆盖棋子`);
    assert.equal(new Set(state.markerAria).size, state.markerAria.length, `第${step}步同一坐标出现重复变化标记`);
    const candidates = state.markerAria.map((label) => label.replace(/^变化点\s*/, "")).filter(Boolean);
    if (!candidates.length) break;
    const before = state.stones;
    const coordinate = candidates[0];
    const next = await clickCoordinate(coordinate);
    // The renderer orders direct continuations before same-ply siblings. If a
    // malformed projection ever puts a sibling first, try the next visible
    // point once; a real continuation must still advance exactly one stone.
    if (next.stones !== before + 1) {
      let advanced = false;
      for (const alternative of candidates.slice(1, 8)) {
        const retry = await clickCoordinate(alternative);
        if (retry.stones === before + 1) { state = retry; advanced = true; break; }
      }
      if (!advanced) throw new Error(`第${step}步点击变化点后未推进：${coordinate}，棋子数 ${before} -> ${next.stones}`);
    } else {
      state = next;
    }
  }
  assert.deepEqual(pageErrors, [], "深度复现不应产生页面错误");
  console.log(`PASS: 深度复现完成，最终棋子 ${state.stones}，无叠加标记/重复点击层`);
} finally {
  await context.close();
  await browser.close();
}
