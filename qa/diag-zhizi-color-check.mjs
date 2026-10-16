// 颜色核对：用「图上印的手数」当颜色真值（黑先手 ⇒ 奇数号黑、偶数号白），
// 逐格比识别出来的颜色。用来判「白被判成黑」是不是网格漂移连带出来的（2026-10-15）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ ZHIZI_ITEM=<图> node qa/diag-zhizi-color-check.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const path = process.env.ZHIZI_ITEM || "qa/fixtures/materials/user-report/device/zhizi-corpus/2026-10-09-21_2120.jpg";
const mime = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-color.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-color.html", base).toString(), { waitUntil: "domcontentloaded" });

const RESTORE = process.env.ZHIZI_RESTORE === "1";
const out = await page.evaluate(async ({ dataUrl, name, mime, restore }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL });
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
  let sampled = null;
  const spy = async (args) => { sampled = sampled ?? args.image; return scanner ? scanner(args) : null; };
  const blob = await (await fetch(dataUrl)).blob();
  const fast = await mod.recognizeBoardImage(new File([blob], name, { type: mime }), 15, {
    skipMoveOrder: !restore, parallel: false, boardScanner: spy,
    digitReader: restore ? (reader ?? undefined) : undefined,
  });
  const g = fast.grid;
  const stones = [];
  fast.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) stones.push({ row: ri, col: ci, cell }); }));
  const spacing = Math.max(6, Math.round((g.spacingX + g.spacingY) / 2));
  const reads = reader && sampled ? await reader({ image: sampled, centers: stones.map((s) => ({ x: g.originX + s.col * g.spacingX, y: g.originY + s.row * g.spacingY })), spacing }) : null;
  const rows = stones.map((s, index) => {
    const number = reads?.[index]?.[0]?.value ?? null;
    const prob = reads?.[index]?.[0]?.score ?? null;
    const expect = number === null ? null : (number % 2 === 1 ? "black" : "white");
    return { at: `${String.fromCharCode(97 + s.col)}${15 - s.row}`, color: s.cell, number, prob, wrong: expect !== null && expect !== s.cell };
  });
  return { count: stones.length, numbered: fast.numberedMoves?.length ?? 0, rows, grid: `origin=(${g.originX.toFixed(1)},${g.originY.toFixed(1)}) spacing=${g.spacingX.toFixed(2)}`, canvas: fast.gridCanvas ? `${fast.gridCanvas.width}x${fast.gridCanvas.height}` : null };
}, { dataUrl: `data:${mime};base64,${readFileSync(resolve(path)).toString("base64")}`, name: path.split("/").pop(), mime, restore: RESTORE });

const checked = out.rows.filter((r) => r.number !== null);
const wrong = checked.filter((r) => r.wrong);
console.log(`${path}\n  画布 ${out.canvas}，${out.grid}；识别 ${out.count} 子（定号 ${out.numbered}），其中读到号 ${checked.length} 个`);
console.log(`  ★ 颜色与号不符：${wrong.length} / ${checked.length} 格`);
console.log(`  棋子清单：${out.rows.map((r) => `${r.at}${r.color === "black" ? "黑" : "白"}`).join(" ")}`);
for (const r of wrong.slice(0, 20)) console.log(`     ${r.at} 识别=${r.color === "black" ? "黑" : "白"} 号=${r.number}(@${r.prob?.toFixed(2)}) 应为=${r.number % 2 === 1 ? "黑" : "白"}`);
await browser.close();
