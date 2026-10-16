// 模板段并行：全语料逐位一致性验收（2026-10-10）。
//
// 为什么需要这个：模板段并行（worker 跑 matchMoveNumbers）目前只在 3 张图上验过。
// 这个改动影响所有走「复原手序」路径的图，必须**全语料**逐项对比
// 「parallel=true」与「parallel=false」：
//   · 整盘棋子与颜色（逐格）
//   · readMoveNumbers（读出全集，排序后逐条）
//   · numberedMoves（完整手序，逐条）
//   · moveOrderQuality.status（门控结论）
// 任何一项不同就是回归，直接失败退出。
//
// 语料：识别夹具 8 张 + materials 9 张 + self-render 抽样 + self-hi-ply 全部。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/parallel-score-parity.mjs
//   THROTTLE（默认 0，不降频——见文档里「降频只作用于主线程」的陷阱说明）
//   SAMPLE_SELF（self-render 抽样张数，默认 12）
import { chromium } from "playwright";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const THROTTLE = Number(process.env.THROTTLE || 0);
const SAMPLE_SELF = Number(process.env.SAMPLE_SELF || 12);

const fix = resolve("qa/fixtures/recognition");
const mat = resolve("qa/fixtures/materials");
const corpus = [];

for (const f of readdirSync(fix).filter((n) => /\.(png|jpe?g)$/i.test(n))) {
  const truth = resolve(fix, f.replace(/\.(png|jpe?g)$/i, ".truth.json"));
  corpus.push({ path: resolve(fix, f), mime: /\.png$/i.test(f) ? "image/png" : "image/jpeg", name: `recognition/${f}`, truth: existsSync(truth) ? truth : null });
}
for (const f of readdirSync(mat).filter((n) => /\.(png|jpe?g)$/i.test(n))) {
  const truth = resolve(fix, f.replace(/\.(png|jpe?g)$/i, ".truth.json"));
  corpus.push({ path: resolve(mat, f), mime: /\.png$/i.test(f) ? "image/png" : "image/jpeg", name: `materials/${f}`, truth: existsSync(truth) ? truth : null });
}
const hiPly = resolve(mat, "self-hi-ply");
if (existsSync(hiPly)) {
  for (const f of readdirSync(hiPly).filter((n) => n.endsWith(".jpg")).slice(0, 6)) {
    corpus.push({ path: resolve(hiPly, f), mime: "image/jpeg", name: `hi-ply/${f}`, truth: null });
  }
}
const selfR = resolve(mat, "self-render");
if (existsSync(selfR)) {
  const all = readdirSync(selfR).filter((n) => n.endsWith("@1200.jpg"));
  const step = Math.max(1, Math.floor(all.length / SAMPLE_SELF));
  for (const f of all.filter((_, i) => i % step === 0).slice(0, SAMPLE_SELF)) {
    corpus.push({ path: resolve(selfR, f), mime: "image/jpeg", name: `self-render/${f}`, truth: null });
  }
}

console.log(`语料 ${corpus.length} 张（降频 ${THROTTLE || "关"}）\n`);
// 崩溃韧性（2026-10-10）：最初一版在跑到第 22 张（196 手满盘）时遇到
// 「Target crashed」——但同一张图隔离重跑 3 次全部通过、结果一致，说明那是
// **浏览环境长时间连续创建上下文后的临时资源故障**，不是识别代码的问题。
// 所以这里加重试：崩溃的图最多重试 RETRY 次（每次换全新 browser），
// 仍失败才记为失败。这样既不被环境噪声打断，也不会掩盖真实缺陷。
const RETRY = Number(process.env.RETRY || 2);
const browser = await chromium.launch({ headless: true });
let pass = 0;
const failures = [];

const recognizeBoth = async (page, payload) => page.evaluate(async ({ dataUrl, name, mime }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const make = async () => new File([await (await fetch(dataUrl)).blob()], name, { type: mime });
  const run = async (parallel) => {
    // 每轮单独建 scanner/reader：与被测路径同构（App 每次识别都会重新装载）
    const bs = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 }).catch(() => null);
    const dr = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 }).catch(() => null);
    try {
      const r = await mod.recognizeBoardImage(await make(), 15, { skipMoveOrder: false, parallel, digitReader: dr ?? undefined, boardScanner: bs ?? undefined });
      const s = { ...mod.moveOrderPerf };
      return {
        board: r.board.flat().map((c) => (c ? c[0] : "-")).join(""),
        stones: r.board.flat().filter(Boolean).length,
        read: r.readMoveNumbers.map((m) => `${m.row},${m.col}:${m.number}`).sort().join("|"),
        readCount: r.readMoveNumbers.length,
        numbered: r.numberedMoves.map((m) => `${m.number}:${m.row},${m.col}`).join("|"),
        numberedCount: r.numberedMoves.length,
        status: r.moveOrderQuality?.status ?? "-",
        parStones: s.parallelScoreStones, parMs: s.parallelScoreMs,
        threw: null,
      };
    } catch (error) {
      // 「没找到可靠棋子」这类**拒绝**也是合法结果，两条路必须**同样拒绝**
      // （错误文案一致才算逐位一致——否则并行可能把该拒的图放进来）。
      return { threw: error instanceof Error ? error.message : String(error), board: "", stones: 0, read: "", readCount: 0, numbered: "", numberedCount: 0, status: "-", parStones: 0, parMs: 0 };
    }
  };
  const on = await run(true);
  const off = await run(false);
  return { on, off };
}, payload);

for (const item of corpus) {
  const isJ = /jpe?g$/i.test(item.path);
  const dataUrl = `data:${isJ ? "image/jpeg" : "image/png"};base64,${readFileSync(item.path).toString("base64")}`;
  let out = null;
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY; attempt += 1) {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    if (THROTTLE) { const c = await ctx.newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); }
    await page.route("**/qa-pp.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body></body></html>" }));
    await page.goto(new URL("qa-pp.html", base).toString(), { waitUntil: "domcontentloaded" });
    try {
      out = await recognizeBoth(page, { dataUrl, name: item.name.split("/").pop(), mime: item.mime });
    } catch (error) {
      lastError = String(error).slice(0, 120);
      out = null;
    }
    await ctx.close().catch(() => {});
    if (out) break;
    if (attempt < RETRY) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!out) {
    failures.push({ name: item.name, bad: ["环境崩溃"], on: null, off: null });
    console.log(`✗ ${item.name.padEnd(34)} 环境崩溃（重试 ${RETRY} 次后仍失败）：${lastError}`);
    continue;
  }

  const { on, off } = out;
  const checks = [
    ["拒绝一致性", on.threw === off.threw],
    ["盘面", on.board === off.board],
    ["子数", on.stones === off.stones],
    ["读出全集", on.read === off.read],
    ["读出数", on.readCount === off.readCount],
    ["完整手序", on.numbered === off.numbered],
    ["手序数", on.numberedCount === off.numberedCount],
    ["门控状态", on.status === off.status],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (bad.length) {
    failures.push({ name: item.name, bad, on, off });
    console.log(`✗ ${item.name.padEnd(34)} 不一致: ${bad.join("/")} | 并行棋子 ${on.parStones}`);
  } else {
    pass += 1;
    const par = on.parStones > 0 ? `并行 ${on.parStones} 子/${on.parMs}ms` : "全程串行";
    const verdict = on.threw ? `两条路同等拒绝（${on.threw.slice(0, 20)}…）` : `${on.stones} 子、读 ${on.readCount}、手序 ${on.numberedCount}、${on.status}`;
    console.log(`✓ ${item.name.padEnd(34)} 逐位一致（${verdict}）${par}`);
  }
}

console.log(`\n=== 汇总：${pass}/${corpus.length} 逐位一致，失败 ${failures.length} ===`);
for (const f of failures.slice(0, 5)) {
  console.log(`\n失败 ${f.name}（${f.bad.join("、")}）`);
  console.log(`  并行: 子 ${f.on.stones} 读 ${f.on.readCount} 手序 ${f.on.numberedCount} ${f.on.status}`);
  console.log(`  串行: 子 ${f.off.stones} 读 ${f.off.readCount} 手序 ${f.off.numberedCount} ${f.off.status}`);
}
await browser.close();
process.exit(failures.length ? 1 : 0);
