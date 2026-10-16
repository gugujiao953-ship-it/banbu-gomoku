// 用户图探针（2026-10-07）：Chinese National Open 2010 黄底 15 手截图。
// 目的：① 分环节耗时（网格/棋子/扫描/读号/装配）② 读号明细逐子打印，
// 看黑子（白字）与白子（黑字）各自的识别情况。
// 用法：QA_BASE_URL=http://localhost:5173/ node qa/tmp-user-cno-probe.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const file = resolve("qa/fixtures/materials/user-cno2010-15.jpg");
const b64 = readFileSync(file).toString("base64");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-cno-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
}));
await page.goto(new URL("qa-cno-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ b64 }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
  const make = () => new File([blob], "user-cno2010-15.jpg", { type: "image/jpeg" });

  const log = [];
  const run = async (label, opts) => {
    const t0 = performance.now();
    const r = await mod.recognizeBoardImage(make(), 15, opts);
    const ms = Math.round(performance.now() - t0);
    const stones = r.board.flat().filter(Boolean).length;
    let black = 0, white = 0;
    r.board.forEach((row) => row.forEach((c) => { if (c === "black") black += 1; else if (c === "white") white += 1; }));
    log.push(`${label}: ${ms}ms · ${stones} 子 (黑${black}/白${white}) · 读出 ${r.readMoveNumbers.length} 号`);
    if (r.moveOrderPerf) log.push(`   perf: ${JSON.stringify(r.moveOrderPerf)}`);
    return { ms, r };
  };

  // 快路径（静态导入，无增强）
  const fast = await run("快路径 默认", { skipMoveOrder: true, parallel: true });

  // 加载增强
  const tLoad = performance.now();
  const digitReader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const boardScanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  log.push(`增强加载: ${Math.round(performance.now() - tLoad)}ms (reader=${!!digitReader} scanner=${!!boardScanner})`);

  const fastBoost = await run("快路径 +补位", { skipMoveOrder: true, parallel: true, boardScanner });
  const full = await run("慢路径 默认", { skipMoveOrder: false, parallel: true });
  const fullBoost = await run("慢路径 +增强", { skipMoveOrder: false, parallel: true, digitReader, boardScanner });

  // 逐子读数明细（慢路径增强）
  const detail = [];
  const r = fullBoost.r;
  const seen = new Map();
  r.readMoveNumbers.forEach((n) => {
    const key = `${n.row},${n.col}`;
    if (!seen.has(key)) seen.set(key, n);
  });
  r.board.forEach((row, ri) => row.forEach((cell, ci) => {
    if (!cell) return;
    const n = seen.get(`${ri},${ci}`);
    detail.push(`${String.fromCharCode(65 + ci)}${15 - ri} ${cell === "black" ? "黑" : "白"} → ${n ? n.value : "-"}${n && n.score != null ? `(${n.score.toFixed(2)})` : ""}`);
  }));
  return { log, detail };
}, { b64 });

console.log(out.log.join("\n"));
console.log("\n逐子读数（慢路径+增强）：");
console.log(out.detail.join("  "));
await browser.close();
