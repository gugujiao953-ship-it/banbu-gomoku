import { chromium } from "playwright";

// End-to-end check of the in-app engine pack flow: settings section renders,
// the download activates the pack immediately, and delete reverts to the
// lightweight engine.
// 09-12 设置主目录分组重构后：分区是折叠 <details>（search 为空时合着），且
// 「强力 AI 引擎」分区在「分析」分区之后——getByText 会先撞上分析面板里隐藏的
// 引擎行小字（hidden <small>——注意 Playwright visible 判定 CSS 而非视口）。
// 改用 summary 精确定位。引擎包已升级 v3（rapfi-full-v3.data，40306406 字节），
// IDB 探针同步（键动态读取，不再硬编码 v1）。
const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`${baseUrl}?qa=1`, { waitUntil: "domcontentloaded" });
await page.locator("nav.bottom-nav button:has-text('设置')").click();
await page.getByText("偏好中心").waitFor();
await page.locator("summary.settings-section-toggle", { hasText: "强力 AI 引擎" }).first().waitFor({ timeout: 15000 });
console.log(JSON.stringify({ step: "section-visible", ok: true }));

// Sections are collapsed <details>; expand before interacting.
await page.locator("summary.settings-section-toggle", { hasText: "强力 AI 引擎" }).click();
// 起始状态必须是「未装包」：引擎包现在随 APK（dev 为同源 engine-packs/）分发、
// 启动即自动安装，首次打开或上一轮跑完都可能已是已装状态。先删干净再开始——
// 删除会写 opt-out 标记，保证本轮不会被自动装回（否则第 23 行断言假挂）。
if (await page.getByText("强力引擎已生效").first().isVisible().catch(() => false)) {
  await page.getByText("删除引擎包").first().click();
  await page.getByText("再点一次确认删除").first().click();
  await page.getByText("轻量引擎 · 完整引擎包可下载").waitFor({ timeout: 15000 });
}
const before = await page.getByText("轻量引擎 · 完整引擎包可下载").isVisible().catch(() => false);
console.log(JSON.stringify({ step: "initial-state", ok: before }));

await page.getByText("下载强力引擎包").first().click();
await page.getByText("强力引擎已生效").first().waitFor({ timeout: 120000 });
console.log(JSON.stringify({ step: "activated", ok: true }));

// 已装包也必须留着下载入口（用户 09-14：引擎包随 APK 分发、启动即自动安装，
// 若只留「删除」，下载功能在真机上等于看不见）。两处坑：
//   · 快照状态先于 downloadEnginePack 的 promise 落地，phase 归位慢一帧——单次
//     读 DOM 会读到「正在下载引擎包…」，必须轮询到落定；
//   · 包状态一变设置页回折叠态，靠 Playwright 可见性断言会假挂，故展开 + DOM 级检查。
// 注意此时源优先级第一项就是自带包（同源 /engine-packs/），所以重下是本地读取。
const readEntries = () => page.evaluate(() => {
  const section = [...document.querySelectorAll("details.settings-group")].find((d) => (d.textContent || "").includes("强力 AI 引擎"));
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
console.log(JSON.stringify({ step: "download-entry-kept-when-installed", ok: entry.titles.includes("重新下载引擎包") && entry.titles.includes("删除引擎包"), ...entry }));

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
console.log(JSON.stringify({ step: "worker-loads-downloaded-pack", ok: probe.variant === "full" && probe.blobSize === 40306406 && probe.packKey === "rapfi-full-v3.data", ...probe }));

await page.getByText("删除引擎包").first().click();
await page.getByText("再点一次确认删除").first().click();
await page.getByText("轻量引擎 · 完整引擎包可下载").waitFor({ timeout: 10000 });
console.log(JSON.stringify({ step: "deleted", ok: true }));

await browser.close();
