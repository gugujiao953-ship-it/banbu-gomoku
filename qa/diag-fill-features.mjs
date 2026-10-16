// 取数：**真漏子**（白底 89 手图，补位救回来的那些格）在 CV 特征上是什么样，
// 用来给「补位独立佐证门」定阈值——目标是既不误杀真漏子，又能拦住智子截屏 h1 那种假子。
//
// 做法：同一张图跑两次（带/不带 boardScanner），差集 = 补位补出来的格；
// 再逐格打印 features(score/core/disc/sat) 与数字头 digit/digitProb。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-fill-features.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = (process.env.FILL_ITEMS || [
  "qa/fixtures/materials/remote-image2.png",
  "qa/fixtures/materials/user-report/device/source/wechat-1792030331728.jpg",
].join(",")).split(",").map((path) => ({ path, note: path.split("/").pop(), mime: /\.png$/i.test(path) ? "image/png" : "image/jpeg" }));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-fillfeat.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-fillfeat.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of items) {
  const out = await page.evaluate(async ({ dataUrl, name, mime }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: mime });
    // ① 不带扫描器（CV 原始结果）
    const plain = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false });
    // ② 带扫描器（补位 + 读号那条路都开）
    let sampled = null;
    const spy = async (args) => { sampled = sampled ?? args.image; return scanner ? scanner(args) : null; };
    const boosted = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false, boardScanner: spy });
    const key = (row, col) => `${row},${col}`;
    const before = new Set();
    plain.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) before.add(key(ri, ci)); }));
    const added = [];
    boosted.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell && !before.has(key(ri, ci))) added.push({ row: ri, col: ci, cell }); }));
    const g = boosted.grid;
    const spacing = Math.max(6, Math.round((g.spacingX + g.spacingY) / 2));
    const rows = [];
    if (sampled && added.length) {
      const local = mod.localAccelerator(sampled);
      const queries = added.map((a) => ({ x: g.originX + a.col * g.spacingX, y: g.originY + a.row * g.spacingY }));
      const probs = await local.scanCells(queries, spacing, {});
      added.forEach((a, index) => {
        const f = mod.analyzeIntersection(sampled, queries[index].x, queries[index].y, spacing);
        const p = probs[index];
        rows.push({
          at: `${String.fromCharCode(97 + a.col)}${15 - a.row}`, color: a.cell,
          score: +f.score.toFixed(3), core: +f.coreShare.toFixed(3), disc: +f.discShare.toFixed(3), sat: Math.round(f.foregroundSaturation),
          diag: +f.diagonalShare.toFixed(3), outer: +f.outerShare.toFixed(3), middle: +f.middleShare.toFixed(3),
          pEmpty: p ? +p.pEmpty.toFixed(4) : null,
        });
      });
    }
    return { plainStones: plain.board.flat().filter(Boolean).length, boostedStones: boosted.board.flat().filter(Boolean).length, addedCount: added.length, rows };
  }, { dataUrl: `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`, name: item.path.split("/").pop(), mime: item.mime });
  console.log(`\n【${item.note}】不带扫描器 ${out.plainStones} 子 → 带扫描器 ${out.boostedStones} 子（差 ${out.addedCount}）`);
  for (const r of out.rows.sort((a, b) => a.score - b.score)) {
    console.log(`   ${r.at.padEnd(5)} ${r.color === "black" ? "黑" : "白"}  score=${String(r.score).padStart(6)} core=${String(r.core).padStart(6)} disc=${String(r.disc).padStart(6)} diag=${String(r.diag).padStart(6)} outer=${String(r.outer).padStart(6)} middle=${String(r.middle).padStart(6)} pEmpty=${r.pEmpty}`);
  }
}
await browser.close();
