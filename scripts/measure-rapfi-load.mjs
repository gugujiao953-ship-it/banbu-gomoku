import { chromium } from "playwright";

const engineVariant = process.env.AI_ENGINE || "auto";
const dataUrl = process.env.AI_DATA_URL || "";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(process.env.BANBU_URL || "http://127.0.0.1:5181/", { waitUntil: "domcontentloaded" });
const outcome = await page.evaluate(({ engine, data }) => new Promise((resolve) => {
  const started = performance.now();
  const worker = new Worker("./rapfi/rapfi-worker.js");
  const timer = setTimeout(() => { worker.terminate(); resolve({ ok: false, error: "load timeout 60s" }); }, 60000);
  worker.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "ready") {
      clearTimeout(timer);
      resolve({ ok: true, variant: data.variant, loadMs: Math.round(performance.now() - started) });
      worker.terminate();
    }
    if (data.type === "error") { clearTimeout(timer); resolve({ ok: false, error: data.message }); worker.terminate(); }
  };
  worker.onerror = () => { clearTimeout(timer); resolve({ ok: false, error: "worker error" }); };
  worker.postMessage({ type: "analyze", engine, dataUrl: data || undefined, size: 15, moves: [{ row: 7, col: 7, player: "black" }], player: "white", rule: "renju", timeMs: 300, maxDepth: 8 });
}), { engine: engineVariant, data: dataUrl });
console.log(JSON.stringify({ requested: engineVariant, ...outcome }));
await browser.close();
if (!outcome.ok) process.exitCode = 1;
