// 一次性：把某张图识别出的棋盘打成 ASCII 格子图，看「多出来的 15 颗」是网格偏一路还是真有假阳。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ FILE=qa/fixtures/materials/zhizi-style-batch/z-003@1200.jpg node qa/tmp-grid-map.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const FILE = process.env.FILE || "qa/fixtures/materials/zhizi-style-batch/z-003@1200.jpg";
const truthFile = FILE.replace(/\.jpg$/, ".truth.json");
const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve(FILE)).toString("base64")}`;
const truth = JSON.parse(readFileSync(resolve(truthFile), "utf8"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(300000);
await page.route("**/qa-gridmap-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-gridmap-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ dataUrl, name }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const blob = await (await fetch(dataUrl)).blob();
  const result = await mod.recognizeBoardImage(new File([blob], name, { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
  const map = result.board.map((line) => line.map((p) => (p === "black" ? "B" : p === "white" ? "W" : ".")).join(""));
  return { grid: result.grid, canvas: result.gridCanvas, map };
}, { dataUrl, name: FILE.split("/").pop() });

const truthMap = Array.from({ length: 15 }, () => Array(15).fill("."));
for (const s of truth.stones) truthMap[s.row][s.col] = s.player === "black" ? "B" : "W";
console.log(`网格原点 (${Math.round(out.grid?.originX ?? -1)},${Math.round(out.grid?.originY ?? -1)}) 格距 ${out.grid ? Math.round(out.grid.spacingX * 10) / 10 : "-"}｜画布 ${out.canvas?.width}x${out.canvas?.height}`);
console.log("识别：".padEnd(6) + "                        真值：");
for (let r = 0; r < 15; r += 1) console.log(`${String(r).padStart(2)}  ${out.map[r]}    ${truthMap[r].join("")}`);
await browser.close();
