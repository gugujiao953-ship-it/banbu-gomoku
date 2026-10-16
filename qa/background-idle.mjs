/**
 * 门禁：切到后台之后，引擎必须**真的停下来**，回前台再自己接上。
 *
 * 为什么需要（2026-10-02 真机取证，Redmi marble / dumpsys activity exit-info）：
 *  用户报「引擎启动后把他切到后台去，过一会这个局面就没有了，之前的修改也没有了」。
 *  不是玄学，是被系统杀的，而杀掉它的是我们自己的引擎：
 *    16:16:28 切后台 → visibilitychange 正确写了 GTP `stop`（这一半本来就是对的）
 *    16:16:32 **持续分析的自愈保活 interval 在 hidden 下重新 startThink** → `kata-analyze 10`
 *    …连跑 5 分钟（importance=400＝后台缓存态）
 *    16:21:08 reason=9 EXCESSIVE RESOURCE USAGE / subreason=7 EXCESSIVE CPU USAGE
 *             "Caused by child process: excessive cpu 1113780 during 300304, limit=25"
 *             ≈ 3.7 个核心满速烧了 5 分钟 → 整个进程被杀 → WebView 冷启动
 *  于是「局面没了 + 没保存的改动没了」。所以这里守两条硬事实：
 *   ① hidden 之后节点数一个字都不许再涨（引擎没有新一轮）；
 *   ② 回前台必须重新开跑——只把引擎按死在后台，等于把「自动分析」变成一次性功能。
 *
 * 用法：QA_BASE_URL=http://127.0.0.1:5547/ node qa/background-idle.mjs
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5173/";
const targetURL = new URL(rawUrl);
targetURL.searchParams.set("qa", "1");
const url = targetURL.href;

const failures = [];
const check = (ok, message, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${message}${detail ? ` ｜${detail}` : ""}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 3, analysisCandidateMetric: "nodes" }));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event).slice(0, 140)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 摆一个能算的局面（与 analysis-continuity 同一组落点），开分析面板并点亮持续分析。
await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "打谱")?.click(); });
await page.waitForTimeout(1200);
for (const point of ["H8", "I9", "G7", "I7", "J10", "F9"]) {
  await page.getByRole("gridcell", { name: `${point}空位`, exact: true }).click();
}
await page.waitForTimeout(900);
await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "分析")?.click(); });
await page.waitForSelector(".ai-analysis-stats", { timeout: 20000 });
await page.evaluate(() => { const input = document.querySelector(".ai-analysis-head .analysis-toggle input"); if (input && !input.checked) input.click(); });

const readNodes = () => page.evaluate(() => {
  const parse = (text) => {
    const match = String(text || "").match(/([\d.]+)([kMB]?)/i);
    if (!match) return 0;
    const unit = match[2].toUpperCase();
    return Number(match[1]) * (unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1);
  };
  for (const span of document.querySelectorAll(".ai-analysis-stats > span")) {
    if ((span.querySelector("small")?.textContent || "").trim() === "节点") return parse(span.querySelector("b")?.textContent);
  }
  return -1;
});

const setVisibility = (state) => page.evaluate((next) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => next !== "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
}, state);

console.log("A 前台：先确认引擎确实在跑（否则后面「不涨」毫无意义）");
// Cold WASM/engine startup can exceed a fixed three-second pause. Await a
// real progress frame before comparing growth; absence of progress still fails.
await page.waitForFunction(() => [...document.querySelectorAll(".ai-analysis-stats > span")].some((span) =>
  span.querySelector("small")?.textContent?.trim() === "节点"
    && Number.parseFloat(span.querySelector("b")?.textContent || "0") > 0), null, { timeout: 45000 });
const running = await readNodes();
await page.waitForTimeout(2500);
const runningLater = await readNodes();
check(running > 0 && runningLater > running, "前台持续分析的节点数在涨", `${Math.round(running)} → ${Math.round(runningLater)}`);
if (!(running > 0 && runningLater > running)) {
  console.log("\n前置条件就没满足（引擎没在跑），这条门禁的其余断言无意义。");
  await browser.close();
  process.exit(1);
}

console.log("B 切后台：hidden 之后不许再有新一轮计算（真机那次是 4 秒后重新点火）");
await setVisibility("hidden");
await page.waitForTimeout(4000); // 旧轮的尾巴（正在收尾的一轮最多还会打几帧）留足余量
const hiddenStart = await readNodes();
await page.waitForTimeout(5000);
const hiddenEnd = await readNodes();
check(hiddenEnd === hiddenStart, "后台 5 秒内节点数零增长（没有新搜索被点火）", `${Math.round(hiddenStart)} → ${Math.round(hiddenEnd)}（差 ${Math.round(hiddenEnd - hiddenStart)}）`);

console.log("C 回前台：必须自己接上，不能把自动分析变成一次性功能");
await setVisibility("visible");
await page.waitForTimeout(9000);
const resumed = await readNodes();
check(resumed > hiddenEnd, "回前台后节点数继续增长（分析已续上）", `${Math.round(hiddenEnd)} → ${Math.round(resumed)}`);

check(errors.length === 0, "全程零页面错误", errors.slice(0, 2).join(" | "));

await browser.close();
if (failures.length) {
  console.log(`\n后台门禁失败：${failures.length} 条断言未通过`);
  process.exit(1);
}
console.log("\n后台门禁通过：切后台引擎真的停了，回前台自己续上。");
process.exit(0);
