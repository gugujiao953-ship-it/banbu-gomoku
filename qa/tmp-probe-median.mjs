// 域判别信号测量（2026-10-08）：模板扫描会给「前 N 颗子的模板首选分中位数」（probeMedian）。
// 目的：验证它能否区分「模板域」（旧书手写体/白底比赛图，模板 6/6 而数字头 0/6）与
// 「屏幕域」（网页/App 渲染体，模板读不动而数字头更好）。若能区分，就能用它做闸门，
// 把 10.4 秒的模板扫描只留给模板域；否则这个提速方案不成立。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-probe-median.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const items = [
  { path: "qa/fixtures/recognition/paper02.jpg", note: "旧书手写体（模板域）" },
  { path: "qa/fixtures/materials/user-cno2010-15.jpg", note: "外部 App 截图（模板+数字头都要）" },
  { path: "qa/fixtures/materials/remote-image2.png", note: "白底比赛图 89 手（模板域）" },
  { path: "qa/fixtures/recognition/paper10.jpg", note: "书谱 66 子（模板域）" },
  { path: "qa/fixtures/materials/renjuportal/rp-score-02.png", note: "网页棋盘（屏幕域）" },
  { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", note: "网页密盘（屏幕域）" },
  { path: "qa/fixtures/materials/renjuportal/rp-score-04.png", note: "网页棋盘（屏幕域）" },
];
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-probe-median-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-probe-median-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of items) {
  const dataUrl = `data:${/\.jpe?g$/i.test(item.path) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }),
    ]);
    const blob = await (await fetch(dataUrl)).blob();
    const run = await mod.recognizeBoardImage(new File([blob], name, { type: blob.type }), 15, { skipMoveOrder: false, parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined });
    return {
      probeMedian: mod.moveOrderPerf.probeMedian,
      probeLegible: mod.moveOrderPerf.probeLegible,
      stones: run.board.flat().filter(Boolean).length,
      reads: run.readMoveNumbers.length,
      restored: run.numberedMoves.length,
      perf: { sweeps: mod.moveOrderPerf.sweeps, values: mod.moveOrderPerf.sweepValues, digitMs: mod.moveOrderPerf.digitMs, sampleMedian: mod.moveOrderPerf.templateSampleMedian, skipped: mod.moveOrderPerf.templateSkipped, totalMs: Math.round(mod.moveOrderPerf.digitMs + mod.moveOrderPerf.detectMs) },
    };
  }, { dataUrl, name: item.path.split("/").pop() });
  console.log(`${item.path.split("/").pop().padEnd(22)} ${item.note.padEnd(24)} ${String(out.stones).padStart(3)} 子/读出 ${String(out.reads).padStart(3)}/复原 ${String(out.restored).padStart(3)} | 样本中位数 ${String(out.perf.sampleMedian).padEnd(6)} 跳过 ${String(out.perf.skipped).padStart(3)}/${out.stones} | 模板扫描 ${out.perf.sweeps}×${out.perf.values} 读号段 ${out.perf.digitMs}ms`);
}
await browser.close();
