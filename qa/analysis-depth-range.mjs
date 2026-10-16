/**
 * 门禁：统计行五格齐全 + 深度显示成「X-Y」区间（来自引擎 INFO SELDEPTH）。
 *
 * 为什么值得单独立门禁：这个区间曾经**静默失效**——解析 SELDEPTH 的正则里混进了一个
 * 退格控制字符（工具链转义写坏），匹配永远失败、selDepth 恒为 0，界面就只剩一个数字。
 * 那种坏法不会报错、不会崩，只是「功能看着做了却从来没生效」，所以要有断言盯着。
 *
 * 用户 09-16 两次反馈的收口验证：
 *  ① 「速度/评估分/胜率/节点 你不要他们了吗」→ 断言五格标签与顺序
 *  ② 「还是没有看到最小最大的样子」→ 断言深度文本匹配 /^\d+(-\d+)?$/ 且跑到一定深度后
 *     应该出现两段式（SELDEPTH > DEPTH）
 * 用法：node scripts/.tmp-depth-range-check.mjs
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5193/";
// 必须带 ?qa=1：否则首运行欢迎页的幕布会挡住「打谱」，点击超时（本项目的老坑）。
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 1 }));
});
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
// 精确点底部导航的「打谱」：DOM 里第一个含「打谱」的按钮不一定是它
// （历史上功能区加过「边界栏」按钮、现在默认的自动换行模式下没有，但开「横向滚动」时
//  那两枚箭头按钮在起点是 disabled，getByRole().first() 一样会点不到）。
await page.evaluate(() => [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click());
await page.waitForTimeout(1200);
// 逐颗点、中间留一次渲染的时间：原来这 5 次点击写在同一个 evaluate 里同步派发，
// 慢机器上只有前面几颗落得下去（React 还没提交，后一次读到的还是旧光标）。
// 手数直接决定「轮到谁」，而胜率标签是按行棋方写的（谁在走显示谁的胜率），
// 于是同一份门禁会在 黑方胜率/白方胜率 之间飘 —— 下面改成按盘上实际手数推期望值。
for (const p of ["H8", "I9", "G7", "I7", "J10"]) {
  await page.evaluate((point) => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')];
    cells.find((e) => (e.getAttribute("aria-label") || "").startsWith(point))?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, p);
  await page.waitForTimeout(320);
}
await page.waitForTimeout(900);
await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "分析")?.click(); });
await page.waitForSelector(".ai-analysis-stats", { timeout: 20000 });
await page.evaluate(() => { const input = document.querySelector(".ai-analysis-head .analysis-toggle input"); if (input && !input.checked) input.click(); });

let sawRange = null;
let lastLabels = "";
let lastStones = 0;
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(2500);
  const snap = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".ai-analysis-stats > span")].map((node) => ({
      label: (node.querySelector("small")?.textContent || "").trim(),
      value: (node.querySelector("b")?.textContent || "").trim(),
    }));
    return { cells, stones: document.querySelectorAll("#board .stone-piece").length, depthTitle: document.querySelector(".ai-analysis-stats .stat-depth")?.getAttribute("title") || "" };
  });
  lastLabels = snap.cells.map((c) => c.label).join("/");
  lastStones = snap.stones;
  const depth = snap.cells.find((c) => c.label === "深度")?.value || "";
  console.log(`sample${i}: ${snap.cells.map((c) => `${c.label}=${c.value}`).join(" | ")}`);
  if (/^\d+-\d+$/.test(depth)) { sawRange = depth; break; }
}

console.log("\n--- 判定 ---");
if (!sawRange) { console.log("FAIL 未出现两段式深度：SELDEPTH 解析可能又失效了（检查 worker 的 selDepth 正则）"); process.exitCode = 1; }
else console.log(`OK 深度出现区间显示：${sawRange}`);
console.log(`统计行标签顺序：${lastLabels}`);
const labels = lastLabels.split("/");
// 胜率那一格按行棋方写（谁在走就显示谁的胜率，见 App.tsx 的 moverWinRateLabel）：
// 盘上偶数颗＝黑方待走，奇数颗＝白方待走。写死「黑方胜率」会把这份门禁挂在运气上。
const mover = lastStones % 2 === 1 ? "白方胜率" : "黑方胜率";
const expected = ["深度", "速度", "评估分", mover, "节点"];
if (JSON.stringify(labels) !== JSON.stringify(expected)) { console.log(`FAIL 统计行标签不符，期望 ${expected.join("/")}（盘上 ${lastStones} 颗），实际 ${lastLabels}`); process.exitCode = 1; }
else console.log("OK 五格齐全且顺序正确");
await browser.close();
