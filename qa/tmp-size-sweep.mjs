// 局部图「给对路数能否拟合」验证（2026-10-08）：对带坐标标签的棋盘局部图，
// 逐个试 boardSize=9..15，看哪个能拟合出网格（线距应与像素法量的 19px 一致）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-size-sweep.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const root = resolve("../经济学知识/15_半步五子棋/_realpid-sample");
const items = ["doc-五子茶馆小题目大全/image179.png", "doc-五子茶馆小题目大全/image334.png"];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-sizesweep-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-sizesweep-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const name of items) {
  const b64 = readFileSync(resolve(root, name)).toString("base64");
  const out = await page.evaluate(async ({ b64, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const lines = [];
    for (let size = 9; size <= 15; size += 1) {
      try {
        const r = await mod.recognizeBoardImage(new File([blob], name, { type: "image/png" }), size, { skipMoveOrder: true, parallel: false });
        const g = r.grid;
        const stones = r.board.flat().filter(Boolean).length;
        lines.push(`  ${size} 路：${r.gridFallback ? "未找到网格" : "网格✓"} · ${stones} 子 · 线距 ${g ? Math.min(g.spacingX, g.spacingY).toFixed(1) : "-"} · 把握 ${r.confidence.toFixed(2)}${g ? ` · 起点 (${g.originX.toFixed(0)},${g.originY.toFixed(0)})` : ""}`);
      } catch (error) { lines.push(`  ${size} 路：出错 ${String(error).slice(0, 44)}`); }
    }
    return lines;
  }, { b64, name });
  console.log(`【${name}】（像素法真值：线距 19px、横 12–13 条 / 竖 12–14 条）`);
  console.log(out.join("\n"));
}
await browser.close();
