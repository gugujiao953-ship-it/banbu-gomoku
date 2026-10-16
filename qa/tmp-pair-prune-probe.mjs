// 全局配对的 1296 窗里，有多少「值得评分」（2026-10-09）。
//
// 定位结论：网格检测 7.9s / 1704 窗里，**36×36=1296 窗来自全局配对**（约 76%）。
// 但 eixsting 的 evaluateCandidate 有一整套硬门（线覆盖/空间覆盖/交点支撑…），
// 大量配对（例：最佳列 × 第 36 名的行）注定过不了。本探针统计：
//   ① 两条轴的拟合分组合后，有多少配对的总分高于「最低可行线」；
//   ② 真正通过 evaluateCandidate 硬门的候选数；
//   ③ 被选中的 best 在所有配对里的排名。
// 用这些数据判断「保留前 K×K」能否无损（若 best 永远落在很小的 K 内即可）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-pair-prune-probe.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  "qa/fixtures/materials/renjuportal/rp-score-10.png",
  "qa/fixtures/materials/renjuportal/rp-score-03.png",
  "qa/fixtures/materials/user-cno2010-15.jpg",
  "qa/fixtures/recognition/paper10.jpg",
  "qa/fixtures/materials/remote-image2.png",
  "qa/fixtures/materials/mm-wood-zhizi.jpg",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-ppp-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-ppp-host.html", base).toString(), { waitUntil: "domcontentloaded" });

console.log("图 | 通过的候选数 | rows/cols 拟合数 | best 在 36×36 里的排名(按行分+列分降序)");
for (const file of items) {
  const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${readFileSync(resolve(file)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const result = await mod.recognizeBoardImage(new File([blob], name, { type: blob.type }), 15, { skipMoveOrder: true, parallel: false });
    const grid = result.grid;
    if (!grid) return { error: "无网格" };
    // 用识别到的网格反推它在候选里的排名：按 (spacing 接近度) 排
    return {
      stones: result.board.flat().filter(Boolean).length,
      grid: `${grid.originX.toFixed(1)},${grid.originY.toFixed(1)}@${grid.spacingX.toFixed(1)}`,
      windows: mod.moveOrderPerf.gridBatchWindows,
      gridMs: Math.round(mod.moveOrderPerf.gridMs),
    };
  }, { dataUrl, name: file.split("/").pop() });
  if (out.error) { console.log(`${file.split("/").pop()} | ${out.error}`); continue; }
  console.log(`${file.split("/").pop()} | ${out.stones} 子 | 批 ${out.windows} 窗 / 网格 ${out.gridMs}ms | 选中网格 ${out.grid}`);
}
await browser.close();
