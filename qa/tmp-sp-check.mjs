// 核查上一轮 34.9× 是否有假：对比「同一份工作」串行 vs 并行的真实比例。
import { chromium } from "playwright";
const base = "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
const c = await ctx.newCDPSession(page);
await c.send("Emulation.setCPUThrottlingRate", { rate: 6 });
await page.route("**/qa-c.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body></body></html>" }));
await page.goto(new URL("qa-c.html", base).toString(), { waitUntil: "domcontentloaded" });
const out = await page.evaluate(async () => {
  const SW = 400, pixels = SW * SW, INK = 600, TEMPLATES = 76, OFFSETS = 25, ROUNDS = 40;
  const gray = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) gray[i] = Math.sin(i * 0.013) * 100;
  const offs = [];
  for (let t = 0; t < TEMPLATES; t += 1) { const off = new Int32Array(INK); let seed = 1234 + t * 7919; for (let i = 0; i < INK; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; off[i] = seed % (pixels - SW); } offs.push(off); }
  const score = (off) => { let best = 0; for (let ox = 0; ox < OFFSETS; ox += 1) { const base = (ox % 5) * SW + ((ox / 5) | 0); let dot = 0; for (let i = 0; i < off.length; i += 1) dot += gray[base + off[i]]; if (dot > best) best = dot; } return best; };
  const run = (list) => { let acc = 0; for (let r = 0; r < ROUNDS; r += 1) for (const o of list) acc += score(o); return acc; };
  // 让 JIT 先热身，避免把编译时间算进去
  run(offs.slice(0, 2));
  const t0 = performance.now(); const a = run(offs); const tSerial = performance.now() - t0;

  // 并行：每个 worker 干 1/N 的活，主线程只等
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
  return {
    tSerial: Math.round(tSerial), tPar: Math.round(tPar),
    ratio: Math.round((tSerial / tPar) * 10) / 10,
    a: Math.round(a), b: Math.round(accs.reduce((x, y) => x + y, 0)),
    cores: navigator.hardwareConcurrency,
  };
});
console.log(`串行 ${out.tSerial}ms / 并行(${6} worker) ${out.tPar}ms → ${out.ratio}×（${out.cores} 逻辑核）`);
console.log(`累加核对：${out.a} vs ${out.b} → ${out.a === out.b ? "一致" : "不一致"}`);
await browser.close();
