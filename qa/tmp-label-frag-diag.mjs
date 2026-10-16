// 局部图（带坐标标签）选窗诊断（2026-10-08）：打开识别器的候选台账，
// 看「有坐标标签的棋盘局部图」为何 15 路与自动路数都失败——卡在哪道门上。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-label-frag-diag.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const root = resolve("../经济学知识/15_半步五子棋/_realpid-sample");
const items = [
  "doc-五子茶馆小题目大全/image179.png",
  "doc-五子茶馆小题目大全/image334.png",
  "docx-三手胜新修订打印版/image111.png",   // 已知能被自动路数救回的对照
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
const logs = [];
page.on("console", (message) => { const t = message.text(); if (/banbu-image-selected|banbu-image-rejected/.test(t)) logs.push(t); });
await page.addInitScript(() => { globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true; });
await page.route("**/qa-labeldiag-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-labeldiag-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const name of items) {
  const path = resolve(root, name);
  const b64 = readFileSync(path).toString("base64");
  logs.length = 0;
  const out = await page.evaluate(async ({ b64, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const make = () => new File([blob], name, { type: "image/png" });
    const lines = [];
    for (const size of [15, 0]) {
      try {
        const r = await mod.recognizeBoardImage(make(), size, { skipMoveOrder: true, parallel: false });
        const g = r.grid;
        lines.push(`  ${size === 0 ? "自动" : "15 路"}：${r.boardSize} 路 · ${r.board.flat().filter(Boolean).length} 子 · fallback=${r.gridFallback} · 把握 ${r.confidence.toFixed(2)} · 间距 ${g ? Math.min(g.spacingX, g.spacingY).toFixed(1) : "-"}`);
      } catch (e) { lines.push(`  ${size}: 出错 ${String(e).slice(0, 50)}`); }
    }
    return lines;
  }, { b64, name });
  console.log(`【${name}】`);
  console.log(out.join("\n"));
  const rejected = logs.filter((t) => t.includes("rejected"));
  if (rejected.length) {
    try {
      const parsed = JSON.parse(rejected[0].slice(rejected[0].indexOf("{")));
      const counts = {};
      for (const item of parsed) for (const f of item.failed) counts[f] = (counts[f] ?? 0) + 1;
      console.log(`  被拒候选 ${parsed.length} 个，失败门统计：`, JSON.stringify(counts));
      console.log(`  分数最高的几个被拒候选：`, JSON.stringify(parsed.slice(0, 4).map((c) => ({ x: c.x, y: c.y, sx: c.sx, score: c.score, failed: c.failed, rowsValid: c.rowsValid, colsValid: c.colsValid }))));
    } catch (e) { console.log("  解析台账失败", String(e).slice(0, 60)); }
  }
  const sel = logs.filter((t) => t.includes("selected"));
  if (sel.length) console.log(`  已选窗：${sel[0].slice(0, 200)}`);
}
await browser.close();
