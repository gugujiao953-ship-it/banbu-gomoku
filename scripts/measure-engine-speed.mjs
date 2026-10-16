/**
 * 量引擎节点速度（节点/秒）——命令行里比较档位/线程数/数据包用。
 *
 * 走的是 App 自己那条路：同源 `rapfi/rapfi-worker.js` + 数据包 blob URL，所以量到的
 * 数字与应用内看到的一致（面板「速度」格就是同一来源）。前提：dev 或 preview 服务器
 * 已下发 COOP/COEP（多线程档必须有跨源隔离）。
 *
 * 用法：
 *   BANBU_URL=http://127.0.0.1:5301/ node scripts/measure-engine-speed.mjs
 *   ENGINE=multi PACK=/.tmp-tuned-pack.data TIME_MS=5000 PLIES=12 node scripts/measure-engine-speed.mjs
 *
 * 环境变量：
 *   ENGINE    fallback | full | multi（默认 multi）
 *   PACK      数据包 URL；不传则用同源 /engine-packs/rapfi-full-v3.data
 *   TIME_MS   每个局面的思考预算（默认 5000）
 *   PLIES     局面手数（取内置真实棋谱的前 N 手，默认 12）
 *   MEMORY_MB 转置表预算（默认 128，与 App 强力档一致）
 *   RUNS      重复次数（默认 1）
 */
import { chromium } from "playwright";
import { rmSync, writeFileSync } from "node:fs";

const base = process.env.BANBU_URL || "http://127.0.0.1:5301/";
const engine = process.env.ENGINE || "multi";
const packPath = process.env.PACK || "./engine-packs/rapfi-full-v3.data";
const timeMs = Number(process.env.TIME_MS || 5000);
const plies = Number(process.env.PLIES || 12);
const memoryMb = Number(process.env.MEMORY_MB || 128);
const runs = Number(process.env.RUNS || 1);
// 关掉多线程（worker 侧 engineMultiAllowed=false → 落单线程 full），用来量单线程基线。
const multiAllowed = process.env.MULTI !== "0";
// THREADS=n 时通过运行时 INFO THREAD_NUM 指定线程数（0/缺省 = 自动取一半核心）
const threads = Number(process.env.THREADS || 0);

const BENCH_PAGE = "public/.tmp-measure-speed.html";
const BENCH_FILE = ".tmp-measure-speed.html";
// 用后即删：public/ 下的文件会被打进 dist（曾经把 20MB 体积预算顶爆过）。
writeFileSync(BENCH_PAGE, '<!doctype html><meta charset="utf-8"><title>engine bench</title>\n');

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(180_000);

const measure = async (index) => {
  await page.goto(`${base}${BENCH_FILE}`, { waitUntil: "domcontentloaded" });
  return await page.evaluate(async ({ engine: variant, packPath: pack, timeMs: budget, plies: plyCount, memoryMb: memory, multiAllowed: allowMulti, threads: threadCount }) => {
    const RAW = "h8h9h6i10i6i9g9g8j11i7i8g6f7h10j8h11h12g10j10j9k8l8l9j7i12g12f13h13e10f11g11e9k7k9h4j5j4i5k5";
    const moves = [...RAW.matchAll(/[a-o](?:1[0-5]|[1-9])/g)].slice(0, plyCount).map((match, index) => ({
      col: match[0].charCodeAt(0) - 97, row: 15 - Number(match[0].slice(1)), player: index % 2 === 0 ? "black" : "white",
    }));
    const isolated = self.crossOriginIsolated;
    const blob = await (await fetch(pack)).blob();
    return await new Promise((resolve) => {
      const worker = new Worker("./rapfi/rapfi-worker.js");
      const logs = [];
      const done = (payload) => resolve({ isolated, ...payload, logs: logs.filter((line) => /SPEED|MESSAGE Rapfi|MESSAGE Speed/.test(line)).slice(-6) });
      const timer = setTimeout(() => { worker.terminate(); done({ hung: true }); }, budget * 4 + 20000);
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "log") logs.push(message.message);
        if (message.type === "progress") { logs.last = message; }
        if (message.type === "result") {
          clearTimeout(timer);
          const inner = message.result || {};
          done({ variant: message.variant, depth: inner.depth, nodes: inner.nodes, speed: inner.speed, elapsedMs: inner.elapsedMs, move: inner.move });
        }
        if (message.type === "error") { clearTimeout(timer); done({ error: message.message, variant: message.variant }); }
      };
      worker.postMessage({
        type: "analyze", requestId: `m-${Date.now()}`, generation: 1, engine: variant, dataUrl: URL.createObjectURL(blob), multi: allowMulti, threads: threadCount,
        size: 15, moves, player: moves.length % 2 === 0 ? "black" : "white", rule: "renju",
        timeMs: budget, maxDepth: 64, topN: 1, maxMemoryMb: memory, rawDebug: true,
        finishOnBareMove: false, stopOnProvenWin: false,
      });
    });
  }, { engine, packPath, timeMs, plies, memoryMb, multiAllowed, threads });
};

console.log(`引擎=${engine} 多线程=${multiAllowed ? "允许" : "禁止"} 数据包=${packPath} 预算=${timeMs}ms 局面=${plies} 手 TT=${memoryMb}MB 线程=${threads || "自动"}`);
try {
for (let index = 0; index < runs; index += 1) {
  const result = await measure(index);
  if (result.hung) { console.log(`  第 ${index + 1} 次：⚠ 超时未返回（挂起）  isolation=${result.isolated}`); continue; }
  if (result.error) { console.log(`  第 ${index + 1} 次：✗ ${result.error}`); continue; }
  console.log(`  第 ${index + 1} 次：深度 ${result.depth} · 节点 ${result.nodes} · 速度 ${result.speed} · 用时 ${Math.round(result.elapsedMs)}ms · 变体 ${result.variant} · 隔离 ${result.isolated}`);
  for (const line of result.logs) console.log(`      ${line}`);
}
} finally {
  await browser.close();
  rmSync(BENCH_PAGE, { force: true });
}
