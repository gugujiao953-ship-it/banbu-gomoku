/**
 * 临时探针：在真机（MuMu）应用内跑一次真实分析，读分析面板的「深度/速度/节点」。
 * 目的：确认原生引擎在**应用真实流程**里拿到了多线程（速度应落在 200k+ 而不是 ~100k），
 * 而不是只有单元门禁的结论。
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node scripts/.tmp-inapp-analysis-speed.mjs
 */
const port = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((item) => item.type === "page");
if (!target) throw new Error("没有页面 target");
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const pageErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") pageErrors.push(String(message.params?.exceptionDetails?.text || "").slice(0, 120));
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 关掉首运行欢迎幕布，然后刷新到干净状态
await evaluate(`localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 5 }));`);
await send("Page.enable");
await send("Page.reload");
await sleep(6000);

const clickText = async (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
console.log("进入打谱:", (await clickText("打谱")).result.value);
await sleep(1500);
// 在棋盘上落几子，凑出一个有搜索量的中局
const placed = await evaluate(`(() => {
  const cells = [...document.querySelectorAll('[role="gridcell"]')];
  const wanted = ["H8", "I9", "G7", "I7", "J10"];
  let count = 0;
  for (const point of wanted) {
    const cell = cells.find((e) => (e.getAttribute('aria-label') || '').startsWith(point));
    if (cell) { cell.dispatchEvent(new MouseEvent('click', { bubbles: true })); count += 1; }
  }
  return count + "/" + cells.length;
})()`);
console.log("落子:", placed.result.value);
await sleep(1200);
// 先打开分析面板（统计行在面板里），再打开持续分析
console.log("打开分析面板:", (await clickText("分析")).result.value);
await sleep(1500);
const toggled = await evaluate(`(() => { const input = document.querySelector('.ai-analysis-head .analysis-toggle input'); if (!input) return "missing"; if (!input.checked) input.click(); return "on"; })()`);
console.log("持续分析:", toggled.result.value);
const samples = [];
for (let i = 0; i < 6; i += 1) {
  await sleep(3000);
  const stats = await evaluate(`document.querySelector('.ai-analysis-stats')?.textContent?.replace(/\\s+/g, ' ').trim() || '(none)'`);
  samples.push(stats.result.value);
  console.log(`sample${i}: ${stats.result.value}`);
}
const engine = await evaluate(`JSON.stringify({ native: window.__banbuNativeEngine ?? null, cores: navigator.hardwareConcurrency })`);
console.log("引擎探测:", engine.result.value);
console.log("页面错误:", pageErrors.length ? pageErrors.slice(0, 3) : "无");
socket.close();
