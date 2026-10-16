/**
 * 跨源隔离 + 多线程引擎的端到端验证（对着**构建产物**跑）。
 *
 * 为什么要它：网页版的多线程依赖 `crossOriginIsolated`，而 GitHub Pages 不下发
 * 任何隔离头——只能靠 src/sw.js 在响应上补。这个「能不能真的用上多线程」的结论
 * 没有任何单测或常规门禁能覆盖（它们跑在已带隔离头的 dev/preview 上），所以留一份
 * 可复跑的验证：用一个**故意不发 COOP/COEP** 的静态服务器托管 dist/，检查
 *   1) 首屏装完 SW 后自动刷新一次、页面变成跨源隔离且不循环刷新
 *   2) 应用正常启动（棋盘渲染）
 *   3) 多线程引擎确实加载起来（ready 变体 = multi）
 *   4) 离线重开仍可用（预缓存 + 隔离头都在）
 *
 * 跑法：npx vite build && node scripts/verify-web-isolation.mjs
 * 
 * 注：public/ 下不要留临时大文件（会被打进 dist）。
//  1) SW 装完后自动刷新一次，页面变成跨源隔离
//  2) 应用正常启动（棋盘渲染）
//  3) 多线程引擎真的加载起来（readyVariant === "multi"）
//  4) 离线重开仍能用（预缓存 + 隔离头）
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.env.SITE_DIR || "dist";
const PORT = Number(process.env.PORT || 5391);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".data": "application/octet-stream", ".sgf": "application/octet-stream", ".db": "application/octet-stream", ".wav": "audio/wav" };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(normalize(ROOT))) { response.writeHead(403).end(); return; }
    try { if ((await stat(path)).isDirectory()) path = join(path, "index.html"); }
    catch { path = join(ROOT, "index.html"); }
    const body = await readFile(path);
    // 关键：故意不发 COOP/COEP，模拟 GitHub Pages。
    response.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Content-Length": body.length });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext(); // 不 block service worker
const page = await context.newPage();
page.setDefaultTimeout(90_000);
const failures = [];
const step = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); }
  catch (error) { failures.push(`${name}：${error.message}`); console.log(`  ✗ ${name}：${error.message}`); }
};
const assert = (value, message) => { if (!value) throw new Error(message); };

let reloads = 0;
let navigations = 0;
page.on("load", () => { reloads += 1; });
page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) { navigations += 1; console.log(`        [nav ${navigations}]`, frame.url(), `t=${Date.now() % 100000}`); } });

await page.goto(base, { waitUntil: "domcontentloaded" });
console.log("        goto 完成时 coi =", await page.evaluate(() => window.crossOriginIsolated), "controller =", await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
await page.waitForTimeout(1200);
console.log("        1.2s 后 coi =", await page.evaluate(() => window.crossOriginIsolated), "reloads =", reloads, "navigations =", navigations);
console.log("        sessionStorage 标记 =", await page.evaluate(() => sessionStorage.getItem("banbu-coi-reload-v1")));

await step("首次装载 SW 后自动刷新一次（拿到隔离，且不循环刷新）", async () => {
  await page.waitForFunction(() => window.crossOriginIsolated === true, null, { timeout: 60_000 });
  // 一次性标记落盘说明「装完 SW 后刷新」这条路径确实走过。
  const marked = await page.evaluate(() => sessionStorage.getItem("banbu-coi-reload-v1"));
  assert(marked === "1", "没有看到一次性刷新标记，说明首屏并没有刷新过");
  // 用 timeOrigin 判断文档有没有被再次替换：刷一次就稳定，不能形成刷新循环。
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(2500);
  const originLater = await page.evaluate(() => performance.timeOrigin);
  assert(origin === originLater, "页面仍在反复刷新（隔离没有稳定下来）");
});

await step("页面真的被跨源隔离（SAB 可用）", async () => {
  const info = await page.evaluate(() => ({ coi: window.crossOriginIsolated, sab: typeof SharedArrayBuffer, controlled: Boolean(navigator.serviceWorker.controller) }));
  console.log("        ", JSON.stringify(info));
  assert(info.coi === true, "crossOriginIsolated 不是 true");
  assert(info.sab === "function", "SharedArrayBuffer 不可用");
  assert(info.controlled, "页面没有被 SW 接管（隔离头就来自 SW）");
});

await step("应用正常启动（棋盘渲染出来）", async () => {
  await page.waitForSelector(".bottom-nav", { timeout: 60_000 });
  await page.waitForSelector("svg.renju-board", { timeout: 60_000 });
});

await step("多线程引擎在这个页面里真的加载成功", async () => {
  await page.evaluate(() => {
    self.__coiProbe = { done: false };
    const worker = new Worker("./rapfi/rapfi-worker.js");
    worker.onmessage = (event) => {
      if (event.data?.type === "ready") { self.__coiProbe.variant = event.data.variant; }
      if (event.data?.type === "result") { self.__coiProbe.done = true; self.__coiProbe.depth = event.data.result?.depth; self.__coiProbe.nodes = event.data.result?.nodes; }
      if (event.data?.type === "error") { self.__coiProbe.done = true; self.__coiProbe.error = event.data.message; }
    };
    void (async () => {
      const blob = await (await fetch("./engine-packs/rapfi-full-v3.data")).blob();
      const moves = "h8h9h6i10i6i9g9g8j11i7i8g6".match(/[a-o](?:1[0-5]|[1-9])/g).map((token, index) => ({
        col: token.charCodeAt(0) - 97, row: 15 - Number(token.slice(1)), player: index % 2 === 0 ? "black" : "white",
      }));
      worker.postMessage({
        type: "analyze", requestId: "coi-1", generation: 1, engine: "multi", dataUrl: URL.createObjectURL(blob), multi: true,
        size: 15, moves, player: "black", rule: "renju", timeMs: 3000, maxDepth: 64, topN: 1, maxMemoryMb: 128,
      });
    })();
  });
  await page.waitForFunction(() => self.__coiProbe?.done, null, { timeout: 120_000 });
  const probe = await page.evaluate(() => self.__coiProbe);
  console.log("        ", JSON.stringify(probe));
  assert(probe.variant === "multi", `实际变体是 ${probe.variant}，不是 multi`);
  assert(!probe.error, `引擎报错：${probe.error}`);
  assert((probe.nodes || 0) > 0, "没有搜索节点");
});

await step("离线重开仍可用（预缓存生效且仍隔离）", async () => {
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.crossOriginIsolated === true, null, { timeout: 60_000 });
  await page.waitForSelector("svg.renju-board", { timeout: 60_000 });
  await context.setOffline(false);
});

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n跨源隔离验证失败 ${failures.length} 项：`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("\n跨源隔离验证通过：SW 注入隔离头 → SAB 可用 → 多线程引擎加载成功 → 离线仍可用。");
