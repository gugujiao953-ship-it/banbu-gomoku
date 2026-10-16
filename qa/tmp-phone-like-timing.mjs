// 与手机条件等价的计时（2026-10-09）。
//
// 背景：用户手机实测「识谱十几秒、复原几十秒」，而桌面 dev 只要 1～4 秒。原因不在代码，
// 而在运行环境差异——手机 Android WebView **不支持跨源隔离**（项目自己的注释里写明，
// 见 NativeEnginePlugin.java），于是：
//   · ORT 只能在主线程单线程跑 wasm（无法多线程 wasm）；
//   · worker 池虽然还在（多核分片不依赖跨源隔离），但每个 worker 也只有 1 线程。
// 桌面 dev server 有 COOP/COEP 头 → 能多线程 wasm，所以快得多。
//
// 本探针把桌面浏览器里的两条路都量一遍：parallel=false（等价手机单线程）与 true（开发机多核），
// 给「手机该有多慢」一个自己的刻度，避免再拿开发机数字当手机预期。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-phone-like-timing.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", note: "网页密盘 76 子" },
  { path: "qa/fixtures/recognition/paper10.jpg", note: "书谱 66 子" },
  { path: "qa/fixtures/materials/user-cno2010-15.jpg", note: "用户 15 手截图" },
];

const browser = await chromium.launch({ headless: true });
for (const item of items) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
  await page.route("**/qa-phone-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-phone-host.html", base).toString(), { waitUntil: "domcontentloaded" });
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
    const time = async (opts) => {
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, ...opts });
      return {
        ms: Math.round(performance.now() - started),
        stones: result.board.flat().filter(Boolean).length,
        reads: result.readMoveNumbers.length,
      };
    };
    await time({ skipMoveOrder: true, parallel: true }); // 预热（首次含 worker 启动与模型装载）
    const single = await time({ skipMoveOrder: true, parallel: false });
    const multi = await time({ skipMoveOrder: true, parallel: true });
    const fullSingle = await time({ skipMoveOrder: false, parallel: false });
    return { single, multi, fullSingle, isolated: globalThis.crossOriginIsolated === true };
  }, { dataUrl, name: item.path.split("/").pop() });
  console.log(`${item.note}（crossOriginIsolated=${out.isolated}）`);
  console.log(`  识谱·单线程（≈手机）${out.single.ms}ms → ${out.single.stones} 子`);
  console.log(`  识谱·多核池（≈开发机）${out.multi.ms}ms → ${out.multi.stones} 子`);
  console.log(`  完整流程·单线程（≈手机）${out.fullSingle.ms}ms → 读出 ${out.fullSingle.reads} 个号`);
  await context.close();
}
await browser.close();
