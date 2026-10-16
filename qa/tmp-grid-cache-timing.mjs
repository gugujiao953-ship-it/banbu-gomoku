// 网格缓存收益实测（2026-10-08）：在**同一个页面**里按 App 的真实顺序跑两次识别
// （先导入 skipMoveOrder:true，再复原 skipMoveOrder:false），对比网格检测耗时。
// 网格估计缓存是模块级的，所以只有同一页面内的两次调用才吃得到——分页跑的探针看不出来。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-grid-cache-timing.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const items = [
  { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", parallel: true },
  { path: "qa/fixtures/materials/renjuportal/rp-score-03.png", parallel: true },
];
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
for (const item of items) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
  await page.route("**/qa-grid-cache-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-grid-cache-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const dataUrl = `data:image/png;base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name, parallel }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }),
    ]);
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: "image/png" });
    const run = async (opts) => {
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { parallel, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, ...opts });
      return {
        ms: Math.round(performance.now() - started),
        gridMs: Math.round(mod.moveOrderPerf.gridMs),
        digitMs: Math.round(mod.moveOrderPerf.digitMs),
        batchMs: Math.round(mod.moveOrderPerf.gridBatchMs),
        batchWindows: mod.moveOrderPerf.gridBatchWindows,
        dedupSkipped: mod.moveOrderPerf.gridDedupSkipped,
        phaseMs: Math.round(mod.moveOrderPerf.gridPhaseMs),
        phaseWindows: mod.moveOrderPerf.gridPhaseWindows,
        sweeps: mod.moveOrderPerf.sweeps,
        stones: result.board.flat().filter(Boolean).length,
        reads: result.readMoveNumbers.length,
        restored: result.numberedMoves.length,
        grid: result.grid ? [Math.round(result.grid.originX * 10) / 10, Math.round(result.grid.originY * 10) / 10, Math.round(result.grid.spacingX * 10) / 10] : null,
      };
    };
    const imp = await run({ skipMoveOrder: true });
    const res = await run({ skipMoveOrder: false });
    return { imp, res };
  }, { dataUrl, name: item.path.split("/").pop(), parallel: item.parallel });
  console.log(`${item.path.split("/").pop()}`);
  console.log(`  导入(skip): ${out.imp.ms}ms（网格 ${out.imp.gridMs}ms = 候选批次 ${out.imp.batchMs}ms/${out.imp.batchWindows} 窗（去重跳过 ${out.imp.dedupSkipped}）+ 相位枚举 ${out.imp.phaseMs}ms/${out.imp.phaseWindows} 窗）→ ${out.imp.stones} 子`);
  console.log(`  复原(本页第二次): ${out.res.ms}ms（网格 ${out.res.gridMs}ms，读号段 ${out.res.digitMs}ms，模板扫描 ${out.res.sweeps} 次）→ ${out.res.stones} 子/读出 ${out.res.reads}/复原 ${out.res.restored}，网格 ${out.res.grid?.join(",")}`);
  await context.close();
}
await browser.close();
