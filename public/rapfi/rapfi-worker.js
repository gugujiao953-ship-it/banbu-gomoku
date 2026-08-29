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
  if (request.finishTimer) { clearTimeout(request.finishTimer); request.finishTimer = null; }
  // The engine's final coordinate is authoritative. A search can finish
  // between a PV refresh and the bestmove line, so reconcile the PV0 entry
  // before exposing Top-N candidates.
  const finalKey = `${move.row}:${move.col}`;
  const matching = stats.candidates.find((candidate) => `${candidate.move.row}:${candidate.move.col}` === finalKey);
  const stalePrimary = stats.candidates.findIndex((candidate) => candidate.pvIndex === 0 && `${candidate.move.row}:${candidate.move.col}` !== finalKey);
  if (stalePrimary >= 0) stats.candidates.splice(stalePrimary, 1);
  const rawPrimaryLine = stats.primaryBestline?.length ? stats.primaryBestline : stats.bestline || [];
  const primaryLine = [{ row: move.row, col: move.col, player: request.player }, ...rawPrimaryLine.filter((point) => point.row !== move.row || point.col !== move.col)];
  if (matching) {
    Object.assign(matching, { move, pvIndex: -1, score: stats.primaryScore ?? stats.score, winRate: stats.primaryWinRate ?? stats.winRate, principalVariation: primaryLine });
  } else stats.candidates.push({ move, pvIndex: -1, score: stats.primaryScore ?? stats.score, winRate: stats.primaryWinRate ?? stats.winRate, principalVariation: primaryLine });
  const elapsedMs = performance.now() - request.started;
  active = null;
  const candidates = (stats.candidates || []).slice().sort((a, b) => (a.pvIndex ?? 99) - (b.pvIndex ?? 99)).slice(0, request.nBest).map((candidate) => ({
    move: candidate.move,
    ...(candidate.score === undefined ? {} : { score: candidate.score }),
    ...(candidate.winRate === undefined ? {} : { winRate: candidate.winRate }),
    principalVariation: candidate.principalVariation?.length ? candidate.principalVariation : stats.bestline || [],
  }));
  const primary = candidates[0];
  post({
    type: "result",
    result: {
      move,
      // A missing score is materially different from a neutral score. Keep
      // the legacy numeric field for callers, but expose availability below.
      score: primary?.score ?? 0,
      depth: stats.depth || 0,
      nodes: stats.totalNodes || stats.nodes || 0,
      elapsedMs,
      illegalRejected: 0,
      reason: "rapfi",
      source: "rapfi",
      principalVariation: primaryLine,
    ...(stats.primaryWinRate === undefined ? stats.winRate === undefined ? {} : { winRate: stats.winRate } : { winRate: stats.primaryWinRate }),
    ...(stats.primaryScore === undefined && stats.score === undefined ? {} : { scoreAvailable: true }),
      candidates: candidates.length ? candidates : undefined,
    },
  });
  drain();
}

function normalizeWinRate(value) {
  if (!Number.isFinite(value)) return undefined;
  const normalized = Math.abs(value) > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function parseCoordinateList(value, size, player) {
  return (String(value).match(/\d+,\d+/g) || []).map((pair, index) => {
    const [col, y] = pair.split(",").map(Number);
    if (col < 0 || y < 0 || col >= size || y >= size) return null;
    return { row: size - 1 - y, col, player: index % 2 === 0 ? player : otherPlayer(player) };
  }).filter(Boolean);
}

function parseInfo(text) {
  const result = {};
  const depth = text.match(/(?:^|\s)(?:DEPTH|depth)\s+(-?\d+)/);
  const nodes = text.match(/(?:^|\s)(?:NODES|nodes)\s+(-?\d+)/);
  const score = text.match(/(?:^|\s)(?:SCORE|score|VALUE|value|EVAL|eval|V)\s+(?:CP\s+)?(-?(?:\d+(?:\.\d+)?|\.\d+))/i);
  const winRate = text.match(/(?:^|\s)(?:WINRATE|winrate|WR|wr|WDL)\s*[:=]?\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*%?/i);
  if (depth) result.depth = Number(depth[1]);
  if (nodes) result.nodes = Number(nodes[1]);
  if (score) result.score = Number(score[1]);
  if (winRate) result.winRate = normalizeWinRate(Number(winRate[1]));
  return result;
}

function rememberCandidate(request, move) {
  const stats = request.stats;
  const key = `${move.row}:${move.col}`;
  const existing = (stats.candidates || []).find((candidate) => `${candidate.move.row}:${candidate.move.col}` === key);
  const next = {
    move,
    pvIndex: stats.pvIndex,
    ...(stats.score === undefined ? {} : { score: stats.score }),
    ...(stats.winRate === undefined ? {} : { winRate: stats.winRate }),
    principalVariation: stats.bestline || [],
  };
  if (existing) Object.assign(existing, next);
  else stats.candidates.push(next);
}

function parseOutput(line) {
  if (!active || typeof line !== "string") return;
  const text = line.trim();
  if (!text) return;
  if (text.startsWith("INFO ")) {
    const match = text.match(/^INFO\s+(DEPTH|NODES|BESTLINE)\s+(.+)$/);
    const parsed = parseInfo(text);
    const pvIndex = text.match(/^INFO\s+PV\s+(\d+)$/i);
    if (pvIndex) active.stats.pvIndex = Number(pvIndex[1]);
    if (parsed.depth !== undefined) active.stats.depth = parsed.depth;
    if (parsed.nodes !== undefined) active.stats.nodes = parsed.nodes;
    const totalNodes = text.match(/^INFO\s+TOTALNODES\s+(\d+)$/i);
    if (totalNodes) active.stats.totalNodes = Number(totalNodes[1]);
    if (parsed.score !== undefined) active.stats.score = parsed.score;
    if (parsed.winRate !== undefined) active.stats.winRate = parsed.winRate;
    if (match?.[1] === "BESTLINE") {
      active.stats.bestline = parseCoordinateList(match[2], active.size, active.player);
      const root = active.stats.bestline[0];
      if (root) {
        rememberCandidate(active, { row: root.row, col: root.col });
        if (active.stats.pvIndex === 0) {
          active.stats.primaryBestline = active.stats.bestline;
          active.stats.primaryScore = active.stats.score;
          active.stats.primaryWinRate = active.stats.winRate;
        }
      }
    }
    // Some builds emit UCI-like `info ... pv ...` lines instead of the
    // compact INFO BESTLINE form. Preserve the same PV contract.
    const pv = text.match(/(?:^|\s)(?:PV|pv)\s+(.+)$/);
    if (pv && !/^INFO\s+PV\b/i.test(text)) active.stats.bestline = parseCoordinateList(pv[1], active.size, active.player);
    return;
  }
  const coordinates = text.match(/^(?:BESTMOVE\s+|bestmove\s+)?(\d+),(\d+)(?:\s+(\d+),(\d+))?$/i);
  if (!coordinates) return;
  const col = Number(coordinates[1]), y = Number(coordinates[2]);
  if (!Number.isInteger(col) || !Number.isInteger(y) || col < 0 || y < 0 || col >= active.size || y >= active.size) return;
  const move = { row: active.size - 1 - y, col };
  rememberCandidate(active, move);
  // YXNBEST can emit multiple root moves. A short grace period keeps older
  // single-best builds compatible while collecting up to the requested top N.
  if (active.stats.candidates.length >= active.nBest) finish(active, move, active.stats);
  else {
    active.finishTimer = setTimeout(() => {
      if (active) finish(active, active.stats.candidates[0]?.move || move, active.stats);
    }, 80);
  }
}

function send(command) {
  if (engine) engine.sendCommand(command);
}

function run(request) {
  active = request;
  request.started = performance.now();
  request.nBest = Math.max(1, Math.min(3, request.topN || 3));
  request.stats = { depth: 0, nodes: 0, totalNodes: 0, pvIndex: 0, bestline: [], primaryBestline: [], candidates: [] };
  send(`START ${request.size}`);
  send(`INFO RULE ${ruleId(request.rule)}`);
  send(`INFO TIMEOUT_TURN ${Math.max(1000, request.timeMs || 4000)}`);
  send(`INFO MAX_DEPTH ${Math.max(10, request.maxDepth || 64)}`);
  send(`INFO SHOW_DETAIL 2`);
  const board = request.moves.map((point) => protocolPoint(point, request.size)).join(" ");
  send(`YXBOARD${board ? ` ${board}` : ""} DONE`);
  send(`YXNBEST ${request.nBest}`);
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
