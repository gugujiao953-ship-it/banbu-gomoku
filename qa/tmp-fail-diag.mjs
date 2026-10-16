// 失败图诊断（2026-10-07）：① 木刻棋盘（智子风格）—— 应用识别出的网格/棋子画回原图，
// 直观看「网格歪在哪」；② 模糊 71 手图 —— 看棋子/读号各自到哪一步。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-fail-diag.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { name: "mm-wood-zhizi.jpg", mime: "image/jpeg", path: "qa/fixtures/materials/mm-wood-zhizi.jpg" },
  { name: "blur-num71.jpg", mime: "image/jpeg", path: "qa/fixtures/materials/blur-num71.jpg" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-failhost.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-failhost.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of items) {
  const out = await page.evaluate(async ({ dataUrl, name, mime }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
    const digitReader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: mime });
    const lines = [];
    // 静态导入（默认路径）
    const t0 = performance.now();
    const fast = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true, boardScanner: scanner ?? undefined });
    const fastMs = Math.round(performance.now() - t0);
    const stones = [];
    fast.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) stones.push(`${String.fromCharCode(65 + ci)}${15 - ri}${cell === "black" ? "黑" : "白"}`); }));
    lines.push(`【${name}】图像 ${fast.imageWidth}x${fast.imageHeight} → 画布 ${fast.gridCanvas?.width}x${fast.gridCanvas?.height}`);
    lines.push(`  网格：origin=(${fast.grid?.originX.toFixed(1)}, ${fast.grid?.originY.toFixed(1)}) spacing=(${fast.grid?.spacingX.toFixed(2)}, ${fast.grid?.spacingY.toFixed(2)})`);
    lines.push(`  静态导入 ${fastMs}ms：${stones.length} 子；note=${fast.note.slice(0, 120)}`);
    lines.push(`  棋子：${stones.join(" ")}`);
    // 复原（增强）
    const t1 = performance.now();
    const full = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: true, boardScanner: scanner ?? undefined, digitReader: digitReader ?? undefined });
    lines.push(`  复原+增强 ${Math.round(performance.now() - t1)}ms：${full.board.flat().filter(Boolean).length} 子、复原 ${full.numberedMoves.length}、读出 ${full.readMoveNumbers.length}：${full.readMoveNumbers.map((m) => m.number).sort((a, b) => a - b).join(",")}`);
    lines.push(`  perf=${JSON.stringify(mod.moveOrderPerf)}`);
    // 叠图：把网格线与棋子画回原图（放大核对用）
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d");
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    if (fast.grid) {
      const g = fast.grid;
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2;
      for (let index = 0; index < 15; index += 1) {
        ctx.beginPath(); ctx.moveTo(g.originX + index * g.spacingX, g.originY); ctx.lineTo(g.originX + index * g.spacingX, g.originY + 14 * g.spacingY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(g.originX, g.originY + index * g.spacingY); ctx.lineTo(g.originX + 14 * g.spacingX, g.originY + index * g.spacingY); ctx.stroke();
      }
      fast.board.forEach((row, ri) => row.forEach((cell, ci) => {
        if (!cell) return;
        ctx.beginPath();
        ctx.arc(g.originX + ci * g.spacingX, g.originY + ri * g.spacingY, Math.min(g.spacingX, g.spacingY) * 0.3, 0, Math.PI * 2);
        ctx.strokeStyle = cell === "black" ? "#ff2d55" : "#34c759"; ctx.lineWidth = 2; ctx.stroke();
      }));
    }
    return { lines, png: cvs.toDataURL("image/png") };
  }, { dataUrl: `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`, name: item.name, mime: item.mime });
  console.log(out.lines.join("\n"));
  const match = /^data:image\/png;base64,(.+)$/.exec(out.png);
  if (match) {
    const file = `qa/tmp-fail-overlay-${item.name.replace(".jpg", "")}.png`;
    writeFileSync(file, Buffer.from(match[1], "base64"));
    console.log(`  叠图已存 ${file}`);
  }
}
await browser.close();
