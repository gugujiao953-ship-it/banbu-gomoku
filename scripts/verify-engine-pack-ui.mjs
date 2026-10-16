import { chromium } from "playwright";

// End-to-end check of the in-app engine pack flow: settings section renders,
// the download activates the pack immediately, and delete reverts to the
// lightweight engine.
// 09-12 设置主目录分组重构后：分区是折叠 <details>（search 为空时合着），改用 summary
// 精确定位。引擎包已升级 v3（rapfi-full-v3.data，40306406 字节），IDB 探针同步
// （键动态读取，不再硬编码 v1）。
// 2026-10-02 起这一节**只有网页环境渲染**：原生（安卓引擎就绪）时 EnginePackSection
// 整节 return null（那一面没有任何可点的动作，只剩一份被用户两次认定重复的引擎介绍，
// 介绍页在「关于 → 引擎与模型介绍」）。所以本脚本验的是网页面：分区 + 下载/删除闭环。
// 桌面浏览器里原生探针恒为 false，够不到原生那一面——那一面的断言在
// src/features/ai/engine-pack-section.test.tsx（直接喂 nativeReady）与
// scripts/verify-web-deploy.mjs 的 CHECK_STATE（假原生桥）里。
const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5193/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
// 首运行弹窗是会挡住点击的模态层，自动化一律先把它按掉（与 qa/* 同一套做法）。
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
const page = await context.newPage();
page.setDefaultTimeout(60000);
// 分区里的按钮一律按「所在分区」定位：getByText 会先撞上分析面板里那些隐藏的同名小字
// （例如「…下载冠军网络包可提升棋力」），点上去就是 30 秒可见性超时。
const openPackSection = () => page.evaluate(() => {
  const pack = [...document.querySelectorAll("details.settings-group")]
    .find((g) => (g.querySelector(".settings-section-title b")?.textContent || "").trim() === "AI 引擎");
  pack?.setAttribute("open", "");
  return Boolean(pack);
});
const packLink = (label) => page.locator("details.settings-group")
  .filter({ has: page.locator(".settings-section-title > b", { hasText: "AI 引擎" }) }).first()
  .locator("button.settings-link", { hasText: label }).first();
const sectionToggle = page.locator("summary.settings-section-toggle", { hasText: "AI 引擎" });
await page.goto(`${baseUrl}?qa=1`, { waitUntil: "domcontentloaded" });
await page.locator("nav.bottom-nav button:has-text('设置')").click();
await page.getByLabel("搜索设置").waitFor();
await sectionToggle.first().waitFor({ timeout: 15000 });
// 原生那一面的介绍分区不许在网页环境出现（它是 2026-10-02 用户报的那个副本）。
const nativeExplainerLeaked = await page.evaluate(() => [...document.querySelectorAll("summary.settings-section-toggle")]
  .some((s) => (s.textContent || "").includes("强力 AI 引擎")));
console.log(JSON.stringify({ step: "section-visible", ok: true, nativeExplainerLeaked }));
if (nativeExplainerLeaked) throw new Error("网页环境出现了原生那一面的「强力 AI 引擎」分区");

// Sections are collapsed <details>; expand before interacting.
await openPackSection();
// 起始状态必须是「未装包」：引擎包现在随 APK（dev 为同源 engine-packs/）分发、
// 启动即自动安装，首次打开或上一轮跑完都可能已是已装状态。先删干净再开始——
// 删除会写 opt-out 标记，保证本轮不会被自动装回（否则下一行断言假挂）。
if (await packLink("删除引擎包").isVisible().catch(() => false)) {
  await packLink("删除引擎包").click();
  await openPackSection();
  await packLink("再点一次确认删除").click();
  await page.getByText("内置引擎（自带轻量网络）· 冠军网络包可下载").first().waitFor({ timeout: 15000 });
}
const before = await page.getByText("内置引擎（自带轻量网络）· 冠军网络包可下载").first().isVisible().catch(() => false);
console.log(JSON.stringify({ step: "initial-state", ok: before }));
if (!before) throw new Error("起始状态不是「未装包」，后面的下载断言没有意义");

await openPackSection();
await packLink("下载冠军网络包").click();
await page.getByText(/rapfi 已生效/).first().waitFor({ timeout: 120000 });
console.log(JSON.stringify({ step: "activated", ok: true }));

// 已装包也必须留着下载入口（用户 09-14：引擎包随 APK 分发、启动即自动安装，
// 若只留「删除」，下载功能在真机上等于看不见）。两处坑：
//   · 快照状态先于 downloadEnginePack 的 promise 落地，phase 归位慢一帧——单次
//     读 DOM 会读到「正在下载引擎包…」，必须轮询到落定；
//   · 包状态一变设置页回折叠态，靠 Playwright 可见性断言会假挂，故展开 + DOM 级检查。
// 注意此时源优先级第一项就是自带包（同源 /engine-packs/），所以重下是本地读取。
const readEntries = () => page.evaluate(() => {
  const toggle = [...document.querySelectorAll("summary.settings-section-toggle")]
    .find((s) => (s.querySelector(".settings-section-title b")?.textContent || "").trim() === "AI 引擎");
  const section = toggle?.closest("details.settings-group");
  if (!section) return { found: false, titles: [] };
  section.setAttribute("open", "");
  const titles = [...section.querySelectorAll("button.settings-link b")].map((b) => (b.textContent || "").trim());
  return { found: true, titles };
});
let entry = await readEntries();
for (let i = 0; i < 20 && !entry.titles.includes("重新下载引擎包"); i += 1) {
  await page.waitForTimeout(1000);
  entry = await readEntries();
}
const keptEntries = entry.titles.includes("重新下载引擎包") && entry.titles.includes("删除引擎包");
console.log(JSON.stringify({ step: "download-entry-kept-when-installed", ok: keptEntries, ...entry }));
if (!keptEntries) throw new Error(`已装包时下载/删除入口不全：${entry.titles.join(" / ") || "无入口"}`);

// The worker picks the pack up through the same path the app uses: blob URL
// created from the downloaded IndexedDB bytes, passed as dataUrl. This also
// times the real per-move load cost on the downloaded pack.
const probe = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("banbu-engine-pack-v1", 1);
  request.onerror = () => reject(new Error("IDB open failed"));
  request.onsuccess = () => {
    const database = request.result;
    const store = database.transaction("packs", "readonly").objectStore("packs");
    const keys = store.getAllKeys();
    keys.onerror = () => reject(new Error("IDB keys failed"));
    keys.onsuccess = () => {
      const packKey = (keys.result || []).map(String).find((key) => key.startsWith("rapfi-full-") && key.endsWith(".data"));
      if (!packKey) { reject(new Error("pack key missing in IDB")); return; }
      const get = store.get(packKey);
      get.onerror = () => reject(new Error("IDB read failed"));
      get.onsuccess = () => {
        const blob = get.result;
        if (!blob) { reject(new Error("pack blob missing")); return; }
        const url = URL.createObjectURL(blob);
        const started = performance.now();
        const worker = new Worker("./rapfi/rapfi-worker.js");
        worker.onmessage = (event) => {
          if (event.data.type === "ready") { resolve({ variant: event.data.variant, loadMs: Math.round(performance.now() - started), blobSize: blob.size, packKey }); worker.terminate(); }
          if (event.data.type === "error") { reject(new Error(event.data.message)); worker.terminate(); }
        };
        worker.postMessage({ type: "analyze", engine: "auto", dataUrl: url, size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju", timeMs: 400, maxDepth: 8 });
      };
    };
  };
}));
// 身份锚点是「blob 字节数 + 包键」——这两条证明 worker 吃的确实是刚下载的那份 v3 包。
// variant 不作断言：引擎按环境挑二进制（跨源隔离下会选 multi 多线程变体，非隔离选 full），
// 两种变体读的都是同一份 .data 权重，脚本 09-12 写死 "full" 时 multi 还没进包。
const probeLoaded = ["full", "multi"].includes(probe.variant) && probe.blobSize === 40306406 && probe.packKey === "rapfi-full-v3.data";
console.log(JSON.stringify({ step: "worker-loads-downloaded-pack", ok: probeLoaded, ...probe }));
if (!probeLoaded) throw new Error("下载到的包没能被引擎加载");

await openPackSection();
await packLink("删除引擎包").click();
await openPackSection();
await packLink("再点一次确认删除").click();
await page.getByText("内置引擎（自带轻量网络）· 冠军网络包可下载").first().waitFor({ timeout: 10000 });
console.log(JSON.stringify({ step: "deleted", ok: true }));

await context.close();
await browser.close();
