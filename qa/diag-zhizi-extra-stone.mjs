// 取证：智子（App 截屏）这类图「稳定多一颗 / 偏移」到底多在哪一格（2026-10-15）。
//
// 做法：把识别结果（网格线 + 每颗子的圈）画回原图，存成 PNG 供人眼核对；
// 同时打印逐格清单与「哪些子是模型补位补出来的」（补位是假阳的主要来路）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-zhizi-extra-stone.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = (process.env.ZHIZI_ITEMS || [
  "qa/fixtures/materials/user-report/zhizi-dense-101.jpg",
  "qa/fixtures/materials/user-report/zhizi-board-crop.jpg",
].join(",")).split(",").map((path) => ({
  path,
  name: path.split("/").pop(),
  mime: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png",
}));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-zhizi-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-zhizi-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of items) {
  const out = await page.evaluate(async ({ dataUrl, name, mime }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
    const blob = await (await fetch(dataUrl)).blob();
    const fast = await mod.recognizeBoardImage(new File([blob], name, { type: mime }), 15, {
      skipMoveOrder: true, parallel: true, boardScanner: scanner ?? undefined,
    });
    const list = [];
    fast.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) list.push({ row: ri, col: ci, cell }); }));
    // 逐格证据（模型补位用得到的那份）：把 pEmpty 低的格单独列出来
    const evidence = fast.cellEvidence ?? [];
    const lowEmpty = evidence.filter((cell) => cell.pEmpty < 0.05).map((cell) => `${cell.row},${cell.col}:pE=${cell.pEmpty.toFixed(3)},黑${cell.pBlack.toFixed(2)}/白${cell.pWhite.toFixed(2)}`);
    // 叠图
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d");
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    const g = fast.grid;
    if (g) {
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 1.5;
      for (let index = 0; index < 15; index += 1) {
        ctx.beginPath(); ctx.moveTo(g.originX + index * g.spacingX, g.originY); ctx.lineTo(g.originX + index * g.spacingX, g.originY + 14 * g.spacingY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(g.originX, g.originY + index * g.spacingY); ctx.lineTo(g.originX + 14 * g.spacingX, g.originY + index * g.spacingY); ctx.stroke();
      }
      fast.board.forEach((row, ri) => row.forEach((cell, ci) => {
        if (!cell) return;
        ctx.beginPath();
        ctx.arc(g.originX + ci * g.spacingX, g.originY + ri * g.spacingY, Math.min(g.spacingX, g.spacingY) * 0.32, 0, Math.PI * 2);
        ctx.strokeStyle = cell === "black" ? "#ff2d55" : "#34c759"; ctx.lineWidth = 2; ctx.stroke();
      }));
    }
    return {
      png: cvs.toDataURL("image/png"),
      info: {
        image: `${fast.imageWidth}x${fast.imageHeight}`, canvas: fast.gridCanvas ? `${fast.gridCanvas.width}x${fast.gridCanvas.height}` : null,
        grid: g ? `origin=(${g.originX.toFixed(1)},${g.originY.toFixed(1)}) spacing=(${g.spacingX.toFixed(2)},${g.spacingY.toFixed(2)})` : null,
        stones: list.length, black: list.filter((s) => s.cell === "black").length,
        list: list.map((s) => `${s.row},${s.col}${s.cell === "black" ? "黑" : "白"}`).join(" "),
        lowEmptyCount: lowEmpty.length, lowEmpty: lowEmpty.join(" | ").slice(0, 1200),
        note: fast.note,
        perfStones: mod.moveOrderPerf.stones,
      },
    };
  }, { dataUrl: `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`, name: item.name, mime: item.mime });
  const i = out.info;
  console.log(`\n【${item.name}】原图 ${i.image} → 画布 ${i.canvas}`);
  console.log(`  网格：${i.grid}`);
  console.log(`  识别 ${i.stones} 子（黑 ${i.black} / 白 ${i.stones - i.black}）`);
  console.log(`  note：${i.note}`);
  console.log(`  棋子清单：${i.list}`);
  console.log(`  pEmpty<0.05 的格（${i.lowEmptyCount} 个）：${i.lowEmpty}`);
  const match = /^data:image\/png;base64,(.+)$/.exec(out.png);
  if (match) {
    const file = `qa/tmp-zhizi-overlay-${item.name.replace(/\.[a-z]+$/i, "")}.png`;
    writeFileSync(file, Buffer.from(match[1], "base64"));
    console.log(`  叠图：${file}`);
  }
}
await browser.close();
