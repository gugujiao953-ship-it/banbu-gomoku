// 「完整流程（复原手序）」的分段耗时（2026-10-09）。
//
// 现场：用户说「识谱十几秒、复原几十秒」，并指出「电脑网页版也慢，不是你说的 1-2 秒」。
// 实测确认用户是对的：同一张盘面，识谱约 2 秒，而**完整流程 15.8 秒（1.5MP）/ 26 秒
// （16.8MP，手机照片量级）**。此前我报的「1-2 秒」是预热后第二次调用（缓存全命中），
// 不代表首次体验——这次把每一步都量出来，并且**不预热**（模拟用户第一次点复原）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-restore-breakdown.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", mime: "image/png" };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-restore-bd-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-restore-bd-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;

const out = await page.evaluate(async ({ dataUrl, name }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  // 不预热：模拟用户第一次点「复原手序」——但模型装载是 App 启动时预热过的，
  // 所以这里也先建一次会话（否则量到的是装载，而实际体验里那步已经在启动时做过）。
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
  ]);
  const blob = await (await fetch(dataUrl)).blob();
  const make = () => new File([blob], name, { type: blob.type });
  const runs = [];
  // 用户真实顺序：先「导入」（静态），再点「复原手序」（另一条识别）
  const time = async (label, opts) => {
    const started = performance.now();
    const result = await mod.recognizeBoardImage(make(), 15, { parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, ...opts });
    runs.push({ label, ms: Math.round(performance.now() - started), stones: result.board.flat().filter(Boolean).length, reads: result.readMoveNumbers.length, snap: { ...mod.moveOrderPerf } });
  };
  await time("导入（skipMoveOrder）", { skipMoveOrder: true });
  await time("复原手序（同一张图第二次）", { skipMoveOrder: false });
  await time("复原手序（再来一次）", { skipMoveOrder: false });
  return runs;
}, { dataUrl, name: item.path.split("/").pop() });

for (const run of out) {
  const s = run.snap;
  console.log(`\n${run.label}: ${run.ms}ms → ${run.stones} 子 / 读出 ${run.reads 	} 个号`);
  console.log(`  解码 ${s.decodeMs} | 网格 ${Math.round(s.gridMs)}（${s.gridWindows} 窗）| 线梳 ${s.combMs} | 逐格特征 ${Math.round(s.cellFeatMs)} | 读号段 ${s.digitMs}（head ${s.digitHeadMs}）| 模型扫描 ${s.boardScanMs} | 装配 ${Math.round(s.assignMs)}`);
  console.log(`  模板扫描 ${s.sweeps} 次 × ${s.sweepValues} 值 = ${(s.sweeps * s.sweepValues / 1e6).toFixed(1)}M 次比对 | 渲染 ${s.templateBuilds} | 清行 ${s.rowClears}/${s.flatClears}`);
}
await browser.close();
