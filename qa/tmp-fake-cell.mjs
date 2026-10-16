// 假子取证（2026-10-07）：木刻棋盘 A15 那格（应用补出来的假子）的逐格证据。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-fake-cell.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-fakehost.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-fakehost.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ b64, b64blur }) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const probe = async (name, b64) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const file = new File([blob], name, { type: "image/jpeg" });
    const fast = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
    const grid = fast.grid;
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    const data = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const sampled = { data: data.data, width: cvs.width, height: cvs.height, gray: mod.buildGray(data.data, cvs.width * cvs.height) };
    const evidence = await scanner({ image: sampled, grid, boardSize: 15, needDigits: true, digitSpacing: Math.min(grid.spacingX, grid.spacingY), digitMaxNumber: 89 });
    if (!evidence) { lines.push(`${name}: 证据为空`); return; }
    const spacing = Math.min(grid.spacingX, grid.spacingY);
    lines.push(`【${name}】`);
    for (const cell of evidence) {
      const f = mod.analyzeIntersection(sampled, grid.originX + cell.col * grid.spacingX, grid.originY + cell.row * grid.spacingY, spacing);
      const name2 = `${String.fromCharCode(65 + cell.col)}${15 - cell.row}`;
      // 只列「会被补位」的：pEmpty<0.05，或中间带+高分；再附上被排除的高分格做对照
      if (cell.pEmpty >= 0.05) continue;
      lines.push(`  ${name2}: pEmpty=${cell.pEmpty.toFixed(3)} pW=${cell.pWhite.toFixed(2)} 特征分=${f.score.toFixed(3)} stoneLike=${f.stoneLike} markerLike=${f.markerLike} 饱和=${Math.round(f.foregroundSaturation)} 盘内=${f.discShare.toFixed(2)} 中心=${f.coreShare.toFixed(2)} 外带=${f.outerShare.toFixed(2)} 环带=${f.ringShare.toFixed(2)}`);
    }
  };
  await probe("remote-image2.png", b64blur);
  return lines;
}, { b64: readFileSync(resolve("qa/fixtures/materials/mm-wood-zhizi.jpg")).toString("base64"), b64blur: readFileSync(resolve("qa/fixtures/materials/blur-num71.jpg")).toString("base64") });

console.log(out.join("\n"));
await browser.close();
