// 网格检测内部分段：相位扫描 vs 窗口评分（2026-10-09）。
//
// 现场：网格检测 7.5～8.4 秒 / 约 1840 窗，而全局配对只占 25 窗——已知 1800 来自
// 「相位枚举」（enumeratePhases 的 mesh 普查）+「精修」（polish 的窗口评分）。
// 本探针把两段的耗时与次数分开量，判断该削哪一段：
//   · mesh 普查贵 → 削 step（更粗的扫描）或减少种子
//   · polish 窗口评分贵 → 减 kept 相位或减少 delta
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-grid-two-phase.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  "qa/fixtures/materials/renjuportal/rp-score-10.png",
  "qa/fixtures/materials/user-cno2010-15.jpg",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 150)));
await page.route("**/qa-gtp-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-gtp-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const file of items) {
  const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${readFileSync(resolve(file)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const result = await mod.recognizeBoardImage(new File([blob], name, { type: blob.type }), 15, { skipMoveOrder: true, parallel: false });
    const p = mod.moveOrderPerf;
    return {
      stones: result.board.flat().filter(Boolean).length,
      gridMs: Math.round(p.gridMs),
      batchMs: Math.round(p.gridBatchMs), batchWindows: p.gridBatchWindows,
      phaseMs: Math.round(p.gridPhaseMs), phaseWindows: p.gridPhaseWindows,
      combMs: p.combMs,
      cellFeatMs: Math.round(p.cellFeatMs),
      totalWindows: p.gridWindows,
    };
  }, { dataUrl, name: file.split("/").pop() });
  console.log(`\n${file.split("/").pop()} → ${out.stones} 子，网格检测 ${out.gridMs}ms（总窗 ${out.totalWindows}）`);
  console.log(`  候选批次（窗口评分）：${out.batchMs}ms / ${out.batchWindows} 窗`);
  console.log(`  相位枚举（mesh 普查 + 精修）：${out.phaseMs}ms / ${out.phaseWindows} 窗`);
  console.log(`  线梳拟合 ${out.combMs}ms | 逐格特征 ${out.cellFeatMs}ms`);
  console.log(`  → 未归类（网格检测 - 批次 - 相位 - 线梳）：${out.gridMs - out.batchMs - out.phaseMs - out.combMs}ms`);
}
await browser.close();
