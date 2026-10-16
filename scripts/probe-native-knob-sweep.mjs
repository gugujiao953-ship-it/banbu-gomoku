/**
 * 临时探针：交错重复测量（A,B,C,A,B,C,A,B,C 同一局面），用来把「顺序/热度效应」和
 * 真实的旋钮差异分开。上一个 `.tmp-native-knob-sweep.mjs` 是正序跑一遍、反序跑一遍，
 * 结果内存档的排名会随次序漂，所以这里改成同一局面交错重复，并报每次的读数与中位数。
 *
 *   node scripts/.tmp-native-interleave.mjs
 */
const port = Number(process.env.CDP_PORT || 9222);
// SWEEP_TT=1：只横扫内存档（全核固定），用来找原生引擎的置换表甜点。
const sweepTt = process.env.SWEEP_TT === "1";
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
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true, timeout: 900000 } }));
});

const movesJson = (() => {
  let rngState = 20260915;
  const rng = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; };
  const size = 15;
  const board = Array.from({ length: size }, () => Array(size).fill(null));
  const hasFive = (row, col, player) => {
    for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let count = 1;
      for (const sign of [-1, 1]) for (let step = 1; board[row + dr * step * sign]?.[col + dc * step * sign] === player; step += 1) count += 1;
      if (count >= 5) return true;
    }
    return false;
  };
  const candidates = () => {
    const out = [];
    for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
      if (board[r][c] !== null) continue;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
        if (board[r + dr]?.[c + dc] !== null) { near = true; break; }
      }
      if (near) out.push([r, c]);
    }
    return out;
  };
  const moves = [];
  board[7][7] = "black"; moves.push({ row: 7, col: 7, player: "black" });
  while (moves.length < 18) {
    const pool = candidates();
    const [r, c] = pool[Math.floor(rng() * pool.length)];
    const player = moves.length % 2 === 0 ? "black" : "white";
    board[r][c] = player;
    if (hasFive(r, c, player)) { board[r][c] = null; continue; }
    moves.push({ row: r, col: c, player });
  }
  return JSON.stringify(moves);
})();

const result = await evaluate(`(async () => {
  const sweepTt = ${sweepTt};
  const plugin = window.Capacitor.Plugins.NativeEngine;
  const moves = ${movesJson};
  const worker = new Worker("./rapfi/rapfi-worker.js");
  let started = false;
  const errors = [];
  worker.addEventListener("message", (event) => {
    const m = event.data || {};
    if (m.type === "native-command") { plugin.write({ line: m.line }).catch((e) => errors.push(String(e))); return; }
    if (m.type === "native-start") {
      if (started) return;
      started = true;
      (async () => {
        try {
          await plugin.prepare();
          await plugin.addListener("stdout", (payload) => worker.postMessage({ type: "native-stdout", line: String(payload.line ?? "") }));
          await plugin.addListener("exit", (payload) => worker.postMessage({ type: "native-exit", code: Number(payload.code ?? -1) }));
          await plugin.start();
          worker.postMessage({ type: "native-ready", version: null, cores: 4 });
        } catch (error) { errors.push(String(error)); }
      })();
    }
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 60000);
    worker.onmessage = (event) => { if (event.data.type === "ready" || event.data.type === "error") { clearTimeout(timer); resolve(); } };
    worker.postMessage({ type: "warmup", engine: "auto", native: true, threads: 4 });
  });
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const measure = (config) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ hang: true }), 45000);
    worker.onmessage = (event) => {
      const m = event.data;
      if (m.type === "result") { clearTimeout(timer); resolve({ nodes: m.result.nodes, elapsedMs: Math.round(m.result.elapsedMs), depth: m.result.depth }); }
      if (m.type === "error") { clearTimeout(timer); resolve({ error: m.message }); }
    };
    worker.postMessage({
      type: "analyze", engine: "auto", size: 15, moves, player: "black", rule: "renju",
      timeMs: 6000, maxDepth: 512, topN: 1,
      continuous: false, finishOnBareMove: false, stopOnProvenWin: false,
      native: true, threads: config.threads, maxMemoryMb: config.maxMemoryMb,
    });
  });

  // SWEEP_TT=1 时只横扫内存档（全核固定），用来找原生引擎的置换表甜点
  const CONFIGS = sweepTt
    ? [
        { label: "全核·128MB", threads: -1, maxMemoryMb: undefined },
        { label: "全核·256MB", threads: -1, maxMemoryMb: 256 },
        { label: "全核·512MB", threads: -1, maxMemoryMb: 512 },
        { label: "全核·1024MB", threads: -1, maxMemoryMb: 1024 },
      ]
    : [
        { label: "自动2线程·128MB", threads: 0, maxMemoryMb: undefined },
        { label: "全核4线程·128MB", threads: -1, maxMemoryMb: undefined },
        { label: "全核4线程·256MB", threads: -1, maxMemoryMb: 256 },
        { label: "全核4线程·512MB", threads: -1, maxMemoryMb: 512 },
      ];
  const rows = [];
  // 交错三轮：每一轮都把四个配置按同一顺序跑一遍，配置间的「热度」才可比
  for (let round = 1; round <= 3; round += 1) {
    for (const config of CONFIGS) {
      const outcome = await measure(config);
      rows.push({ round, label: config.label, ...outcome, nps: outcome.nodes && outcome.elapsedMs ? Math.round(outcome.nodes / (outcome.elapsedMs / 1000)) : null });
    }
  }
  return JSON.stringify({ errors, rows });
})()`, true);

const parsed = JSON.parse(result.result.value);
console.log("引擎错误:", parsed.errors.length ? parsed.errors.slice(0, 2) : "无");
const grouped = new Map();
for (const row of parsed.rows) {
  if (!grouped.has(row.label)) grouped.set(row.label, []);
  grouped.get(row.label).push(row);
}
console.log("\n配置 | 三轮读数(k nps, 深度) | 中位数");
const summary = [];
for (const [label, rows] of grouped) {
  const values = rows.map((r) => r.nps).filter((v) => v !== null).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : 0;
  summary.push({ label, median });
  console.log(`${label} | ${rows.map((r) => `${Math.round((r.nps || 0) / 1000)}k(d${r.depth})`).join(" · ")} | ${Math.round(median / 1000)}k`);
}
summary.sort((a, b) => b.median - a.median);
console.log("\n排名（中位数）:", summary.map((s) => `${s.label}=${Math.round(s.median / 1000)}k`).join(" > "));
socket.close();
