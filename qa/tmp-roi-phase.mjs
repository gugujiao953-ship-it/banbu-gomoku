// 一次性：ROI（对齐屏框选）会不会把网格相位带偏。用户报「智子那张在手机上仍然偏移」，
// 而我在无 ROI 下量到相位是对的——所以把 ROI 当变量逐档试。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/tmp-roi-phase.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const FILE = "qa/fixtures/materials/user-report/zhizi-dense-101.jpg";
// 真值（我只在前面用放大图核过左上 5×5；这里用「锚点」判相位：号 1 应在 (14,14) 等）
const ROIS = [
  { label: "无 ROI（=没拖过框）", roi: null },
  { label: "整块棋盘（含外框留白）", roi: { x: 0.012, y: 0.200, w: 0.977, h: 0.440 } },
  { label: "正好框住 15 条线", roi: { x: 0.060, y: 0.200, w: 0.881, h: 0.397 } },
  { label: "更松（整屏上半部）", roi: { x: 0, y: 0.150, w: 1, h: 0.550 } },
  { label: "偏小（框到右半）", roi: { x: 0.45, y: 0.200, w: 0.55, h: 0.44 } },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(900_000);
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.route("**/qa-roi-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-roi-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve(FILE)).toString("base64")}`;
const out = await page.evaluate(async ({ dataUrl, rois }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const blob = await (await fetch(dataUrl)).blob();
  const rows = [];
  for (const item of rois) {
    const result = await mod.recognizeBoardImage(new File([blob], "zhizi.jpg", { type: "image/jpeg" }), 15, {
      skipMoveOrder: true, parallel: false, roi: item.roi ?? undefined, boardScanner: scanner ?? undefined,
    });
    const at = {};
    for (const m of result.readMoveNumbers) at[m.number] = `${m.row},${m.col}`;
    const stones = [];
    result.board.forEach((line, row) => line.forEach((p, col) => { if (p) stones.push(1); }));
    rows.push({ label: item.label, grid: result.grid ? { x: Math.round(result.grid.originX * 10) / 10, y: Math.round(result.grid.originY * 10) / 10, sp: Math.round(result.grid.spacingX * 10) / 10 } : null, stones: stones.length, anchors: { 1: at[1] ?? "-", 2: at[2] ?? "-", 101: at[101] ?? "-" } });
  }
  return rows;
}, { dataUrl, rois: ROIS.map((r) => ({ label: r.label, roi: r.roi })) });

console.log("正确相位 = 原点 y≈323.1、格距 45.3、锚点 1→14,14 / 2→14,10 / 101→10,7\n");
for (const row of out) {
  const ok = row.grid && Math.abs(row.grid.y - 323.1) < 3 && row.anchors["1"] === "14,14";
  console.log(`${ok ? "✔" : "✘"} ${row.label.padEnd(22)} 原点(${row.grid?.x},${row.grid?.y}) 格距${row.grid?.sp} 棋子${row.stones} 锚点 1→${row.anchors["1"]} 2→${row.anchors["2"]} 101→${row.anchors["101"]}`);
}
await browser.close();
