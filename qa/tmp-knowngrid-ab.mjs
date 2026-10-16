// knownGrid 复用的 A/B（2026-10-09）：复原那一步「不传 vs 传导入的网格」。
//
// 现场：实测复原一次要 15.5 秒，其中网格检测在「不复用」时要 5～7.6 秒。
// App 侧已把导入算好的网格存进核对屏会话、复原时传下去（knownGrid）；
// 本探针直接对比两条路的墙钟时间与分段耗时，确认收益，并检查识别结果是否一致。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-knowngrid-ab.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", mime: "image/png" };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-kg-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-kg-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;

const out = await page.evaluate(async ({ dataUrl, name }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
  ]);
  const blob = await (await fetch(dataUrl)).blob();
  const make = () => new File([blob], name, { type: blob.type });
  const run = async (label, opts) => {
    const started = performance.now();
    const result = await mod.recognizeBoardImage(make(), 15, { parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, ...opts });
    const shots = new Set();
    result.board.forEach((line, row) => line.forEach((cell, col) => { if (cell) shots.add(`${row},${col},${cell}`); }));
    return {
      label,
      ms: Math.round(performance.now() - started),
      stones: result.board.flat().filter(Boolean).length,
      reads: result.readMoveNumbers.length,
      grid: result.grid ? `${result.grid.originX.toFixed(1)},${result.grid.originY.toFixed(1)}@${result.grid.spacingX.toFixed(1)}` : "-",
      fingerprint: [...shots].sort().join("|").length + ":" + [...shots].sort().slice(0, 3).join(";"),
      snap: { gridMs: Math.round(mod.moveOrderPerf.gridMs), gridWindows: mod.moveOrderPerf.gridWindows, digitMs: mod.moveOrderPerf.digitMs },
    };
  };
  // ① 先「导入」拿到网格（App 的真实顺序）
  const imp = await run("导入（拿网格）", { skipMoveOrder: true });
  const grid = imp.grid === "-" ? null : { originX: 0, originY: 0, spacingX: 0, spacingY: 0 };
  // 从导入结果里取回真实数值（识别器回报的是字符串化的，这里重新取一次原始对象）
  const raw = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false });
  const knownGrid = raw.grid ? { originX: raw.grid.originX, originY: raw.grid.originY, spacingX: raw.grid.spacingX, spacingY: raw.grid.spacingY } : null;
  void grid;
  // ② 复原，不传 knownGrid
  const without = await run("复原·不复用网格", { skipMoveOrder: false });
  // ③ 复原，传 knownGrid
  const withGrid = await run("复原·复用网格", { skipMoveOrder: false, knownGrid });
  return { imp, without, withGrid, knownGrid };
}, { dataUrl, name: item.path.split("/").pop() });

for (const row of [out.imp, out.without, out.withGrid]) {
  console.log(`${row.label}: ${row.ms}ms → ${row.stones} 子 / 读出 ${row.reads} 个号 | 网格 ${row.grid}`);
  console.log(`   网格检测 ${row.snap.gridMs}ms（${row.snap.gridWindows} 窗）| 读号段 ${row.snap.digitMs}ms`);
}
console.log(`\n结果一致性：盘面指纹 ${out.without.fingerprint === out.withGrid.fingerprint ? "相同 ✓" : "不同 ✗"}`);
console.log(`复用省下：${out.without.ms - out.withGrid.ms}ms（网格检测 ${out.without.snap.gridMs} → ${out.withGrid.snap.gridMs}ms）`);
await browser.close();
