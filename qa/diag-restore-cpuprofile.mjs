// 诊断：复原手序那 30 多秒到底烧在哪些函数上（2026-10-14）。用 V8 CPU profile 拿自耗时排名。
//
// 起因：diag-restore-profile 显示智子密盘「复原」33.6s，其中 render 1.6s + sweep 6.8s +
// parallelScore 7.9s = 16.3s 有账，剩下 17s 没账。靠读代码猜不如直接采样。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ PROFILE_ITEM=qa/fixtures/... node qa/diag-restore-cpuprofile.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const itemPath = process.env.PROFILE_ITEM || "qa/fixtures/materials/user-report/zhizi-dense-101.jpg";
const PHASE = process.env.PROFILE_PHASE || "restore"; // restore | import
const TOP = Number(process.env.PROFILE_TOP || 25);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-cpuprofile.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cpuprofile.html", base).toString(), { waitUntil: "domcontentloaded" });

const bytes = readFileSync(resolve(itemPath));
const mime = /\.jpe?g$/i.test(itemPath) ? "image/jpeg" : "image/png";
const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

// 先跑一遍预热（让 ORT/模型就位），再采样第二遍——采样的是「复原」本身，不是装载。
const WARM = async ({ dataUrl, name, phase }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const make = () => new File([blob], name, { type: blob.type });
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
  ]);
  const imported = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true, boardScanner: boardScanner ?? undefined });
  if (phase === "import") return { ms: 0 };
  const t0 = performance.now();
  const restored = await mod.recognizeBoardImage(make(), 15, {
    skipMoveOrder: false, parallel: true,
    digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined,
    knownGrid: imported.knownGrid ?? undefined,
  });
  return { ms: Math.round(performance.now() - t0), numbered: restored.numberedMoves?.length ?? 0 };
};

const args = { dataUrl, name: itemPath.split("/").pop(), phase: PHASE };
await page.evaluate(WARM, args);

const cdp = await context.newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
const result = await page.evaluate(WARM, args);
const { profile } = await cdp.send("Profiler.stop");

// 自耗时聚合：按 (functionName, url:line) 归并的时间片数 × 采样间隔。
const interval = 200 / 1000; // ms
const byNode = new Map();
const nodesById = new Map();
for (const node of profile.nodes) nodesById.set(node.id, node);
const selfById = new Map();
for (let index = 0; index < profile.samples.length; index += 1) {
  const id = profile.samples[index];
  const delta = profile.timeDeltas[index] || interval * 1000;
  selfById.set(id, (selfById.get(id) || 0) + delta);
}
for (const [id, micros] of selfById) {
  const node = nodesById.get(id);
  if (!node) continue;
  const frame = node.callFrame;
  const url = (frame.url || "").replace(base, "").replace(/^https?:\/\/[^/]+/, "");
  const key = `${frame.functionName || "(anonymous)"} @ ${url}:${frame.lineNumber + 1}`;
  byNode.set(key, (byNode.get(key) || 0) + micros / 1000);
}
const totalMicros = profile.timeDeltas.reduce((sum, value) => sum + value, 0) / 1000;
const ranked = [...byNode].sort((left, right) => right[1] - left[1]).slice(0, TOP);

console.log(`${itemPath}  ${PHASE}：${result.ms}ms（采样窗口 ${Math.round(totalMicros)}ms，定号 ${result.numbered ?? "-"}）`);
console.log("自耗时前 %d 名：", TOP);
for (const [key, ms] of ranked) console.log(`  ${ms.toFixed(0).padStart(7)}ms  ${(100 * ms / totalMicros).toFixed(1).padStart(5)}%  ${key}`);
await browser.close();
