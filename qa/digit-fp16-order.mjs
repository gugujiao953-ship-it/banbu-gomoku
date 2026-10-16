// fp16 慢 3 倍的**根因诊断**（2026-10-09）。
//
// 现象：在 `digit-model-selfrender.mjs` 里，iter8(fp16) 总耗时是 iter21(fp32) 的 2.4–3.3 倍，
// 而**读数逐格完全相同**。但 `digit-fp16-ab.mjs`（交替 A/B）测出两者持平（±3.5%）。
//
// 两个实验矛盾，必须先分清是"真慢"还是"测量顺序造成的假象"。本探针把变量逐个隔离：
//   ① 单独跑（进程里只有它）——排除进程内相互影响；
//   ② 交换顺序（fp32 先跑、fp16 后跑）——排除"谁先跑谁吃亏"的顺序效应；
//   ③ 只量推理本身（逐格前向，不经识别管线）——排除管线分支差异。
//
// 用法：
//   MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ ORDER=quant_first node qa/digit-fp16-order.mjs
//   ORDER=raw_first   → fp32 先跑
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const ORDER = process.env.ORDER || "quant_first"; // quant_first | raw_first | only_quant | only_raw

const quant = { key: "iter8·fp16", url: "/models/digit-head-iter8.onnx", disk: "public/models/digit-head-iter8.onnx" };
const raw = { key: "iter21·fp32", url: "/qa/cand-models/digit-head-iter21.onnx", disk: "qa/cand-models/digit-head-iter21.onnx" };
const modelList = (
  ORDER === "only_quant" ? [quant]
    : ORDER === "only_raw" ? [raw]
      : ORDER === "raw_first" ? [raw, quant] : [quant, raw]
).filter((m) => existsSync(resolve(".", m.disk)));

// 三张不同规模的图（子数少/中/多）
const dir = resolve("qa/fixtures/materials/self-render");
const files = ["self-001@820.jpg", "self-004@820.jpg", "self-007@820.jpg"];
const payloads = files.filter((f) => existsSync(resolve(dir, f))).map((f) => ({
  file: f,
  dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(dir, f)).toString("base64")}`,
}));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-order-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-order-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items, modelList }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const boardScanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
  });
  const readers = new Map();
  const loadMs = new Map();
  for (const m of modelList) {
    const t0 = performance.now();
    const r = await head.createDigitHeadReader({ modelUrl: m.url, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 });
    loadMs.set(m.key, Math.round(performance.now() - t0));
    readers.set(m.key, r);
  }

  const rows = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.file, { type: item.mime });
    const perModel = [];
    for (const m of modelList) {
      const reader = readers.get(m.key);
      if (!reader) { perModel.push({ key: m.key, error: "null" }); continue; }
      // 计时分两段：整条识别管线 + 纯读号调用
      const t0 = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, {
        skipMoveOrder: false, parallel: false, digitReader: reader, boardScanner: boardScanner ?? undefined,
      });
      const totalMs = Math.round(performance.now() - t0);
      const snap = { ...mod.moveOrderPerf };
      perModel.push({
        key: m.key, totalMs,
        digitMs: snap.digitMs, digitHeadMs: snap.digitHeadMs, boardScanMs: snap.boardScanMs,
        sweeps: snap.sweeps, renderMs: snap.renderMs, sweepMs: snap.sweepMs,
        read: result.readMoveNumbers.length,
        stones: result.board.flat().filter(Boolean).length,
        numbered: result.numberedMoves.length,
      });
    }
    rows.push({ file: item.file, perModel });
  }
  return { rows, loadMs: [...loadMs.entries()] };
}, { items: payloads, modelList });

console.log(`\n=== ORDER=${ORDER} ===`);
console.log(`模型装载耗时: ${out.loadMs.map(([k, v]) => `${k}=${v}ms`).join("  ")}`);
for (const row of out.rows) {
  console.log(`\n${row.file}`);
  for (const r of row.perModel) {
    if (r.error) { console.log(`  ${r.key}: ${r.error}`); continue; }
    console.log(`  ${r.key.padEnd(12)} 总 ${String(r.totalMs).padStart(6)}ms | 读号段 ${String(r.digitMs).padStart(6)}ms（模型 ${String(r.digitHeadMs).padStart(5)}ms）| 扫描 ${r.boardScanMs}ms | 模板 渲染 ${r.renderMs}/评分 ${r.sweepMs}ms ${r.sweeps}次 | 读出 ${r.read}/${r.stones}`);
  }
  if (row.perModel.length === 2 && !row.perModel.some((r) => r.error)) {
    const [a, b] = row.perModel;
    const d = ((a.totalMs - b.totalMs) / b.totalMs) * 100;
    console.log(`  → ${a.key} 相对 ${b.key}：${d >= 0 ? "慢" : "快"} ${Math.abs(d).toFixed(1)}%`);
  }
}
await browser.close();
