import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const shots = "qa/.device-frames";
mkdirSync(shots, { recursive: true });
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("https://localhost"));
if (!page) throw new Error("找不到页面");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
// 开分析面板 + 打开「持续分析」（不落子、不动棋谱）
console.log("开面板:", JSON.stringify(await page.evaluate(() => window.__bb.click("分析"))));
await page.waitForTimeout(900);
console.log("点持续分析:", await page.evaluate(() => { const el = document.querySelector('input[aria-label="持续分析"]'); if (!el) return "no-toggle"; el.click(); return "clicked"; }));
let live = false;
for (let i = 0; i < 40; i += 1) {
  const s = await page.evaluate(() => ({ cand: document.querySelectorAll(".analysis-candidate-point").length, depth: (document.querySelector(".ai-analysis-stats .stat-depth b") || {}).textContent || "-" }));
  if (s.cand > 0) { console.log(`候选点出现 @${i}s：`, JSON.stringify(s)); live = true; break; }
  await page.waitForTimeout(1000);
}
if (!live) console.log("40s 内没有候选点（引擎可能还在起）");
// 仪表：候选层 / 读数 的变更频率
const rep = await page.evaluate(async () => {
  const cells = () => Array.from(document.querySelectorAll(".analysis-candidate-point")).map((g) => g.getAttribute("aria-label") || "").join("|");
  const stats = () => Array.from(document.querySelectorAll(".ai-analysis-stats b")).map((b) => b.textContent).join("|");
  let candN = 0, statN = 0, lastC = cells(), lastS = stats();
  const t0 = performance.now();
  const iv = setInterval(() => {
    const c = cells(); if (c !== lastC) { lastC = c; candN += 1; }
    const s = stats(); if (s !== lastS) { lastS = s; statN += 1; }
  }, 50);
  await new Promise((r) => setTimeout(r, 20000));
  clearInterval(iv);
  return { seconds: (performance.now() - t0) / 1000, candN, statN, finalStats: stats(), candShown: document.querySelectorAll(".analysis-candidate-point").length };
});
console.log(`真机 20s：候选层变更 ${rep.candN} 次（${(rep.candN / rep.seconds).toFixed(2)}/秒）｜读数变更 ${rep.statN} 次（${(rep.statN / rep.seconds).toFixed(2)}/秒）｜当前候选 ${rep.candShown} 个`);
console.log("最终读数（深度|速度|评估分|胜率|节点）:", rep.finalStats);
// 高帧率截图：棋盘区域的逐帧像素变化
const rect = await page.evaluate(() => { const r = document.querySelector("svg#board").getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
const stamps = [];
for (let i = 0; i < 24; i += 1) { const t = Date.now(); await page.screenshot({ path: `${shots}/d${String(i).padStart(2, "0")}.png`, clip: rect }); stamps.push(Date.now() - t); }
console.log("截图间隔(ms):", stamps.slice(1, 12).join(","));
// 收尾：关掉持续分析与面板
await page.evaluate(() => { const el = document.querySelector('input[aria-label="持续分析"]'); if (el) el.click(); });
await page.waitForTimeout(800);
await page.evaluate(() => window.__bb.click("分析"));
console.log("页面错误:", errors.length ? errors.slice(0, 3) : "无");
await browser.close();
