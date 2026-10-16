// 在**同一台机器上**对比「模型任务走 worker vs 走主线程」（2026-10-09）。
//
// 为什么要这个对比：用户手机实测「识谱十几秒、且哪张图都一样」。这个「与图片无关」说明
// 有固定开销在主导——最可能的就是 import 路径里**固定 225 格**的 cell-cls 分类。
// 我先前把非隔离环境的模型任务挪到主线程（桌面模拟手机上确实更快），但那是在 12 核
// 桌面上主线程与 worker 同源竞争的结果，未必代表手机。这里用 CDP 把 CPU 降频 6 倍
// 模拟手机算力，两条路各量一遍。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-model-route-ab.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = { path: "qa/fixtures/materials/user-cno2010-15.jpg", note: "用户 15 手截图（子少、最能暴露固定开销）" };
const THROTTLE = Number(process.env.CPU_THROTTLE || 6);

const browser = await chromium.launch({ headless: true });
for (const forceWorkers of [false, true]) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "warning") console.log("   [warn]", message.text().slice(0, 140)); });
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.route("**/qa-route-ab-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-route-ab-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name, forceWorkers }) => {
    globalThis.__BANBU_FORCE_MODEL_WORKERS__ = forceWorkers;
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: blob.type });
    const time = async (opts) => {
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true, boardScanner: boardScanner ?? undefined, digitReader: digitReader ?? undefined, ...opts });
      return { ms: Math.round(performance.now() - started), stones: result.board.flat().filter(Boolean).length, snap: { ...mod.moveOrderPerf } };
    };
    await time({});            // 预热
    return await time({});     // 计时
  }, { dataUrl, name: item.path.split("/").pop(), forceWorkers });
  const s = out.snap;
  console.log(`模型任务${forceWorkers ? "走 worker" : "走主线程"}（CPU 降频 ${THROTTLE}×）：${out.ms}ms → ${out.stones} 子`);
  console.log(`   网格 ${Math.round(s.gridMs)}ms / 模型扫描 ${s.boardScanMs}ms / 读号 ${s.digitHeadMs}ms / 逐格特征 ${Math.round(s.cellFeatMs)}ms`);
  await context.close();
}
await browser.close();
