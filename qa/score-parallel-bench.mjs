// 模板「评分」并行基准（2026-10-10）——保留为可复跑的探针。
//
// 结论（实测）：worker 并行做 scoreAt 是**可行且逐位一致**的
//   · 不降频（真实多核条件）：串行 315ms → 6 worker 136ms = **2.3×**
//   · 降频 6×：串行 4242ms → 130ms = 32.8× ← **这是假象**
//
// ⚠ 关于那个 32.8×：CDP 的 `Emulation.setCPUThrottlingRate` **只作用于主线程**，
// worker 线程不受影响。所以「降频模拟手机」在这类**跨线程**测量里会系统性夸大并行收益，
// 不能拿来预估手机上的效果。判断并行收益必须用**不降频**的数字（2.3×），
// 再按手机核数打折（6 核手机预期 2–4×，含 postMessage 通信与负载不均）。
//
// 这条探针本身也是「评分可以搬进 worker」的最小验证：
// 同一份数据、同一个评分函数、切给 N 个 worker，累加值逐位相同。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/score-parallel-bench.mjs
//   THROTTLE=0（默认，推荐）| 6（看假象）
import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const THROTTLE = Number(process.env.THROTTLE || 0);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
if (THROTTLE) { const c = await ctx.newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); }
await page.route("**/qa-spb.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body></body></html>" }));
await page.goto(new URL("qa-spb.html", base).toString(), { waitUntil: "domcontentloaded" });
const out = await page.evaluate(async () => {
  const SW = 400, pixels = SW * SW, INK = 600, TEMPLATES = 76, OFFSETS = 25, ROUNDS = 40;
  const gray = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) gray[i] = Math.sin(i * 0.013) * 100;
  const offs = [];
  for (let t = 0; t < TEMPLATES; t += 1) { const o = new Int32Array(INK); let s = 1234 + t * 7919; for (let i = 0; i < INK; i += 1) { s = (s * 1103515245 + 12345) & 0x7fffffff; o[i] = s % (pixels - SW); } offs.push(o); }
  const score = (o) => { let b = 0; for (let x = 0; x < OFFSETS; x += 1) { const base = (x % 5) * SW + ((x / 5) | 0); let d = 0; for (let i = 0; i < o.length; i += 1) d += gray[base + o[i]]; if (d > b) b = d; } return b; };
  const run = (l) => { let a = 0; for (let r = 0; r < ROUNDS; r += 1) for (const o of l) a += score(o); return a; };
  run(offs.slice(0, 2)); // 热身
  const t0 = performance.now(); const a = run(offs); const tSerial = performance.now() - t0;
  const src = `let gray,SW,INK,OFFSETS,ROUNDS,offs;const score=(o)=>{let b=0;for(let x=0;x<OFFSETS;x+=1){const base=(x%5)*SW+((x/5)|0);let d=0;for(let i=0;i<o.length;i+=1)d+=gray[base+o[i]];if(d>b)b=d;}return b;};
  self.onmessage=(e)=>{const m=e.data;if(m.type==="init"){gray=new Float32Array(m.gray);SW=m.sw;INK=m.ink;OFFSETS=m.offsets;ROUNDS=m.rounds;offs=[];for(let t=0;t<m.n;t+=1){const o=new Int32Array(INK);let s=1234+t*7919;for(let i=0;i<INK;i+=1){s=(s*1103515245+12345)&0x7fffffff;o[i]=s%(SW*SW-SW);}offs.push(o);}self.postMessage({type:"ready"});return;}
  if(m.type==="work"){let acc=0;for(let r=0;r<ROUNDS;r+=1)for(let i=m.start;i<m.end;i+=1)acc+=score(offs[i]);self.postMessage({type:"done",acc});}};`;
  const u = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const N = 6;
  const ws = Array.from({ length: N }, () => new Worker(u));
  await Promise.all(ws.map((w) => new Promise((res) => { w.onmessage = (e) => { if (e.data.type === "ready") res(); }; w.postMessage({ type: "init", gray: Array.from(gray), sw: SW, ink: INK, offsets: OFFSETS, rounds: ROUNDS, n: TEMPLATES }); })));
  const per = Math.ceil(TEMPLATES / N);
  const t1 = performance.now();
  const accs = await Promise.all(ws.map((w, i) => new Promise((res) => { w.onmessage = (e) => { if (e.data.type === "done") res(e.data.acc); }; w.postMessage({ type: "work", start: i * per, end: Math.min(TEMPLATES, (i + 1) * per) }); })));
  const tPar = performance.now() - t1;
  ws.forEach((w) => w.terminate()); URL.revokeObjectURL(u);
  return { tSerial: Math.round(tSerial), tPar: Math.round(tPar), ratio: Math.round((tSerial / tPar) * 10) / 10, a: Math.round(a), b: Math.round(accs.reduce((x, y) => x + y, 0)), cores: navigator.hardwareConcurrency };
});
console.log(`THROTTLE=${THROTTLE} | 串行 ${out.tSerial}ms / 6 worker ${out.tPar}ms → ${out.ratio}×（${out.cores} 逻辑核）`);
console.log(`累加核对：${out.a} vs ${out.b} → ${out.a === out.b ? "逐位一致 ✓" : "不一致 ✗"}`);
if (THROTTLE) console.log("⚠ 降频只作用于主线程，worker 不受影响 → 这个倍数是假象，请用 THROTTLE=0");
await browser.close();
