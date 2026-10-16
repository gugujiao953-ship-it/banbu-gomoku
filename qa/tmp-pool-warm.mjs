// 一次性：池子「第二次是否变快」——区分「每 worker 的 ORT 编译是一次性成本」还是「恒定的净亏」。
// 同一页面里连跑三次导入路径：① 池（冷）② 池（第二次）③ 单线程。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/tmp-pool-warm.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const FILE = process.env.POOL_FILE || "qa/fixtures/materials/remote-image2.png";

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(900_000);
await page.route("**/qa-pool-warm-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-pool-warm-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const dataUrl = `data:${/\.png$/i.test(FILE) ? "image/png" : "image/jpeg"};base64,${readFileSync(resolve(FILE)).toString("base64")}`;
const out = await page.evaluate(async ({ dataUrl }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const blob = await (await fetch(dataUrl)).blob();
  const mk = () => new File([blob], "probe.png", { type: blob.type });
  const reset = () => { for (const key of Object.keys(mod.moveOrderPerf)) { const v = mod.moveOrderPerf[key]; if (Array.isArray(v)) mod.moveOrderPerf[key] = v.map(() => 0); else if (typeof v === "number") mod.moveOrderPerf[key] = 0; } };
  const run = async (skipMoveOrder, parallel) => {
    reset();
    const t0 = performance.now();
    const result = await mod.recognizeBoardImage(mk(), 15, { skipMoveOrder, parallel, boardScanner: scanner ?? undefined });
    return { ms: Math.round(performance.now() - t0), boardScanMs: Math.round(mod.moveOrderPerf.boardScanMs), stones: result.board.flat().filter(Boolean).length };
  };
  const rows = [];
  for (const round of [1, 2, 3]) rows.push({ label: `导入·池#${round}`, ...(await run(true, true)) });
  rows.push({ label: "导入·单线程", ...(await run(true, false)) });
  return rows;
}, { dataUrl });

for (const row of out) console.log(`${row.label.padEnd(14)} 总 ${String(row.ms).padStart(6)}ms｜板面扫描 ${String(row.boardScanMs).padStart(6)}ms｜${row.stones} 子`);
await browser.close();
