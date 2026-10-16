// 诊断：识谱两段（导入 / 复原手序）各自的时间去哪儿了（2026-10-14）。
//
// 起因：用户要求「第一次导入 10 秒内识完」。探针 diag-first-import-prewarm 显示
// 预热只值 ~1 秒（建池本身很便宜），而**复原手序那一段**在密盘（智子 193 子）上要
// 30–40 秒、且一个号都没读出来。要加速就得先知道钱花在哪一步，所以这里把识别器
// 的 moveOrderPerf 全字段打出来。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-restore-profile.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
/** PARALLEL=0 走单线程对照（判断并行到底有没有在干活）。 */
const PARALLEL = process.env.PARALLEL !== "0";
const items = process.env.PROFILE_ITEMS
  ? process.env.PROFILE_ITEMS.split(",").map((path) => ({ path, note: path.split("/").pop() }))
  : [
      { path: "qa/fixtures/materials/user-report/zhizi-dense-101.jpg", note: "智子密盘 101" },
      { path: "qa/fixtures/materials/user-report/book-blur-71.jpg", note: "书谱小图 71" },
      { path: "qa/fixtures/recognition/paper10.jpg", note: "书谱 66 子" },
    ];

/** 关心的时间字段（毫秒），按链路顺序。 */
const MS_FIELDS = ["decodeMs", "detectMs", "gridMs", "combMs", "cellFeatMs", "boardScanMs", "digitMs", "digitHeadMs", "assignMs", "renderMs", "sweepMs", "parallelScoreMs"];
const COUNT_FIELDS = ["gridWindows", "stones", "sweeps", "sweepValues", "templateBuilds", "rowClears", "flatClears", "scoreCalls", "templateCalls", "distinctSizes", "parallelScoreStones"];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const logs = [];
page.on("console", (message) => { logs.push(`[${message.type()}] ${message.text().slice(0, 240)}`); });
page.on("pageerror", (error) => logs.push(`[pageerror] ${String(error).slice(0, 200)}`));
await page.route("**/qa-profile.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-profile.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of items) {
  const bytes = readFileSync(resolve(item.path));
  const mime = /\.jpe?g$/i.test(item.path) ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name, msFields, countFields, parallel }) => {
    globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: blob.type });
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const pick = () => {
      const snapshot = { ...mod.moveOrderPerf };
      const slim = {};
      for (const key of msFields) slim[key] = Math.round(snapshot[key] || 0);
      for (const key of countFields) slim[key] = snapshot[key] ?? 0;
      slim.sweepsByStage = (snapshot.sweepsByStage || []).join("/");
      return slim;
    };
    const t0 = performance.now();
    const imported = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel, boardScanner: boardScanner ?? undefined });
    const importMs = Math.round(performance.now() - t0);
    const importPerf = pick();
    const t1 = performance.now();
    const restored = await mod.recognizeBoardImage(make(), 15, {
      skipMoveOrder: false, parallel,
      digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined,
      knownGrid: imported.knownGrid ?? undefined,
    });
    const restoreMs = Math.round(performance.now() - t1);
    const restorePerf = pick();
    return {
      importMs, restoreMs, importPerf, restorePerf,
      canvas: { width: imported.recognizeSize?.width ?? null, height: imported.recognizeSize?.height ?? null },
      stones: imported.board.flat().filter(Boolean).length,
      numbered: restored.numberedMoves?.length ?? 0,
      reads: restored.readMoveNumbers?.length ?? 0,
    };
  }, { dataUrl, name: item.path.split("/").pop(), msFields: MS_FIELDS, countFields: COUNT_FIELDS, parallel: PARALLEL });
  console.log(`\n${item.note}  画布 ${out.canvas.width}×${out.canvas.height}  导入 ${out.importMs}ms  复原 ${out.restoreMs}ms  → ${out.stones} 子 / 读号 ${out.reads} / 定号 ${out.numbered}`);
  for (const [label, perf] of [["导入", out.importPerf], ["复原", out.restorePerf]]) {
    const parts = MS_FIELDS.map((key) => `${key.replace(/Ms$/, "")} ${perf[key]}`).join("  ");
    const counts = COUNT_FIELDS.map((key) => `${key} ${perf[key]}`).join(" ");
    console.log(`  ${label} 分解: ${parts}`);
    console.log(`  ${label} 计数: ${counts}  阶段 ${perf.sweepsByStage}`);
  }
}

if (logs.length) { console.log("\n浏览器告警："); for (const line of logs.slice(0, 10)) console.log("  ", line); }
await browser.close();
