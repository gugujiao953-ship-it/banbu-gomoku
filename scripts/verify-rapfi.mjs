import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (message) => console.log(`[page:${message.type()}] ${message.text()}`));
await page.goto(process.env.BANBU_URL || "http://127.0.0.1:5181/", { waitUntil: "domcontentloaded" });
const engineVariant = process.env.AI_ENGINE || "fallback";
const dataUrl = process.env.AI_DATA_URL || "";
const result = await page.evaluate(({ engine, data }) => new Promise((resolve) => {
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const timer = setTimeout(() => { worker.terminate(); resolve({ ok: false, error: "Rapfi 载入或思考超过 20 秒" }); }, 20000);
  worker.onmessage = (event) => {
    if (event.data.type === "status") console.log(`status: ${event.data.status}`);
    if (event.data.type === "ready") console.log(`ready: ${event.data.variant}`);
    if (event.data.type === "log") console.log(`log: ${event.data.message}`);
    if (event.data.type === "error") { clearTimeout(timer); worker.terminate(); resolve({ ok: false, error: event.data.message }); }
    if (event.data.type === "result") { clearTimeout(timer); worker.terminate(); resolve({ ok: true, result: event.data.result }); }
  };
  worker.postMessage({ type: "analyze", engine, dataUrl: data || undefined, size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju", timeMs: 1200, maxDepth: 20 });
}), { engine: engineVariant, data: dataUrl });
console.log(JSON.stringify(result));
await browser.close();
if (!result.ok) process.exitCode = 1;
