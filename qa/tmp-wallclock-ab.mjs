// 墙钟 A/B（不需要改源码）：用 skipMoveOrder 开关来隔离「模板段 + 装配」的真实占比。
//   A = 完整复原（含模板段）
//   B = skipMoveOrder（跳过整个模板段与装配）
// 差额即模板段+装配的真实墙钟成本；再与内部计数器交叉验证。
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const THROTTLE = Number(process.env.CPU_THROTTLE || 6);
const p = process.env.IMG || "qa/fixtures/materials/renjuportal/rp-score-10.png";
const isJ = /\.jpe?g$/i.test(p);
const dataUrl = `data:${isJ ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(p)).toString("base64")}`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
const c = await ctx.newCDPSession(page);
if (THROTTLE) await c.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await page.route("**/qa-w2.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body></body></html>" }));
await page.goto(new URL("qa-w2.html", base).toString(), { waitUntil: "domcontentloaded" });
const out = await page.evaluate(async ({ dataUrl, name }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const bs = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 }).catch(() => null);
  const dr = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 }).catch(() => null);
  const blob = await (await fetch(dataUrl)).blob();
  const mk = () => new File([blob], name, { type: blob.type });
  // 先拿网格（也顺带完成装载/预热）
  const imp = await mod.recognizeBoardImage(mk(), 15, { skipMoveOrder: true, parallel: true, boardScanner: bs ?? undefined });
  const s1 = { ...mod.moveOrderPerf };
  const g = imp.grid ? { originX: imp.grid.originX, originY: imp.grid.originY, spacingX: imp.grid.spacingX, spacingY: imp.grid.spacingY } : undefined;
  // B：跳过模板段（复用网格）
  const tb0 = performance.now();
  await mod.recognizeBoardImage(mk(), 15, { skipMoveOrder: true, parallel: true, boardScanner: bs ?? undefined, knownGrid: g });
  const bMs = Math.round(performance.now() - tb0);
  const sB = { ...mod.moveOrderPerf };
  // A：完整（复用网格）
  const ta0 = performance.now();
  const r = await mod.recognizeBoardImage(mk(), 15, { skipMoveOrder: false, parallel: true, digitReader: dr ?? undefined, boardScanner: bs ?? undefined, knownGrid: g });
  const aMs = Math.round(performance.now() - ta0);
  const sA = { ...mod.moveOrderPerf };
  return {
    bMs, aMs, s1: { gridMs: Math.round(s1.gridMs), cellFeat: Math.round(s1.cellFeatMs), scan: s1.boardScanMs },
    sB: { gridMs: Math.round(sB.gridMs), cellFeat: Math.round(sB.cellFeatMs), scan: sB.boardScanMs, digit: sB.digitMs },
    sA: { gridMs: Math.round(sA.gridMs), cellFeat: Math.round(sA.cellFeatMs), scan: sA.boardScanMs, digit: sA.digitMs, render: sA.renderMs, sweep: sA.sweepMs, assign: Math.round(sA.assignMs) },
    read: r.readMoveNumbers.length, stones: r.board.flat().filter(Boolean).length,
  };
}, { dataUrl, name: p.split("/").pop() });
console.log(`\n=== ${p}（降频 ${THROTTLE}×，均复用网格避免重算）===`);
console.log(`  B 只导入（skipMoveOrder）：${out.bMs}ms   内部：网格 ${out.sB.gridMs} 逐格 ${out.sB.cellFeat} 模型扫描 ${out.sB.scan} 读号 ${out.sB.digit}`);
console.log(`  A 完整复原              ：${out.aMs}ms   内部：网格 ${out.sA.gridMs} 逐格 ${out.sA.cellFeat} 模型扫描 ${out.sA.scan} 读号 ${out.sA.digit}(render ${out.sA.render} sweep ${out.sA.sweep}) 装配 ${out.sA.assign}`);
console.log(`  → 模板段+装配的真实墙钟差额 ≈ ${out.aMs - out.bMs}ms（占 A 的 ${Math.round(((out.aMs - out.bMs) / out.aMs) * 100)}%）`);
console.log(`  A 读出 ${out.read}/${out.stones}`);
await browser.close();
