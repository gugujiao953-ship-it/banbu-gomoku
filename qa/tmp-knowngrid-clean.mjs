// knownGrid 复用的**干净 A/B**（2026-10-09）：用**独立页面**分别测两条路，
// 避免模块级 gridEstimateCache 让「不复用」那次偷吃缓存、把收益量成假的。
//
// 上一版探针就在同一页里连跑三次，第二次的「网格检测 1ms」是缓存命中，
// 于是「复用省 5.5 秒」这个结论不干净。这里每条路各开一个新 context，
// 只跑「复原」一次（页面里其余什么都不做），量首次真实耗时。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-knowngrid-clean.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = "qa/fixtures/materials/renjuportal/rp-score-10.png";
const dataUrl = `data:image/png;base64,${readFileSync(resolve(item)).toString("base64")}`;

const browser = await chromium.launch({ headless: true });

// 先在一个**独立页面**里拿网格（模拟 App 的导入那一次，其结果会被 App 存进核对屏会话）。
const gridOf = async () => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/qa-kgc-host.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body></body></html>" }));
  await page.goto(new URL("qa-kgc-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const grid = await page.evaluate(async ({ dataUrl }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const result = await mod.recognizeBoardImage(new File([blob], "x.png", { type: "image/png" }), 15, { skipMoveOrder: true, parallel: false });
    return result.grid ? { originX: result.grid.originX, originY: result.grid.originY, spacingX: result.grid.spacingX, spacingY: result.grid.spacingY } : null;
  }, { dataUrl });
  await context.close();
  return grid;
};

/** 在全新页面里只跑一次复原，可选传 knownGrid。 */
const restoreOnce = async (knownGrid) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 140)));
  await page.route("**/qa-kgc2-host.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body></body></html>" }));
  await page.goto(new URL("qa-kgc2-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const out = await page.evaluate(async ({ dataUrl, knownGrid }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    ]);
    const blob = await (await fetch(dataUrl)).blob();
    const started = performance.now();
    const result = await mod.recognizeBoardImage(new File([blob], "x.png", { type: "image/png" }), 15, {
      skipMoveOrder: false, parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, knownGrid: knownGrid ?? undefined,
    });
    const shots = new Set();
    result.board.forEach((line, row) => line.forEach((cell, col) => { if (cell) shots.add(`${row},${col},${cell}`); }));
    return {
      ms: Math.round(performance.now() - started),
      stones: result.board.flat().filter(Boolean).length,
      reads: result.readMoveNumbers.length,
      fingerprint: [...shots].sort().join("|"),
      gridMs: Math.round(mod.moveOrderPerf.gridMs),
      gridWindows: mod.moveOrderPerf.gridWindows,
      digitMs: mod.moveOrderPerf.digitMs,
    };
  }, { dataUrl, knownGrid });
  await context.close();
  return out;
};

const grid = await gridOf();
console.log("导入算得的网格：", grid ? `${grid.originX.toFixed(1)},${grid.originY.toFixed(1)}@${grid.spacingX.toFixed(1)}` : "无");
const without = await restoreOnce(null);
console.log(`复原·不复用（独立页面首次）：${without.ms}ms → ${without.stones} 子 / 读出 ${without.reads} | 网格检测 ${without.gridMs}ms（${without.gridWindows} 窗）`);
const withGrid = await restoreOnce(grid);
console.log(`复原·复用网格（独立页面首次）：${withGrid.ms}ms → ${withGrid.stones} 子 / 读出 ${withGrid.reads} | 网格检测 ${withGrid.gridMs}ms（${withGrid.gridWindows} 窗）`);
console.log(`\n结果一致性：${without.fingerprint === withGrid.fingerprint ? "盘面逐格相同 ✓" : "盘面不同 ✗"}`);
console.log(`收益：${without.ms - withGrid.ms}ms`);
await browser.close();
