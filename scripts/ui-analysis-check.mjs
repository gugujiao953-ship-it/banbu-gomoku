import { chromium } from "playwright";

// UI flow check: rolling auto-analysis (depth must keep climbing across samples),
// candidates ranked descending, no deadlock after moves.
// 流程注意（2026-09-14）：为验证强力引擎，本脚本先经设置页下载引擎包，而离开
// 打谱页会按设计关掉持续分析；回到打谱后必须再用面板头部开关把分析打开，否则
// 采样全是「-」（脚本曾因此长期打出空值，误看成节点冻结）。末行会给爬升判定。
// Rolling auto-analysis UI regression. Usage:
//   BANBU_URL=http://127.0.0.1:4173 node scripts/ui-analysis-check.mjs   (production: pack downloads from Pages)
//   BANBU_URL=http://localhost:5199 node scripts/ui-analysis-check.mjs   (dev: pack from same-origin middleware)
const url = process.env.BANBU_URL || "http://127.0.0.1:4173/";
const downloadWait = process.env.PACK_DOWNLOAD_WAIT ? Number(process.env.PACK_DOWNLOAD_WAIT) : 45000;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  for (const r of navigator.serviceWorker?.getRegistrations ? [] : []) r.unregister();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  // User path: leave the engine choice at its default (light) — a completed
  // download must auto-switch to strong and analysis must actually use full.
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: true, analysisCandidateCount: 5, analysisTimeMs: 2000, analysisShowCandidates: true }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
// download pack via in-app flow (dev same-origin middleware)
await page.evaluate(() => { [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '设置')?.click(); });
await page.waitForTimeout(2000);
const dl = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(e => (e.textContent||'').includes('下载强力引擎包'));
  if (btn) { btn.click(); return true; }
  return false;
});
if (dl) {
  const deadline = Date.now() + downloadWait + 60000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    const state = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("banbu-engine-pack-state-v1") || "null"); } catch { return null; } });
    if (state && state.version === 3) break;
  }
}
console.log("pack:", await page.evaluate(() => localStorage.getItem("banbu-engine-pack-state-v1")));
console.log("engine-choice-after-dl:", await page.evaluate(() => localStorage.getItem("banbu-ai-engine-choice-v1")));
await page.evaluate(() => { [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '打谱')?.click(); });
await page.waitForTimeout(500);
for (const p of ["H8", "G9"]) {
  await page.evaluate((pt) => { const cell = [...document.querySelectorAll('[role="gridcell"]')].find(e => (e.getAttribute('aria-label')||'').startsWith(pt)); cell?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, p);
  await page.waitForTimeout(600);
}
await page.evaluate(() => { [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '分析')?.click(); });
await page.waitForTimeout(400);
// 首行「分析」只是打开分析面板；持续分析总开关在面板头部（analysisAuto）。而且
// 离开打谱页（上面为了下载引擎包进过设置页）会按 09-13 的设计自动关掉持续分析
// ——不显式打开的话面板会一直停在「深度-评估分-…-节点-」，看起来像节点冻结，
// 实际是分析压根没启动（本脚本原流程就栽在这里，2026-09-14 修正）。
const switched = await page.evaluate(() => {
  const input = document.querySelector('.ai-analysis-head .analysis-toggle input');
  if (!input) return "missing";
  if (input.checked) return "already-on";
  input.click();
  return "turned-on";
});
console.log("analysis-switch:", switched);
const samples = [];
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(4000);
  const s = await page.evaluate(() => ({
    stats: document.querySelector('.ai-analysis-stats')?.textContent?.replace(/\s+/g, ' ').trim() || "(none)",
    cands: [...document.querySelectorAll('.analysis-candidate-chip')].map(e => e.textContent?.trim()).join(" | ") || "",
  }));
  console.log(`sample${i}: ${s.stats}  ${s.cands}`);
  samples.push(s.stats);
}
// 观测脚本也要能一眼看出坏没坏：深度/节点必须随时间真的爬升。
const depthOf = (t) => Number((t.match(/深度\s*(\d+)/) || [])[1] || 0);
const nodesOf = (t) => Number(((t.match(/节点\s*([\d,]+)/) || [])[1] || "").replace(/,/g, "") || 0);
const depths = samples.map(depthOf);
const nodes = samples.map(nodesOf);
console.log(depths[depths.length - 1] > depths[0] && nodes[nodes.length - 1] > nodes[0]
  ? `OK 深度/节点随时间爬升：深度 ${depths.join("→")}｜节点 ${nodes.join("→")}`
  : `SUSPECT 深度/节点未爬升（分析未启动或冻结）：深度 ${depths.join("→")}｜节点 ${nodes.join("→")}`);
// 选点数量下拉：切到 2 选后候选点数量随动（2026-09-14：旧的
// `.ai-analysis-pick-count select` 已被面板头部 PanelSelect 取代）。
const pick = await page.evaluate(() => {
  const trigger = document.querySelector('.panel-select-trigger[aria-label="选点数量"]');
  if (!trigger) return { present: false };
  const before = document.querySelectorAll('.analysis-candidate-chip').length;
  trigger.click();
  return { present: true, label: trigger.textContent?.trim(), chipsBefore: before };
});
await page.waitForTimeout(300);
await page.evaluate(() => { [...document.querySelectorAll('.panel-select-menu [role="option"]')].find((el) => el.textContent?.trim() === "2 选")?.click(); });
await page.waitForTimeout(5000);
const pick2 = await page.evaluate(() => ({ chipsAfter: document.querySelectorAll('.analysis-candidate-chip').length }));
console.log("pick:", JSON.stringify({ ...pick, ...pick2 }));
// 候选点交互预览：点击面板候选按钮 → 棋盘出现 ghost 变化预览；再点消失。
// 「变化连线」开关默认关闭：预览只出现带序号的预览棋子，不应有线；且预览期间
// 候选点圆标上的胜率等指标文本暂时隐藏（避免与预览棋子互相干扰）。
const preview = await page.evaluate(() => {
  const chip = document.querySelector('.ai-analysis-candidates .analysis-candidate-chip');
  if (!chip) return { chip: false };
  chip.click();
  return { chip: true };
});
await page.waitForTimeout(500);
const on = await page.evaluate(() => ({
  ghosts: document.querySelectorAll('.analysis-preview-stone').length,
  lines: document.querySelectorAll('.analysis-preview-line line').length,
  metricLabels: document.querySelectorAll('.analysis-candidate-point text').length,
  selected: !!document.querySelector('.analysis-candidate-chip.selected'),
  highlight: !!document.querySelector('.analysis-candidate-point.candidate-active'),
  stillThinking: !!document.querySelector('.ai-analysis-stats'),
}));
// 打开「选点小数位」→ 候选列表的小数位随动（胜率出现小数点；0 位时不出现）
await page.evaluate(() => { document.querySelector('.panel-select-trigger[aria-label="选点小数位数"]')?.click(); return true; });
await page.waitForTimeout(200);
await page.evaluate(() => { [...document.querySelectorAll('.panel-select-menu [role="option"]')].find((el) => el.textContent?.trim() === "1 位")?.click(); return true; });
await page.waitForTimeout(400);
const decimalOn = await page.evaluate(() => ({
  chipsWithDot: [...document.querySelectorAll('.analysis-candidate-chip em')].filter((el) => (el.textContent || "").includes(".")).length,
  chipTexts: [...document.querySelectorAll('.analysis-candidate-chip em')].map((el) => el.textContent?.trim()).join(" | ") || "",
}));
// 取消预览 + 小数位关回 0 位
await page.evaluate(() => { document.querySelector('.analysis-candidate-chip.selected')?.click(); return true; });
await page.waitForTimeout(200);
await page.evaluate(() => { document.querySelector('.panel-select-trigger[aria-label="选点小数位数"]')?.click(); return true; });
await page.waitForTimeout(200);
await page.evaluate(() => { [...document.querySelectorAll('.panel-select-menu [role="option"]')].find((el) => el.textContent?.trim() === "0 位")?.click(); return true; });
await page.waitForTimeout(400);
const off = await page.evaluate(() => ({
  ghosts: document.querySelectorAll('.analysis-preview-stone').length,
  lines: document.querySelectorAll('.analysis-preview-line line').length,
  metricLabelsBack: document.querySelectorAll('.analysis-candidate-point text').length,
  dotsAfterReset: [...document.querySelectorAll('.analysis-candidate-chip em')].filter((el) => (el.textContent || "").includes(".")).length,
}));
console.log("preview:", JSON.stringify({ preview, on, decimalOn, off }));
// 换一手再观察（不应挂死）
await page.evaluate(() => { [...document.querySelectorAll('[role="gridcell"]')].find(e => (e.getAttribute('aria-label')||'').startsWith("I10"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await page.waitForTimeout(7000);
const s2 = await page.evaluate(() => document.querySelector('.ai-analysis-stats')?.textContent?.replace(/\s+/g, ' ').trim());
console.log("after-new-move:", s2);
console.log("errors:", errs.join(" ;; ") || "none");
await browser.close();
