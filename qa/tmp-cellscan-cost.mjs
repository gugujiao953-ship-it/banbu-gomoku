// 225 格 cell-cls 分类的**固定开销**测量（2026-10-09）。
//
// 背景：用户手机实测「识谱十几秒，且哪张图都一样」。扫描器对整盘 225 格无条件跑一遍
// cell-cls 分类（不论图片内容、不论是否需要读号），手机单线程每格几十毫秒 → 十几秒，
// 与图片无关——正好对上「哪个都一样」。
//
// 本探针在**冷缓存**（每次用不同尺寸扰动让 scanCacheKey 变化，或直接调 classifyCells）
// 下量：225 格要多久、以及「只扫有意义的格」能省多少。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-cellscan-cost.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = { path: "qa/fixtures/materials/user-cno2010-15.jpg" };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-cellscan-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cellscan-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve(item.path)).toString("base64")}`;

const out = await page.evaluate(async ({ dataUrl, name }) => {
  const mod = await import("/src/image-recognition.ts");
  const inference = await import("/src/features/record/model-inference.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const first = await mod.recognizeBoardImage(new File([blob], name, { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: false });
  const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const grid = first.grid;
  const half = Math.round((grid.spacingX + grid.spacingY) / 2);
  const all = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) all.push({ x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY, row, col });
  }
  // 预热一次（含 ORT 会话与算子编译）
  await inference.classifyCells(sampled, all.slice(0, 1), half, {});
  const tAll = performance.now();
  await inference.classifyCells(sampled, all, half, {});
  const allMs = performance.now() - tAll;
  // 只扫「已识别子 + 特征分≥0.1 的空格」——这才是理论上需要的集合
  const busy = [];
  const detected = new Set();
  first.board.forEach((line, row) => line.forEach((cell, col) => { if (cell) detected.add(`${row},${col}`); }));
  const scoreTable = [];
  for (let row = 0; row < 15; row += 1) {
    scoreTable.push([]);
    for (let col = 0; col < 15; col += 1) {
      scoreTable[row].push(mod.analyzeIntersection(sampled, grid.originX + col * grid.spacingX, grid.originY + row * grid.spacingY, half).score);
    }
  }
  for (const query of all) {
    if (detected.has(`${query.row},${query.col}`) || scoreTable[query.row][query.col] >= 0.1) busy.push(query);
  }
  const tBusy = performance.now();
  await inference.classifyCells(sampled, busy, half, {});
  const busyMs = performance.now() - tBusy;
  return { cells: all.length, allMs: Math.round(allMs), busy: busy.length, busyMs: Math.round(busyMs), perCell: allMs / all.length };
}, { dataUrl, name: item.path.split("/").pop() });

console.log(`225 格全扫：${out.allMs}ms（${out.perCell.toFixed(1)}ms/格）`);
console.log(`只扫「已识别子 + 特征分≥0.1」的 ${out.busy} 格：${out.busyMs}ms`);
console.log(`→ 可省 ${Math.round((1 - out.busyMs / out.allMs) * 100)}%（${Math.round((out.allMs - out.busyMs) / 100) / 10}s）`);
await browser.close();
