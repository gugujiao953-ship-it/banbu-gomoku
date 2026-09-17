/* Classic worker bridge for the Rapfi WebAssembly build.
 * Protocol reference: https://github.com/dhbloo/gomoku-calculator
 * The file intentionally stays dependency-free so it can run under Vite,
 * Capacitor's static server, and a normal offline web server. */
const FULL_LOAD_TIMEOUT_MS = 30000;
let engine = null;
let loading = false;
let loadToken = 0;
let loadTimer = null;
let fullBlocked = false;
let experimentBlocked = false;
let relaxedBlocked = false;
let multiBlocked = false;
let simdSupport = null;
// 多线程档（2026-09-15 恢复）：pthread 构建强制 import 共享内存
// （memory flags=3、82 个 import vs 单线程 70 个），因此**必须**跑在跨源隔离
// 页面里（COOP same-origin + COEP require-corp）。网页版靠 Service Worker 注入
// 这两个头拿到隔离；原生 WebView 拿不到隔离（Android WebView 不实现
// crossOriginIsolated），所以在 APK 里这一档永远不会被选中，自动落单线程。
let sharedMemoryProbe = null;
// App 侧「多线程引擎」开关（默认允许）。关掉时 App 发 "full"，这里再兜一层，
// 免得旧的常驻 worker 还握着允许状态。
let engineMultiAllowed = true;
// 原生引擎（安卓 APK）：主线程用 Capacitor 插件起一个真正跑 Rapfi 的进程，本 worker
// 只负责协议与解析——命令通过 postMessage 交给主线程写进进程 stdin，进程 stdout
// 按行回灌给 parseOutput。这样协议逻辑（候选/深度/时限/收尾）一份代码两处复用，
// 原生侧也**不需要 SharedArrayBuffer**（安卓 WebView 拿不到跨源隔离，wasm 多线程
// 在 APK 里永远不可能，设备实测过）。
let nativeAllowed = false;
// 原生启动失败过一次就别再试（每次都要起进程、复制权重，代价高）。
let nativeBlocked = false;
let nativeReady = false;
let nativeVersion = null;
let pendingNative = null;
const NATIVE_START_TIMEOUT_MS = 20000;
let enginePreference = "auto";
let dataUrlOverride = null;
let activeVariant = "fallback";
const waiting = [];
let active = null;

const post = (message) => self.postMessage(message);
const ruleId = (rule) => rule === "renju" ? 2 : rule === "standard" ? 1 : 0;
const protocolPoint = (point, size) => `${point.col},${size - 1 - point.row},${point.player === "black" ? 1 : 2}`;
const otherPlayer = (player) => player === "black" ? "white" : "black";

// Rapfi's YXBOARD stream derives everything from the move list: the engine
// world always opens with black, each stone's color flag is SELF/OPPO relative
// to the engine's color (deduced from the first stone), and passes are
// auto-inserted to align the side to move. In-app positions are strictly
// alternating black-first lists, which encode as-is. Puzzle-style positions may
// start with white or imply a different mover, so rebuild the stream for the
// requested mover: emit all blacks then all whites (even half-move total ->
// black to move), or first black + all whites + remaining blacks (odd total ->
// white to move).
function canonicalBoardMoves(moves, mover) {
  if (!mover) return moves;
  const blacks = moves.filter((point) => point.player === "black");
  const whites = moves.filter((point) => point.player === "white");
  const alternating = moves.every((point, index) => point.player === (index % 2 === 0 ? "black" : "white"));
  if (alternating && mover === (moves.length % 2 === 0 ? "black" : "white")) return moves;
  if (mover === "black") {
    if (blacks.length < 1 || whites.length < 1) return moves;
    return [...blacks, ...whites];
  }
  if (blacks.length < 2) return moves;
  return [...blacks.slice(0, 1), ...whites, ...blacks.slice(1)];
}

function clearRequestTimers(request) {
  if (!request) return;
  if (request.stopTimer) { clearTimeout(request.stopTimer); request.stopTimer = null; }
  if (request.finishTimer) { clearTimeout(request.finishTimer); request.finishTimer = null; }
}

function scheduleStop(request) {
  if (!request || request.unlimited || active !== request || request.finished || request.stopTimer) return;
  const delayMs = Math.max(0, request.deadline - performance.now());
  request.stopTimer = setTimeout(() => {
    if (!active || active !== request || request.finished || request.stopRequested) return;
    request.stopRequested = true;
    // Ask Rapfi to publish the best result accumulated within the requested
    // budget. The engine may answer synchronously or on a later stdout turn.
    send("YXSTOP");
    if (!active || active !== request || request.finished) return;
    request.finishTimer = setTimeout(() => {
      if (!active || active !== request || request.finished) return;
      finish(request, request.bestMove || request.stats.candidates[0]?.move, request.stats);
    }, Math.max(250, Math.min(1200, Math.round(request.timeMs * 0.25))));
  }, delayMs);
}

function finish(request, move, stats) {
  if (!active || active !== request) return;
  if (request.finished) return;
  request.finished = true;
  clearRequestTimers(request);
  if (!move) {
    active = null;
    post({ type: "error", requestId: request.requestId, generation: request.generation, message: "Rapfi 未返回合法落点" });
    drain();
    return;
  }
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
    Object.assign(matching, { move, pvIndex: -1, score: stats.primaryScore ?? stats.score, winRate: stats.primaryWinRate ?? stats.winRate, nodes: stats.totalNodes || stats.nodes, depth: stats.depth, principalVariation: primaryLine });
  } else stats.candidates.push({ move, pvIndex: -1, score: stats.primaryScore ?? stats.score, winRate: stats.primaryWinRate ?? stats.winRate, nodes: stats.totalNodes || stats.nodes, depth: stats.depth, principalVariation: primaryLine });
  const elapsedMs = performance.now() - request.started;
  // Root move ordering (history/killer heuristics) makes the engine emit PV
  // lines 2..N that were only probed at shallow depth — displaying them reads
  // as "random far-apart candidate points". Keep a secondary line only when it
  // was searched nearly as deep as the principal variation (threshold lowered
  // 8→4 with searchedCandidates, 2026-09-11: candidates appear ~1s earlier).
  const minDepth = Math.max(2, (stats.depth || 0) - 8);
  // 本轮结束：把「本局面累计到现在的节点」留给下一轮接着算（见 continuousNodesBase）。
  // 必须在这里定格——stats 会在下一轮 run() 里被清零。
  const cumulativeNodes = request.continuous ? reportedNodes(request) : (stats.totalNodes || stats.nodes || 0);
  if (request.continuous) continuousNodesBase = cumulativeNodes;
  active = null;
  const candidates = (stats.candidates || []).slice()
    .filter((candidate) => (candidate.pvIndex ?? 99) <= 0 || (candidate.depth ?? 0) >= minDepth)
    .sort((a, b) => (a.pvIndex ?? 99) - (b.pvIndex ?? 99)).slice(0, request.nBest).map((candidate) => ({
    move: candidate.move,
    ...(candidate.score === undefined ? {} : { score: candidate.score }),
    ...(candidate.winRate === undefined ? {} : { winRate: candidate.winRate }),
    ...(candidate.nodes === undefined ? {} : { nodes: candidate.nodes }),
    ...(candidate.depth === undefined ? {} : { depth: candidate.depth }),
    principalVariation: candidate.principalVariation?.length ? candidate.principalVariation : stats.bestline || [],
  }));
  const primary = candidates[0];
  post({
    type: "result",
    requestId: request.requestId,
    generation: request.generation,
    variant: activeVariant,
    result: {
      move,
      // A missing score is materially different from a neutral score. Keep
      // the legacy numeric field for callers, but expose availability below.
      score: primary?.score ?? 0,
      depth: stats.depth || 0,
      selDepth: stats.selDepth || 0,
      nodes: cumulativeNodes,
      // 本轮结束时的节点速度：引擎自报的 SPEED 优先，否则按总节点/用时现算。
      speed: requestSpeed({ stats, started: request.started }),
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

// See finish(): drop shallow PV byproducts from live progress too.
function searchedCandidates(stats) {
  // 候选早现门槛：T12 曾用 max(8, 深度-8) 防浅层 PV 随机点，但滚动分析每轮/
  // 换面都要从 0 爬深度，用户实测「好几秒才有选点」（2026-09-11）——深度 4
  // 的 PV 已相当可靠，降到 max(4, 深度-8)：首轮约 1s 内出候选。primary 恒保留。
  const minDepth = Math.max(2, (stats.depth || 0) - 8);
  return (stats.candidates || []).filter((candidate) => (candidate.pvIndex ?? 99) <= 0 || (candidate.depth ?? 0) >= minDepth);
}

function parseCoordinateList(value, size, player) {
  return (String(value).match(/\d+,\d+/g) || []).map((pair, index) => {
    const [col, y] = pair.split(",").map(Number);
    if (col < 0 || y < 0 || col >= size || y >= size) return null;
    return { row: size - 1 - y, col, player: index % 2 === 0 ? player : otherPlayer(player) };
  }).filter(Boolean);
}

// 节点速度（节点/秒）：优先用引擎自报的 INFO SPEED，它已经做过平滑；引擎这一轮
// 还没打印过就按「总节点 / 已用时」现算，保证界面上始终有个可比的数字。
// 多线程线程数：引擎支持运行时 `INFO THREAD_NUM n`（config 的 default_thread_num
// 只在启动时读一次，改它得重做数据包）。request.threads 为 0/缺省 = 按设备自动取
// 一半核心；上限钉在 hardwareConcurrency，避免把机器压死反而更慢。
function threadCountFor(request) {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  const requested = Number(request.threads);
  // 「多线程引擎」是**网页版 wasm** 的实验开关（多线程 wasm 需要跨源隔离，安卓
  // WebView 永远拿不到），关掉时 wasm 固定单线程。原生引擎不受它约束：原生是真线程、
  // 不需要隔离，套用这个「默认关」的开关等于让原生默认只跑 1 线程——模拟器实测同一
  // 局面 1 线程 109-199k nps、4 线程 230-340k nps，白扔一半以上算力（用户 09-15：
  // 手机常态不到 100k，别人能跑 225k）。原生要省电降温，请在「引擎线程数」里显式
  // 选 1 线程，而不是靠一个默认关的实验开关。
  if (!engineMultiAllowed && activeVariant !== "native") return 1;
  // 0/缺省 = 自动（一半核心，与同类网页引擎的默认一致）；-2 = 大核；负数 = 全核；正数 = 指定。
  // 「大核」是 09-17 新增：手机多是 4 大 + 4 小，Lazy SMP 每一层迭代都被最慢的线程拖住，
  // 把小核算进来可能比只铺大核还慢。bigCores 由原生插件读 cpufreq 得出、App 随请求下发；
  // 拿不到（网页版 / 机器同构）就退回「自动」档的行为。
  const bigCores = Number(request.bigCores);
  const auto = Math.max(1, Math.round(cores / 2));
  const wanted = !Number.isFinite(requested) || requested === 0
    ? auto
    : requested === -2
      ? (Number.isFinite(bigCores) && bigCores > 0 ? Math.min(Math.round(bigCores), cores) : auto)
      : requested < 0 ? cores : requested;
  return Math.max(1, Math.min(Math.round(cores), Math.round(wanted)));
}

function requestSpeed(request) {
  const stats = request.stats || {};
  if (typeof stats.speed === "number" && stats.speed > 0) return stats.speed;
  const elapsedMs = performance.now() - (request.started || 0);
  const nodes = stats.totalNodes || stats.nodes || 0;
  if (!nodes || elapsedMs < 200) return undefined;
  return Math.round(nodes / (elapsedMs / 1000));
}

// 持续分析的节点数必须累计，不能按轮各算各的。
//
// 背景（2026-09-15 用户报「速度一直近 100k，节点总量却迟迟不破 1m，十秒才加一秒
// 的量」）：持续分析是一轮接一轮的有界搜索（每轮 2s/4s/…/20s），每轮 `stats` 从零
// 开始，而引擎的 INFO TOTALNODES 也只是**本轮**的累计值。热 TT 让后面的轮省得多
// 得多——实测同一局面 4 核原生：第 4 轮 8s 搜了 1.49M 节点，第 5 轮 10s 只搜了
// 0.28M。界面侧为了保证「同面续算不闪数字」取的是历史最大值，于是这个数字在某一
// 轮之后再也不会被刷新——看起来就是「引擎满速在跑但节点不动」。
//
// 累加之后 nodes ≈ 速度 × 时间，才是用户理解的「这个局面总共算了多少」；每轮都会
// 有 TT 命中被重复计入，那是引擎真实访问过的节点，不是估算。
let continuousNodesBase = 0;
let continuousNodesKey = null;

/** 同一局面的判据：轮到谁走、规则、以及整条着法序列。与 App 侧 currentPositionKey 同源。 */
function continuousKey(request) {
  const moves = request.moves || [];
  return `${request.size}|${request.player}|${request.rule}|${moves.map((move) => `${move.row},${move.col},${move.player}`).join(" ")}`;
}

/** 对外汇报的节点数：本局面跨轮累计 + 本轮搜索量。非持续分析恒为本轮量。 */
function reportedNodes(request) {
  const stats = (request && request.stats) || {};
  return (request.nodesBase || 0) + (stats.totalNodes || stats.nodes || 0);
}

function parseInfo(text) {
  const result = {};
  const depth = text.match(/(?:^|\s)(?:DEPTH|depth)\s+(-?\d+)/);
  // 引擎实际搜索到达的最大深度（selective depth）。DEPTH 是「当前完成的迭代层」，
  // SELDEPTH 含选择延伸，所以总是更靠前——「17-42」这种区间就是这两个数（用户 09-16：
  // 计算器网页版那样显示最小到最大深度）。引擎一直在发，我们此前从没解析。
  // 必须用  排除掉 DEPTH 行本身（SELDEPTH 里含 DEPTH 子串）。
  const selDepth = text.match(/(?:^|\s)SELDEPTH\s+(\d+)/i);
  const nodes = text.match(/(?:^|\s)(?:NODES|nodes)\s+(-?\d+)/);
  // 引擎自己报的瞬时速度（INFO SPEED n）。尾部的 \b 是必须的：同名的
  // "MESSAGE Speed 223K" 摘要行带 K 后缀，不挡住会把 223K 当成 223。
  const speed = text.match(/(?:^|\s)(?:SPEED|speed)\s+(\d+)\b/);
  const score = text.match(/(?:^|\s)(?:SCORE|score|VALUE|value|EVAL|eval|V)\s+(?:CP\s+)?(-?(?:\d+(?:\.\d+)?|\.\d+))/i);
  const winRate = text.match(/(?:^|\s)(?:WINRATE|winrate|WR|wr|WDL)\s*[:=]?\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*%?/i);
  if (depth) result.depth = Number(depth[1]);
  if (selDepth) result.selDepth = Number(selDepth[1]);
  if (nodes) result.nodes = Number(nodes[1]);
  if (speed) result.speed = Number(speed[1]);
  if (score) result.score = Number(score[1]);
  if (winRate) result.winRate = normalizeWinRate(Number(winRate[1]));
  return result;
}

function rememberCandidate(request, move) {
  const stats = request.stats;
  const key = `${move.row}:${move.col}`;
  const existing = (stats.candidates || []).find((candidate) => `${candidate.move.row}:${candidate.move.col}` === key);
  // Iterations stream in at their own pace; an older/shallower line must
  // never downgrade data already captured from a deeper iteration.
  if (existing && (existing.depth ?? 0) > (stats.depth ?? 0)) return;
  const next = {
    move,
    pvIndex: stats.pvIndex,
    ...(stats.score === undefined ? {} : { score: stats.score }),
    ...(stats.winRate === undefined ? {} : { winRate: stats.winRate }),
    ...(stats.nodes === undefined && stats.totalNodes === undefined ? {} : { nodes: stats.totalNodes || stats.nodes }),
    ...(stats.depth === undefined ? {} : { depth: stats.depth }),
    principalVariation: stats.bestline || [],
  };
  if (existing) Object.assign(existing, next);
  else stats.candidates.push(next);
}

function parseOutput(line) {
  if (!active || typeof line !== "string") return;
  const request = active;
  const text = line.trim();
  if (!text) return;
  if (request.rawDebug) post({ type: "log", message: "RAW " + text.slice(0, 140) });
  // "MESSAGE Bestline <move>" is the engine's end-of-search summary; the bare
  // coordinate that follows it is the declared final answer, not an
  // intermediate YXNBEST line. Any new INFO block reopens the search.
  if (/^MESSAGE Bestline/i.test(text)) request.bestlineSummarySeen = true;
  else if (text.startsWith("INFO")) request.bestlineSummarySeen = false;
  if (text.startsWith("INFO ")) {
    const match = text.match(/^INFO\s+(DEPTH|NODES|BESTLINE)\s+(.+)$/);
    const parsed = parseInfo(text);
    const pvIndex = text.match(/^INFO\s+PV\s+(\d+)$/i);
    if (pvIndex) active.stats.pvIndex = Number(pvIndex[1]);
    if (parsed.depth !== undefined) active.stats.depth = parsed.depth;
    if (parsed.selDepth !== undefined) active.stats.selDepth = parsed.selDepth;
    if (parsed.nodes !== undefined) active.stats.nodes = parsed.nodes;
    const totalNodes = text.match(/^INFO\s+TOTALNODES\s+(\d+)$/i);
    if (totalNodes) active.stats.totalNodes = Number(totalNodes[1]);
    if (parsed.score !== undefined) active.stats.score = parsed.score;
    if (parsed.winRate !== undefined) active.stats.winRate = parsed.winRate;
    if (parsed.speed !== undefined) active.stats.speed = parsed.speed;
    if (performance.now() - (active.lastProgressAt || 0) >= 100) {
      active.lastProgressAt = performance.now();
      post({ type: "progress", requestId: request.requestId, generation: request.generation, variant: activeVariant, depth: active.stats.depth || 0, selDepth: active.stats.selDepth || 0, nodes: reportedNodes(active), speed: requestSpeed(active), score: active.stats.score, winRate: active.stats.winRate, candidates: searchedCandidates(active.stats) });
    }
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
    // The engine plans its iterations by the time budget and never announces
    // completion on its own once the budget is generous, even for positions it
    // has already proven won. When the primary line shows a proven win (a mate
    // score, or a saturated win rate on the think path), stop it — the answer
    // is proven, so ending here is lossless.
    if (request.stopOnProvenWin && !request.provenWinStopSent) {
      const mateText = /EVAL\s+\+M\d+/i.test(text);
      const mateScore = typeof active.stats.primaryScore === "number" && active.stats.primaryScore >= 10000;
      const wrSolved = request.finishOnBareMove && typeof active.stats.primaryWinRate === "number" && active.stats.primaryWinRate >= 0.999;
      if (mateText || mateScore || wrSolved) {
        request.provenWinStopSent = true;
        // YXSTOP 的响应格式因构建而异：fallback 构建会回 "MESSAGE Bestline" +
        // 裸坐标（bestlineSummarySeen 置位后立即 finish），full 构建可能只回裸
        // 坐标甚至不回——provenWin 时绝不能只等它（用户 09-10：做题点分析卡
        // 几十秒不落子，即 EVAL +M 触发本分支后清掉 stopTimer 兜底、引擎已停
        // 而 worker 永等）。置 stopRequested 让裸坐标也能收尾，并保留兜底
        // timer 用当前 PV0 强制 finish。
        request.stopRequested = true;
        if (request.stopTimer) { clearTimeout(request.stopTimer); request.stopTimer = null; }
        send("YXSTOP");
        request.stopTimer = setTimeout(() => {
          if (!active || active !== request || request.finished) return;
          finish(request, request.bestMove || request.stats.candidates[0]?.move, request.stats);
        }, 800);
      }
    }
    return;
  }
  const coordinates = text.match(/^(?:(BESTMOVE|bestmove)\s+)?(\d+),(\d+)(?:\s+(\d+),(\d+))?$/i);
  if (!coordinates) return;
  const col = Number(coordinates[2]), y = Number(coordinates[3]);
  if (!Number.isInteger(col) || !Number.isInteger(y) || col < 0 || y < 0 || col >= request.size || y >= request.size) return;
  const move = { row: request.size - 1 - y, col };
  request.bestMove = move;
  rememberCandidate(request, move);
  if (request.continuous && performance.now() - (request.lastProgressAt || 0) >= 100) {
    request.lastProgressAt = performance.now();
    post({ type: "progress", requestId: request.requestId, generation: request.generation, variant: activeVariant, depth: request.stats.depth || 0, selDepth: request.stats.selDepth || 0, nodes: reportedNodes(request), score: request.stats.score, winRate: request.stats.winRate, candidates: searchedCandidates(request.stats) });
  }
  // A prefixed BESTMOVE is an explicit terminal response. Bare coordinate
  // lines are often intermediate YXNBEST/PV output, so never finish merely
  // because one candidate (or Top-N candidates) arrived.
  // A prefixed BESTMOVE is an explicit terminal response. With finishOnBareMove
  // a bare coordinate is terminal when it follows the engine's "MESSAGE
  // Bestline" summary OR when no search output preceded it at all (trivially
  // solved positions answer in milliseconds with no INFO lines) — both mean the
  // engine has declared its final answer, so easy positions return instantly
  // instead of burning the whole time budget.
  if (coordinates[1] || (request.acceptBareFinal && request.bestlineSummarySeen) || (request.finishOnBareMove && !request.stats.depth && !request.stats.nodes) || request.stats.depth >= request.maxDepth || request.stopRequested) finish(request, move, request.stats);
}

function send(command) {
  if (engine) engine.sendCommand(command);
}

// ---- Optional opening book (双书：索索夫打点簿 + 山口五手两打谱) ------------
// Architecture follows every serious renju engine (Yixin .bmk, 智子): the
// book lives at the ENGINE layer. An analyze request carrying book:true is
// answered from the book before the engine is touched — so the game loop,
// the opening state machine and any future caller all get book moves
// uniformly, with zero app-side stitching.
// Two books, picked by the game's openingRule:
//   sosyov     public/opening-book/sosyov-v1.json       (scripts/build-opening-book.mjs)
//   yamaguchi  public/opening-book/yamaguchi-v1.json.gz (scripts/build-yamaguchi-book.mjs)
// v2 keys are JSON [row,col] move sequences with {p,l} rank entries; v3 keys
// are JSON flat row*size+col move codes with [point, rank, ...] value pairs
// (compact — the Yamaguchi book is an order of magnitude bigger). Rank
// semantics in both books: smaller = stronger (山口谱: 1=唯一防/必胜宣布点/
// 定式名可下点；败点层不入书). Keep in sync with src/features/ai/opening-book.ts.
// 每个簿给出候选路径（按序尝试）。Capacitor 打包 APK 时会**自动解压 .gz 资源**
// 并把文件名去掉 .gz 后缀（实测：dist 里是 yamaguchi-v1.json.gz 351KB，APK 内
// 变成 yamaguchi-v1.json 4.1MB），只请求 .gz 会在真机上 404 → 山口/五手两打
// 类规则永远走不了簿（用户 09-13 反馈「开局不像以前那样走簿、要等满时限」）。
// 因此两种文件名都试；decodeBookResponse 已按 gzip 魔数自适应，无需关心内容格式。
const BOOK_FILES = {
  sosyov: ["../opening-book/sosyov-v1.json"],
  yamaguchi: ["../opening-book/yamaguchi-v1.json.gz", "../opening-book/yamaguchi-v1.json"],
};
// Opening rules whose theory the Yamaguchi lib covers (山口开局 + 五手两打
// 家族)。其余（含 soosyrv-8 与未带 openingRule 的旧请求）走索索夫簿——
// 与 T26 单书行为一致。
const YAMAGUCHI_RULES = ["yamaguchi", "five-two", "five-n", "taraguchi-10", "tarannikov"];
function bookKindFor(request) {
  const rule = typeof request.openingRule === "string" ? request.openingRule : "";
  return YAMAGUCHI_RULES.includes(rule) ? "yamaguchi" : "sosyov";
}
const bookData = { sosyov: null, yamaguchi: null };
const bookPromise = { sosyov: null, yamaguchi: null };
// Hosts behave differently for .gz assets: vite dev / GitHub Pages / Capacitor
// send Content-Encoding: gzip and the browser fetch layer ALREADY decodes the
// body, while a plain file server hands us the raw gzip bytes. Decode by
// content (gzip magic 0x1f 0x8b), never by header — double-decoding plain
// JSON (or under-decoding binary) is otherwise host-dependent.
function decodeBookResponse(response) {
  return response.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    if (bytes.length > 1 && bytes[0] === 31 && bytes[1] === 139) {
      if (typeof DecompressionStream !== "function") return null; // 旧 WebView：静默无书
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream).text().then((text) => JSON.parse(text));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  });
}
function ensureBook(kind) {
  if (!bookPromise[kind]) {
    const candidates = BOOK_FILES[kind];
    // Same-origin static asset; a literal relative path resolves against this
    // worker script's own URL — no dynamic input reaches fetch.
    // 依次尝试候选文件名：dev/网页用 .gz，APK 内 Capacitor 已解压成 .json。
    const attempt = (index) => {
      if (index >= candidates.length) return Promise.resolve(null);
      return fetch(candidates[index])
        .then((response) => (response.ok ? decodeBookResponse(response) : null))
        .then((data) => {
          if (data && data.positions && (data.version === 2 || data.version === 3)) return data;
          return attempt(index + 1);
        })
        .catch(() => attempt(index + 1));
    };
    bookPromise[kind] = attempt(0)
      .then((data) => { if (data) bookData[kind] = data; });
  }
  return bookPromise[kind];
}
function bookTransforms(n) {
  return [
    { fwd: (r, c) => [r, c], inv: (r, c) => [r, c] },
    { fwd: (r, c) => [r, n - c], inv: (r, c) => [r, n - c] },
    { fwd: (r, c) => [n - r, c], inv: (r, c) => [n - r, c] },
    { fwd: (r, c) => [n - r, n - c], inv: (r, c) => [n - r, n - c] },
    { fwd: (r, c) => [c, r], inv: (r, c) => [c, r] },
    { fwd: (r, c) => [n - c, n - r], inv: (r, c) => [n - c, n - r] },
    { fwd: (r, c) => [c, n - r], inv: (r, c) => [n - c, r] },
    { fwd: (r, c) => [n - c, r], inv: (r, c) => [c, n - r] },
  ];
}
// Normalize one D4-rotated lookup into book-coordinate entries
// [{row, col, rank}] for the given key encoding (v2 nested pairs / v3 flat codes).
function bookLabels(data, moves, size, transform) {
  const out = [];
  if (data.version === 3) {
    const key = JSON.stringify(moves.map((move) => {
      const mapped = transform.fwd(move.row, move.col);
      return mapped[0] * size + mapped[1];
    }));
    const labels = data.positions[key];
    if (!Array.isArray(labels)) return out;
    for (let i = 0; i + 1 < labels.length; i += 2) {
      const code = labels[i];
      const rank = labels[i + 1];
      if (!Number.isInteger(code) || code < 0 || code >= size * size) continue;
      if (!Number.isInteger(rank) || rank <= 0) continue;
      out.push({ row: Math.floor(code / size), col: code % size, rank });
    }
    return out;
  }
  const key = JSON.stringify(moves.map((move) => transform.fwd(move.row, move.col)));
  const labels = data.positions[key];
  if (!Array.isArray(labels)) return out;
  for (const entry of labels) {
    // v2 rank labels are "N" or "N*"; parse without regex/exec. 汉字=开局名层
    // （白2/黑3 的簿内开局线候选）：无数字 rank 但仍是簿收录的可下点——rank 记
    // 0，bookRanked 在无数字 rank 时回退到这层（否则白2/黑3 永远书 miss 回落
    // 引擎自由摆，摆到簿外线后整局打点簿失效；用户 09-10 门禁 S3c 实锤）。
    const label = typeof entry.l === "string" ? entry.l : "";
    const digits = label.endsWith("*") ? label.slice(0, -1) : label;
    const rank = Number(digits);
    if (!Array.isArray(entry.p) || entry.p.length !== 2) continue;
    if (!Number.isInteger(rank) || rank <= 0) {
      // 仅汉字开局名层可回退（白2/黑3 的簿内开局线候选）；"A"=未标强弱
      // （谱内未研究/未评级，不是可下点），继续跳过。
      if (/[\u4e00-\u9fff]/.test(label)) out.push({ row: entry.p[0], col: entry.p[1], rank: 0 });
      continue;
    }
    out.push({ row: entry.p[0], col: entry.p[1], rank });
  }
  return out;
}
function bookRanked(kind, moves, size) {
  const data = bookData[kind];
  if (!data || !Array.isArray(moves) || !moves.length) return [];
  const n = size - 1;
  for (const transform of bookTransforms(n)) {
    const ranked = [];
    for (const entry of bookLabels(data, moves, size, transform)) {
      const inv = transform.inv(entry.row, entry.col);
      if (inv[0] < 0 || inv[0] >= size || inv[1] < 0 || inv[1] >= size) continue;
      ranked.push({ row: inv[0], col: inv[1], label: String(entry.rank), rank: entry.rank });
    }
    if (ranked.length) {
      // 数字 rank 层优先（打点/白4 好点，越小越强）；仅开局名层（汉字）时
      // 全部视为同一可下组（rank=1），由 bookAnswer 的 top 组随机破平——
      // 白2/黑3 由此稳定走簿，不再引擎自由摆。
      const rankedOnly = ranked.filter((entry) => entry.rank > 0);
      if (rankedOnly.length) return rankedOnly.sort((a, b) => a.rank - b.rank);
      return ranked.map((entry) => ({ ...entry, rank: 1 }));
    }
  }
  return [];
}
function bookAnswer(request) {
  const ranked = bookRanked(bookKindFor(request), request.moves, request.size);
  if (!ranked.length) return false;
  // Ties in the top rank group resolve randomly (mirrors queryOpeningBookMove
  // in src/features/ai/opening-book.ts): the Yamaguchi book marks the whole
  // 26-opening set as one equal group — a fixed pick would repeat one opening
  // every game.
  const bestRank = ranked[0].rank;
  const pool = ranked.filter((entry) => entry.rank === bestRank);
  const top = pool[Math.floor(Math.random() * pool.length) % pool.length] || ranked[0];
  post({
    type: "result",
    requestId: request.requestId,
    generation: request.generation,
    variant: activeVariant || "fallback",
    result: {
      move: { row: top.row, col: top.col },
      score: 0,
      scoreAvailable: false,
      depth: 0,
      nodes: 0,
      elapsedMs: 0,
      illegalRejected: 0,
      reason: "book",
      source: "book",
      bookLabel: top.label,
      principalVariation: [],
      // rank 随书候选一起发出（T31：AI 宣布五手N打数量要用「库内好点数」推理）。
      candidates: ranked.slice(0, Math.max(1, Math.min(10, request.topN || 3))).map((entry) => ({ move: { row: entry.row, col: entry.col }, depth: 0, rank: entry.rank, principalVariation: [] })),
    },
  });
  return true;
}

function run(request) {
  active = request;
  request.started = performance.now();
  request.nBest = Math.max(1, Math.min(10, request.topN || 3));
  request.continuous = request.continuous === true;
  // 同一局面的续轮继承累计节点（见 continuousNodesBase）：换局面、或中间穿插了
  // 普通（非持续）请求时归零。
  const continuousNodesRequestKey = request.continuous ? continuousKey(request) : null;
  if (continuousNodesRequestKey && continuousNodesRequestKey === continuousNodesKey) {
    request.nodesBase = continuousNodesBase;
  } else {
    request.nodesBase = 0;
    continuousNodesKey = continuousNodesRequestKey;
    continuousNodesBase = 0;
  }
  // Continuous means "report as you go, no early completion tricks" — NOT
  // "run forever". A time-unbounded search cannot be stopped cooperatively
  // (the WASM loop blocks the worker queue), which deadlocks the persistent
  // engine on the next position. Keep every request inside its deadline.
  request.unlimited = request.unlimited === true || Number(request.timeMs) === 0;
  request.timeMs = request.unlimited ? 0 : Math.max(100, Math.min(300000, Math.round(Number(request.timeMs) || 4000)));
  request.maxDepth = request.unlimited ? 512 : Math.max(1, Math.min(512, Math.round(Number(request.maxDepth) || 64)));
  request.finished = false;
  request.stopRequested = false;
  request.bestMove = null;
  request.deadline = request.unlimited ? Number.POSITIVE_INFINITY : request.started + request.timeMs;
  request.stats = { depth: 0, selDepth: 0, nodes: 0, totalNodes: 0, speed: 0, pvIndex: 0, bestline: [], primaryBestline: [], candidates: [] };
  request.finishOnBareMove = request.finishOnBareMove === true;
  // Continuous analysis runs in bounded rounds that roll over a warm TT. Inside
  // a bounded round the engine still declares its timeout answer via
  // "MESSAGE Bestline" + a bare coordinate — honour it instead of hard-killing
  // at the deadline, which discarded the deepest finished iteration (the probe
  // measured the final line arriving ~800ms after our grace fired).
  request.acceptBareFinal = request.finishOnBareMove || (request.continuous === true && request.unlimited !== true);
  request.stopOnProvenWin = request.stopOnProvenWin === true;
  request.bestlineSummarySeen = false;
  request.lastProgressAt = 0;
  request.provenWinStopSent = false;
  scheduleStop(request);
  send(`START ${request.size}`);
  send(`INFO RULE ${ruleId(request.rule)}`);
  // 多线程变体与原生引擎都按设置下发线程数。单线程 wasm 构建会忽略这条命令。
  // 原生引擎的 config 里 default_thread_num=1，不发就等于只用 1 线程——白白少掉
  // 数倍算力（模拟器实测 1 线程 44.8k vs 4 线程 235k nps）。
  if (activeVariant === "multi" || activeVariant === "native") send(`INFO THREAD_NUM ${threadCountFor(request)}`);
  // Gomocup's default TT budget on desktop is 350MB, but this build's config
  // ships default_tt_size_kb=32768 (32MB) and nothing raised it — long rolling
  // analyses thrash a small table. MAX_MEMORY is the total budget (bytes); the
  // engine subtracts the NNUE weight reservation and gives the rest to the TT.
  // Scale by device RAM so low-memory phones keep the conservative default.
  // T49 火力线：用户自定义档（maxMemoryMb）优先于设备分档；0=自动。
  // 极限档（2048）分配失败会引擎退出，App 侧 error→useFallback 兜底。
  // 09-12 实测：TT 不是越大越快——同一局面 10s 预算 64/128MB 表比 256MB 快 29%
  // （大表缓存失配 + 大块清零），手机内存带宽更窄差距更大。默认档下调到甜点区。
  const ram = typeof navigator !== "undefined" ? navigator.deviceMemory : undefined;
  if (request.maxMemoryMb) send(`INFO MAX_MEMORY ${Math.round(request.maxMemoryMb * 1024 * 1024)}`);
  else if (typeof ram === "number" ? ram >= 4 : true) send("INFO MAX_MEMORY 134217728");
  else if (ram >= 2) send("INFO MAX_MEMORY 67108864");
  send(`INFO TIMEOUT_TURN ${request.unlimited ? 0 : request.timeMs}`);
  send(`INFO MAX_DEPTH ${request.maxDepth}`);
  // 深度范围的下界（用户 09-16：像五子棋计算器那样给「最小 / 最大」深度）。
  // Rapfi 的 START_DEPTH 决定迭代加深从第几层开始搜索：>1 时跳过更浅的迭代。
  // 注意这在**持续分析**里基本是白拿（热 TT 下走到 d12 只要 0.1s，见改造表 R21），
  // 它的价值在「单次分析已经算过深、只想继续加深」这类场景。缺省/0 不发命令，
  // 引擎保持自己的默认（从第 1 层起算）。
  if (Number.isFinite(request.depthMin) && request.depthMin > 1 && request.depthMin < request.maxDepth) {
    send(`INFO START_DEPTH ${Math.round(request.depthMin)}`);
  }
  send(`INFO SHOW_DETAIL 2`);
  const board = canonicalBoardMoves(request.moves, request.player).map((point) => protocolPoint(point, request.size)).join(" ");
  send(`YXBOARD${board ? ` ${board}` : ""} DONE`);
  send(`YXNBEST ${request.nBest}`);
}

function drain() {
  if (!engine || active || !waiting.length) return;
  run(waiting.shift());
}

function startVariant(variant) {
  if (variant === "native") return startNativeVariant();
  importScripts(`./${variant}/rapfi-single.js`);
  const factory = self.Rapfi;
  if (typeof factory !== "function") throw new Error("Rapfi WASM 工厂未找到");
  const scriptUrl = new URL(`./${variant}/rapfi-single.js`, self.location.href).href;
  return factory({
    // pthread 构建按需再起 Worker 时，Emscripten 用 mainScriptUrlOrBlob 当脚本
    // 地址（worker 里没有 document.currentScript 可查）；不传就只能挂起。
    mainScriptUrlOrBlob: variant === "multi" ? scriptUrl : undefined,
    locateFile: (name) => {
      // An analyze-level override lets the benchmark harness point at an
      // alternative NNUE data package without rebuilding assets.
      if ((variant === "full" || variant === "multi" || /^experiment/.test(variant)) && dataUrlOverride && /^rapfi.*\.data$/.test(name)) return dataUrlOverride;
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

// WASM threads probe: a minimal module that declares a *shared* memory with a
// max and runs memory.atomic.notify. Exactly the capability Emscripten pthreads
// needs, so a pass means the multi build can instantiate. `new SharedArrayBuffer`
// alone is not enough — newer Chromium lets WebAssembly.Memory({shared:true})
// through even outside cross-origin isolation, while the Emscripten runtime
// still needs the SAB constructor for its atomics glue.
function detectSharedMemory() {
  if (sharedMemoryProbe !== null) return sharedMemoryProbe;
  sharedMemoryProbe = Promise.resolve().then(() => {
    if (typeof SharedArrayBuffer !== "function") return false;
    if (typeof Atomics !== "object" || typeof Atomics.wait !== "function") return false;
    const probe = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version 1
      0x01, 0x04, 0x01, 0x60, 0x00, 0x00,             // type section: () -> ()
      0x03, 0x02, 0x01, 0x00,                         // func section: one func
      0x05, 0x04, 0x01, 0x03, 0x01, 0x01,             // memory: flags 3 (shared) min 1 max 1
      0x0a, 0x0b, 0x01, 0x09, 0x00, 0x41, 0x00,       // code: i32.const 0
      0xfe, 0x10, 0x02, 0x00, 0x1a, 0x0b,             // memory.atomic.notify 0 2; drop; end
    ]);
    return WebAssembly.validate(probe);
  }).catch(() => false);
  return sharedMemoryProbe;
}

/** 原生变体：请主线程起进程，等它报就绪；之后 send() 走 postMessage。 */
function startNativeVariant() {
  return new Promise((resolve, reject) => {
    nativeReady = false;
    const timer = setTimeout(() => {
      pendingNative = null;
      reject(new Error("原生引擎启动超时"));
    }, NATIVE_START_TIMEOUT_MS);
    pendingNative = { resolve, reject, timer };
    post({ type: "native-start" });
  });
}

/** 主线程回报进程已就绪。 */
function resolveNativeReady(payload) {
  if (!pendingNative) return;
  const { resolve, timer } = pendingNative;
  clearTimeout(timer);
  pendingNative = null;
  nativeReady = true;
  nativeVersion = payload && payload.version ? payload.version : null;
  resolve({
    // 与 wasm 实例同一形状：只用到 sendCommand。
    sendCommand: (command) => {
      if (!nativeReady) return;
      post({ type: "native-command", line: command });
    },
  });
}

function rejectNativeReady(reason) {
  if (!pendingNative) return;
  const { reject, timer } = pendingNative;
  clearTimeout(timer);
  pendingNative = null;
  reject(new Error(reason || "原生引擎启动失败"));
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
  activeVariant = variant;
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

function chooseVariant(requested) {
  // 原生可用时它优先于 wasm 的任何档（含 multi）：安卓上本来就不需要 SAB，而且
  // 「轻量/强力/自调」在原生侧的差别只剩内存/线程/时限——把轻量也落到 wasm 只会让
  // 用户默认拿到弱引擎。原生启动失败（nativeBlocked）时自动回到 wasm 那套。
  if (nativeAllowed && !nativeBlocked) return "native";
  if (requested === "fallback" || (fullBlocked && requested !== "experiment")) return "fallback";
  if (requested === "multi" || requested === "auto" || requested === "full") {
    // "full"/"auto" 的语义是「当前环境下最强的可用引擎」，而多线程档就是最强的
    // 那个（App 的预热就直接发 "full"）。三个条件缺一条就落单线程强力/轻量档：
    // 用户没关（关掉时 App 发 multi:false）、冠军包在（算力来自 mix9svq，没包的
    // 多线程毫无意义）、页面跨源隔离（pthread 构建强制 import 共享内存）。
    // 必须在加载前判死：非隔离环境里 pthread 构建既不 resolve 也不报错，
    // 会静静挂满 30 秒加载超时。
    const isolated = self.crossOriginIsolated === true;
    const usable = requested === "multi" ? isolated : isolated && engineMultiAllowed;
    if (usable && !multiBlocked && dataUrlOverride) {
      const deviceMemory = self.navigator ? self.navigator.deviceMemory : undefined;
      if (!(typeof deviceMemory === "number" && deviceMemory < 2)) return "multi";
    }
  }
  if (requested === "experiment") {
    // 实验档 = 官方 wasm-multi-simd128 的 SIMD 构建（实验性，先看效果）。
    // 与 full 相同的先决条件：冠军数据包必须在（40MB heap 同源）。
    if (experimentBlocked || !dataUrlOverride) return "fallback";
    const deviceMemory = self.navigator ? self.navigator.deviceMemory : undefined;
    if (typeof deviceMemory === "number" && deviceMemory < 2) return "fallback";
    return "experiment";
  }
  // The full NNUE data is no longer bundled with the app: it arrives through
  // the analyze-level dataUrl override once the user downloads the engine pack
  // in settings. Without that override only the lightweight fallback build can
  // run (an explicit "full" request without data therefore lands here too).
  if (!dataUrlOverride) return "fallback";
  // Both wasm variants are non-SIMD single-thread builds, so the full build is
  // feature-compatible even with the oldest supported WebView. Its downloaded
  // data package is ~47MB in the wasm heap, though; true low-memory devices
  // stay on the fallback build up front. deviceMemory rounds down to a power
  // of two, so <2 means ~1GB RAM.
  if (requested !== "full") {
    const deviceMemory = self.navigator ? self.navigator.deviceMemory : undefined;
    if (typeof deviceMemory === "number" && deviceMemory < 2) return "fallback";
  }
  return "full";
}

// WASM SIMD feature probe: a minimal module whose only body instruction is
// v128.const. compile() rejects it on engines without SIMD support (WebView
// cores before Chrome 91). Cached; runs once per worker lifetime.
function detectSimd() {
  if (simdSupport !== null) return simdSupport;
  const probe = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version 1
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,       // type section: () -> v128
    0x03, 0x02, 0x01, 0x00,                         // func section: one func, type 0
    0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,       // code: v128.const x16 lanes
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0b,                                           // end
  ]);
  simdSupport = WebAssembly.compile(probe).then(() => true, () => false);
  return simdSupport;
}

// 实验档加载链：优先 Relaxed SIMD 构建（NNUE 的 int8 点积可走单条 relaxed
// 指令，WebView 内核 Chrome 114+），加载/编译失败自动落标准 SIMD 构建
// （Chrome 91+），再失败按 full 同款兜底走 fallback。不做手写 relaxed 探测
// ——compile 失败本身就是最准的探测，代价只是老内核上多一次失败下载。
// 返回 {instance, variant}：finishLoad 必须用实际加载的变体做标签（否则
// relaxed 成功时会被误报成 "experiment"，对照实验无从分辨）。
async function startExperimentChain() {
  if (!relaxedBlocked) {
    try {
      return { instance: await startVariant("experiment-relaxed"), variant: "experiment-relaxed" };
    } catch (error) {
      relaxedBlocked = true;
      post({ type: "log", message: "Relaxed SIMD 不可用，回落标准 SIMD 实验引擎：" + (error instanceof Error ? error.message : String(error)) });
    }
  }
  if (!(await detectSimd())) throw new Error("当前 WebView 不支持 WASM SIMD");
  return { instance: await startVariant("experiment"), variant: "experiment" };
}

function loadVariant(variant, token) {
  if (variant === "full" || variant === "experiment" || variant === "multi" || variant === "native") {
    // A stalled data fetch must not leave analyze requests queued forever.
    // Abandon the slow attempt and serve the fallback build instead.
    loadTimer = setTimeout(() => {
      if (token !== loadToken || engine) return;
      loading = false;
      if (variant === "native") nativeBlocked = true;
      else if (variant === "experiment" && !experimentBlocked) experimentBlocked = true;
      else if (variant === "multi" && !multiBlocked) multiBlocked = true;
      else fullBlocked = true;
      post({ type: "log", message: variant === "native" ? "原生引擎启动超时，改用 WASM 引擎" : variant === "multi" ? "多线程引擎加载超时，改用单线程强力引擎" : "Rapfi 加载超时，改用单线程强力引擎" });
      load();
    }, FULL_LOAD_TIMEOUT_MS);
  }
  return Promise.resolve()
    .then(async () => {
      if (variant === "experiment") return startExperimentChain();
      return { instance: await startVariant(variant), variant };
    })
    .then((started) => {
    if (token !== loadToken) return;
    finishLoad(token, started.instance, started.variant);
  }).catch((error) => {
    if (token !== loadToken) return;
    clearLoadTimer();
    loading = false;
    if (variant === "full" || variant === "experiment" || variant === "multi" || variant === "native") {
      if (variant === "native") {
        nativeBlocked = true;
        post({ type: "log", message: "原生引擎不可用，改用 WASM 引擎：" + (error instanceof Error ? error.message : String(error)) });
      } else if (variant === "multi") {
        multiBlocked = true;
        post({ type: "log", message: "多线程引擎不可用，改用单线程强力引擎：" + (error instanceof Error ? error.message : String(error)) });
      } else if (variant === "experiment") {
        experimentBlocked = true;
        post({ type: "log", message: "Rapfi 实验引擎加载失败，改用基础引擎：" + (error instanceof Error ? error.message : String(error)) });
      } else {
        fullBlocked = true;
        post({ type: "log", message: "Rapfi full 加载失败，改用基础引擎：" + (error instanceof Error ? error.message : String(error)) });
      }
      load();
      return;
    }
    post({ type: "error", message: "Rapfi 本地 WASM 加载失败：" + (error instanceof Error ? error.message : String(error)) });
  });
}

function load() {
  if (loading || engine) return;
  loading = true;
  // Analysis stays offline: both variants load from the bundled assets and
  // this worker never downloads model data from a third-party host.
  const token = ++loadToken;
  void loadVariant(chooseVariant(enginePreference), token);
}

self.onmessage = (event) => {
  const message = event.data || {};
  // ---- 原生引擎的回灌（主线程转发进程输出）----
  if (message.type === "native-ready") { resolveNativeReady(message); return; }
  if (message.type === "native-start-failed") { rejectNativeReady(message.reason); return; }
  if (message.type === "native-stdout") { parseOutput(message.line); return; }
  if (message.type === "native-exit") {
    nativeReady = false;
    engine = null;
    if (active) { active.finished = true; active = null; }
    post({ type: "error", message: `原生引擎进程已退出（code ${message.code}）` });
    drain();
    return;
  }
  if (message.type === "stop") {
      if (active && message.requestId && active.requestId && message.requestId !== active.requestId) return;
    if (engine) engine.sendCommand("YXSTOP");
    if (active) {
      const request = active;
      if (message.toResult === true && !request.unlimited) {
        // 用户强制停止 → 落当前最强点（T29）：YXSTOP 让引擎收尾当前迭代，
        // 通常立刻经 acceptBareFinal 走正常 finish；宽限到期仍无声就采用
        // 最新进度快照（bestMove/最深候选）finish——和 deadline 兜底同一通路。
        request.stopRequested = true;
        clearRequestTimers(request);
        request.finishTimer = setTimeout(() => {
          if (!active || active !== request || request.finished) return;
          finish(request, request.bestMove || (request.stats.candidates.length ? request.stats.candidates[0].move : null), request.stats);
        }, 500);
        return;
      }
      request.finished = true;
      clearRequestTimers(request);
      active = null;
      post({ type: "stopped", requestId: request.requestId, generation: request.generation });
      drain();
    }
    return;
  }
  // 后台预热：应用在空闲时提前把引擎加载好（40MB 强力包冷加载在手机上
  // 10-30s，现场等会看起来像卡死——用户 09-10）。只加载不分析；首个
  // analyze 到来时引擎已就绪，直接 drain。
  if (message.type === "warmup") {
    if (!engine && !loading) {
      if (message.native === true) nativeAllowed = true;
      if (message.multi === false) engineMultiAllowed = false;
      else if (message.multi === true) engineMultiAllowed = true;
      if (message.engine === "full" || message.engine === "fallback" || message.engine === "auto" || message.engine === "experiment" || message.engine === "multi") enginePreference = message.engine;
      if (typeof message.dataUrl === "string" && message.dataUrl) dataUrlOverride = message.dataUrl;
      load();
    }
    return;
  }
  if (message.type !== "analyze") return;
  // The first analyze pins the engine preference and optional data package
  // location for this worker's lifetime; later requests reuse the engine.
  // 顺序不变式（全盘体检 P1-1）：钉死必须发生在 book 分支之前——book 首包未加载完
  // 走异步让路分支时会提前 return，若那时才钉死，miss 后 load() 会按未钉死状态起
  // fallback 变体且常驻 worker 整局锁死在轻量引擎（用户选强力却静默降档）。
  if (!engine && !loading) {
    if (message.native === true) nativeAllowed = true;
      if (message.multi === false) engineMultiAllowed = false;
      else if (message.multi === true) engineMultiAllowed = true;
      if (message.engine === "full" || message.engine === "fallback" || message.engine === "auto" || message.engine === "experiment" || message.engine === "multi") enginePreference = message.engine;
    if (typeof message.dataUrl === "string" && message.dataUrl) dataUrlOverride = message.dataUrl;
  }
  // Opening book first (engine-layer, see above): on a hit answer instantly
  // without loading or searching. On a miss (or missing book file) fall
  // through to the normal engine path.
  if (message.book === true) {
    const bookRequest = { ...message, size: message.size || 15 };
    const bookKind = bookKindFor(bookRequest);
    if (bookData[bookKind]) {
      if (bookAnswer(bookRequest)) return;
    } else {
      // 首包 fetch 不得阻塞请求链（T29）：慢网络下最多让路 3s，之后引擎照常
      // 应答（书从下一手自然生效）。旧实现 1.5s 对 dev-server 冷启动/慢 IO 太
      // 紧——白2/黑3 开局摆子偶发 miss 回落引擎摆簿外线，整局打点簿失效且
      // 门禁 S3c 偶发假挂（2026-09-10 实测交替 hit/miss）。本地资源 fetch 恒
      // <1s，3s 只在真正异常时兜底。
      const bookReady = Promise.race([ensureBook(bookKind), new Promise((resolve) => setTimeout(resolve, 3000))]);
      bookReady.then(() => {
        if (bookAnswer(bookRequest)) return;
        waiting.push(bookRequest);
        load();
        drain();
      });
      return;
    }
  }
  waiting.push({ ...message, size: message.size || 15 });
  load();
  drain();
};
