// 诊断：两件「卡不卡」的量化（2026-10-14）。
//   ① 应用启动时后台预热（最多 5 个 worker 各自创建 ORT 会话）会不会拖累主线程 → 量长任务与掉帧；
//   ② 识别本身在主线程上冻结多久（进度卡片转得动、但按钮点不动的那一段）→ 量最长一帧间隔。
//
// 用 CDP `Emulation.setCPUThrottlingRate` 降频模拟手机（默认 6×，与项目里既有的降频实验同档）。
// 预热开/关用 `__BANBU_NO_PREWARM__`（识别器里那个 QA 开关），其余完全同一份代码。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ CPU_THROTTLE=6 node qa/diag-startup-jank.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const RATE = Number(process.env.CPU_THROTTLE || 6);
const START_WINDOW_MS = Number(process.env.START_WINDOW_MS || 12000);
const RECOGNIZE = process.env.JANK_RECOGNIZE !== "0";
const fixture = process.env.JANK_FIXTURE || "qa/fixtures/materials/user-report/book-blur-71.jpg";

const browser = await chromium.launch({ headless: true });

/** 在一个页面里装好长任务 + 掉帧探针，返回读取函数。 */
const INSTRUMENT = () => {
  const longTasks = [];
  const frames = [];
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ["longtask"] });
  } catch { /* 没有 longtask 就算了 */ }
  let last = performance.now();
  const tick = (now) => { frames.push(Math.round(now - last)); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  globalThis.__jankStart = performance.now();
  globalThis.__jankRead = () => {
    const f = frames.slice().sort((a, b) => a - b);
    const pct = (q) => (f.length ? f[Math.min(f.length - 1, Math.floor(f.length * q))] : -1);
    return {
      frames: f.length, frameP50: pct(0.5), frameP95: pct(0.95), frameMax: f[f.length - 1] ?? -1,
      longTasks: longTasks.length, longTotal: longTasks.reduce((sum, value) => sum + value, 0), longMax: longTasks.length ? Math.max(...longTasks) : 0,
    };
  };
  globalThis.__jankReset = () => { longTasks.length = 0; frames.length = 0; last = performance.now(); };
};

const run = async (noPrewarm) => {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await context.addInitScript((flag) => { globalThis.__BANBU_NO_PREWARM__ = flag; }, noPrewarm);
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  // 先不降频把页面拉起来：dev 模式是 2000+ 个模块按需转换的，6× 降频下加载本身就要几十秒，
  // 那段时间的卡顿与「预热」无关，混进来只会污染结论。降频只用于观察窗口（贴近日用状态）。
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector(".app-shell", { timeout: 120_000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  await page.evaluate(() => { globalThis.__jankReset(); globalThis.__banbuPrewarmMark = performance.now(); });
  const out = await page.evaluate(async (ms) => {
    await new Promise((done) => setTimeout(done, ms));
    return { window: globalThis.__jankRead(), pool: { ...(globalThis.__banbuPoolStats || {}) } };
  }, START_WINDOW_MS);
  let recognize = null;
  if (RECOGNIZE) {
    const bytes = readFileSync(resolve(fixture));
    const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    recognize = await page.evaluate(async ({ dataUrl }) => {
      globalThis.__jankReset();
      const mod = await import("/src/image-recognition.ts");
      const head = await import("/src/features/record/digit-head.ts");
      const blob = await (await fetch(dataUrl)).blob();
      const [digitReader, boardScanner] = await Promise.all([
        head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
        head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
      ]);
      const t0 = performance.now();
      const imported = await mod.recognizeBoardImage(new File([blob], "j.jpg", { type: blob.type }), 15, { skipMoveOrder: true, parallel: true, boardScanner: boardScanner ?? undefined });
      const importMs = Math.round(performance.now() - t0);
      const frames = globalThis.__jankRead();
      globalThis.__jankReset();
      const t1 = performance.now();
      const restored = await mod.recognizeBoardImage(new File([blob], "j.jpg", { type: blob.type }), 15, {
        skipMoveOrder: false, parallel: true,
        digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined, knownGrid: imported.knownGrid ?? undefined,
      });
      return { importMs, importJank: frames, restoreMs: Math.round(performance.now() - t1), restoreJank: globalThis.__jankRead(), numbered: restored.numberedMoves?.length ?? 0 };
    }, { dataUrl });
  }
  await context.close();
  return { out, recognize };
};

const show = (label, jank) => console.log(`  ${label}: 最长一帧 ${jank.frameMax}ms（p95 ${jank.frameP95}ms）｜长任务 ${jank.longTasks} 次 / 合计 ${jank.longTotal}ms / 最长 ${jank.longMax}ms`);

console.log(`CPU 降频 ${RATE}×，启动后观察 ${START_WINDOW_MS}ms`);
for (const noPrewarm of [true, false]) {
  const { out, recognize } = await run(noPrewarm);
  console.log(`\n【${noPrewarm ? "关预热（对照）" : "开预热"}】池 spawned=${out.pool.spawned ?? 0} reused=${out.pool.reused ?? 0}`);
  show("启动窗口", out.window);
  if (recognize) {
    console.log(`  导入 ${recognize.importMs}ms → ${recognize.numbered} 号；复原 ${recognize.restoreMs}ms`);
    show("  导入期间", recognize.importJank);
    show("  复原期间", recognize.restoreJank);
  }
}
await browser.close();
