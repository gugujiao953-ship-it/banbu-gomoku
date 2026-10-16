/**
 * 网页版部署体检：跨源隔离链路 + 引擎档位 + 「分析开不起来」的两条死路。
 *
 * 为什么需要它（2026-09-18 线上事故）：网页版要跑到百万 nps 靠的是 **WASM 多线程**
 * 档，而多线程只有一个前提——页面跨源隔离（`crossOriginIsolated`）。GitHub Pages 不
 * 能下发响应头，隔离只能由 `src/sw.js` 在响应上补；而 Workbox 的预缓存是全有或全无，
 * 安装期只要有一条 404 就整个 install reject、注册被丢弃。线上 `/app/` 实测 91 条预
 * 缓存里只有 `version.json` 是 404（部署侧刻意只把版本文件放站点根），于是：
 *   SW 装不上 → 没有 COOP/COEP → 没有 SharedArrayBuffer → 多线程档永远进不去
 *   → 离线预缓存也一并消失。
 * 这条链子在页面上**没有任何报错**（没有 SW 就没人补头，主线程只看得到
 * crossOriginIsolated === false），所以必须有一条能跑的门禁把它钉住。
 *
 * 用法：
 *   node scripts/verify-web-deploy.mjs                     # 本地 dist，Pages 式托管（不发隔离头，挂在 /app/）
 *   SERVE_PACK=1 node scripts/verify-web-deploy.mjs         # 加验：隔离下多线程引擎真的能加载
 *   CHECK_UI=1 node scripts/verify-web-deploy.mjs           # 加验：无引擎包时「分析」真的跑起来
 *   CHECK_CONTENT=1 node scripts/verify-web-deploy.mjs      # 加验：内置题库/棋谱/手册配图/零 404
 *   CHECK_STATE=1 node scripts/verify-web-deploy.mjs        # 加验：引擎状态自愈（见下）+ legacy 不该白加载
 *   WEB_URL=https://…/app/ node scripts/verify-web-deploy.mjs   # 线上体检（清单逐条探测 + 隔离）
 *   BROWSER=webkit 换内核（Safari 内核；默认 chromium）；MOUNT 改挂载点；PORT 改端口。
 *
 * 托管点照搬线上：子路径 `/app/`。这一点很关键——「站点根绝对路径」类缺陷（/puzzles/…、
 * /manual/…、/renlib/…）只有在子路径下才暴露，挂在根路径测是测不出来的。
 * 先跑 `npm run build`。注意 public/ 下别留临时大文件（会被打进 dist）。
 */
import { chromium, webkit } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = process.env.SITE_DIR || "dist";
const PORT = Number(process.env.PORT || 5393);
// 真实部署挂在子路径（https://…/banbu-gomoku/app/）。托管必须照搬这个挂载点：
// 「站点根绝对路径」类的缺陷（/puzzles/…、/manual/…、/renlib/…）只有在子路径下才暴露。
const MOUNT = process.env.MOUNT || "/app";
const SERVE_PACK = process.env.SERVE_PACK === "1";
const CHECK_UI = process.env.CHECK_UI === "1";
const CHECK_CONTENT = process.env.CHECK_CONTENT === "1";
const CHECK_STATE = process.env.CHECK_STATE === "1";
const LIVE_URL = process.env.WEB_URL || "";
const useWebKit = process.env.BROWSER === "webkit";
const PACK_NAME = "rapfi-full-v3.data";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".data": "application/octet-stream", ".sgf": "application/octet-stream", ".db": "application/octet-stream", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8", ".lib": "application/octet-stream" };

const failures = [];
const assert = (value, message) => { if (!value) failures.push(message); };
const check = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); }
  catch (error) { failures.push(`${name}：${error.message}`); console.log(`  ✗ ${name}：${error.message}`); }
};

/** 从 SW 产物里抠出预缓存清单（injectManifest 注入的实体清单）。 */
const readManifest = (source) => [...source.matchAll(/"revision":[^}]*?"url":"([^"]+)"/g)].map((match) => match[1]);

// ---------------------------------------------------------------- 线上体检模式
if (LIVE_URL) {
  await liveCheck();
  // 线上模式到此为止：不落到本地托管那一套（finish 只管结论，退出码在这里定）。
  process.exit(failures.length ? 1 : 0);
}

async function liveCheck() {
  const base = LIVE_URL.endsWith("/") ? LIVE_URL : `${LIVE_URL}/`;
  console.log(`线上体检：${base}`);
  const swSource = await (await fetch(`${base}${["s", "w", ".js"].join("")}`)).text();
  const entries = readManifest(swSource);
  assert(entries.length > 0, "没从线上 SW 里读到预缓存清单（SW 存在吗？）");
  console.log(`  预缓存 ${entries.length} 条，逐条探测…`);
  const bad = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= entries.length) return;
      const entry = entries[index];
      try {
        const response = await fetch(base + entry, { headers: { Range: "bytes=0-0" } });
        if (!response.ok) bad.push(`${response.status} ${entry}`);
        else await response.arrayBuffer();
      } catch (error) { bad.push(`ERR ${entry} ${error.message}`); }
    }
  }));
  assert(bad.length === 0, `有 ${bad.length} 条预缓存取不到，SW 会整个装不上：${bad.slice(0, 8).join(" / ")}`);
  if (bad.length === 0) console.log("  ✓ 清单里每一条线上都取得到（SW 安装不会因 404 失败）");
  const liveBrowser = await launch();
  const livePage = await liveBrowser.newPage();
  await livePage.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
  let isolated = false;
  for (let index = 0; index < 14 && !isolated; index += 1) {
    await livePage.waitForTimeout(2500);
    isolated = await livePage.evaluate(() => window.crossOriginIsolated === true);
  }
  const state = await livePage.evaluate(() => ({ coi: window.crossOriginIsolated, sab: typeof SharedArrayBuffer, controlled: Boolean(navigator.serviceWorker.controller) }));
  console.log("  隔离状态:", JSON.stringify(state));
  assert(isolated, "线上页面拿不到跨源隔离（多线程档因此永远不可用）");
  assert(state.sab === "function", "线上 SharedArrayBuffer 不可用");
  await liveBrowser.close();
  finish();
}

// ---------------------------------------------------------------- 本地（Pages 式托管）
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(MOUNT)) { response.writeHead(404, { "Content-Type": "text/html" }).end("outside mount"); return; }
    const relative = pathname.slice(MOUNT.length).replace(/^\//, "");
    // SERVE_PACK=1 时同源提供引擎包（模拟 APK 自带 / 本地 dev 中间件）。
    // 注意：这里的兜底路由会把未知路径回成 index.html（200），所以**必须**在静态
    // 兜底之前判掉这个路径，否则包请求会拿到一份 HTML 而被当成「包」用。
    if (relative === `engine-packs/${PACK_NAME}`) {
      const pack = join("engine-packs", PACK_NAME);
      if (!SERVE_PACK || !existsSync(pack)) { response.writeHead(404).end("no pack"); return; }
      const body = await readFile(pack);
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
      response.end(body);
      return;
    }
    let path = normalize(join(ROOT, relative));
    if (!path.startsWith(normalize(ROOT))) { response.writeHead(403).end(); return; }
    try { if ((await stat(path)).isDirectory()) path = join(path, "index.html"); }
    catch { path = join(ROOT, "index.html"); }
    const body = await readFile(path);
    // 关键：故意不发 COOP/COEP，完全模拟 GitHub Pages。
    response.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Content-Length": body.length });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/html" }).end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${PORT}${MOUNT}/`;
console.log(`托管 ${ROOT} @ ${base}（挂载点照搬线上）｜内核 ${useWebKit ? "webkit" : "chromium"}｜引擎包 ${SERVE_PACK ? "同源提供" : "无（模拟线上）"}｜CHECK_UI=${CHECK_UI}｜CHECK_CONTENT=${CHECK_CONTENT}`);

const manifest = readManifest(await readFile(join(ROOT, ["s", "w", ".js"].join("")), "utf8"));
const missingLocal = manifest.filter((entry) => !existsSync(join(ROOT, entry)));
console.log(`预缓存 ${manifest.length} 条，构建产物里缺失 ${missingLocal.length} 条：${missingLocal.join(", ") || "-"}`);
assert(missingLocal.length === 0, `构建产物里缺预缓存条目：${missingLocal.join(", ")}`);
assert(!manifest.includes("version.json"), "version.json 又被塞进预缓存了——部署侧不放它，SW 会整个装不上");

const browser = await launch();
const context = await browser.newContext(useWebKit ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1" } : {});
const page = await context.newPage();
page.setDefaultTimeout(90000);

await check("SW 装上并补出隔离头（页面拿到 crossOriginIsolated + SAB）", async () => {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  let isolated = false;
  for (let index = 0; index < 14 && !isolated; index += 1) {
    await page.waitForTimeout(2500);
    isolated = await page.evaluate(() => window.crossOriginIsolated === true);
  }
  const state = await page.evaluate(() => ({ coi: window.crossOriginIsolated, sab: typeof SharedArrayBuffer, controlled: Boolean(navigator.serviceWorker.controller) }));
  console.log("       ", JSON.stringify(state));
  if (!isolated) throw new Error("没有拿到跨源隔离（SW 没装上，或没补 COOP/COEP）");
  if (state.sab !== "function") throw new Error("SharedArrayBuffer 不可用");
});

await check("应用正常启动（棋盘渲染）", async () => {
  await page.waitForSelector("svg.renju-board", { timeout: 60000 });
});

if (SERVE_PACK) {
  await check("跨源隔离下多线程引擎真的加载成功（百万 nps 那条路）", async () => {
    await page.evaluate((workerFile) => {
      self.__multiProbe = { done: false };
      const worker = new Worker(`./${workerFile}`);
      worker.onmessage = (event) => {
        if (event.data?.type === "ready") self.__multiProbe.variant = event.data.variant;
        if (event.data?.type === "result") { self.__multiProbe.done = true; self.__multiProbe.depth = event.data.result?.depth; self.__multiProbe.nodes = event.data.result?.nodes; self.__multiProbe.speed = event.data.result?.speed; }
        if (event.data?.type === "error") { self.__multiProbe.done = true; self.__multiProbe.error = event.data.message; }
      };
      void (async () => {
        const blob = await (await fetch("./engine-packs/rapfi-full-v3.data")).blob();
        const tokens = "h8h9h6i10i6i9g9g8j11i7i8g6".match(/[a-o](?:1[0-5]|[1-9])/g) || [];
        const moves = tokens.map((token, index) => ({ col: token.charCodeAt(0) - 97, row: 15 - Number(token.slice(1)), player: index % 2 === 0 ? "black" : "white" }));
        worker.postMessage({ type: "analyze", requestId: "probe-1", generation: 1, engine: "auto", dataUrl: URL.createObjectURL(blob), multi: true, size: 15, moves, player: "black", rule: "renju", timeMs: 3000, maxDepth: 64, topN: 1, maxMemoryMb: 128 });
      })();
    }, ["rapfi", "rapfi-" + "worker" + ".js"].join("/"));
    await page.waitForFunction(() => self.__multiProbe?.done, null, { timeout: 180000 });
    const probe = await page.evaluate(() => self.__multiProbe);
    console.log("       ", JSON.stringify(probe));
    if (probe.error) throw new Error(`引擎报错：${probe.error}`);
    if (probe.variant !== "multi") throw new Error(`实际变体是 ${probe.variant}，不是 multi`);
    if (!(probe.nodes > 0)) throw new Error("没有搜索节点");
  });
}

if (CHECK_UI) {
  // 用户视角的那条死路：站点上没有 40MB 引擎包（线上 /app/ 就是这样）时，
  // 「分析」开关必须仍然能跑起来（回落内置引擎）并把话说明白。
  await check("没有引擎包时「分析」真的跑起来（深度/节点在爬升）", async () => {
    await page.evaluate(() => {
      localStorage.setItem("banbu-first-run-welcome-v1", "true");
      localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 3 }));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("svg.renju-board", { timeout: 60000 });
    await page.waitForTimeout(3000);
    const placed = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[role="gridcell"]')];
      let count = 0;
      for (const point of ["H8", "G9"]) {
        const cell = cells.find((node) => (node.getAttribute("aria-label") || "").startsWith(point));
        if (cell) { cell.dispatchEvent(new MouseEvent("click", { bubbles: true })); count += 1; }
      }
      return count;
    });
    if (placed !== 2) throw new Error(`落子没成功（${placed}/2）`);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { [...document.querySelectorAll("button, label")].find((node) => (node.textContent || "").trim() === "分析")?.click(); });
    await page.waitForTimeout(1500);
    const switched = await page.evaluate(() => {
      const input = document.querySelector(".ai-analysis-head .analysis-toggle input");
      if (!input) return "no-toggle";
      if (input.checked) return "already-on";
      input.click();
      return "clicked";
    });
    const depthOf = (text) => Number((String(text).match(/深度\s*(\d+)/) || [])[1] || 0);
    const nodesOf = (text) => {
      const raw = String(text).match(/节点\s*([\d.]+)([kM]?)/) || [];
      const unit = (raw[2] || "").toUpperCase();
      return Number(raw[1] || 0) * (unit === "K" ? 1000 : unit === "M" ? 1000000 : 1);
    };
    let first = null;
    let last = null;
    for (let index = 0; index < 6; index += 1) {
      await page.waitForTimeout(3000);
      const stats = await page.evaluate(() => document.querySelector(".ai-analysis-stats")?.textContent?.replace(/\s+/g, " ").trim() || "");
      if (!first) first = stats;
      last = stats;
    }
    console.log(`       开关=${switched} 首采样「${first}」→ 末采样「${last}」`);
    if (depthOf(last) <= 0) throw new Error("深度一直是「-」，分析没有启动");
    if (nodesOf(last) <= nodesOf(first)) throw new Error(`节点没有爬升（${nodesOf(first)} → ${nodesOf(last)}）`);
  });
}

if (CHECK_CONTENT) {
  // 内置内容（题库 / 棋谱 / 手册配图 / RenLib 核心）用的都是随包资源，最容易被
  // 「站点根绝对路径」这类缺陷整体打掉：子路径部署下会全部 404，而界面上只是空的
  // （题库 0 个题集、手册图裂、.lib 打不开），不会有任何报错。逐项断言到「真的有东西」。
  const contentProblems = new Set();
  page.on("response", (r) => { if (r.status() >= 400) contentProblems.add(`${r.status()} ${r.url().replace(base, "./").slice(0, 100)}`); });

  await check("内置题库真的加载出题集（不是 0 个）", async () => {
    await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      [...document.querySelectorAll(".bottom-nav button")].find((b) => /棋谱库/.test(b.textContent || ""))?.click();
      await wait(2000);
      [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("题库"))?.click();
      await wait(2500);
    });
    const info = await page.evaluate(() => ({ text: (document.body.innerText || "").replace(/\s+/g, " ") }));
    const count = Number((info.text.match(/题库\s*(\d+)/) || [])[1] || 0);
    console.log(`       题库计数=${count}`);
    if (count < 10) throw new Error(`内置题库只有 ${count} 个题集（应为 17 个开宝题集）`);
    if (!/开宝|三手胜|坂田吾朗|天狗道场|VCF/.test(info.text)) throw new Error("题库里看不到任何内置题集名");
  });

  await check("内置棋谱（人机大战 5 局）在棋谱库里", async () => {
    await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("棋谱"))?.click();
      await wait(2000);
    });
    const count = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return Number((text.match(/全部\s*(\d+)/) || [])[1] || 0);
    });
    console.log(`       棋谱计数=${count}`);
    if (count < 5) throw new Error(`棋谱库里只有 ${count} 份（内置 5 局人机大战应已入库）`);
  });

  await check("手册配图全部加载（33 张）", async () => {
    await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      [...document.querySelectorAll(".bottom-nav button")].find((b) => /设置/.test(b.textContent || ""))?.click();
      await wait(1800);
      [...document.querySelectorAll("button, .setting-row, .settings-link")].find((b) => /用户手册|使用手册/.test(b.textContent || ""))?.click();
      await wait(2000);
      document.querySelectorAll(".manual-item").forEach((item) => item.setAttribute("open", ""));
      document.querySelectorAll(".manual-feature-thumb img").forEach((img) => { img.loading = "eager"; });
      const sheet = document.querySelector(".manual-sheet");
      if (sheet) {
        for (let y = 0; y <= sheet.scrollHeight; y += 700) { sheet.scrollTop = y; await wait(200); }
        sheet.scrollTop = 0;
      }
    });
    await page.waitForTimeout(4000);
    const manual = await page.evaluate(() => {
      const images = [...document.querySelectorAll(".manual-feature-thumb img")];
      return { total: images.length, loaded: images.filter((img) => img.complete && img.naturalWidth > 0).length, first: images[0]?.getAttribute("src") || "" };
    });
    console.log(`       配图 ${manual.loaded}/${manual.total}，首个 src=${manual.first}`);
    if (manual.total < 30) throw new Error(`手册配图元素只有 ${manual.total} 个`);
    if (manual.loaded !== manual.total) throw new Error(`手册配图没全加载（${manual.loaded}/${manual.total}）`);
    if (!manual.first.startsWith("./")) throw new Error(`配图路径没按构建 base 解析：${manual.first}`);
  });

  await check("子路径部署下没有任何资源 404", async () => {
    if (contentProblems.size) throw new Error([...contentProblems].slice(0, 6).join(" / "));
  });
}

if (CHECK_STATE) {
  // 用户 09-18 报「本来就有模型，却让我下载引擎」的两类状态检测 bug（都不是「真的没装」）：
  //   ① 安卓原生引擎探测只在挂载时跑一次 → 插件注册晚于启动就把整个会话判成「没有原生
  //      引擎」，界面一直引导下载 38MB，而安装包里带着模型。
  //   ② 引擎包状态标记（localStorage 一行）丢了 → 旧实现不再看 IndexedDB，直接判成
  //      「没装」，而 40MB 的包本体还在库里。
  // 另外守一条：CSP 的 script-src 必须允许 data:，否则 plugin-legacy 的降级探测被拦，
  // 所有浏览器都会白加载 868KB 的 legacy 包（线上实测还连带 SystemJS 报错）。
  const stateContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await stateContext.addInitScript(() => {
    // 假安卓桥：window.androidBridge 让 Capacitor 认成 android；check 前 10 次抛错
    // 模拟「插件注册晚于启动 effect」，之后返回可用。
    window.androidBridge = {};
    let calls = 0;
    window.__checkCalls = () => calls;
    window.Capacitor = {
      Plugins: {
        NativeEngine: {
          check: async () => { calls += 1; if (calls <= 10) throw new Error("plugin not ready"); return { available: true, abi: "arm64", cores: 8, bigCores: 4, assetsCopied: true, binaryPath: "/data/app/rapfi", dotprodCapable: true, dotprodEnabled: true, dotprodPreference: "auto" }; },
          prepare: async () => ({ ready: true, dir: "/data" }),
          start: async () => ({ running: true, cores: 8 }),
          write: async () => undefined,
          stop: async () => undefined,
          addListener: () => ({ remove: async () => undefined }),
        },
      },
    };
  });
  const statePage = await stateContext.newPage();
  statePage.setDefaultTimeout(90000);
  const stateErrors = [];
  statePage.on("pageerror", (e) => stateErrors.push(String(e).slice(0, 140)));
  const legacyRequests = [];
  statePage.on("request", (r) => { if (/legacy/.test(r.url())) legacyRequests.push(r.url().split("/").pop()); });
  // 引擎状态现在分两面（2026-10-02，用户第二次报「设置里那个强力 ai 引擎的介绍怎么又跑出来了」）：
  //   · 原生（安卓，即下面这个假桥环境）——设置里**没有**引擎包分区，整节不渲染
  //     （EnginePackSection 的 `if (nativeReady) return null`）。原生就绪的信号只剩
  //     设置 →「分析 → 分析引擎」那一行的「本机原生引擎已就绪…」；介绍唯一的一处是
  //     关于 → 引擎与模型介绍（设置里靠「关于」分区那行指路）。
  //   · 网页——才有「AI 引擎」分区，里面是 downloadEnginePack / deleteEnginePack 唯一的 UI。
  // 旧版这里读的是原生那一面的分区文案（「本机原生引擎已生效」），分区删掉后必须换锚点。
  const readEngineSurface = () => statePage.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (!document.querySelector(".settings-group")) {
      [...document.querySelectorAll(".bottom-nav button")].find((b) => /设置/.test(b.textContent || ""))?.click();
      await wait(2500);
    }
    const groups = [...document.querySelectorAll(".settings-group")];
    const titleOf = (group) => (group.querySelector(".settings-section-title b")?.textContent || "").trim();
    const packSection = groups.find((g) => titleOf(g) === "AI 引擎" || titleOf(g).includes("强力 AI 引擎"));
    const analysis = groups.find((g) => titleOf(g) === "分析");
    const flat = (node) => (node?.textContent || "").replace(/\s+/g, " ");
    return {
      packSectionText: flat(packSection).slice(0, 140),
      analysisText: flat(analysis).slice(0, 500),
      settingsText: flat(document.querySelector(".settings-page")),
    };
  });

  await check("原生引擎插件晚注册：界面最终抬成「已就绪」（不再误报要下载）", async () => {
    await statePage.goto(base, { waitUntil: "domcontentloaded" });
    await statePage.waitForTimeout(2500);
    await statePage.evaluate(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
    await statePage.reload({ waitUntil: "domcontentloaded" });
    await statePage.waitForSelector("svg.renju-board", { timeout: 60000 });
    let surface = null;
    for (let index = 0; index < 10; index += 1) {
      await statePage.waitForTimeout(2500);
      surface = await readEngineSurface();
      if (/本机原生引擎已就绪/.test(surface.analysisText)) break;
    }
    console.log(`       设置 →「分析」引擎行：${surface.analysisText.slice(0, 110)}`);
    // 「已就绪」与「下载冠军网络包可提升棋力」是同一行的两种说法：晚注册的老 bug 就是
    // 探针一次失败后再也不抬，界面一直停后一种说法引导用户去下 38MB。
    if (!/本机原生引擎已就绪/.test(surface.analysisText)) throw new Error(`晚注册后界面没有抬起来（仍是「${surface.analysisText.slice(0, 80)}」）`);
    if (/下载冠军网络包可提升棋力/.test(surface.analysisText)) throw new Error(`抬起来的同时还在引导下载：「${surface.analysisText.slice(0, 80)}」`);
  });

  await check("原生环境设置页不再出现引擎介绍副本（介绍只在「关于 → 引擎与模型介绍」）", async () => {
    const surface = await readEngineSurface();
    if (surface.packSectionText) throw new Error(`原生环境的设置里又出现了引擎包分区：「${surface.packSectionText.slice(0, 90)}」`);
    for (const needle of ["强力 AI 引擎", "本机原生引擎已生效", "KataGo 旗舰引擎", "两个 AI 引擎"]) {
      if (surface.settingsText.includes(needle)) throw new Error(`设置页里还留着原生引擎介绍文案「${needle}」（这一节在原生不该渲染）`);
    }
    // 删掉副本不能把入口一起删没：搜/翻到「关于」那行必须还能看见介绍页的名字。
    if (!/引擎与模型介绍/.test(surface.settingsText)) throw new Error("设置页里没有指向「关于 → 引擎与模型介绍」的入口（原生环境唯一的介绍出口）");
  });

  await check("CSP 允许 data: → 现代浏览器不白加载 legacy 包", async () => {
    console.log(`       legacy 请求：${legacyRequests.length ? [...new Set(legacyRequests)].join(", ") : "无"}`);
    if (legacyRequests.length) throw new Error("仍在加载 legacy 包（CSP 的 script-src 少了 data:）");
  });

  await check("引擎包标记丢失但库里有包：自愈回「已生效」", async () => {
    // 需要 SERVE_PACK=1：让应用自己把同源引擎包装进库（40MB 由应用写入，正是线上
    // 真实路径），然后只清掉那行 localStorage 标记再重载——验的就是「标记丢了但
    // 模型还在」时界面不该判成「没装引擎」。
    if (!SERVE_PACK) { console.log("       跳过（本项需要 SERVE_PACK=1 提供同源引擎包）"); return; }
    const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await freshContext.newPage();
    page.setDefaultTimeout(120000);
    await page.goto(`${base}?qa=1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.evaluate(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
    let installed = null;
    for (let index = 0; index < 40; index += 1) {
      await page.waitForTimeout(3000);
      installed = await page.evaluate(() => localStorage.getItem("banbu-engine-pack-state-v1"));
      if (installed) break;
    }
    if (!installed) { await freshContext.close(); throw new Error("应用没能把同源引擎包装进库（前置条件不成立）"); }
    console.log(`       应用已装包：${installed}`);
    // 只清标记，包本体留在 IndexedDB
    await page.evaluate(() => localStorage.removeItem("banbu-engine-pack-state-v1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("svg.renju-board", { timeout: 60000 });
    await page.waitForTimeout(12000);
    const info = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      [...document.querySelectorAll(".bottom-nav button")].find((b) => /设置/.test(b.textContent || ""))?.click();
      await wait(2500);
      // 原生那两节在 2026-10-02 之后不再出现，这里按分区标题精确锚「AI 引擎」
      // （这个 context 没有假桥，是网页环境，分区一定渲染）。
      const section = [...document.querySelectorAll(".settings-group")]
        .find((g) => (g.querySelector(".settings-section-title b")?.textContent || "").trim() === "AI 引擎");
      return { text: (section?.textContent || "").replace(/\s+/g, " ").slice(0, 110), flag: localStorage.getItem("banbu-engine-pack-state-v1") };
    });
    console.log(`       引擎分区：${info.text.slice(0, 70)}｜标记：${info.flag}`);
    await freshContext.close();
    if (!/rapfi 已生效/.test(info.text)) throw new Error(`没有自愈回「已生效」（界面是「${info.text.slice(0, 60)}」）`);
    if (!info.flag || !/"version":3/.test(info.flag)) throw new Error("状态标记没有补回来");
  });

  await check("引擎文案不再把内置引擎说成「没就绪/要去下载」", async () => {
    const surface = await readEngineSurface();
    if (/内置备用引擎|引擎包未就绪/.test(surface.settingsText)) throw new Error(`仍出现旧口吻：「${surface.settingsText.slice(0, 90)}」`);
  });

  await check("网页环境（无原生桥）设置里仍有「AI 引擎」分区与下载入口", async () => {
    // 上面那个 context 被假原生桥抬成了 nativeReady，那一面分区整节不渲染（正是 2026-10-02
    // 要的）。这里另开一个干净 context 验另一面：downloadEnginePack / deleteEnginePack
    // 唯一的 UI 还在，删分区时把它一起删掉就会在这里失败。
    const webContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const webPage = await webContext.newPage();
    webPage.setDefaultTimeout(90000);
    try {
      await webPage.goto(`${base}?qa=1`, { waitUntil: "domcontentloaded" });
      await webPage.waitForTimeout(2500);
      await webPage.evaluate(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
      const web = await webPage.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        [...document.querySelectorAll(".bottom-nav button")].find((b) => /设置/.test(b.textContent || ""))?.click();
        await wait(2500);
        const groups = [...document.querySelectorAll(".settings-group")];
        const titleOf = (g) => (g.querySelector(".settings-section-title b")?.textContent || "").trim();
        const packSection = groups.find((g) => titleOf(g) === "AI 引擎");
        const flat = (node) => (node?.textContent || "").replace(/\s+/g, " ");
        return {
          found: Boolean(packSection),
          nativeTitleLeaked: groups.some((g) => titleOf(g).includes("强力 AI 引擎")) || /强力 AI 引擎|本机原生引擎已生效/.test(flat(document.querySelector(".settings-page"))),
          links: [...(packSection?.querySelectorAll("button.settings-link b") || [])].map((b) => (b.textContent || "").trim()),
          text: flat(packSection).slice(0, 160),
        };
      });
      console.log(`       引擎分区：${web.text.slice(0, 80)}`);
      if (!web.found) throw new Error("网页环境的设置里没有「AI 引擎」分区（那份包的下载入口就在里面）");
      if (!web.links.some((title) => title.includes("下载"))) throw new Error(`引擎分区缺下载入口：${web.links.join(" / ") || "无入口"}`);
      if (web.nativeTitleLeaked) throw new Error("网页环境里出现了原生那一面的「强力 AI 引擎」介绍分区");
    } finally {
      await webContext.close();
    }
  });

  await stateContext.close();
}

await browser.close();
server.close();
finish();

function launch() {
  return (useWebKit ? webkit : chromium).launch({
    headless: true,
    ...(useWebKit ? {} : { args: ["--no-proxy-server", "--proxy-bypass-list=*"] }),
  });
}

function finish() {
  if (failures.length) {
    console.error(`\n部署体检失败 ${failures.length} 项：\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("\n部署体检通过。");
}
