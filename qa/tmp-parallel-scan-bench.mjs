// 多核扫描测速·干净版（2026-10-07）：每个配置开**独立页面**（扫描器缓存互不干扰），
// 量「225 格格级扫描」在多核开关开/关下的真实差值。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-parallel-scan-bench.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { name: "user-cno2010-15.jpg", mime: "image/jpeg", path: "qa/fixtures/materials/user-cno2010-15.jpg", expect: 15 },
  { name: "remote-image2.png", mime: "image/png", path: "qa/fixtures/materials/remote-image2.png", expect: 89 },
  { name: "paper10.jpg", mime: "image/jpeg", path: "qa/fixtures/recognition/paper10.jpg", expect: 66 },
];

const browser = await chromium.launch({ headless: true });

const measure = async (item, parallel) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
  page.on("console", (message) => { const text = message.text(); if (/accelerator|识别线程|模型|cell-scan/i.test(text)) console.log("[page]", message.type(), text.slice(0, 220)); });
  await page.route("**/qa-parbench2-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-parbench2-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ dataUrl, name, mime, parallel }) => {
    globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
    const digitReader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
    if (!scanner) return { error: "scanner 模型加载失败" };
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: mime });
    const time = async (opts) => {
      const t0 = performance.now();
      const run = await mod.recognizeBoardImage(make(), 15, opts);
      return { ms: Math.round(performance.now() - t0), stones: run.board.flat().filter(Boolean).length, restored: run.numberedMoves.length, read: run.readMoveNumbers.length, scan: mod.moveOrderPerf.boardScanMs, head: mod.moveOrderPerf.digitHeadMs };
    };
    // 导入路径（冷扫描）→ 复原路径（扫描命中缓存）
    const imp = await time({ skipMoveOrder: true, parallel, boardScanner: scanner });
    const res = await time({ skipMoveOrder: false, parallel, boardScanner: scanner, digitReader });
    return { imp, res };
  }, { dataUrl: `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`, name: item.name, mime: item.mime, parallel });
  await context.close();
  return result;
};

for (const item of items) {
  console.log(`=== ${item.name}（期望 ${item.expect} 子）`);
  const par = await measure(item, true);
  const loc = await measure(item, false);
  if (par.error || loc.error) { console.log("  错误:", par.error || loc.error); continue; }
  console.log(`  多核开 · 导入: ${par.imp.ms}ms（扫描 ${par.imp.scan}ms）${par.imp.stones} 子；复原: ${par.res.ms}ms（扫描 ${par.res.scan}ms、读号 ${par.res.head}ms）${par.res.stones} 子/复原 ${par.res.restored}/读 ${par.res.read}`);
  console.log(`  多核关 · 导入: ${loc.imp.ms}ms（扫描 ${loc.imp.scan}ms）${loc.imp.stones} 子；复原: ${loc.res.ms}ms（扫描 ${loc.res.scan}ms、读号 ${loc.res.head}ms）${loc.res.stones} 子/复原 ${loc.res.restored}/读 ${loc.res.read}`);
  console.log(`  → 格级扫描提速 ${Math.round((1 - par.imp.scan / Math.max(1, loc.imp.scan)) * 100)}%（${loc.imp.scan}ms → ${par.imp.scan}ms）；导入总耗时差 ${loc.imp.ms - par.imp.ms}ms`);
}
await browser.close();
