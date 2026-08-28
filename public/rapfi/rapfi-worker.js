/* Classic worker bridge for the Rapfi WebAssembly build.
 * Protocol reference: https://github.com/dhbloo/gomoku-calculator
 * The file intentionally stays dependency-free so it can run under Vite,
 * Capacitor's static server, and a normal offline web server. */
let engine = null;
let loading = false;
let loadToken = 0;
let loadTimer = null;
const waiting = [];
let active = null;

const post = (message) => self.postMessage(message);
const ruleId = (rule) => rule === "renju" ? 2 : rule === "standard" ? 1 : 0;
const protocolPoint = (point, size) => `${point.col},${size - 1 - point.row},${point.player === "black" ? 1 : 2}`;
const otherPlayer = (player) => player === "black" ? "white" : "black";

function finish(request, move, stats) {
  if (!active || active !== request) return;
  const elapsedMs = performance.now() - request.started;
  active = null;
  post({
    type: "result",
    result: {
      move,
      score: 0,
      depth: stats.depth || 0,
      nodes: stats.nodes || 0,
      elapsedMs,
      illegalRejected: 0,
      reason: "rapfi",
      source: "rapfi",
      principalVariation: stats.bestline || [],
    },
  });
  drain();
}

function parseOutput(line) {
  if (!active || typeof line !== "string") return;
  const text = line.trim();
  if (!text) return;
  if (text.startsWith("INFO ")) {
    const match = text.match(/^INFO\s+(DEPTH|NODES|BESTLINE)\s+(.+)$/);
    if (!match) return;
    if (match[1] === "DEPTH") active.stats.depth = Number(match[2]) || 0;
    else if (match[1] === "NODES") active.stats.nodes = Number(match[2]) || 0;
    else if (match[1] === "BESTLINE") {
      active.stats.bestline = (match[2].match(/\d+,\d+/g) || []).map((value, index) => {
        const [col, y] = value.split(",").map(Number);
        return { row: active.size - 1 - y, col, player: index % 2 === 0 ? active.player : otherPlayer(active.player) };
      });
    }
    return;
  }
  const coordinates = text.match(/^(\d+),(\d+)(?:\s+(\d+),(\d+))?$/);
  if (!coordinates) return;
  const col = Number(coordinates[1]), y = Number(coordinates[2]);
  if (!Number.isInteger(col) || !Number.isInteger(y) || col < 0 || y < 0 || col >= active.size || y >= active.size) return;
  finish(active, { row: active.size - 1 - y, col }, active.stats);
}

function send(command) {
  if (engine) engine.sendCommand(command);
}

function run(request) {
  active = request;
  request.started = performance.now();
  request.stats = { depth: 0, nodes: 0, bestline: [] };
  send(`START ${request.size}`);
  send(`INFO RULE ${ruleId(request.rule)}`);
  send(`INFO TIMEOUT_TURN ${Math.max(1000, request.timeMs || 4000)}`);
  send(`INFO MAX_DEPTH ${Math.max(10, request.maxDepth || 64)}`);
  send(`INFO SHOW_DETAIL 2`);
  const board = request.moves.map((point) => protocolPoint(point, request.size)).join(" ");
  send(`YXBOARD${board ? ` ${board}` : ""} DONE`);
  send("YXNBEST 1");
}

function drain() {
  if (!engine || active || !waiting.length) return;
  run(waiting.shift());
}

function startVariant(variant) {
  importScripts(`./${variant}/rapfi-single.js`);
  const factory = self.Rapfi;
  if (typeof factory !== "function") throw new Error("Rapfi WASM 工厂未找到");
  return factory({
    locateFile: (name) => {
      const file = /^rapfi.*\.data$/.test(name) ? "rapfi.data" : name;
      return new URL(`./${variant}/${file}`, self.location.href).href;
    },
    onReceiveStdout: parseOutput,
    onReceiveStderr: (message) => post({ type: "log", message }),
    onExit: () => { engine = null; post({ type: "error", message: "Rapfi 已退出" }); },
    setStatus: (status) => post({ type: "status", status }),
    noExitRuntime: true,
  });
}

function clearLoadTimer() {
  if (loadTimer !== null) {
    clearTimeout(loadTimer);
    loadTimer = null;
  }
}

function finishLoad(token, instance, variant) {
  if (token !== loadToken) return;
  clearLoadTimer();
  engine = instance;
  loading = false;
  post({ type: "ready", variant });
  drain();
}

function startFallback(token) {
  Promise.resolve().then(() => startVariant("fallback")).then((instance) => {
    finishLoad(token, instance, "fallback");
  }).catch((error) => {
    if (token !== loadToken) return;
    loading = false;
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
}

function load() {
  if (loading || engine) return;
  loading = true;
  // Deliberately use the bundled engine only. Analysis stays offline and this
  // worker never downloads model data from a third-party host.
  const preferred = "fallback";
  const token = ++loadToken;
  Promise.resolve().then(() => startVariant(preferred)).then((instance) => {
    finishLoad(token, instance, preferred);
  }).catch((fullError) => {
    if (token !== loadToken) return;
    clearLoadTimer();
    loading = false;
    post({ type: "error", message: "Rapfi 本地 WASM 加载失败：" + (fullError instanceof Error ? fullError.message : String(fullError)) });
  });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "stop") {
    if (engine) engine.sendCommand("YXSTOP");
    if (active) { active = null; drain(); }
    return;
  }
  if (message.type !== "analyze") return;
  waiting.push({ ...message, size: message.size || 15 });
  load();
  drain();
};
