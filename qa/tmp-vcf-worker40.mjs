/** tmp: 直接驱动 vcf-gen worker，测 depth 40 / 36 需要多久（区分「生成不出来」与「30s 被砍」） */
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const run = (depth, attacker, count, budgetReport) => page.evaluate(async ([depth, attacker, count]) => {
  const specs = [["puzzles/vcf-material.json", 0], ["puzzles/vcf-material-3.json", 1000000], ["puzzles/vcf-material-12.json", 2000000]];
  const lists = await Promise.all(specs.map(async ([f, off]) => {
    const r = await fetch("/" + f); const j = await r.json();
    return (j.items || []).map((it) => ({ ...it, i: it.i + off }));
  }));
  const items = lists.flat();
  const material = { v: 1, count: items.length, items };
  const w = new Worker("/src/features/vcf/vcf-gen.worker.ts", { type: "module" });
  const t0 = Date.now();
  const res = await new Promise((resolve) => {
    let last = null;
    w.onmessage = (e) => { if (e.data?.type === "progress") last = e.data; if (e.data?.type === "result") resolve({ ...e.data, progress: last }); };
    w.onerror = (e) => resolve({ type: "error", error: String(e.message || e) });
    const timer = setTimeout(() => resolve({ type: "outer-timeout" }), 120000);
    w.addEventListener("message", (e) => { if (e.data?.type === "result") clearTimeout(timer); });
    w.postMessage({ type: "generate", tier: depth > 12 ? "deep" : "middle", mode: "novel", count, seed: (Date.now() ^ 12345) >>> 0, material, depthRange: [13, 40], attacker, depth });
  });
  w.terminate();
  return { depth, attacker, count, ms: Date.now() - t0, type: res.type, n: res.puzzles?.length ?? 0, gotDepth: res.puzzles?.map((p) => p.depth), attempts: res.attempts, error: res.error ?? null };
}, [depth, attacker, count]);
console.log(JSON.stringify(await run(40, "black", 1)));
console.log(JSON.stringify(await run(36, "black", 1)));
console.log(JSON.stringify(await run(40, "black", 3)));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 4000))]);
