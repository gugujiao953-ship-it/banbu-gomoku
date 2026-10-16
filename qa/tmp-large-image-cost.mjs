// 大图（手机照片量级）的识谱耗时（2026-10-09）。
//
// 为什么要这张：用户报「电脑网页版也慢」，而我此前的语料最大只有 1.7MP，真实手机照片是
// 12MP 量级。识别器把长边缩到 1600px，但**网格检测的搜索空间随缩放后的面积增长**，
// 且候选窗口评分是 O(N²) 级——所以大图与小图的耗时完全不是一个量级。
// 本探针把同一张盘面做成 0.5 / 1.7 / 16.8MP 三档，量「识谱」与「完整流程」的实际耗时，
// 直接回答「用户看到的十几秒从哪来」。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-large-image-cost.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", note: "原图 1.5MP（我之前的语料上限）" },
  { path: "qa/tmp-large/phone-photo-12mp.jpg", note: "放大到 16.8MP（手机照片量级）" },
];

const browser = await chromium.launch({ headless: true });
for (const item of items) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
  await page.route("**/qa-large-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-large-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const mime = /\.jpe?g$/i.test(item.path) ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name, mime }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: mime });
    const time = async (opts) => {
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, ...opts });
      return {
        ms: Math.round(performance.now() - started),
        stones: result.board.flat().filter(Boolean).length,
        reads: result.readMoveNumbers.length,
        size: `${result.imageWidth}x${result.imageHeight}`,
        canvas: result.gridCanvas ? `${result.gridCanvas.width}x${result.gridCanvas.height}` : "-",
        snap: { gridMs: Math.round(mod.moveOrderPerf.gridMs), gridWindows: mod.moveOrderPerf.gridWindows, combMs: Math.round(mod.moveOrderPerf.combMs), cellFeatMs: Math.round(mod.moveOrderPerf.cellFeatMs) },
      };
    };
    await time({ skipMoveOrder: true });         // 预热
    const fast = await time({ skipMoveOrder: true });
    const full = await time({ skipMoveOrder: false });
    return { fast, full };
  }, { dataUrl, name: item.path.split("/").pop(), mime });
  console.log(`\n${item.note}`);
  console.log(`  图片 ${out.fast.size} → 工作画布 ${out.fast.canvas}`);
  console.log(`  识谱（导入）    ${out.fast.ms}ms → ${out.fast.stones} 子`);
  console.log(`  完整流程        ${out.full.ms}ms → 读出 ${out.full.reads} 个号`);
  console.log(`  分段：网格 ${out.fast.snap.gridMs}ms（${out.fast.snap.gridWindows} 窗）/ 线梳 ${out.fast.snap.combMs}ms / 逐格特征 ${out.fast.snap.cellFeatMs}ms`);
  await context.close();
}
await browser.close();
