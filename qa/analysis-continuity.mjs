/**
 * 临时探针：持续分析 60 秒的连续性体检。
 * 回答用户三问：① 会不会「跑着卡一下」 ② 有没有被别的计算叠加影响 ③ 节点/计算量会不会被重置重算。
 * 每秒采样一次：节点、深度区间、速度、候选点计算量。
 *
 * 用法：QA_BASE_URL=http://[::1]:5173/ node qa/analysis-continuity.mjs
 * （它在本仓登记成了正式门禁 qa:full 的一员，所以**必须认环境变量**：
 *   以前这里写死 http://127.0.0.1:5193/ 且不给覆盖入口，跑 qa:full 时只会连不上而失败。）
 */
import { chromium } from "playwright";
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5173/";
const targetURL = new URL(rawUrl);
targetURL.searchParams.set("qa", "1");
const url = targetURL.href;
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 3, analysisCandidateMetric: "nodes" }));
});
const page = await context.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "打谱"); b?.click(); });
await page.waitForTimeout(1200);
for (const point of ["H8", "I9", "G7", "I7", "J10", "F9"]) {
  await page.getByRole("gridcell", { name: `${point}空位`, exact: true }).click();
}
await page.waitForTimeout(900);
await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "分析")?.click(); });
await page.waitForSelector(".ai-analysis-stats", { timeout: 20000 });
await page.evaluate(() => { const i = document.querySelector(".ai-analysis-head .analysis-toggle input"); if (i && !i.checked) i.click(); });

const parse = (t) => {
  const num = (s) => { const m = String(s || "").match(/([\d.]+)([kMB]?)/i); if (!m) return 0; const u = m[2].toUpperCase(); return Number(m[1]) * (u === "K" ? 1e3 : u === "M" ? 1e6 : u === "B" ? 1e9 : 1); };
  const cells = {};
  for (const sp of document.querySelectorAll(".ai-analysis-stats > span")) {
    const k = (sp.querySelector("small")?.textContent || "").trim();
    cells[k] = (sp.querySelector("b")?.textContent || "").trim();
  }
  const chips = [...document.querySelectorAll(".analysis-candidate-chip em")].map((e) => e.textContent.trim());
  return { cells, chips, nodes: num(cells["节点"]), depth: cells["深度"], speed: num(cells["速度"]), chipVals: chips.map(num) };
};
const samples = [];
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1000);
  const raw = await page.evaluate(parse);
  samples.push({ t: i + 1, ...raw });
}
const nodes = samples.map((s) => s.nodes);
const speeds = samples.map((s) => s.speed);
// 重置检测：节点相对上一秒下降
const drops = samples.slice(1).filter((s, i) => s.nodes < samples[i].nodes * 0.98).map((s) => `t=${s.t}s ${samples[s.t - 2].nodes}→${s.nodes}`);
// 跳变检测：相邻秒节点增量的突变（>4 倍中位增量，或 < 1/4）
const deltas = samples.slice(1).map((s, i) => s.nodes - samples[i].nodes).filter((d) => d > 0).sort((a, b) => a - b);
const med = deltas[Math.floor(deltas.length / 2)] || 0;
const spikes = samples.slice(1).map((s, i) => ({ t: s.t, d: s.nodes - samples[i].nodes })).filter((x) => med && (x.d > med * 4 || (x.d > 0 && x.d < med / 4)));
// 深度回退检测
const depthNums = samples.map((s) => Number((s.depth.match(/^(\d+)/) || [])[1] || 0)).filter((n) => n > 0);
const depthDrops = depthNums.slice(1).filter((n, i) => n < depthNums[i]).length;
console.log(`采样 ${samples.length} 秒`);
console.log(`节点：${nodes[0]} → ${nodes[nodes.length - 1]}（末值/首值 = ${(nodes[nodes.length - 1] / Math.max(1, nodes[0])).toFixed(1)}×）`);
console.log(`节点重置/下降次数：${drops.length}${drops.length ? " → " + drops.slice(0, 5).join(" | ") : ""}`);
console.log(`速度：中位 ${Math.round(speeds.filter(Boolean).sort((a,b)=>a-b)[Math.floor(speeds.filter(Boolean).length/2)] / 1000)}k，min ${Math.round(Math.min(...speeds.filter(Boolean)) / 1000)}k，max ${Math.round(Math.max(...speeds.filter(Boolean)) / 1000)}k`);
console.log(`节点增量中位数：${Math.round(med / 1000)}k/秒；异常跳变 ${spikes.length} 次${spikes.length ? " → " + spikes.slice(0, 5).map((s) => `t=${s.t}s ${Math.round(s.d/1000)}k`).join(" | ") : ""}`);
console.log(`深度回退次数：${depthDrops}`);
console.log(`深度轨迹：${samples.filter((_, i) => i % 10 === 0).map((s) => s.depth).join(" → ")}`);
console.log(`秒速低点(<25%中位)：${speeds.filter((v) => v && v < med / 4).length} 次`);
console.log("页面错误:", errs.length ? errs.slice(0, 3) : "无");
await browser.close();
const failures = [];
if (!nodes.some((value) => value > 0) || nodes.at(-1) <= nodes[0]) failures.push("采样期间节点没有持续增长");
if (drops.length) failures.push(`节点重置或下降 ${drops.length} 次`);
if (depthDrops) failures.push(`深度回退 ${depthDrops} 次`);
if (errs.length) failures.push(`页面异常 ${errs.length} 次`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
