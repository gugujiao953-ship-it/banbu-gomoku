// 一次性诊断：用户报的两张图（智子截屏「识谱偏差」/ 模糊书谱「复原不全」）按生产路径实测，
// 导出「检测到的棋盘几何 + 每颗子的位置与手数」，供 Python 画叠加图直接看偏差。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/tmp-report-measure.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const IMAGES = [
  { id: "zhizi-dense-101", file: "qa/fixtures/materials/user-report/zhizi-dense-101.jpg" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(600_000);
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
page.on("console", (m) => { const t = m.text(); if (/banbu-image-(fits|phases|mesh|phase|shift-fix|refine-fix|selected|rejected|grid|boardsize)/.test(t)) console.log("[dbg]", t.slice(0, 400)); });
await page.route("**/qa-report-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-report-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = IMAGES.map((item) => ({
  ...item,
  dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(item.file)).toString("base64")}`,
}));

const PARALLEL = process.env.PARALLEL !== "0";
const out = await page.evaluate(async ({ items, PARALLEL }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 }),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 }),
  ]);
  globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
  const rows = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const run = async (options) => {
      const started = performance.now();
      const result = await mod.recognizeBoardImage(new File([blob], item.id + ".jpg", { type: "image/jpeg" }), 15, {
        parallel: PARALLEL, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, ...options,
      });
      const stones = [];
      result.board.forEach((line, row) => line.forEach((player, col) => { if (player) stones.push({ row, col, player }); }));
      return {
        ms: Math.round(performance.now() - started),
        boardSize: result.boardSize,
        confidence: Math.round(result.confidence * 1000) / 1000,
        grid: result.grid ? { originX: Math.round(result.grid.originX * 10) / 10, originY: Math.round(result.grid.originY * 10) / 10, spacingX: Math.round(result.grid.spacingX * 10) / 10, spacingY: Math.round(result.grid.spacingY * 10) / 10, quality: Math.round((result.grid.quality ?? 0) * 100) / 100 } : null,
        gridFallback: Boolean(result.gridFallback),
        note: result.note,
        stones,
        numbers: result.readMoveNumbers.map((m) => ({ row: m.row, col: m.col, number: m.number, player: m.player })),
        numbered: result.numberedMoves.length,
        quality: result.moveOrderQuality ? { accepted: result.moveOrderQuality.accepted, status: result.moveOrderQuality.status, reason: result.moveOrderQuality.reason, assignedMean: Math.round(result.moveOrderQuality.assignedMean * 1000) / 1000, assignedMin: Math.round(result.moveOrderQuality.assignedMin * 1000) / 1000 } : null,
      };
    };
    // 两条都量：导入那一趟（核对屏最先看到的，skipMoveOrder:true）与复原那趟
    const imported = await run({ skipMoveOrder: true });
    const restore = await run({ skipMoveOrder: false });
    rows.push({ id: item.id, file: item.file, imported, restore });
  }
  return rows;
}, { items: payloads, PARALLEL });

writeFileSync("/tmp/report-measure.json", JSON.stringify(out, null, 1));
for (const row of out) {
  const r = row.restore;
  console.log(`\n### ${row.id}（${r.boardSize} 路，置信 ${r.confidence}，${r.ms}ms）`);
  console.log(`  网格 ${r.grid ? `原点(${r.grid.originX},${r.grid.originY}) 格距 ${r.grid.spacingX}x${r.grid.spacingY} 质量 ${r.grid.quality}` : "无"}${r.gridFallback ? "（退化为固定边距）" : ""}`);
  console.log(`  棋子 ${r.stones.length}｜读出序号 ${r.numbers.length}｜完整复原 ${r.numbered}｜accepted=${r.quality?.accepted} 均值${r.quality?.assignedMean} 最低${r.quality?.assignedMin}`);
  if (r.quality?.reason) console.log(`  理由：${r.quality.reason}`);
  if (r.note) console.log(`  note：${r.note.replace(/\s+/g, " ").slice(0, 160)}`);
}
await browser.close();
