import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 识谱多核加速门禁（用户 09-14：用手机的处理器与内存加速图片识谱）。
 *
 * 这个门禁守三件事：
 *   A. **结果不变**：同一张图分别用单线程与多核并行识别，逐位对照完整输出
 *      （局面、序号、置信度、被忽略标注数、提示文案）。并行只是把「算」交给
 *      多个线程，判定规则仍在主线程按原顺序执行，所以两条路径必须一字不差。
 *   B. **真的用了多核**：断言并行那一次确实创建了 Worker。只比对结果是不够的
 *      ——池子在任何异常下都会静默回落单线程，那样 A 会轻松通过却什么也没加速。
 *   C. **设置项在位**：设置页「可选增强功能」里有「识谱多核加速」，新用户默认
 *      开启，关掉后落盘为 false（下次进来仍关）。
 *
 * 跑法：需要 dev 服务器（模块级导入 /src/image-recognition.ts），
 *   npm run dev -- --port 5173
 *   QA_BASE_URL=http://127.0.0.1:5173/ node qa/recognition-parallel-parity.mjs
 * 覆盖更多语料（含书谱纸面图）：
 *   RECOGNITION_PARITY_FIXTURES=public/.tmp-bench node qa/recognition-parallel-parity.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const fixtureDir = resolve(process.env.RECOGNITION_PARITY_FIXTURES || "qa/fixtures/recognition");
const FIXTURES = readdirSync(fixtureDir)
  .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
  .sort();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  // 数 Worker 构造次数：用来证明并行那次真的开了线程，而不是静默回落。
  await context.addInitScript(() => {
    const Original = window.Worker;
    window.__banbuWorkerSpawns = 0;
    window.Worker = class extends Original {
      constructor(...args) {
        window.__banbuWorkerSpawns += 1;
        super(...args);
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  // A/B 段跑在一个同源的空白宿主页上（由请求拦截直接给出），不加载应用：
  // 应用页在 dev 下会被 SW 复位中间件导航一次，长跑的 evaluate 会被打断。
  await page.route("**/qa-recognition-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><meta charset=\"utf-8\"><title>recognition parity host</title></head><body></body></html>",
  }));

  // ---------- A + B：并行与单线程逐位对照 ----------
  await page.goto(new URL("qa-recognition-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  const fixtures = FIXTURES.map((name) => ({ name, b64: readFileSync(resolve(fixtureDir, name)).toString("base64") }));
  const rows = await page.evaluate(async (items) => {
    const mod = await import("/src/image-recognition.ts");
    const out = [];
    for (const item of items) {
      const blob = await (await fetch("data:image/png;base64," + item.b64)).blob();
      const run = async (parallel) => {
        const before = window.__banbuWorkerSpawns;
        const result = await mod.recognizeBoardImage(new File([blob], item.name, { type: "image/png" }), 15, { parallel });
        return {
          spawned: window.__banbuWorkerSpawns - before,
          fingerprint: JSON.stringify({
            boardSize: result.boardSize,
            board: result.board,
            numberedMoves: result.numberedMoves,
            confidence: result.confidence,
            ignoredColoredMarkers: result.ignoredColoredMarkers,
            note: result.note,
          }),
        };
      };
      const serial = await run(false);
      const parallel = await run(true);
      out.push({ name: item.name, serialSpawned: serial.spawned, parallelSpawned: parallel.spawned, identical: serial.fingerprint === parallel.fingerprint });
    }
    return out;
  }, fixtures);

  for (const row of rows) {
    assert(row.identical, `${row.name}：多核与单线程识别结果不一致（并行路径改变了判定结果）`);
    assert(row.serialSpawned === 0, `${row.name}：单线程模式不应创建 Worker，实际创建了 ${row.serialSpawned} 个`);
    assert(row.parallelSpawned >= 1, `${row.name}：多核模式没有创建 Worker，说明已静默回落单线程（等于没加速）`);
  }
  console.log(`[recognition-parallel] 逐位一致 ${rows.length}/${rows.length} 张，多核线程创建数 ${rows.map((row) => row.parallelSpawned).join("/")}`);

  // ---------- C：设置项在位、默认开启、可关闭 ----------
  const coresSeen = await page.evaluate(() => navigator.hardwareConcurrency);
  await page.goto(new URL("?qa=1", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  // 等应用挂载完成再点：设置页是 CSR 渲染的，domcontentloaded 早于首个界面。
  await page.waitForSelector(".app-shell", { timeout: 30_000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  // 设置搜索「识谱加速」：既证明这一项能被搜到，也让「可选增强功能」分区展开。
  await page.getByLabel("搜索设置").fill("识谱加速");
  const row = page.locator('.enhancement-settings .setting-row:has-text("识谱多核加速")').first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  assert(await page.locator('.enhancement-settings .setting-row:has-text("识谱多核加速")').count() === 1,
    "设置页「可选增强功能」里的识谱加速行应当唯一");
  const toggle = row.locator('input[type="checkbox"]');
  assert(await toggle.isChecked(), "识谱多核加速默认应当开启（新用户出厂即开）");
  const explanation = (await row.locator("small").first().innerText()).trim();
  assert(explanation.length >= 12, `识谱加速行的说明文案过短：「${explanation}」`);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "null"));
  assert(stored === null || stored.fastRecognition !== false, "新用户存档里不应把识谱加速写成关闭");

  await toggle.click();
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "null"));
  assert(closed && closed.fastRecognition === false, "关闭识谱加速后没有落盘为 false");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 30_000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("搜索设置").fill("识谱加速");
  const afterReload = page.locator('.enhancement-settings .setting-row:has-text("识谱多核加速") input[type="checkbox"]').first();
  await afterReload.waitFor({ state: "visible", timeout: 15_000 });
  assert(!(await afterReload.isChecked()), "重载后识谱加速又被打开了（应当记住用户的关闭）");

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`[recognition-parallel] 设置项在位、默认开启、可关闭并持久化（本机 hardwareConcurrency=${coresSeen}）`);
  console.log("[recognition-parallel] pass");
} finally {
  await browser.close();
}
