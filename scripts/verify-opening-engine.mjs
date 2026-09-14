import { chromium } from "playwright";

// Real 五手两打 game against the AI with the strong engine: verifies that the
// AI's opening placements and fifth-move offers are now engine-driven (slow,
// dataUrl-carrying) instead of instant heuristics.
const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 160)); });
page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 160)));

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
        if (message && message.type === "analyze") record.requests.push({ t: Math.round(performance.now()), engine: message.engine, hasDataUrl: Boolean(message.dataUrl), timeMs: message.timeMs, topN: message.topN || 1 });
        return originalPostMessage(message);
      };
      worker.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type === "ready") { record.ready = data.variant; window.__diag.events.push({ type: "ready", variant: data.variant }); }
        if (data.type === "result" && data.result) record.results.push({ t: Math.round(performance.now()), requestId: data.requestId });
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

await page.locator(".ai-game-setup").getByText("强力引擎").click();
const downloadButton = page.getByText("立即下载强力引擎包");
if (await downloadButton.isVisible().catch(() => false)) {
  await downloadButton.click();
  await page.getByText("已生效").first().waitFor({ timeout: 120000 });
}

// 规则 → 有禁手 → 五手两打
await page.locator(".ai-game-setup").getByText("有禁手").click();
await page.waitForTimeout(400);
await page.locator(".ai-game-setup").locator(".ai-float-list").getByText("五手两打").click();
await page.waitForTimeout(300);
await page.mouse.click(12, 400);
// 难度 → 大师
await page.locator(".ai-setup-cell.single").first().click();
await page.getByText("大师", { exact: true }).click();
await page.waitForTimeout(250);
await page.mouse.click(12, 400);
// 执白：AI 执黑（摆放 + 打点都由 AI 完成）
await page.locator(".ai-game-setup").getByText("执白").click();
await page.waitForTimeout(200);
await page.locator(".ai-game-setup").getByText("开始人机对战").click();
await page.waitForTimeout(600);

const board = page.locator(".renju-board");
await board.waitFor();
const box = await board.boundingBox();
if (!box) throw new Error("棋盘没有布局框");
const sx = box.width / 16;
const sy = box.height / 16;
const center = { x: box.x + sx * 8, y: box.y + sy * 8 };

const clickBoard = async (dx, dy) => {
  await page.mouse.click(center.x + dx * sx, center.y + dy * sy);
};

const waitForStones = async (count, timeoutMs = 60000) => {
  const started = Date.now();
  for (;;) {
    const current = await page.locator(".stone-piece").count();
    if (current >= count) return Date.now() - started;
    if (Date.now() - started > timeoutMs) throw new Error(`等待 ${count} 颗棋子超时（当前 ${current}）`);
    await page.waitForTimeout(250);
  }
};

// 黑1（AI，引擎）
let t = await waitForStones(1);
console.log(JSON.stringify({ step: "black1-ai", ms: t }));
// 白2（人类）
await clickBoard(2, 0);
await waitForStones(2);
// 黑3（AI，引擎）
t = await waitForStones(3);
console.log(JSON.stringify({ step: "black3-ai", ms: t }));
// 交换决定权在人类（白方）：出现提示就点保持/不交换
const swapButton = page.getByText("保持当前执子方").or(page.getByText("不交换")).first();
if (await swapButton.isVisible().catch(() => false)) { await swapButton.click(); console.log(JSON.stringify({ step: "swap-kept" })); }
await page.waitForTimeout(500);
// 白4（人类）
await clickBoard(-2, 1);
await waitForStones(4);
// AI 提供两个打点（引擎，topN=2）
t = await waitForStones(4, 5000);
const candidateReady = await page.locator(".opening-candidate").count();
for (let wait = 0; wait < 120 && candidateReady === 0; wait += 1) {
  if (await page.locator(".opening-candidate").count() > 0) break;
  await page.waitForTimeout(500);
}
const candidates = await page.locator(".opening-candidate").count();
console.log(JSON.stringify({ step: "fifths-offered", candidates }));
// 白方选择 A1（候选标记被棋盘热区覆盖，用坐标点击）
const candidateBox = await page.locator(".opening-candidate").first().boundingBox();
if (candidateBox) await page.mouse.click(candidateBox.x + candidateBox.width / 2, candidateBox.y + candidateBox.height / 2);
await waitForStones(5);
// 此后正常轮流：人类白6
await clickBoard(0, 2);
const diag = await page.evaluate(() => ({
  workers: window.__diag.workers.map((worker) => ({
    ready: worker.ready,
    requests: worker.requests,
    resultCount: worker.results.length,
    thinkMs: worker.requests.map((request, index) => worker.results[index] ? worker.results[index].t - request.t : null),
  })),
}));
console.log(JSON.stringify({ diag, consoleErrors: consoleErrors.slice(0, 5) }, null, 1));
await browser.close();
