import { chromium } from "playwright";

// 识谱多核加速的**生产包**校验（手工脚本，不进正式门禁：它需要一个预览构建）。
// 正式门禁 qa/recognition-parallel-parity.mjs 跑在 dev 服务器上、走模块级导入；
// dev 里 Vite 给 worker 的是 module worker，而生产包给的是 classic iife worker
// ——手机上跑的是后者，所以这一层要单独验一次。
//
// 跑法：
//   npx vite build --outDir dist-recog-verify --emptyOutDir
//   npx vite preview --outDir dist-recog-verify --port 5298 --host 127.0.0.1
//   QA_BASE_URL=http://127.0.0.1:5298/ node qa/manual/recognition-parallel-production.mjs
//
// 端到端走真实 UI 全流程（底部导航 → 图片识谱 → 选图 → 对齐屏「识别」），断言：
//   1. 多核开启时确实创建了 Worker（证明生产构建里的 worker 资产能加载），
//   2. 关闭开关后不创建 Worker（走单线程），
//   3. 两次识别出的棋子数量一致（生产包下并行/串行结果相同）。
// 注意：识别完成看的是 .import-progress--complete 卡片，不是 .app-toast-message。
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5298/";
const fixture = process.env.RECOGNITION_PROD_FIXTURE || "qa/fixtures/recognition/paper02.jpg";

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const results = [];
let failed = false;

for (const enabled of [true, false]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript((on) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ fastRecognition: on }));
    const Original = window.Worker;
    window.__banbuWorkerSpawns = 0;
    window.Worker = class extends Original {
      constructor(...args) {
        window.__banbuWorkerSpawns += 1;
        super(...args);
      }
    };
  }, enabled);
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".renju-board").waitFor({ timeout: 60_000 });
  await page.locator(".bottom-nav .nav-center").click();
  await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
  await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
  // 对齐屏：默认框 + 右下角「识别」。
  const recognize = page.locator('.board-fs-action:has-text("识别")');
  await recognize.waitFor({ state: "visible", timeout: 30_000 });
  const started = Date.now();
  await recognize.click();
  const settled = page.locator(".import-progress--complete, .import-progress--error").first();
  await settled.waitFor({ state: "visible", timeout: 120_000 });
  const elapsed = Date.now() - started;
  const progressText = ((await page.locator(".import-progress").first().textContent()) || "").replace(/\s+/g, " ").trim();
  const stones = await page.locator(".stone-piece").count();
  const spawns = await page.evaluate(() => window.__banbuWorkerSpawns);
  await context.close();

  results.push({ enabled, stones, spawns, elapsed, progressText, errors });
}

await browser.close();
for (const row of results) {
  console.log(`${row.enabled ? "多核开" : "多核关"}  棋子 ${row.stones}  线程 ${row.spawns}  ${row.elapsed}ms  「${row.progressText.slice(0, 70)}」${row.errors.length ? `  错误: ${row.errors[0]}` : ""}`);
}
const [on, off] = results;
const problems = [];
if (on.spawns < 1) problems.push("多核模式没有创建 Worker（生产包里 worker 没生效）");
if (off.spawns !== 0) problems.push(`关闭开关后仍创建了 ${off.spawns} 个 Worker`);
if (!on.stones || on.stones !== off.stones) problems.push(`两种模式棋子数不同：开 ${on.stones} / 关 ${off.stones}`);
if (on.errors.length || off.errors.length) problems.push("页面报错");
if (problems.length) failed = true;
console.log(failed ? `生产包校验失败：${problems.join("；")}` : "生产包校验通过（全流程 + 结果一致）");
process.exitCode = failed ? 1 : 0;
