/**
 * 读安卓设备/模拟器上**我们应用自己的 WebView** 的真实能力（跨源隔离、SAB、核心数）
 * 与引擎实际变体，用于判断「某个能力在安卓端到底能不能用」。
 *
 * 为什么必需：安卓端的问题无法靠桌面推断——本轮就是靠它测出「注入 COOP/COEP 后
 * crossOriginIsolated 依然是 false（平台限制）」，以及「注入 COEP 会把引擎 worker
 * 拦死（coep-frame-resource-needs-coep-header）」。
 *
 * WebView 的 CDP 不支持 Browser 级域（Playwright 的 connectOverCDP 会在
 * Browser.setDownloadBehavior 上失败），所以直接连页面 target 的 WebSocket，
 * 只用 Runtime.evaluate —— 这也是安卓侧唯一能读到 WebView 内部状态的通道。
 *
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node scripts/.tmp-android-webview-probe.mjs
 */
const port = Number(process.env.CDP_PORT || 9222);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((item) => item.type === "page");
if (!target) throw new Error(`没有页面 target：${JSON.stringify(list).slice(0, 300)}`);
console.log("页面:", target.url, "|", target.title);

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
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true, timeout: 150000 } }));
});

const capability = await evaluate(`JSON.stringify({
  crossOriginIsolated: window.crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer,
  atomicsWait: typeof Atomics?.wait,
  hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: navigator.deviceMemory ?? null,
  sharedMemoryProbe: (() => { try { new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }); return "成功"; } catch (e) { return "失败: " + String(e).slice(0, 60); } })(),
  swControlled: Boolean(navigator.serviceWorker?.controller),
  location: location.href,
  ua: navigator.userAgent.slice(0, 90)
})`);
console.log("能力:", capability.result.value);

// 多线程变体能不能真的加载：直接问 worker（超时 100s）。
const engine = await evaluate(`new Promise((resolve) => {
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const timer = setTimeout(() => resolve(JSON.stringify({ timeout: true })), 100000);
  worker.onmessage = (event) => {
    const m = event.data || {};
    if (m.type === "ready") { clearTimeout(timer); resolve(JSON.stringify({ variant: m.variant })); }
    if (m.type === "error") { clearTimeout(timer); resolve(JSON.stringify({ error: m.message })); }
  };
  worker.postMessage({ type: "warmup", engine: "auto", multi: true, threads: -1 });
})`, true);
console.log("引擎预热:", engine.result.value);
socket.close();
