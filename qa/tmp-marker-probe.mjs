// 标记取证（2026-10-07）：木刻棋盘上红字「A」（E12）与相邻真黑子（D12/F12）的逐格特征对比，
// 外加用户另一张图上「已被忽略的彩色标注」样本（cno2010 图）——用来找区分字段。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-marker-probe.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-markerhost.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-markerhost.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async (items) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const file = new File([blob], item.name, { type: item.mime });
    const run = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
    const grid = run.grid;
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    const data = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const sampled = { data: data.data, width: cvs.width, height: cvs.height, gray: mod.buildGray(data.data, cvs.width * cvs.height) };
    const spacing = Math.min(grid.spacingX, grid.spacingY);
    lines.push(`【${item.name}】网格 (${grid.originX.toFixed(1)},${grid.originY.toFixed(1)}) 间距 ${spacing.toFixed(1)}；忽略彩色标注 ${run.ignoredColoredMarkers}；识别 ${run.board.flat().filter(Boolean).length} 子`);
    for (const cell of item.cells) {
      const col = cell.charCodeAt(0) - 65;
      const row = 15 - parseInt(cell.slice(1), 10);
      const x = grid.originX + col * grid.spacingX;
      const y = grid.originY + row * grid.spacingY;
      const f = mod.analyzeIntersection(sampled, x, y, spacing);
      lines.push(`  ${cell}: stoneLike=${f.stoneLike} markerLike=${f.markerLike} score=${f.score.toFixed(3)} 前景亮=${Math.round(f.foregroundLight)} 背景亮=${Math.round(f.backgroundLight)} 饱和=${Math.round(f.foregroundSaturation)} 前景色=${JSON.stringify(f.foregroundColor)}`);
      lines.push(`       盘内占比=${f.discShare.toFixed(2)} 环带=${f.ringShare.toFixed(2)} 外带=${f.outerShare.toFixed(2)} 中心=${f.coreShare.toFixed(2)} 中环=${f.middleShare.toFixed(2)} 对角=${f.diagonalShare.toFixed(2)} 暗盘=${f.darkDiscShare.toFixed(2)} 空洞=${f.voidShare.toFixed(2)} 描边=${(f.strokeShare ?? 0).toFixed(2)}`);
    }
  }
  return lines;
}, [
  { name: "mm-wood-zhizi.jpg", mime: "image/jpeg", cells: ["E12", "D12", "F12", "D13", "C12", "E11"], dataUrl: `data:image/jpeg;base64,${readFileSync(resolve("qa/fixtures/materials/mm-wood-zhizi.jpg")).toString("base64")}` },
  { name: "user-cno2010-15.jpg", mime: "image/jpeg", cells: ["I11", "J10", "H8"], dataUrl: `data:image/jpeg;base64,${readFileSync(resolve("qa/fixtures/materials/user-cno2010-15.jpg")).toString("base64")}` },
]);

console.log(out.join("\n"));
await browser.close();
