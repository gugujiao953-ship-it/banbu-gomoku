// 棋盘局部图诊断（2026-10-07）：书的插图常把棋盘裁成中间一块（只有网格线、无外框）——
// 「未检测到网格线」的主类。这里对若干失败样本分别跑 15 路与自动路数，看自动路数能否救。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-fragment-diag.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const root = resolve("../经济学知识/15_半步五子棋/_realpid-sample");
const items = [
  "docx-三手胜新修订打印版/image111.png",
  "docx-三手胜新修订打印版/image50.png",
  "docx-三手胜新修订打印版/image57.png",
  "docx-三手胜新修订打印版/image85.png",
  "pdf-6roTsumeRenju-1-2/img-004.png",
].filter((f) => { try { readFileSync(resolve(root, f)); return true; } catch { return false; } });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-frag-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-frag-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = items.map((f) => ({ name: f, dataUrl: `data:image/png;base64,${readFileSync(resolve(root, f)).toString("base64")}` }));
const out = await page.evaluate(async (items) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.name.split("/").pop(), { type: "image/png" });
    lines.push(`【${item.name}】`);
    for (const size of [15, 0]) {
      try {
        const r = await mod.recognizeBoardImage(make(), size, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
        const g = r.grid;
        lines.push(`  ${size === 0 ? "自动路数" : "默认 15 路"}：${r.boardSize} 路 · ${r.board.flat().filter(Boolean).length} 子 · 间距 ${g ? Math.min(g.spacingX, g.spacingY).toFixed(1) : "-"} · 把握 ${r.confidence.toFixed(2)} · ${r.note.slice(0, 52)}`);
      } catch (error) {
        lines.push(`  ${size === 0 ? "自动路数" : "默认 15 路"}：出错 ${String(error).slice(0, 60)}`);
      }
    }
  }
  return lines;
}, payloads);
console.log(out.join("\n"));
await browser.close();
