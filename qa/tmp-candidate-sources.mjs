// 候选池构成：三个来源各贡献多少窗（2026-10-09）。
//
// 上一步量到「候选批次 1704 窗 / 6.8 秒」是网格检测的大头，但不知道 1704 里
// 全局配对 / 局部行拟合 / 局部列拟合各占多少。本探针按来源分别统计，
// 找准该削的那一段（并要求削减无损：被削的窗在硬门上必然被拒）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-candidate-sources.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = ["qa/fixtures/materials/renjuportal/rp-score-10.png", "qa/fixtures/materials/user-cno2010-15.jpg"];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-cs-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cs-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const file of items) {
  const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${readFileSync(resolve(file)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const inference = await import("/src/features/record/model-inference.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], name, { type: blob.type });
    const result = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
    // 复刻识别器的几何：画布缩放 + 线梳拟合，然后分别数三个来源
    const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
    const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    const local = mod.localAccelerator(sampled);
    const minSpacing = Math.max(5, Math.min(sampled.width, sampled.height) * 0.015);
    const [rowFits, columnFits] = await local.fitCombs([
      { alongX: true, innerStart: 1, boardSize: 15, spacingRange: { minimum: minSpacing } },
      { alongX: false, innerStart: 1, boardSize: 15, spacingRange: { minimum: minSpacing } },
    ]);
    const globalPairs = Math.min(rowFits.length, 36) * Math.min(columnFits.length, 36);
    const localLimits = { pool: 48, seeds: 20, output: 16 };
    const localRow = await local.fitCombs(columnFits.slice(0, 12).map((column) => ({
      alongX: true, innerStart: column.origin - column.spacing * 0.35,
      innerEnd: column.origin + (14) * column.spacing + column.spacing * 0.35,
      boardSize: 15, limits: localLimits, spacingRange: { minimum: column.spacing * 0.88, maximum: column.spacing * 1.12 },
    })));
    const localColumn = await local.fitCombs(rowFits.slice(0, 12).map((row) => ({
      alongX: false, innerStart: row.origin - row.spacing * 0.35,
      innerEnd: row.origin + (14) * row.spacing + row.spacing * 0.35,
      boardSize: 15, limits: localLimits, spacingRange: { minimum: row.spacing * 0.88, maximum: row.spacing * 1.12 },
    })));
    let localRowTotal = 0, localColTotal = 0;
    let spacingRejectedRow = 0, spacingRejectedCol = 0;
    for (const list of localRow) for (const row of list) {
      localRowTotal += 1;
      const column = columnFits.slice(0, 12)[localRow.indexOf(list)];
      if (Math.min(row.spacing, column.spacing) / Math.max(row.spacing, column.spacing) < 0.92) spacingRejectedRow += 1;
    }
    for (const list of localColumn) for (const column of list) {
      localColTotal += 1;
      const row = rowFits.slice(0, 12)[localColumn.indexOf(list)];
      if (Math.min(row.spacing, column.spacing) / Math.max(row.spacing, column.spacing) < 0.92) spacingRejectedCol += 1;
    }
    return {
      stones: result.board.flat().filter(Boolean).length,
      rowFits: rowFits.length, columnFits: columnFits.length,
      globalPairs, localRowTotal, localColTotal,
      spacingRejectedRow, spacingRejectedCol,
      measured: mod.moveOrderPerf.gridBatchWindows,
      gridMs: Math.round(mod.moveOrderPerf.gridMs),
    };
  }, { dataUrl, name: file.split("/").pop() });
  console.log(`\n${file.split("/").pop()} → ${out.stones} 子，网格 ${out.gridMs}ms / 批次共 ${out.measured} 窗`);
  console.log(`  全局配对：${Math.min(out.rowFits, 36)} × ${Math.min(out.columnFits, 36)} = ${out.globalPairs} 窗`);
  console.log(`  局部行拟合：${out.localRowTotal} 窗（间距比不合格 ${out.spacingRejectedRow}）`);
  console.log(`  局部列拟合：${out.localColTotal} 窗（间距比不合格 ${out.spacingRejectedCol}）`);
}
await browser.close();
