// 配对剪枝的无损验证（2026-10-09）：把每轴截到前 K 个（K² 配对，而非 36²），
// 检查 27 张基线图的**选中网格是否逐值不变**，并量省下多少时间。
//
// 判据（硬要求）：K 再小也必须让所有图选中同一个网格——否则窗口评分里的平手边界
// 会被改变，那就是有损。因此本探针同时报「网格变化数」，只有 0 才允许默认启用。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-pairprune-verify.mjs
import { chromium } from "playwright";
import { existsSync, globSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const baselinePath = resolve("qa/fixtures/grid-identity.json");
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : { rows: [] };
const byFile = new Map(baseline.rows.map((row) => [row.file.replace(/\\/g, "/"), row]));

const files = [
  ...globSync("qa/fixtures/recognition/*.{png,jpg,jpeg}").sort(),
  ...globSync("qa/fixtures/materials/*.{png,jpg}").sort(),
  ...globSync("qa/fixtures/materials/renjuportal/*.png").sort(),
];
const KS = [0, 12, 8, 6];

const browser = await chromium.launch({ headless: true });
console.log("K | 网格变化 | 网格总耗时 | 窗口数 | 备注");
for (const K of KS) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/qa-ppv-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-ppv-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const rows = [];
  for (const file of files) {
    const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
    const dataUrl = `data:${mime};base64,${readFileSync(resolve(file)).toString("base64")}`;
    const out = await page.evaluate(async ({ dataUrl, name, K }) => {
      globalThis.__BANBU_PAIR_TOPK__ = K;
      const mod = await import("/src/image-recognition.ts");
      const head = await import("/src/features/record/digit-head.ts");
      const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null);
      const blob = await (await fetch(dataUrl)).blob();
      try {
        const run = await mod.recognizeBoardImage(new File([blob], name, { type: blob.type }), 15, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
        let black = 0, white = 0, fingerprint = 2166136261;
        run.board.forEach((line, row) => line.forEach((cell, col) => {
          if (cell === "black") black += 1; else if (cell === "white") white += 1;
          const code = cell === "black" ? 1 : cell === "white" ? 2 : 0;
          fingerprint = Math.imul(fingerprint ^ (row * 31 + col * 7 + code), 16777619);
        }));
        return {
          grid: run.grid ? { originX: Math.round(run.grid.originX * 10000) / 10000, originY: Math.round(run.grid.originY * 10000) / 10000, spacingX: Math.round(run.grid.spacingX * 10000) / 10000, spacingY: Math.round(run.grid.spacingY * 10000) / 10000 } : null,
          black, white, fingerprint: fingerprint >>> 0, fallback: Boolean(run.gridFallback),
          gridMs: Math.round(mod.moveOrderPerf.gridMs), windows: mod.moveOrderPerf.gridWindows,
        };
      } catch (error) { return { error: String(error).slice(0, 60) }; }
    }, { dataUrl, name: basename(file), K });
    rows.push({ file, ...out });
  }
  await context.close();
  let changed = 0, missing = 0, totalGridMs = 0, totalWindows = 0;
  const changes = [];
  for (const row of rows) {
    const before = byFile.get(row.file.replace(/\\/g, "/"));
    if (!before) { missing += 1; continue; }
    totalGridMs += row.gridMs ?? 0;
    totalWindows += row.windows ?? 0;
    const same = JSON.stringify(before.grid) === JSON.stringify(row.grid)
      && before.fingerprint === row.fingerprint
      && before.black === row.black && before.white === row.white
      && before.gridFallback === row.fallback;
    if (!same) { changed += 1; changes.push(basename(row.file)); }
  }
  console.log(`${K === 0 ? "36" : String(K).padStart(2)} | ${String(changed).padStart(2)}${changed ? " ⚠" : "  "} | ${String(totalGridMs).padStart(6)}ms | ${String(totalWindows).padStart(5)} | ${changes.slice(0, 5).join(",") || "无可比项"}`);
}
await browser.close();
