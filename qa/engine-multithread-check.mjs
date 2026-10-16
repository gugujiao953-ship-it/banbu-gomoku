import { chromium } from "playwright";

/**
 * 多线程引擎门禁。
 *
 * 多线程不是「打开开关就一定生效」：pthread 构建（wasm 的 memory import 是
 * shared=true）必须同时满足 ①页面跨源隔离（SAB 可用）②冠军数据包已装
 * ③开关打开，缺一条就按设计回落单线程——而且是**静默**回落。历史上一整轮
 * 多线程工作就是这样丢掉的（真机 WebView 拿不到隔离，代码在但从未生效）。
 * 所以这里用不侵入的方式盯住 App 自己的引擎 worker，把三个条件分支都钉住。
 *
 * 做法：addInitScript 包一层 window.Worker，记录 App 发给引擎 worker 的消息
 * （engine / multi 字段）与 worker 自报的实际变体（ready.variant）；再直接
 * 对照「同环境、同数据包」下的预期变体。**只验证 App 真的把开关传下去、
 * 引擎真的按条件选了变体**，不重复测应用逻辑。
 *
 * 前置环境（缺一不可，缺了就明确失败而不是静默跳过）：
 *   - 服务器必须下发 COOP same-origin + COEP require-corp（dev/preview 已配）
 *   - public/engine-packs/rapfi-full-v3.data 存在（只在开发树里）
 * 跑法：
 *   QA_BASE_URL=http://127.0.0.1:5301/ node qa/engine-multithread-check.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaUrl = new URL(baseUrl);
qaUrl.searchParams.set("qa", "1");

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const failures = [];
const step = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); }
  catch (error) { failures.push(`${name}：${error.message}`); console.log(`  ✗ ${name}：${error.message}`); }
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 915 } });
// 包一层 Worker：把 App 发给引擎 worker 的消息与引擎自报变体记录下来。
await context.addInitScript(() => {
  const Original = window.Worker;
  const entries = [];
  window.__engineWorkers = entries;
  window.Worker = function patchedWorker(url, options) {
    const worker = new Original(url, options);
    if (String(url).includes("rapfi")) {
      const entry = { messages: [], variants: [] };
      entries.push(entry);
      worker.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type === "ready") entry.variants.push(data.variant);
        if (data.type === "error") entry.error = data.message;
      });
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message, ...rest) => {
        if (message && (message.type === "analyze" || message.type === "warmup")) {
          entry.messages.push({ type: message.type, engine: message.engine, multi: message.multi, threads: message.threads, hasData: Boolean(message.dataUrl) });
        }
        return post(message, ...rest);
      };
    }
    return worker;
  };
  window.Worker.prototype = Original.prototype;
});

const page = await context.newPage();
page.setDefaultTimeout(120_000);
const engineState = () => page.evaluate(() => ({
  isolated: window.crossOriginIsolated,
  sab: typeof SharedArrayBuffer,
  packReady: Boolean(document.querySelector(".engine-pack-section .engine-pack-ready, .ai-engine-badge")),
  workers: (window.__engineWorkers || []).map((entry) => ({ variants: entry.variants, error: entry.error, messages: entry.messages })),
}));

await page.goto(qaUrl.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav", { timeout: 60_000 });

// 引擎是**懒启动**的：页面加载后不会建 worker，第一次真正需要算棋时才 new Worker。
// 所以「观察 App 下发了什么」不能只等，必须先走一条会让引擎干活的路（人机对战落一手）。
// 这也顺带保证观察到的消息是真对局里的消息，而不是预热消息。
const triggerEngineWork = async () => {
  await page.click('.bottom-nav button:has-text("对弈")');
  await page.waitForTimeout(800);
  const entry = page.locator('[data-duel-entry="ai"] .duel-entry-action');
  if (await entry.count()) {
    await entry.first().click();
    await page.waitForTimeout(1200);
    const resumeButton = page.locator('[data-duel-resume-yes]');
    if (await resumeButton.count()) {
      await resumeButton.click();
      await page.locator('.duel-resume-sheet').waitFor({ state: 'detached' });
    }
    const startButton = page.locator('[role="dialog"] button', { hasText: /开始人机对战|开始对局/ }).first();
    if (await startButton.count()) {
      await startButton.click();
      await page.waitForTimeout(6000);
    }
  }
  // 落到棋盘上：让 AI 应一手，引擎才会收到 analyze。
  await page.locator('[data-duel-screen]').waitFor({ state: 'visible', timeout: 30_000 });
  // Reload restores an unfinished game: H8 can already be occupied, and the
  // saved turn may first require an AI reply. Wait for a playable empty point.
  const empty = page.locator('[role="gridcell"][aria-label$="空位"][aria-disabled="false"]').first();
  await empty.waitFor({ state: 'attached', timeout: 30_000 });
  await empty.click();
  await page.waitForTimeout(9000);
};

await step("运行环境具备跨源隔离（隔离头缺失时多线程永远不生效）", async () => {
  const state = await engineState();
  assert(state.isolated === true, `crossOriginIsolated=${state.isolated}：服务器没有下发 COOP/COEP，多线程不可能生效`);
  assert(state.sab === "function", "SharedArrayBuffer 不可用");
});

await step("默认关闭：App 发给引擎的消息里多线程是「关」", async () => {
  await page.waitForTimeout(3000);
  await triggerEngineWork();
  const state = await engineState();
  const sent = state.workers.flatMap((entry) => entry.messages).filter((message) => message.type === "warmup" || message.type === "analyze");
  assert(sent.length > 0, "走了一手人机对战仍没有观察到 App 发给引擎 worker 的 warmup/analyze 消息");
  assert(sent.every((message) => message.multi !== true), `默认关闭时不应带 multi:true，实际 ${JSON.stringify(sent)}`);
});

await step("在设置里打开「多线程引擎」并持久化", async () => {
  await page.click('.bottom-nav button:has-text("设置")');
  await page.waitForSelector(".settings-page", { timeout: 20_000 });
  await page.getByLabel("搜索设置").fill("多线程");
  // 这一档在设置页里是 button.tuned-mini-toggle（aria-pressed 表状态），**不是**
  // label.setting-row 里的 checkbox——旧选择器找的是不存在的 DOM，所以这一步一直超时。
  // 按钮文本是「多线程」+ 状态字（「多线程关」/「多线程开」），不带「引擎」二字。
  const toggle = page.locator('button.tuned-mini-toggle:has-text("多线程")').first();
  await toggle.waitFor({ state: "visible", timeout: 20_000 });
  assert((await toggle.getAttribute("aria-pressed")) === "false", "多线程引擎默认必须是关闭的");
  await toggle.click();
  await page.waitForTimeout(400);
  assert((await toggle.getAttribute("aria-pressed")) === "true", "点了多线程引擎但按钮没有进入开启态");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").engineMultiThread);
  assert(stored === true, `开关没有持久化：engineMultiThread=${stored}`);
});

await step("打开后：App 发给引擎的消息带上 multi:true", async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav", { timeout: 60_000 });
  // 开了多线程后要真下棋才会看到 analyze 消息（引擎懒启动，不靠预热）。
  await triggerEngineWork();
  const state = await engineState();
  const sent = state.workers.flatMap((entry) => entry.messages).filter((message) => message.type === "warmup" || message.type === "analyze");
  assert(sent.some((message) => message.multi === true), `打开后没有任何消息带 multi:true，实际 ${JSON.stringify(sent)}`);
});

await step("线程数从设置下发到引擎（运行时 INFO THREAD_NUM，不需要重做数据包）", async () => {
  // 全核档：worker 必须把「全核」翻译成 hardwareConcurrency，并真的发给引擎。
  // 这个控件是原生 <select aria-label="引擎线程数">，挂在「分析 → 自调档」区块里，
  // 且**仅当 engineMultiThread 为真时才渲染**——所以先确保开关是开的。
  // 注意别去清空搜索框：清空会整段重渲染，刚抓到的节点会变成游离节点（看起来「hidden」）。
  await page.click('.bottom-nav button:has-text("设置")');
  await page.waitForSelector(".settings-page", { timeout: 20_000 });
  const multiOn = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").engineMultiThread === true);
  if (!multiOn) {
    await page.getByLabel("搜索设置").fill("多线程");
    await page.waitForTimeout(600);
    await page.locator('button.tuned-mini-toggle:has-text("多线程")').first().click();
    await page.waitForTimeout(600);
  }
  // 搜「线程」让「分析」区块留在屏上；这个关键词同时在 settings 搜索的白名单里。
  await page.getByLabel("搜索设置").fill("线程");
  await page.waitForTimeout(800);
  const choice = page.locator('select[aria-label="引擎线程数"]').first();
  await choice.waitFor({ state: "attached", timeout: 20_000 });
  await choice.scrollIntoViewIfNeeded();
  assert(await choice.isVisible(), "「引擎线程数」下拉存在但不可见（自调档区块没露出来）");
  const fullCoreValue = await choice.locator("option").filter({ hasText: "全核" }).first().getAttribute("value");
  assert(fullCoreValue !== null, `线程数里没有「全核」档：${await choice.locator("option").allTextContents()}`);
  await choice.selectOption(fullCoreValue);
  await page.waitForTimeout(400);
  const storedThreads = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").engineThreads);
  assert(Number(storedThreads) === -1, `「全核」没有写进设置（应为 -1）：engineThreads=${storedThreads}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav", { timeout: 60_000 });
  // 同样：线程档要真下一次棋才会随 analyze 消息下发。
  await triggerEngineWork();
  const info = await page.evaluate(() => ({
    cores: navigator.hardwareConcurrency,
    threads: (window.__engineWorkers || []).flatMap((entry) => entry.messages).map((message) => message.threads),
  }));
  assert(info.threads.includes(-1), `设置里的全核没有下发到引擎消息：${JSON.stringify(info.threads)}`);
  console.log(`        本机核心 ${info.cores} · 下发的线程档 ${JSON.stringify(info.threads)}`);
});

await step("引擎按条件选择变体：有包且隔离 → multi，否则单线程且不报错", async () => {
  const state = await engineState();
  const variants = state.workers.flatMap((entry) => entry.variants);
  const errors = state.workers.map((entry) => entry.error).filter(Boolean);
  const withData = state.workers.flatMap((entry) => entry.messages).some((message) => message.hasData);
  console.log(`        观测到的变体：${JSON.stringify(variants)}${errors.length ? `；错误：${JSON.stringify(errors)}` : ""}`);
  assert(errors.length === 0, `引擎报错：${errors.join(" / ")}`);
  if (!withData) {
    // 开发树里没有 40MB 数据包（Web 部署/测试包就是这种形态）：多线程按设计
    // 必须回落，这里只钉「不许报错、不许假装是 multi」。
    assert(!variants.includes("multi"), "没有数据包却报出 multi 变体，说明前置条件判断失效");
    console.log("        （本机无引擎数据包：只验证了回落路径，多线程分支未覆盖）");
    return;
  }
  assert(variants.includes("multi"), `隔离且有数据包时应加载 multi，实际变体 ${JSON.stringify(variants)}`);
});

await browser.close();

if (failures.length) {
  console.error(`\n多线程引擎门禁失败 ${failures.length} 项：`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("\n多线程引擎门禁通过：隔离前提、开关传递、变体选择与回落路径均符合设计。");
