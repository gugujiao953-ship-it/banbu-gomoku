// 诊断：多核池在「非跨源隔离」环境（=手机 WebView）下是不是在拖后腿 / 是否分片超时降级。
//
// 背景（2026-10-09）：手机实测识谱十几秒、复原几十秒；桌面同条件（关跨源隔离）复现出
// 「worker 池比单线程更慢」（书谱 4.9s → 25.9s，25.9 ≈ 一次 SLICE_TIMEOUT_MS=20000 的
// 超时 + 主线程补算）。本探针把 console 抓下来，直接看有没有「多核分片失败，改用单线程」
// 这类降级日志，以及每个分片的时间线。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-pool-vs-single.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { path: "qa/fixtures/recognition/paper10.jpg", note: "书谱 66 子" },
  { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", note: "网页密盘 76 子" },
];

const browser = await chromium.launch({ headless: true });
for (const item of items) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => { if (message.type() !== "log") logs.push(`[${message.type()}] ${message.text().slice(0, 200)}`); });
  page.on("pageerror", (error) => logs.push(`[pageerror] ${String(error).slice(0, 200)}`));
  await page.route("**/qa-pool-diag-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-pool-diag-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const dataUrl = `data:${/\.jpe?g$/i.test(item.path) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: blob.type });
    const time = async (label, opts) => {
      const started = performance.now();
      const perf0 = { ...mod.moveOrderPerf };
      const result = await mod.recognizeBoardImage(make(), 15, { digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, ...opts });
      const ms = Math.round(performance.now() - started);
      return { label, ms, stones: result.board.flat().filter(Boolean).length, reads: result.readMoveNumbers.length, perf: { ...mod.moveOrderPerf } };
    };
    const results = [];
    results.push(await time("单线程", { skipMoveOrder: true, parallel: false }));
    results.push(await time("多核池", { skipMoveOrder: true, parallel: true }));
    results.push(await time("单线程(再)", { skipMoveOrder: true, parallel: false }));
    return { isolated: globalThis.crossOriginIsolated === true, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory ?? null, results };
  }, { dataUrl, name: item.path.split("/").pop() });
  console.log(`\n${item.note}  crossOriginIsolated=${out.isolated} cores=${out.cores} memory=${out.memory}GB`);
  for (const row of out.results) {
    const p = row.perf;
    console.log(`  ${row.label}: ${row.ms}ms → ${row.stones} 子 | 网格 ${Math.round(p.gridMs)}ms(${p.gridWindows} 窗) 模型扫描 ${p.boardScanMs}ms 读号 ${p.digitHeadMs}ms`);
  }
  if (logs.length) { console.log("  浏览器告警："); for (const line of logs.slice(0, 6)) console.log("   ", line); }
  await context.close();
}
await browser.close();
