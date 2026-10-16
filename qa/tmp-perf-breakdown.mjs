// 识谱耗时分解（一次性）：用识别器自带的 moveOrderPerf 把「一次复原」拆到各段，
// 分辨哪些是模型推理、哪些是模板渲染/评分、哪些是网格检测——为「还能从哪儿榨速度」定靶。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/tmp-perf-breakdown.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const CASES = [
  { id: "密集215手", file: "qa/fixtures/materials/self-hi-ply/self-010@1200.jpg" },
  { id: "真机89手", file: "qa/fixtures/materials/remote-image2.png" },
  { id: "智子193子", file: "qa/fixtures/materials/user-report/zhizi-dense-101.jpg" },
  { id: "书谱71手", file: "qa/fixtures/materials/user-report/book-blur-71.jpg" },
];

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(900_000);
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.route("**/qa-perf-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-perf-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const items = CASES.map((c) => ({ ...c, dataUrl: `data:${/\.png$/i.test(c.file) ? "image/png" : "image/jpeg"};base64,${readFileSync(resolve(c.file)).toString("base64")}` }));
const out = await page.evaluate(async ({ items }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 }),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 }),
  ]);
  const rows = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const mk = () => new File([blob], item.id, { type: blob.type });
    const run = async (parallel) => {
      for (const key of Object.keys(mod.moveOrderPerf)) {
        const value = mod.moveOrderPerf[key];
        if (Array.isArray(value)) mod.moveOrderPerf[key] = value.map(() => 0);
        else if (typeof value === "number") mod.moveOrderPerf[key] = 0;
      }
      const t0 = performance.now();
      const result = await mod.recognizeBoardImage(mk(), 15, {
        skipMoveOrder: false, parallel, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined,
      });
      return { ms: Math.round(performance.now() - t0), perf: JSON.parse(JSON.stringify(mod.moveOrderPerf)), numbered: result.numberedMoves.length, reads: result.readMoveNumbers.length };
    };
    const withPool = await run(true);
    const single = await run(false);
    rows.push({ id: item.id, withPool, single });
  }
  return rows;
}, { items });

const pct = (part, whole) => `${Math.round((part / Math.max(1, whole)) * 100)}%`;
for (const row of out) {
  const a = row.withPool, b = row.single;
  console.log(`\n### ${row.id}：多核 ${a.ms}ms（复原 ${a.numbered} 手/读出 ${a.reads} 号）｜单线程 ${b.ms}ms → 多核提速 ${(b.ms / a.ms).toFixed(2)}×`);
  const p = a.perf;
  const sum = p.decodeMs + p.detectMs + p.gridMs + p.combMs + p.cellFeatMs + p.digitMs;
  console.log(`  总 ${a.ms}ms｜分段（自身计时合计 ${Math.round(sum)}ms）`);
  console.log(`    解码/缩放 decodeMs ${p.decodeMs}ms`);
  console.log(`    路数检测 detectMs ${p.detectMs}ms｜网格 gridMs ${p.gridMs}ms（批 ${p.gridBatchMs}ms/${p.gridBatchWindows} 窗，相位 ${p.gridPhaseMs}ms/${p.gridPhaseWindows} 窗）`);
  console.log(`    线梳 combMs ${p.combMs}ms｜格特征 cellFeatMs ${p.cellFeatMs}ms`);
  console.log(`    **读号段 digitMs ${p.digitMs}ms（占 ${pct(p.digitMs, a.ms)}）** = 模板渲染 ${p.renderMs}ms + 模板评分 ${p.sweepMs}ms + 数字头 ${p.digitHeadMs}ms + 板面扫描 ${p.boardScanMs}ms｜装配 ${p.assignMs}ms`);
  console.log(`    模板：扫描 ${p.sweeps} 次 / 值 ${p.sweepValues} 个 / 渲染 ${p.templateBuilds} 次(${p.distinctSizes} 种尺度) / scoreAt ${p.scoreCalls} 次｜并行回填 ${p.parallelScoreMs}ms(${p.parallelScoreStones} 子)`);
  console.log(`    逐级升格扫描次数 ${JSON.stringify(p.sweepsByStage)}｜探针 median ${p.probeMedian} legible ${p.probeLegible} skipped ${p.probeSkipped}`);
  const q = b.perf;
  console.log(`    单线程对照：读号段 ${q.digitMs}ms（模板评分 ${q.sweepMs}ms + 渲染 ${q.renderMs}ms + 数字头 ${q.digitHeadMs}ms + 扫描 ${q.boardScanMs}ms）`);
}
await browser.close();
