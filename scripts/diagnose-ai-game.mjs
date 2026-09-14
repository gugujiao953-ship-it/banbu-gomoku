import { chromium } from "playwright";

// Ground-truth diagnosis of an in-app AI game on the redesigned setup sheet:
// wraps window.Worker to capture which engine variant actually loads, whether
// analyze requests carry the pack dataUrl, real per-move think time, and any
// worker errors. Plays a real 大师/strong freestyle game from the UI.
const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200)); });
page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 200)));

await page.addInitScript(() => {
  window.__diag = { workers: [], events: [] };
  const OriginalWorker = window.Worker;
  const PatchedWorker = function(url, options) {
    const worker = new OriginalWorker(url, options);
    if (String(url).includes("rapfi-worker")) {
      const record = { ready: null, requests: [], results: [] };
      window.__diag.workers.push(record);
      const originalPostMessage = worker.postMessage.bind(worker);
      worker.postMessage = (message) => {
        if (message && message.type === "analyze") record.requests.push({ t: Math.round(performance.now()), engine: message.engine, hasDataUrl: Boolean(message.dataUrl), timeMs: message.timeMs, unlimited: message.unlimited === true });
        return originalPostMessage(message);
      };
      worker.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type === "ready") { record.ready = data.variant; window.__diag.events.push({ t: Math.round(performance.now()), type: "ready", variant: data.variant }); }
        if (data.type === "result" && data.result) record.results.push({ t: Math.round(performance.now()), requestId: data.requestId });
        if (data.type === "error") window.__diag.events.push({ t: Math.round(performance.now()), type: "error", message: String(data.message || "").slice(0, 120) });
      });
    }
    return worker;
  };
  PatchedWorker.prototype = OriginalWorker.prototype;
  window.Worker = PatchedWorker;
});

await page.goto(`${baseUrl}?qa=1`, { waitUntil: "domcontentloaded" });
await page.locator("nav.bottom-nav button:has-text('AI')").click();
await page.waitForTimeout(700);

// The setup sheet is embedded inline on the AI page. Configure it directly.
await page.getByText("强力引擎").first().click();
const downloadButton = page.getByText("立即下载强力引擎包");
if (await downloadButton.isVisible().catch(() => false)) {
  await downloadButton.click();
  await page.getByText("已生效").first().waitFor({ timeout: 120000 });
  console.log(JSON.stringify({ step: "pack-downloaded-and-active" }));
} else {
  console.log(JSON.stringify({ step: "pack-already-active" }));
}

await page.locator(".ai-setup-cell.single").first().click();
await page.getByText("大师", { exact: true }).click();
await page.waitForTimeout(300);
await page.mouse.click(12, 400);
await page.waitForTimeout(300);
await page.locator(".ai-game-setup").getByText("开始人机对战").click();
await page.waitForTimeout(800);

const board = page.locator(".renju-board");
await board.waitFor();
await page.waitForTimeout(400);
const sx = (await board.boundingBox()).width / 16;

// Click the empty intersection closest to the board center, so the script
// never collides with whatever point the engine actually played.
const clickCenterEmpty = async () => {
  await page.evaluate(() => {
    const hits = Array.from(document.querySelectorAll(".board-hit"));
    const empty = hits.filter((element) => (element.getAttribute("aria-label") || "").includes("空位"));
    empty.sort((a, b) => {
      const box = document.querySelector(".renju-board").getBoundingClientRect();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const pa = a.getBoundingClientRect(), pb = b.getBoundingClientRect();
      const da = (pa.left + pa.width / 2 - cx) ** 2 + (pa.top + pa.height / 2 - cy) ** 2;
      const db = (pb.left + pb.width / 2 - cx) ** 2 + (pb.top + pb.height / 2 - cy) ** 2;
      return da - db;
    });
    const target = empty[0];
    if (!target) throw new Error("没有空位可点");
    const rect = target.getBoundingClientRect();
    window.__diagClick = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const point = await page.evaluate(() => window.__diagClick);
  await page.mouse.click(point.x, point.y);
};

for (let index = 0; index < 4; index += 1) {
  const before = await page.evaluate(() => window.__diag.workers.reduce((sum, worker) => sum + worker.results.length, 0));
  await clickCenterEmpty();
  await page.waitForTimeout(500);
  let after = before;
  for (let wait = 0; wait < 60; wait += 1) {
    after = await page.evaluate(() => window.__diag.workers.reduce((sum, worker) => sum + worker.results.length, 0));
    if (after > before) break;
    await page.waitForTimeout(250);
  }
  console.log(JSON.stringify({ ply: index + 1, aiResultsBefore: before, aiResultsAfter: after }));
}

const diag = await page.evaluate(() => ({
  workers: window.__diag.workers.map((worker) => ({
    ready: worker.ready,
    requests: worker.requests,
    resultCount: worker.results.length,
    thinkMs: worker.requests.map((request, index) => worker.results[index] ? worker.results[index].t - request.t : null),
  })),
  events: window.__diag.events.slice(-12),
}));
console.log(JSON.stringify({ diag, consoleErrors: consoleErrors.slice(0, 6) }, null, 1));
await browser.close();
