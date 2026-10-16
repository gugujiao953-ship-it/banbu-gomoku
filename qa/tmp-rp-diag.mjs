// 网页棋盘域诊断：把真值棋盘与识别结果并排打印成字符画，并给出最优整体平移量。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-rp-diag.mjs rp-score-03
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const name = process.argv[2] || "rp-score-03";
const dir = resolve("qa/fixtures/materials/renjuportal");
const truth = JSON.parse(readFileSync(resolve(dir, `${name}.truth.json`), "utf8"));
const dataUrl = `data:image/png;base64,${readFileSync(resolve(dir, `${name}.png`)).toString("base64")}`;

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-rp-diag-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-rp-diag-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const result = await page.evaluate(async ({ dataUrl }) => {
  const mod = await import("/src/image-recognition.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const out = await mod.recognizeBoardImage(new File([blob], "x.png", { type: "image/png" }), 15, { skipMoveOrder: true, parallel: false });
  const board = [];
  out.board.forEach((line) => board.push(line.map((cell) => (cell ? (cell === "black" ? "B" : "W") : "."))));
  return { board, boardSize: out.boardSize, grid: out.grid, canvas: out.gridCanvas, image: [out.imageWidth, out.imageHeight], note: out.note, fallback: out.gridFallback };
}, { dataUrl });

const truthGrid = Array.from({ length: 15 }, () => Array(15).fill("."));
for (const stone of truth.stones) truthGrid[stone.row][stone.col] = stone.player === "black" ? "B" : "W";
const det = result.board;
console.log(`${name}  ${result.image.join("x")} → 画布 ${result.canvas.width}x${result.canvas.height}  路数 ${result.boardSize}  网格 ${result.grid ? `${result.grid.originX.toFixed(1)},${result.grid.originY.toFixed(1)} @ ${result.grid.spacingX.toFixed(1)}x${result.grid.spacingY.toFixed(1)}` : "无"}  退回=${result.fallback}`);
console.log(`note: ${result.note}`);
console.log("真值(上) / 识别(下)  行号 0=顶");
for (let row = 0; row < 15; row += 1) {
  console.log(`  ${truthGrid[row].join("")}   ${det[row] ? det[row].join("") : ""}`);
}
// 最优整体平移
let best = null;
for (let dr = -4; dr <= 4; dr += 1) {
  for (let dc = -4; dc <= 4; dc += 1) {
    let hit = 0;
    for (let row = 0; row < 15; row += 1) for (let col = 0; col < 15; col += 1) {
      const sr = row + dr, sc = col + dc;
      if (sr < 0 || sr > 14 || sc < 0 || sc > 14) continue;
      if (det[row]?.[col] && det[row][col] === truthGrid[sr][sc]) hit += 1;
    }
    if (!best || hit > best.hit) best = { dr, dc, hit };
  }
}
const truthCount = truth.stones.length;
console.log(`最优整体平移 dr=${best.dr} dc=${best.dc} → 命中 ${best.hit}/${truthCount}（说明整盘是否只是错位）`);
await browser.close();
