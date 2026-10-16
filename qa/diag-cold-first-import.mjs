// 诊断：**真冷启动**（全新浏览器 profile，无 HTTP 缓存）第一次导入要多久，预热能省多少（2026-10-14）。
//
// 为什么必须用全新 profile：dev server + 浏览器缓存会把 14MB ORT wasm 与模型文件都缓存住，
// 于是「首次建池」在桌面只要 1 秒——这跟用户手机上「刚装完第一次识谱」完全是两码事。
// 每个场景都用一个临时 user-data-dir，跑完即删；这才是真机首次的近似。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-cold-first-import.mjs
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { path: "qa/fixtures/materials/user-report/book-blur-71.jpg", note: "书谱小图 71" },
  { path: "qa/fixtures/materials/user-report/zhizi-dense-101.jpg", note: "智子密盘 101" },
];

const coldRun = async ({ dataUrl, name, prewarm }) => {
  const dir = mkdtempSync(join(tmpdir(), "banbu-cold-"));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    args: ["--disable-http-cache", "--disk-cache-size=1"],
  });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => { if (/banbu-pool-(reuse|release|made)/.test(message.text())) logs.push(message.text()); });
  await page.route("**/qa-cold.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-cold.html", base).toString(), { waitUntil: "domcontentloaded" });
  const out = await page.evaluate(async ({ dataUrl, name, prewarm }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    let prewarmMs = null;
    if (prewarm) {
      const started = performance.now();
      await mod.prewarmRecognitionPool();
      prewarmMs = Math.round(performance.now() - started);
    }
    const blob = await (await fetch(dataUrl)).blob();
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const make = () => new File([blob], name, { type: blob.type });
    const t0 = performance.now();
    const imported = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true, boardScanner: boardScanner ?? undefined });
    const importMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const restored = await mod.recognizeBoardImage(make(), 15, {
      skipMoveOrder: false, parallel: true,
      digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined,
      knownGrid: imported.knownGrid ?? undefined,
    });
    return {
      prewarmMs, importMs, restoreMs: Math.round(performance.now() - t1),
      stones: imported.board.flat().filter(Boolean).length, numbered: restored.numberedMoves?.length ?? 0,
      pool: { ...(globalThis.__banbuPoolStats || {}) },
    };
  }, { dataUrl, name, prewarm });
  if (logs.length) for (const line of logs) console.log("    " + line);
  await context.close();
  rmSync(dir, { recursive: true, force: true });
  return out;
};

for (const item of items) {
  const bytes = readFileSync(resolve(item.path));
  const mime = /\.jpe?g$/i.test(item.path) ? "image/jpeg" : "image/png";
  const args = { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, name: item.path.split("/").pop() };
  console.log(`\n${item.note}（全新 profile，无缓存）`);
  for (const prewarm of [false, true]) {
    const row = await coldRun({ ...args, prewarm });
    const pre = row.prewarmMs === null ? "" : `预热 ${row.prewarmMs}ms → `;
    console.log(`  ${prewarm ? "预热后" : "直接导入"}: ${pre}导入 ${row.importMs}ms + 复原 ${row.restoreMs}ms = ${row.importMs + row.restoreMs}ms → ${row.stones} 子 / ${row.numbered} 号 | 池 spawned=${row.pool.spawned} reused=${row.pool.reused}`);
  }
}
