// 网格窗评分对比（2026-10-07）：木刻棋盘上「肉眼正确的窗」与「应用选中的窗」各得多少分。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-grid-probe.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-gridhost.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-gridhost.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ b64, b64blur }) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const build = async (b64) => {
    const img = new Image(); img.src = `data:image/jpeg;base64,${b64}`; await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    const data = ctx.getImageData(0, 0, cvs.width, cvs.height);
    return { data: data.data, width: cvs.width, height: cvs.height, gray: mod.buildGray(data.data, cvs.width * cvs.height) };
  };
  const sampled = await build(b64);
  const run = await mod.recognizeBoardImage(new File([await (await fetch(`data:image/jpeg;base64,${b64}`)).blob()], "x.jpg", { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: false });
  lines.push(`木刻画布 ${sampled.width}x${sampled.height}；应用选中 origin=(${run.grid.originX.toFixed(1)},${run.grid.originY.toFixed(1)}) spacing=(${run.grid.spacingX.toFixed(2)},${run.grid.spacingY.toFixed(2)}) note=${run.note.slice(0, 60)}`);
  const score = (ox, oy, sx, sy) => {
    const q = mod.scoreGridWindow(sampled, ox, oy, sx, sy, 15);
    if (!q) return "null";
    return `${q.score.toFixed(1)}｜线覆盖 ${q.lineCoverage.toFixed(2)} 连续 ${q.continuity.toFixed(2)} 交点 ${q.intersectionSupport.toFixed(2)} 外框 ${q.outerFrameShare.toFixed(2)} 有效行列 ${q.validRowCount}/${q.validColumnCount} 延伸 ${q.externalContinuation.toFixed(2)} 出线 ${q.externalLineCount} 星位 ${q.starSupport.toFixed(2)}${q.earlyOut ? " [早退]" : ""}`;
  };
  lines.push(`  应用选中的窗：${score(run.grid.originX, run.grid.originY, run.grid.spacingX, run.grid.spacingY)}`);
  // 肉眼正确的窗外加邻域：origin x≈60 y≈110，spacing≈76.4
  for (const [ox, oy, sx, sy] of [
    [74, 137, 79.7, 79.7],   // 真值（Python 量线得到）
    [73, 216.8, 79.78, 79.37], // 真值下移一格（= 相位校正 +1 后的样子）
    [73, 120, 79.78, 79.37],   // 真值上移一点
    [74, 137, 80.0, 80.0],
  ]) {
    lines.push(`  真实窗 (${ox},${oy},${sx},${sy})：${score(ox, oy, sx, sy)}`);
  }
  const blur = await build(b64blur);
  const blurRun = await mod.recognizeBoardImage(new File([await (await fetch(`data:image/jpeg;base64,${b64blur}`)).blob()], "y.jpg", { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: false });
  lines.push(`模糊图画布 ${blur.width}x${blur.height}；网格 origin=(${blurRun.grid.originX.toFixed(1)},${blurRun.grid.originY.toFixed(1)}) spacing=(${blurRun.grid.spacingX.toFixed(2)},${blurRun.grid.spacingY.toFixed(2)}) → ${blurRun.board.flat().filter(Boolean).length} 子（真值约 71）`);
  return lines;
}, { b64: readFileSync(resolve("qa/fixtures/materials/mm-wood-zhizi.jpg")).toString("base64"), b64blur: readFileSync(resolve("qa/fixtures/materials/blur-num71.jpg")).toString("base64") });

console.log(out.join("\n"));
await browser.close();
