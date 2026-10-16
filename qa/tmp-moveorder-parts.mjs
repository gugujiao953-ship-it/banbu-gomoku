// 手序读号（matchMoveNumbers）内部拆解（2026-10-09）：coarse 25 偏移 vs fine 169 偏移。
//
// 现场：手序净耗时 11.6 秒 / 7 张图，占带手序识别的 69%（scripts/probe-moveorder-cost.mjs）。
// 单次 sweep 内：每个候选 value 先跑 coarse offsets（5×5=25 或 7×7=49 个位置），
// 若没有 early-accept，再对 top-6 候选跑 fine offsets（13×13=169）。fine 这段占大头。
//
// 本探针用 A/B 开关量三段各自耗时：
//   ① 现状
//   ② 关掉 fine（__BANBU_NO_FINE__，只验证语义与耗时差，不用于出货）
//   ③ 缩小 fine 半径（__BANBU_FINE_RADIUS__）
// 目的是**量化 fine 的收益与成本**，再决定能否在不掉识别率的前提下收窄它。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-moveorder-parts.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { path: "qa/fixtures/recognition/user-98-36.jpg", mime: "image/jpeg" },
  { path: "qa/fixtures/recognition/paper10.jpg", mime: "image/jpeg" },
  { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", mime: "image/png" },
  { path: "qa/fixtures/materials/remote-image2.png", mime: "image/png" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 140)));
await page.route("**/qa-mop-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-mop-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of items) {
  const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: blob.type });
    const run = async (label) => {
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined });
      return {
        label,
        ms: Math.round(performance.now() - started),
        stones: result.board.flat().filter(Boolean).length,
        reads: result.readMoveNumbers.length,
        restored: result.numberedMoves.length,
        sweeps: mod.moveOrderPerf.sweeps,
        values: mod.moveOrderPerf.sweepValues,
        builds: mod.moveOrderPerf.templateBuilds,
      };
    };
    await run("预热");
    const runs = [await run("带手序")];
    // 无手序作差：抵消解码/网格/逐格特征的公共开销
    const noOrder = await (async () => {
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false, boardScanner: boardScanner ?? undefined });
      return { ms: Math.round(performance.now() - started), stones: result.board.flat().filter(Boolean).length };
    })();
    return { runs, noOrder };
  }, { dataUrl, name: item.path.split("/").pop() });
  const full = out.runs[0];
  console.log(`${item.path.split("/").pop()}：带手序 ${full.ms}ms（${full.stones} 子/读出 ${full.reads}/复原 ${full.restored}） − 无手序 ${out.noOrder.ms}ms = 手序净 ${full.ms - out.noOrder.ms}ms`);
  console.log(`   扫描 ${full.sweeps} 次 × ${full.values} 值 = ${(full.sweeps * full.values / 1e6).toFixed(1)}M 比对 | 模板渲染 ${full.builds}`);
}
await browser.close();
