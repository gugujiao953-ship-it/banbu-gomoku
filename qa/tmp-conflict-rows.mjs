// 一次性：「模板 vs 数字头」逐格冲突行dump——给出模板边际（首位-次位）与数字头置信，
// 用来定「什么时候该信数字头」的仲裁规则。可对多张图跑，输出可直接对照。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/tmp-conflict-rows.mjs <图> [<图> ...]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const files = process.argv.slice(2);
const items = files.map((f) => ({ file: f, id: f.split("/").pop(), dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(f)).toString("base64")}` }));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(600_000);
await page.route("**/qa-conflict-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-conflict-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
  });
  const result = [];
  for (const item of items) {
    globalThis.__BANBU_MOVE_SOURCE_DEBUG__ = [];
    const blob = await (await fetch(item.dataUrl)).blob();
    await mod.recognizeBoardImage(new File([blob], item.id, { type: "image/jpeg" }), 15, {
      skipMoveOrder: false, parallel: false, boardScanner: scanner ?? undefined,
    });
    const rows = globalThis.__BANBU_MOVE_SOURCE_DEBUG__;
    const seen = new Set();
    const conflicts = [];
    for (const row of rows) {
      const key = `${row.row},${row.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!row.template || !row.head) continue;
      if (row.template.value === row.head.value) continue;
      const margin = row.template.second === null ? null : Math.round((row.template.score - row.template.second) * 1000) / 1000;
      conflicts.push({ cell: key, template: `${row.template.value}@${row.template.score}`, second: row.template.second, margin, head: `${row.head.value}@${row.head.prob}` });
    }
    result.push({ id: item.id, conflicts });
  }
  return result;
}, { items });

for (const item of out) {
  console.log(`\n### ${item.id}：模板与数字头不一致的格 ${item.conflicts.length}`);
  console.log('  格 | 模板(值@分/次位/边际) | 数字头(值@置信)');
  for (const c of item.conflicts) {
    console.log(`  ${c.cell.padEnd(6)} ${c.template.padEnd(16)} 次位${c.second} 边际${c.margin} | ${c.head}`);
  }
  const thin = item.conflicts.filter((c) => c.margin !== null && c.margin < 0.06).length;
  const strong = item.conflicts.filter((c) => Number(c.head.split("@")[1]) >= 0.9).length;
  const both = item.conflicts.filter((c) => c.margin !== null && c.margin < 0.06 && Number(c.head.split("@")[1]) >= 0.9).length;
  console.log(`  其中：模板边际<0.06 的 ${thin}｜数字头≥0.9 的 ${strong}｜两者同时成立 ${both}`);
}
await browser.close();
