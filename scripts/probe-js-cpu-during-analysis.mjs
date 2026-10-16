/**
 * 临时探针：分析运行时，WebView 的 JS 线程到底吃掉多少 CPU。
 *
 * 为什么量这个：手机上原生引擎会开 N 个线程（全核 = 核心数），而 WebView 的 JS/渲染
 * 线程跟它抢同一批核心。如果 JS 侧每个节点流都在忙于解析 stdout、跑 React 渲染，等于
 * 从引擎嘴里抢走一部分算力——那「减少 JS 工作量」就是一条真实可榨的路径；如果 JS 占用
 * 很低，这条路就不用走了。
 *
 * 用 CDP 的 Performance.getMetrics 取 ScriptDuration/TaskDuration 的增量（这是真实
 * JS 执行时间，不是我用 MutationObserver 数 DOM 那种无效度量）。
 *
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node scripts/.tmp-js-cpu-during-analysis.mjs
 */
const port = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((item) => item.type === "page");
if (!target) throw new Error("没有页面 target");
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const evaluate = (expression, awaitPromise = false) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true, timeout: 200000 } }));
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
await call("Performance.enable");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metrics = async () => {
  const result = await call("Performance.getMetrics");
  return Object.fromEntries(result.metrics.map((m) => [m.name, m.value]));
};

const metric = process.env.METRIC === "depth" ? "depth" : "winRate";
await evaluate(`localStorage.setItem("banbu-first-run-welcome-v1","true"); localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 1, analysisCandidateMetric: ${JSON.stringify(process.env.METRIC === "depth" ? "depth" : "winRate")} }));`);
await call("Page.enable");
await call("Page.reload");
await wait(7000);
const cores = (await evaluate(`navigator.hardwareConcurrency`)).result.value;
console.log(`设备核心数: ${cores} · 候选显示内容: ${metric}`);

// 走真实 UI：打谱 → 落子 → 打开分析 → 开持续分析
await evaluate(`[...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '打谱')?.click()`);
await wait(1500);
await evaluate(`(() => { const cells = [...document.querySelectorAll('[role="gridcell"]')]; const wanted = ["H8", "I9", "G7", "I7", "J10", "F9"]; for (const p of wanted) cells.find((e) => (e.getAttribute('aria-label') || '').startsWith(p))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
await wait(1200);
await evaluate(`[...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '分析')?.click()`);
await wait(1500);
await evaluate(`(() => { const input = document.querySelector('.ai-analysis-head .analysis-toggle input'); if (input && !input.checked) input.click(); })()`);

// 先跑 3 秒把引擎/包预热稳定；期间反复确认分析面板真的开着（上个探针可能把界面留在了设置页）
for (let i = 0; i < 12; i += 1) {
  const ready = (await evaluate(`Boolean(document.querySelector('.ai-analysis-stats'))`)).result.value;
  if (ready) break;
  await evaluate(`[...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '分析')?.click()`);
  await wait(800);
  await evaluate(`(() => { const input = document.querySelector('.ai-analysis-head .analysis-toggle input'); if (input && !input.checked) input.click(); })()`);
  await wait(700);
}
await wait(3000);
const before = await metrics();
const t0 = Date.now();
await wait(10000);
const after = await metrics();
const wallMs = Date.now() - t0;

const delta = (key) => (after[key] ?? 0) - (before[key] ?? 0);
const scriptMs = delta("ScriptDuration") * 1000;
const taskMs = delta("TaskDuration") * 1000;
const layoutMs = delta("LayoutDuration") * 1000;
const recalcMs = delta("RecalcStyleDuration") * 1000;
const stats = (await evaluate(`document.querySelector('.ai-analysis-stats')?.textContent?.replace(/\\s+/g, ' ').trim() || '(none)'`)).result.value;

console.log(`\n窗口 ${wallMs}ms（引擎在跑持续分析）`);
console.log(`  JS 脚本执行      ${Math.round(scriptMs)}ms  = 单核的 ${(scriptMs / wallMs * 100).toFixed(1)}%`);
console.log(`  渲染任务总计      ${Math.round(taskMs)}ms  = 单核的 ${(taskMs / wallMs * 100).toFixed(1)}%`);
console.log(`  其中 布局/样式    ${Math.round(layoutMs)} / ${Math.round(recalcMs)}ms`);
console.log(`  相对整机算力      ${((scriptMs / wallMs) / cores * 100).toFixed(2)}%（设 ${cores} 核都被引擎占满）`);
console.log(`  统计行: ${stats}`);
socket.close();
