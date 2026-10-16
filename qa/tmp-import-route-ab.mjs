// 导入路径（识谱）模型任务走 worker vs 走主线程的 A/B（2026-10-09，CPU 降频模拟手机）。
//
// 背景（用户真机复测）：1.1.9.20 把非隔离环境的模型任务挪到主线程后，「复原快了一点，
// 但识谱更慢了，且哪张图都一样」。这个「与图片无关」正是 225 格 cell-cls 的固定开销——
// import 路径无条件对整盘 225 格跑一遍分类（不读号，只为了补位判定），
// 单线程手机上就是 225 × 每格几十毫秒 = 十几秒。
//
// 本探针在**同一台机器、同一降频**下量 import 路径两条路的墙钟时间，并确保「冷扫描缓存」
// （每次用新 context，避免 scanCache 把第二次变成假的 0ms）。
//
// 用法：MSYS_NO_PATHCONV=1 CPU_THROTTLE=6 QA_BASE_URL=http://localhost:5173/ node qa/tmp-import-route-ab.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const THROTTLE = Number(process.env.CPU_THROTTLE || 6);
const items = [
  { path: "qa/fixtures/materials/user-cno2010-15.jpg", mime: "image/jpeg", note: "用户 15 手截图" },
  { path: "qa/fixtures/recognition/paper10.jpg", mime: "image/jpeg", note: "书谱 66 子" },
];

const browser = await chromium.launch({ headless: true });
for (const item of items) {
  const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  console.log(`\n${item.note}（CPU 降频 ${THROTTLE}×，import 路径）`);
  for (const route of ["worker", "main"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "warning") console.log(`   [warn/${route}]`, message.text().slice(0, 130)); });
    const client = await context.newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    await page.route("**/qa-import-route-host.html", (r) => r.fulfill({
      contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
    }));
    await page.goto(new URL("qa-import-route-host.html", base).toString(), { waitUntil: "domcontentloaded" });
    const out = await page.evaluate(async ({ dataUrl, name, route }) => {
      // ⚠ 这一行是上次那份 A/B 漏掉的（2026-10-09 自查）：不设这个覆盖，
      // 两条路都走代码里的默认分支（非隔离 → 主线程），量出的 41s/42s 其实是
      // 同一个配置跑两遍，据此得出的「worker 更慢」结论无效。现在按 route 显式切换。
      globalThis.__BANBU_FORCE_MODEL_WORKERS__ = route === "worker";
      const mod = await import("/src/image-recognition.ts");
      const head = await import("/src/features/record/digit-head.ts");
      const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null);
      const blob = await (await fetch(dataUrl)).blob();
      const make = () => new File([blob], name, { type: blob.type });
      // 与 App 导入同一条路径：skipMoveOrder: true + boardScanner + 多核开关（默认开）
      const started = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true, boardScanner: scanner ?? undefined });
      const ms = Math.round(performance.now() - started);
      const perf = { ...mod.moveOrderPerf };
      return { ms, stones: result.board.flat().filter(Boolean).length, perf };
    }, { dataUrl, name: item.path.split("/").pop(), route });
    const p = out.perf;
    console.log(`  ${route === "worker" ? "模型任务走 worker" : "模型任务走主线程"}: ${out.ms}ms → ${out.stones} 子 | 网格 ${Math.round(p.gridMs)}ms 模型扫描 ${p.boardScanMs}ms 逐格 ${Math.round(p.cellFeatMs)}ms`);
    await context.close();
  }
}
await browser.close();
