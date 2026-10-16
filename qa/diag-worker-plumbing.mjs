// 诊断：确认「worker 侧 console 是否被转发到页面」+「池到底有没有跑 matchMoveNumbers/scanCells」（2026-10-14）。
// 若转发正常，那么「复原日志里只有 fitCombs、没有 matchMoveNumbers/scanCells」就等于「那些任务全在主线程」。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-worker-plumbing.mjs
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const logs = [];
page.on("console", (message) => logs.push(`[${message.type()}] ${message.text().slice(0, 200)}`));
page.on("worker", (worker) => logs.push(`[worker-created] ${worker.url().split("/").pop()}`));
await page.route("**/qa-plumbing.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-plumbing.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async () => {
  const mod = await import("/src/image-recognition.ts");
  const accelMod = await import("/src/features/recognition/recognition-accelerator.ts");
  const width = 640; const height = 640;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const image = mod.localAccelerator ? null : null;
  void image;
  const sampled = { data, width, height };
  const pool = await accelMod.createParallelAccelerator(sampled, { modelSessions: true });
  if (!pool) return { error: "池没建起来" };
  const queries = [];
  for (let i = 0; i < 40; i += 1) queries.push({ x: 100 + (i % 8) * 60, y: 100 + Math.floor(i / 8) * 60 });
  const t0 = performance.now();
  const cells = await pool.scanCells(queries, 32);
  const scanMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  const matches = await pool.matchMoveNumbers(queries.slice(0, 12).map((q, index) => ({ ...q, spacing: 32, player: index % 2 ? "white" : "black", maxNumber: 40 })));
  const matchMs = Math.round(performance.now() - t1);
  return { scanMs, scanned: cells.length, matchMs, matched: matches.length, stats: { ...(globalThis.__banbuPoolStats || {}) } };
});
console.log("池直调结果:", JSON.stringify(out));
console.log("页面收到的日志：");
for (const line of logs) console.log("  ", line);
await browser.close();
