// App 层读数明细（2026-10-07）：dump 复原路径的 readMoveNumbers / numberedMoves /
// quality / note，以及逐子 trace（模板候选 + 数字头候选）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-user-cno-app.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const b64 = readFileSync(resolve("qa/fixtures/materials/user-cno2010-15.jpg")).toString("base64");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-cno3-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
}));
await page.goto(new URL("qa-cno3-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ b64 }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
  const make = () => new File([blob], "user-cno2010-15.jpg", { type: "image/jpeg" });

  const digitReader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const boardScanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });

  const lines = [];
  const r = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: true, digitReader, boardScanner });
  const nameOf = (row, col) => `${String.fromCharCode(65 + col)}${15 - row}`;
  lines.push(`note: ${r.note}`);
  lines.push(`quality: ${JSON.stringify(r.moveOrderQuality)}`);
  lines.push(`numberedMoves: ${r.numberedMoves.length}`);
  lines.push(`readMoveNumbers(${r.readMoveNumbers.length}): ` + r.readMoveNumbers.map((m) => `${m.number}@${nameOf(m.row, m.col)}${m.player === "black" ? "黑" : "白"}`).join(" "));
  return lines;
}, { b64 });

console.log(out.join("\n"));
await browser.close();
