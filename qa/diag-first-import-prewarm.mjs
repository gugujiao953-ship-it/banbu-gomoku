// 诊断：第一次导入识谱的「冷启动」代价，以及后台预热能省掉多少（2026-10-14）。
//
// 目的：用户要求「第一次导入也能在 10 秒内识完棋谱」。页面**首次**识别的耗时几乎全在
// 「每个 worker 各自编译 14MB 的 ORT wasm + 装载两个 fp16 模型」，与「哪张图」无关。
// 预热（prewarmRecognitionPool）就是把这段挪到用户在首页/系统相册里的空闲时间。
//
// 本探针**照抄 App 真实调用**（src/App.tsx:9131 与 :9296）：
//   阶段①「导入」  ：recognizeBoardImage(file, size, { skipMoveOrder: true, parallel, boardScanner })
//   阶段②「复原手序」：recognizeBoardImage(file, size, { skipMoveOrder: false, parallel, digitReader, boardScanner })
// 两种场景各跑一遍：
//   A 冷启动（无预热）——用户抱怨的那条路
//   B 预热后        ——先 await prewarmRecognitionPool()（模拟"首页空闲时已热好"）
//   C 交错          ——起预热 → 等 PREWARM_LEAD_MS（模拟"用户正在系统相册里挑图"）→ 再识别
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-first-import-prewarm.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
/** 模拟「起预热 → 用户挑照片 → 点确认」之间的间隔。手机上选图普遍 5–20 秒。 */
const PREWARM_LEAD_MS = Number(process.env.PREWARM_LEAD_MS || 6000);
const ROUNDS = Number(process.env.ROUNDS || 2);
const items = [
  { path: "qa/fixtures/materials/user-report/zhizi-dense-101.jpg", note: "智子密盘 101" },
  { path: "qa/fixtures/materials/user-report/book-blur-71.jpg", note: "书谱小图 71" },
];

const browser = await chromium.launch({ headless: true });

/** 新开一个干净页面。（浏览器 wasm 代码缓存按 URL 生效——真机**首次**装完没有缓存，
 *  所以这里的冷启动数字是下界；但 A 与 B 用同一份缓存，两者之差就是预热省下的那一段。） */
const freshPage = async () => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => { if (message.type() !== "log") logs.push(`[${message.type()}] ${message.text().slice(0, 160)}`); });
  page.on("pageerror", (error) => logs.push(`[pageerror] ${String(error).slice(0, 160)}`));
  await page.route("**/qa-first-import.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-first-import.html", base).toString(), { waitUntil: "domcontentloaded" });
  return { page, context, logs };
};

/** 照抄 App 的两段调用。prewarmFirst: false | true | "overlap"。 */
const RUN = async ({ dataUrl, name, prewarmFirst, leadMs }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const accel = await import("/src/features/recognition/recognition-accelerator.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const make = () => new File([blob], name, { type: blob.type });
  let prewarmMs = null;
  if (prewarmFirst === true) {
    const started = performance.now();
    await accel.prewarmRecognitionPool();
    prewarmMs = Math.round(performance.now() - started);
  } else if (prewarmFirst === "overlap") {
    void accel.prewarmRecognitionPool();
    await new Promise((done) => setTimeout(done, leadMs));
  }
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
  ]);
  const t0 = performance.now();
  const import1 = await mod.recognizeBoardImage(make(), 15, {
    skipMoveOrder: true, parallel: true, boardScanner: boardScanner ?? undefined,
  });
  const t1 = performance.now();
  const restore = await mod.recognizeBoardImage(make(), 15, {
    skipMoveOrder: false, parallel: true,
    digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined,
    knownGrid: import1.knownGrid ?? undefined,
  });
  const t2 = performance.now();
  return {
    importMs: Math.round(t1 - t0),
    restoreMs: Math.round(t2 - t1),
    totalMs: Math.round(t2 - t0),
    prewarmMs,
    stones: import1.board.flat().filter(Boolean).length,
    numbered: restore.numberedMoves?.length ?? 0,
    pool: { ...(globalThis.__banbuPoolStats || { spawned: 0, reused: 0 }) },
  };
};

const stat = (rows, key) => {
  const list = rows.map((row) => row[key]);
  return { min: Math.min(...list), max: Math.max(...list), mean: Math.round(list.reduce((a, b) => a + b, 0) / list.length) };
};

for (const item of items) {
  const bytes = readFileSync(resolve(item.path));
  const mime = /\.jpe?g$/i.test(item.path) ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  const args = { dataUrl, name: item.path.split("/").pop() };

  const cold = [];
  const warm = [];
  const overlap = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    for (const [bucket, mode] of [[cold, false], [warm, true], [overlap, "overlap"]]) {
      const { page, context, logs } = await freshPage();
      const row = await page.evaluate(RUN, { ...args, prewarmFirst: mode, leadMs: PREWARM_LEAD_MS });
      row.logs = logs.slice(0, 3);
      bucket.push(row);
      await context.close();
    }
  }

  console.log(`\n${item.note}  ${bytes.length} B`);
  for (const [label, rows] of [["① 冷启动（无预热）", cold], ["② 预热后", warm], [`③ 交错（预热后等 ${PREWARM_LEAD_MS}ms 再识别）`, overlap]]) {
    for (const row of rows) {
      const pre = row.prewarmMs === null ? "" : `[预热 ${row.prewarmMs}ms] `;
      console.log(`  ${label}: ${pre}导入 ${row.importMs}ms + 复原 ${row.restoreMs}ms = ${row.totalMs}ms → ${row.stones} 子 / ${row.numbered} 号 | 池 spawned=${row.pool.spawned} reused=${row.pool.reused}`);
    }
  }
  const c = stat(cold, "totalMs");
  const w = stat(warm, "totalMs");
  const o = stat(overlap, "totalMs");
  console.log(`  ── 冷 ${c.min}–${c.max}ms(均 ${c.mean}) vs 预热后 ${w.min}–${w.max}ms(均 ${w.mean})：省 ${c.mean - w.mean}ms`);
  console.log(`  ── 交错场景（用户实等，含复原）：${o.min}–${o.max}ms(均 ${o.mean})  ${o.max <= 10000 ? "✅ <10s" : "❌ 超 10s"}`);
}

await browser.close();
