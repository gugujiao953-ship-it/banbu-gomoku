// 分段耗时探针（2026-10-07）：把 import / restore 两条路径在「多核开/关」下的
// 每个阶段耗时打出来（decode / 网格检测 / 逐格特征 / 模板读号 / 模型扫描 / 装配），
// 用来定位「还能从哪儿再快」。设备模拟：本机 dev（无跨源隔离 → 主线程 ORT 单线程，
// 与安卓 WebView 相近）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-phase-perf.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  // 用户 10-08 明确：识谱（导入）体验优先，复原次要——这三张覆盖 App 截图 / 网页棋盘 / 书谱。
  { name: "rp-score-10.png", mime: "image/png", path: "qa/fixtures/materials/renjuportal/rp-score-10.png" },
  { name: "user-cno2010-15.jpg", mime: "image/jpeg", path: "qa/fixtures/materials/user-cno2010-15.jpg" },
  { name: "paper02.jpg", mime: "image/jpeg", path: "qa/fixtures/recognition/paper02.jpg" },
];

const browser = await chromium.launch({ headless: true });
const payloads = items.map((item) => ({ name: item.name, mime: item.mime, dataUrl: `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}` }));

const measure = async (item, parallel) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
  await page.route("**/qa-phase-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-phase-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ dataUrl, name, mime, parallel }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const t0 = performance.now();
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
    const digitReader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
    const loadMs = Math.round(performance.now() - t0);
    if (!scanner) return { error: "模型加载失败" };
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: mime });
    const snap = () => ({ ...mod.moveOrderPerf });
    const time = async (opts) => {
      const start = performance.now();
      const run = await mod.recognizeBoardImage(make(), 15, opts);
      return { ms: Math.round(performance.now() - start), stones: run.board.flat().filter(Boolean).length, restored: run.numberedMoves.length, perf: snap() };
    };
    const imp = await time({ skipMoveOrder: true, parallel, boardScanner: scanner });
    const res = await time({ skipMoveOrder: false, parallel, boardScanner: scanner, digitReader });
    return { loadMs, imp, res };
  }, { dataUrl: item.dataUrl, name: item.name, mime: item.mime, parallel });
  await context.close();
  return result;
};

const fmt = (label, run) => {
  const p = run.perf;
  console.log(`  ${label}: 合计 ${run.ms}ms | 解码 ${p.decodeMs} | 检测段 ${Math.round(p.detectMs)}（网格 ${p.gridMs} + 梳齿 ${p.combMs} + 逐格特征 ${p.cellFeatMs}） | 读号段 ${p.digitMs} | 模型扫描 ${p.boardScanMs} | 装配 ${p.assignMs} → ${run.stones} 子/复原 ${run.restored}`);
  console.log(`     工作量：网格窗 ${p.gridWindows} 早退 ${p.wEarly} | 模板 sweep ${p.sweeps}×${p.sweepValues} 渲染 ${p.templateBuilds} 清行 ${p.rowClears}/${p.flatClears}`);
};

for (const item of payloads) {
  console.log(`=== ${item.name}`);
  const par = await measure(item, true);
  const loc = await measure(item, false);
  if (par.error || loc.error) { console.log("  错误:", par.error || loc.error); continue; }
  console.log(`  模型装载 ${par.loadMs}ms（两条路径各一次）`);
  fmt("导入·多核开", par.imp);
  fmt("导入·多核关", loc.imp);
  fmt("复原·多核开（扫描命中缓存）", par.res);
  fmt("复原·多核关（扫描命中缓存）", loc.res);
}
await browser.close();
