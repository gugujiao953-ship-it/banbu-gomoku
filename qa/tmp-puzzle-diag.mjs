// 题库图批量诊断（2026-10-07）：shiina18 题库那类「细线、无号、非 15 路」的图，
// 应用按 15 路与自动路数（boardSize=0）各跑一遍，看网格/棋子差在哪。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-puzzle-diag.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const dir = resolve("../经济学知识/15_半步五子棋/棋谱/02-题库/shiina18-renju-puzzles/docs/_static/2379");
const files = globSync("*.png", { cwd: dir }).slice(0, 8);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-puzzle-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-puzzle-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = files.map((f) => ({
  name: f, dataUrl: `data:image/png;base64,${readFileSync(resolve(dir, f)).toString("base64")}`,
}));
const out = await page.evaluate(async (items) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.name, { type: "image/png" });
    const run = async (size) => {
      try {
        const r = await mod.recognizeBoardImage(make(), size, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
        const stones = r.board.flat().filter(Boolean).length;
        const g = r.grid;
        return { size: r.boardSize, stones, note: r.note.slice(0, 46), grid: g ? `(${g.originX.toFixed(0)},${g.originY.toFixed(0)}) 间距 ${g.spacingX.toFixed(1)}` : "无网格" };
      } catch (error) { return { size, error: String(error).slice(0, 60) }; }
    };
    const byDefault = await run(15);
    const byAuto = await run(0);
    lines.push(`${item.name}`);
    lines.push(`   默认 15 路：${byDefault.error ?? `${byDefault.stones} 子 · ${byDefault.grid} · ${byDefault.note}`}`);
    lines.push(`   自动路数：  ${byAuto.error ?? `${byAuto.stones} 子 · ${byAuto.size} 路 · ${byAuto.grid} · ${byAuto.note}`}`);
  }
  return lines;
}, payloads);
console.log(out.join("\n"));
await browser.close();
