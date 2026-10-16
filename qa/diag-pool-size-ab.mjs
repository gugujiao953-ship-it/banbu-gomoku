// A/B：识谱线程池 4 条 vs 6 条（2026-10-15）。用假 deviceMemory 控制档位：
//   7GB → 新公式 min(240, 7*24=168)=168 / 36.8 ≈ 4 条（与旧策略 160/36.8=4 相同）
//   8GB → 新公式 240 / 36.8 ≈ 6 条（旧策略在 8GB 上也是 4 条）
// 同一张图各跑 2 轮，报导入/复原耗时与池大小日志。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-pool-size-ab.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = process.env.AB_ITEM || "qa/fixtures/materials/user-report/zhizi-dense-101.jpg";
const ROUNDS = Number(process.env.AB_ROUNDS || 2);
const mime = /\.jpe?g$/i.test(item) ? "image/jpeg" : "image/png";

const browser = await chromium.launch({ headless: true });

const run = async (fakeMemory) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript((mem) => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => mem });
  }, fakeMemory);
  const page = await context.newPage();
  const poolLogs = [];
  page.on("console", (message) => { if (message.text().includes("banbu-image-accelerator")) poolLogs.push(message.text().slice(0, 120)); });
  await page.route("**/qa-abhost.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-abhost.html", base).toString(), { waitUntil: "domcontentloaded" });
  const out = await page.evaluate(async ({ dataUrl, name, rounds }) => {
    globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: blob.type });
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const rows = [];
    for (let index = 0; index < rounds; index += 1) {
      const t0 = performance.now();
      const imported = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true, boardScanner: boardScanner ?? undefined });
      const importMs = Math.round(performance.now() - t0);
      const t1 = performance.now();
      const restored = await mod.recognizeBoardImage(make(), 15, {
        skipMoveOrder: false, parallel: true, digitReader: digitReader ?? undefined,
        boardScanner: boardScanner ?? undefined, knownGrid: imported.knownGrid ?? undefined,
      });
      rows.push({ importMs, restoreMs: Math.round(performance.now() - t1), stones: imported.board.flat().filter(Boolean).length, numbered: restored.numberedMoves?.length ?? 0 });
    }
    return { rows, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory };
  }, { dataUrl: `data:${mime};base64,${readFileSync(resolve(item)).toString("base64")}`, name: item.split("/").pop(), rounds: ROUNDS });
  await context.close();
  return { ...out, poolLogs };
};

for (const memory of [7, 8]) {
  const out = await run(memory);
  const label = memory === 7 ? "4 条（等同旧策略）" : "6 条（新档）";
  console.log(`\n假 deviceMemory=${memory} → ${label}  cores=${out.cores}`);
  const poolLine = out.poolLogs.find((line) => line.includes("poolSize"));
  if (poolLine) console.log(`  ${poolLine}`);
  for (const [index, row] of out.rows.entries()) {
    console.log(`  第${index + 1}轮：导入 ${row.importMs}ms + 复原 ${row.restoreMs}ms → ${row.stones} 子 / ${row.numbered} 号`);
  }
  const mean = (key) => Math.round(out.rows.reduce((sum, row) => sum + row[key], 0) / out.rows.length);
  console.log(`  均：导入 ${mean("importMs")}ms、复原 ${mean("restoreMs")}ms`);
}
await browser.close();
