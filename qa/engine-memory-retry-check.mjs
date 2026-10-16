/**
 * 引擎内存降级重试的**行为**门禁（2026-10-11）。
 *
 * ## 守的是什么
 *
 * 用户报「电脑网页版人机对战**总是**显示『AI 引擎未能分配内存，本局已改用内置备用引擎；
 * 可调低「分析内存」后重试』…**一直报错**」。根因是个真 bug：
 *
 * ```
 * gameMemoryRetryRef.current = 256;                       // 失败时记下降级值
 * // 重试 → 但发出去的还是原高档值，因为那条 postMessage 没读这个 ref
 * maxMemoryMb: engineMemoryMbFor(engineChoice, settings.analysisMaxMemoryMb)
 * ```
 *
 * 后果：每一手都走一遍"失败 → 记 256 → 重试（仍高档）→ 再失败 → 换兜底引擎"，
 * 于是用户看到"一直报错"，而该降的档位**永远降不下去**。
 *
 * 这类 bug 类型系统抓不到、代码读起来也完全正常（那个赋值语句本身没问题），
 * 所以单测（`src/features/ai/engine-memory.test.ts`）钉住**决策函数**，
 * 这条门禁钉住**真的接上了** —— 两者缺一不可：单测能证明
 * `resolveAnalyzeMemoryMb` 语义正确，但证明不了调用方用了它。
 *
 * ## 怎么验的
 *
 * 注入一个假 Worker 拦下 rapfi 的 analyze：第一轮故意回一条 error
 * （模拟"引擎分配失败、进程退出"），看**第二轮**的 `maxMemoryMb` 是不是降级值。
 * 不看提示文案（那只是话术），只看**真发出去的数字**。
 *
 * 跑法：先起 dev/preview（默认 4401，可用 QA_BASE_URL 覆盖），再 node 本文件。
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4401/";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  // 高档位（这样降级才有意义）
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisMaxMemoryMb: 1024 }));
  Object.defineProperty(navigator, "deviceMemory", { get: () => 16, configurable: true });

  // @ts-ignore
  window.__analyzeSends = [];
  // @ts-ignore
  window.__failFirstRapfi = true;

  const OriginalWorker = window.Worker;
  // @ts-ignore
  window.Worker = class extends OriginalWorker {
    constructor(url, options) {
      super(url, options);
      const name = String(url).split("/").pop();
      // 只拦 rapfi（内置轻量引擎那个 worker 是我们的兜底，不拦）
      if (name !== "rapfi-worker.js") return;
      const originalPost = this.postMessage.bind(this);
      this.postMessage = (message, transfer) => {
        if (message?.type === "analyze") {
          // @ts-ignore
          const sends = window.__analyzeSends;
          sends.push({ engine: message.engine, mem: message.maxMemoryMb ?? null });
          // 第一轮 analyze 故意回"引擎退出"，模拟内存分配失败
          // @ts-ignore
          if (window.__failFirstRapfi) {
            // @ts-ignore
            window.__failFirstRapfi = false;
            window.setTimeout(() => {
              this.dispatchEvent(new MessageEvent("message", { data: { type: "error", message: "out of memory" } }));
            }, 120);
            return;   // 不发真消息
          }
        }
        return originalPost(message, transfer);
      };
    }
  };
});

const page = await context.newPage();
const target = new URL(BASE);
target.searchParams.set("qa", "1");
await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(1200);
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(600);
await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
await page.waitForTimeout(1500);
const start = page.locator('[role="dialog"] button', { hasText: /开始人机对战|开始对局/ }).first();
if (await start.count()) { await start.click(); await page.waitForTimeout(6000); }

// 装 toast 观察器（提示文案也要看：它得如实说"降到了多少"）
await page.evaluate(() => {
  // @ts-ignore
  window.__toasts = [];
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.className || "").includes("toast")) {
          // @ts-ignore
          window.__toasts.push((node.textContent || "").replace(/\s+/g, " ").trim());
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
});

// 落一手触发 AI 思考
await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[role="gridcell"]')];
  const target = cells.find((cell) => (cell.getAttribute("aria-label") || "").startsWith("H8")) || cells[Math.floor(cells.length / 2)];
  target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(14000);

const sends = await page.evaluate(() => window.__analyzeSends || []);
const toasts = await page.evaluate(() => window.__toasts || []);

console.log("analyze 发送序列:", JSON.stringify(sends));
console.log("toast:", JSON.stringify(toasts));

check("发生了降级重试（至少两轮 analyze）", sends.length >= 2, JSON.stringify(sends));
if (sends.length >= 2) {
  const [first, second] = sends;
  check("第一轮用用户档位（1024）", first.mem === 1024, `mem=${first.mem}`);
  check("**第二轮用降级值（256）—— 修之前这里还是 1024**",
    second.mem === 256,
    `mem=${second.mem}（修之前会一直是 ${first.mem}，于是每一手都失败一遍）`);
  check("两轮的引擎档位一致（降的是内存、不是引擎）", first.engine === second.engine, `${first.engine} vs ${second.engine}`);
}
check("提示如实说明降到了多少", toasts.some((text) => /降至 256MB/.test(text)), JSON.stringify(toasts));

await browser.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("失败项：");
  for (const item of failed) console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  process.exit(1);
}
