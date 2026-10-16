// 补位判定取证（2026-10-07）：在真实管线里，把「pEmpty<0.05 但没补上」的格连同
// 卡在哪一条门打出来（静态路径与复原路径各一遍）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-fill-reason.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-fillreason-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-fillreason-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ b64 }) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const file = new File([blob], "remote-image2.png", { type: "image/png" });
  // 复原路径（含读号）
  const run = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false, parallel: false, boardScanner: scanner ?? undefined });
  lines.push(`复原路径：${run.board.flat().filter(Boolean).length} 子（读号 ${run.readMoveNumbers.length}）`);
  // 再单独跑一次扫描器要证据（同一张图、同一网格）
  const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : 1;
  const cvs = document.createElement("canvas");
  cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
  const ctx = cvs.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
  const data = ctx.getImageData(0, 0, cvs.width, cvs.height);
  const sampled = { data: data.data, width: cvs.width, height: cvs.height, gray: mod.buildGray(data.data, cvs.width * cvs.height) };
  const grid = run.grid;
  const evidence = await scanner({ image: sampled, grid, boardSize: 15, needDigits: true, digitSpacing: Math.min(grid.spacingX, grid.spacingY), digitMaxNumber: 89 });
  if (!evidence) { lines.push("证据为空"); return lines; }
  const spacing = Math.min(grid.spacingX, grid.spacingY);
  let low = 0, blockedMarker = 0, blockedCorr = 0, onBoard = 0, fillable = 0;
  const samples = [];
  for (const cell of evidence) {
    if (cell.pEmpty >= 0.05) continue;
    low += 1;
    if (run.board[cell.row][cell.col]) { onBoard += 1; continue; }
    const f = mod.analyzeIntersection(sampled, grid.originX + cell.col * grid.spacingX, grid.originY + cell.row * grid.spacingY, spacing);
    if (f.markerLike) {
      blockedMarker += 1;
      if (samples.length < 14) samples.push(`标记:${String.fromCharCode(65 + cell.col)}${15 - cell.row} 饱和=${Math.round(f.foregroundSaturation)} 中心=${f.coreShare.toFixed(2)} 盘内=${f.discShare.toFixed(2)} 外带=${f.outerShare.toFixed(2)} 环带=${f.ringShare.toFixed(2)} 亮=${Math.round(f.foregroundLight)} 分=${f.score.toFixed(2)}`);
      continue;
    }
    if (!(f.score >= 0.2 || cell.digit > 0)) { blockedCorr += 1; if (samples.length < 8) samples.push(`${String.fromCharCode(65 + cell.col)}${15 - cell.row}(分${f.score.toFixed(2)}/d${cell.digit})`); continue; }
    fillable += 1;
  }
  lines.push(`证据 pEmpty<0.05 共 ${low} 格：已在盘上 ${onBoard}、被标记门挡 ${blockedMarker}、被佐证门挡 ${blockedCorr}、可补 ${fillable}`);
  if (samples.length) lines.push(`  佐证门样本：${samples.join(" ")}`);
  return lines;
}, { b64: readFileSync(resolve("qa/fixtures/materials/remote-image2.png")).toString("base64") });

console.log(out.join("\n"));
await browser.close();
