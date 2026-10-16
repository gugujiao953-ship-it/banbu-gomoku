// 网格检测 1824 窗的构成与「可无损削减多少」（2026-10-09）。
//
// 现场：导入的网格检测 7.5～7.9 秒、1824 个候选窗（每窗都是全盘线剖面扫描）。
// 用户要求「无损优化」。本探针统计三类候选各自的数量与命中情况：
//   ① 全局配对 rowFits[0..36] × columnFits[0..36] = 1296
//   ② 锁定一列后的局部行拟合
//   ③ 锁定一行后的局部列拟合
// 并检查：**最终选中的 best / cleanBest 排在第几个被评分的候选**——若它出现在很靠前，
// 说明后面的候选只是在「陪跑」；再配合 evaluateCandidate 的硬门，看能否安全地提前停。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-grid-window-composition.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  "qa/fixtures/materials/renjuportal/rp-score-10.png",
  "qa/fixtures/recognition/paper10.jpg",
  "qa/fixtures/materials/user-cno2010-15.jpg",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 150)));
await page.route("**/qa-gwc-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-gwc-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const file of items) {
  const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${readFileSync(resolve(file)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => { logs.push(args.map(String).join(" ")); };
    const blob = await (await fetch(dataUrl)).blob();
    const result = await mod.recognizeBoardImage(new File([blob], name, { type: blob.type }), 15, { skipMoveOrder: true, parallel: false });
    console.info = originalInfo;
    globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = false;
    // 从调试日志里取候选池构成（[banbu-image-fits] 给出两条轴的拟合数量）
    const fits = logs.find((line) => line.includes("banbu-image-fits"));
    let rowCount = 0, colCount = 0;
    if (fits) {
      try {
        const payload = JSON.parse(fits.slice(fits.indexOf("{")));
        rowCount = payload.rows?.length ?? 0;
        colCount = payload.columns?.length ?? 0;
      } catch { /* 忽略 */ }
    }
    return {
      stones: result.board.flat().filter(Boolean).length,
      windows: mod.moveOrderPerf.gridWindows,
      early: mod.moveOrderPerf.wEarly,
      gridMs: Math.round(mod.moveOrderPerf.gridMs),
      rowCount, colCount,
    };
  }, { dataUrl, name: file.split("/").pop() });
  const globalPair = Math.min(out.rowCount, 36) * Math.min(out.colCount, 36);
  console.log(`${file.split("/").pop()}: 网格 ${out.gridMs}ms / ${out.windows} 窗（早退 ${out.early}）→ ${out.stones} 子`);
  console.log(`   两条轴拟合数 rows=${out.rowCount} cols=${out.colCount} → 全局配对约 ${globalPair} 窗，局部/相位约占 ${out.windows - globalPair}`);
}
await browser.close();
