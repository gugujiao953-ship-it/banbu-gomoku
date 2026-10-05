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
// ---- KataGo 旗舰引擎（仅安卓原生，GTP 协议）----
// 与 native（Rapfi）变体并存但消息类型独立（kata-*）。协议差异：GTP 应答以
// "= " 开头，搜索过程行是 "info move X visits N winrate R ... pv A B C"；
// 每手预算用 time_settings 下发（kata.cfg 的 maxTime 只是硬安全上限）。
// threads 固定 1：2026-09-25 严格复测 1→2 无增益且加剧热降频（引擎实验室结论）。
let kataAllowed = false;
// ---- iKataGo 云引擎（WebSocket GTP，用户填自己的服务器地址自连）----
// 与旗舰同构：远端也是一个真 KataGo 进程，只是管道换成了 WebSocket。
// 因此**解析层完全复用**（parseKataOutput / runKata / 帧累计口径都走同一套），
// 差别只在「命令往哪写、输出从哪来」——由 send() 与 ikatagoOnLine() 两个入口分派。
let ikatagoAllowed = false;
let ikatagoBlocked = false;
let ikatagoReady = false;
let ikatagoConfig = null;              // { serverUrl, username, password, platform }
let ikatagoSocket = null;              // WebSocket
let ikatagoBuffer = "";                // 按行切分缓冲（TCP 不保边界，超长候选行必须缓冲）
let pendingIkatago = null;             // { resolve, reject, timer }
const IKATAGO_START_TIMEOUT_MS = 30000;

/** 可被钉死为「引擎偏好」的变体名（含云引擎；加新引擎时只改这一处）。 */
const ENGINE_PREFERENCES = new Set(["full", "fallback", "auto", "experiment", "multi", "kata", "ikatago", "native"]);

/** 从 analyze/warmup 消息里取 iKataGo 配置并钉住（地址/凭据随每次请求带，
 *  用户改配置后无需重启 worker 即可生效——下一次请求就用新值重连）。 */
function pinIkatago(message) {
  if (message.engine !== "ikatago") return;
  ikatagoAllowed = true;
  const cfg = message.ikatago;
  if (cfg && typeof cfg === "object" && typeof cfg.serverUrl === "string") {
    const changed = !ikatagoConfig
      || ikatagoConfig.serverUrl !== cfg.serverUrl
      || ikatagoConfig.username !== cfg.username
      || ikatagoConfig.password !== cfg.password
      || ikatagoConfig.platform !== cfg.platform;
    ikatagoConfig = {
      serverUrl: cfg.serverUrl,
      username: typeof cfg.username === "string" ? cfg.username : "",
      password: typeof cfg.password === "string" ? cfg.password : "",
      platform: typeof cfg.platform === "string" ? cfg.platform : "linux-x64",
    };
    // 配置变了：清放弃标记并断开旧连接（下次请求按新地址重连）
    if (changed) {
      ikatagoBlocked = false;
      try { ikatagoSocket?.close(); } catch { /* 已关 */ }
      ikatagoSocket = null;
      ikatagoReady = false;
      if (activeVariant === "ikatago") { engine = null; loading = false; }
    }
  }
}
// 放弃标记：连续启动失败后置真，本 worker 生命周期内不再自动重试旗舰
// （每手都赌一次启动用户等不起）；用户显式切走再切回时清掉，给全新机会。
let kataBlocked = false;
let kataAttempts = 0;                  // 本轮加载链已失败的次数
const KATA_MAX_START_ATTEMPTS = 2;
let kataReady = false;
let pendingKata = null;
// 冷启动要过四道关：复制模型 → fork+exec → ORT 初始化 → stdout 打出横幅。
// 热机全流程 ~3-8s，但冷机（应用刚起、CPU 被前台渲染抢占、热降频）实测可超
// 25s——旧值 25s 会把「正在正常加载」误判成失败并触发整链重试（09-26 报
// 「几分钟了一直加载中」的根因之一）。用户又反馈「宁可得等、也别误报失败」，
// 所以再放宽到 90s：**正常加载几乎不可能超过**，而超时后仍有完整的失败/重试
// 链路兜底。宁可等，不要把「正在加载」说成「启动失败」。
const KATA_START_TIMEOUT_MS = 90000;
// 标定协议 v1（固定等待上限，最大化搜索）：首启 4 手 genmove@1s（首手弃掉，
// 含模型加载尾延迟），overhead = median(墙钟) − 1.0。预算 = 档位秒数 − overhead − 余量。
// 墙钟噪声 ±0.2%，是手机上唯一可信的指标（访问数噪声 ±3.4% 且受热漂移支配）。
let kataOverhead = 0.10;               // 标定前的假设值（常驻引擎实测 ≈0.10s）
let kataPendingOverhead = null;        // 主线程桥带回的已存标定值（null = 本 worker 负责标定）
let kataCalib = null;
// 引擎当前摆着的局面（增量同步的基准，见 runKata 的 canIncrement）：
// 持续分析不重摆全量，只发增量新落的棋子。
let kataLive = { active: false, size: 15, rule: "renju", moves: [] };
// **引擎棋盘可信度**：`kata-genmove_analyze` 会在引擎内部**真正落子**（gtp.cpp:2016
// playChosenMove=true → :810 bot->makeMove）——落子轮结束后引擎盘面 = 我们记录的
// 局面 + 它自己那一步，此时增量同步的基准是错的（会多出一颗幽灵子、行棋方错位，
// 分析结果整体失真）。任何落子轮收尾/被打断都把基准标脏，下一轮全量重摆（几毫秒
// 的管道开销，换正确性）；持续分析改用 kata-analyze（不落子）后正常路径不受影响。
let kataLiveDirty = false;
// **旧分析收尾行的确定性归属**（09-27 真机定位「只有第一次开在计算、点一手没反应」根因）：
// 打断旧 genmove（换手/stop）后引擎 stopAndWait 会吐一个旧收尾行（play X / = X）。
// 旧实现用布尔标志「丢下一个收尾行」——但收尾行到达时 active 可能恰好为空（stop
// 之后没有新轮），被 parseKataOutput 的 `!active` 提前丢弃、标志没人消费，于是
// **永久残留**，把下一轮真正的收尾行吃掉：那一轮永远不 finish、面板永远「思考中」、
// 引擎空转（真机日志实锤：play G7 之后再无任何 analyze/runKata）。
// 现在按「待收输出窗口」计数：打断一个在跑的搜索 +1（等它那条旧收尾行）、每发一条
// 会应答 `=` 的 setup 命令 +1；收到 `=`/`?`/丢弃收尾行各 -1；**收到任何 info 行即
// 清零**（info 只可能出现在 setup 全部应答之后）。收尾行只在窗口 >0 时判为旧尾巴。
// 该判定与打断时机无关，且窗口最迟被第一条 info 关闭——不会再有永久残留。
let kataSetupAcks = 0;
// **本轮 setup 命令的下发时刻**（10-01 「落子后旧选点残余」根因修复用）：首个裸 "="
// 应答到达前丢弃 info 残行的判定要用它兜底防挂死。
let kataRoundCommandsAt = 0;
// **本轮是否已见到首个裸 "=" 应答**（协议硬边界）：gtp.cpp 顺序应答——新轮自己的
// info 必然在它的第一个 `=` 应答（含搜索前导 =）**之后**；在此之前到达的 info 必是
// 旧搜索躺在输出管道里的残行（详见 parseKataOutput 的 info 分支）。
let kataSeenRoundAck = true;
// **native rapfi 的轮次边界守卫**（2026-10-01，同 kataSeenRoundAck 的用意）：
// 本轮 START 的 "OK" 应答到达前的输出一律丢弃（详见 parseOutput）。
let rapfiRoundAckSeen = true;
let rapfiRoundCommandsAt = 0;
// **静默看门狗（两级）**：万一收尾行因任何意外没被认领（或搜索根本没跑起来），
// active 会永久悬挂、面板卡「思考中」——旧实现的实际表现，用户无法自救。
// 正常引擎每 0.4s 必出一条 info，静默只可能意味着「搜索已结束但收尾行没认领」
// 或「进程僵死」。两级宽限：
//   · first＝首帧 info 的宽限（冷机首次大评估可能慢，但不会 15s 无声）——超时说明
//    搜索命令根本没生效，如实收尾让 App 走重试/降级；
//   · idle＝每帧 info 之后的静默宽限——用当前最强快照收尾，UI 永不悬挂。
// 预算制（落子/提示）本来就有 deadline+宽限兜底，不挂看门狗。
const KATA_SILENCE_MS = 6000;             // 持续分析：0.4s/帧，6s 静默即异常
const KATA_FIRST_INFO_MS = 15000;
const KATA_UNLIMITED_IDLE_MS = 20000;     // 不限时落子轮：用户要「一直想」，宽限放大
const KATA_UNLIMITED_FIRST_MS = 30000;
let kataSilenceTimer = null;
function clearKataSilence() {
  if (kataSilenceTimer !== null) { clearTimeout(kataSilenceTimer); kataSilenceTimer = null; }
}
function kataSilenceDelays(request) {
  if (request.continuous) return { first: KATA_FIRST_INFO_MS, idle: KATA_SILENCE_MS };
  if (request.unlimited) return { first: KATA_UNLIMITED_FIRST_MS, idle: KATA_UNLIMITED_IDLE_MS };
  return null;
}
function armKataSilence(request, atStart) {
  const delays = kataSilenceDelays(request);
  if (!delays) return;
  clearKataSilence();
  kataSilenceTimer = setTimeout(() => {
    kataSilenceTimer = null;
    if (!active || active !== request || request.finished) return;
    // 有候选就用当前最强点收尾；一个候选都没有才是真的失败，交给 finish 报错
    // （不吞问题：App 会据此走重试/降级，而不是永远转圈）。
    finish(request, request.bestMove || (request.stats.candidates.length ? request.stats.candidates[0].move : null), request.stats);
  }, atStart ? delays.first : delays.idle);
}
/** 每条 info 行续期（只有挂了看门狗的轮次需要）。 */
function touchKataSilence() {
  if (active && !active.finished && isKataFamily() && kataSilenceDelays(active)) armKataSilence(active, false);
}
let kataCalibPromise = null;           // 进行中的标定（同进程只允许一条，重试不得并发重跑）
const KATA_CALIB_ROUNDS = 4;           // 首手弃掉 → 有效样本 3
const KATA_CALIB_BUDGET_S = 1.0;
const KATA_CALIB_TIMEOUT_MS = 15000;
// 持续制的「安全上限」：等价弈境的 maxTime 1e10（不自行收尾，只被新命令/stop
// 打断）。取 100000 秒而不是 1e10——上游对超大浮点的解析路径未核实，十万秒
// 远超任何单次会话，语义相同。
const KATA_CONTINUOUS_MAX_TIME_S = 100000;

// GTP 坐标：字母列跳过 I（15 路 = A-O 去 I，与 GTP 标准一致）；行号从下往上。
const GTP_LETTERS = "ABCDEFGHJKLMNOP";
const gtpVertex = (row, col, size) => `${GTP_LETTERS[col] || "?"}${size - row}`;
function parseGtpVertex(token, size) {
  // 字母范围 A-H / J-P（共 15 个，跳过 I）——写 [A-HJ-NP] 会漏掉 O 列，
  // O 列的着法会被判非法、整轮收尾成"引擎未返回合法落点"。
  const m = String(token || "").trim().match(/^([A-HJ-P])(\d{1,2})$/i);
  if (!m) return null;
  const col = GTP_LETTERS.indexOf(m[1].toUpperCase());
  const row = size - Number(m[2]);
  if (col < 0 || row < 0 || row >= size) return null;
  return { row, col };
}
const isAlternatingSequence = (moves) => moves.every((point, index) => point.player === (index % 2 === 0 ? "black" : "white"));

const post = (message) => self.postMessage(message);
// 诊断通道（默认关闭，零开销）：worker 内关键决策点经主线程桥写进原生插件的外部
// 日志文件（排查「引擎不动」这类只能真机复现的问题；worker 里没有 alert，console
// 在 release 也不转发，那是唯一可靠通道）。关着时每次调用只是一次布尔判断。
const KATA_DIAG_ENABLED = true;
const diag = (text) => { if (KATA_DIAG_ENABLED) self.postMessage({ type: "kata-diag", text }); };
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
  if (!Number.isFinite(request.deadline)) return;   // kata 等 markSearchStart 给出真实起点
  const delayMs = Math.max(0, request.deadline - performance.now());
  request.stopTimer = setTimeout(() => {
    if (!active || active !== request || request.finished || request.stopRequested) return;
    request.stopRequested = true;
    // Ask Rapfi to publish the best result accumulated within the requested
    // budget. The engine may answer synchronously or on a later stdout turn.
    send(stopCommand());
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
  clearKataSilence();
  if (!move) {
    active = null;
    post({ type: "error", requestId: request.requestId, generation: request.generation, message: isKataFamily() ? "KataGo 未返回合法落点" : "Rapfi 未返回合法落点" });
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
    // kata 路径下**不覆盖 nodes**：候选的 nodes 是它自己的子节点访问数，
    // stats.nodes 是根访问数（整帧候选之和），两者不是一个量。终局行登记时
    // 用后者覆盖前者会让「首选候选」的访问数虚高（回归测试实测 13 → 20）。
    // rapfi 路径没有这个区分（它的 stats.nodes 就是该候选的节点数）。
    const keepKataVisits = isKataFamily() && typeof matching.nodes === "number";
    Object.assign(matching, { move, pvIndex: -1, score: stats.primaryScore ?? stats.score, winRate: stats.primaryWinRate ?? stats.winRate, ...(keepKataVisits ? {} : { nodes: stats.totalNodes || stats.nodes }), depth: stats.depth, principalVariation: primaryLine });
  } else stats.candidates.push({ move, pvIndex: -1, score: stats.primaryScore ?? stats.score, winRate: stats.primaryWinRate ?? stats.winRate, nodes: stats.totalNodes || stats.nodes, depth: stats.depth, principalVariation: primaryLine });
  const elapsedMs = performance.now() - request.started;
  // Root move ordering (history/killer heuristics) makes the engine emit PV
  // lines 2..N that were only probed at shallow depth — displaying them reads
  // as "random far-apart candidate points". Keep a secondary line only when it
  // was searched nearly as deep as the principal variation (threshold lowered
  // 8→4 with searchedCandidates, 2026-09-11: candidates appear ~1s earlier).
  // 具体过滤见 candidateVisible()（KataGo 走另一套：order 排序、无深度）。
  // 本轮结束：把「本局面累计到现在的节点」留给下一轮接着算（见 continuousNodesBase）。
  // 必须在这里定格——stats 会在下一轮 run() 里被清零。
  const cumulativeNodes = request.continuous ? reportedNodes(request) : (stats.totalNodes || stats.nodes || 0);
  if (request.continuous) continuousNodesBase = cumulativeNodes;
  active = null;
  const candidates = (stats.candidates || []).slice()
    .filter((candidate) => candidateVisible(candidate, stats))
    .sort((a, b) => (a.pvIndex ?? 99) - (b.pvIndex ?? 99)).slice(0, request.nBest).map((candidate) => ({
    move: candidate.move,
    // pvIndex 必须带走：App 侧靠它判断「哪一个是引擎的首选」（pvIndex<=0），
    // 丢了这个字段会让「首选点」判定退化（对局提示、候选高亮都受影响）。
    pvIndex: candidate.pvIndex ?? 0,
    ...(candidate.score === undefined ? {} : { score: candidate.score }),
    ...(candidate.winRate === undefined ? {} : { winRate: candidate.winRate }),
    ...(candidate.nodes === undefined ? {} : { nodes: candidate.nodes }),
    ...(candidate.depth === undefined ? {} : { depth: candidate.depth }),
    ...(candidate.drawRate === undefined ? {} : { drawRate: candidate.drawRate }),
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
      reason: isKataFamily() ? activeVariant : "rapfi",
      source: isKataFamily() ? activeVariant : "rapfi",
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

/** 候选可见性：Rapfi 靠深度过滤浅层 PV 副产品；KataGo 的候选来自 analyze 流
 *  （按引擎 order 排序、无深度信息），全收，由 finish 排序后截 topN。 */
function candidateVisible(candidate, stats) {
  // KataGo 系（本机旗舰 + iKataGo 云引擎）走同一套：按引擎给的 order 排序号过滤。
  // **必须同时覆盖 ikatago**——漏掉它会让云引擎落到下面的 Rapfi 分支，而那条要求
  // `candidate.depth >= minDepth`，可 KataGo 的 info 帧根本没有 depth 字段（恒
  // undefined → 0），于是除 order 0 之外**所有候选都被过滤掉**，面板上只剩一个点
  // （用户 09-29 报「引擎又没有选点了」的根因）。
  if (activeVariant === "kata" || activeVariant === "ikatago") return (candidate.pvIndex ?? 99) <= 50;
  const minDepth = Math.max(2, (stats.depth || 0) - 8);
  return (candidate.pvIndex ?? 99) <= 0 || (candidate.depth ?? 0) >= minDepth;
}

// See finish(): drop shallow PV byproducts from live progress too.
function searchedCandidates(stats) {
  // 候选早现门槛：T12 曾用 max(8, 深度-8) 防浅层 PV 随机点，但滚动分析每轮/
  // 换面都要从 0 爬深度，用户实测「好几秒才有选点」（2026-09-11）——深度 4
  // 的 PV 已相当可靠，降到 max(4, 深度-8)：首轮约 1s 内出候选。primary 恒保留。
  return (stats.candidates || []).filter((candidate) => candidateVisible(candidate, stats));
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

function rememberCandidate(request, move, options) {
  const stats = request.stats;
  const key = `${move.row}:${move.col}`;
  const existing = (stats.candidates || []).find((candidate) => `${candidate.move.row}:${candidate.move.col}` === key);
  // Iterations stream in at their own pace; an older/shallower line must
  // never downgrade data already captured from a deeper iteration.
  if (existing && (existing.depth ?? 0) > (stats.depth ?? 0)) return;
  // kata 路径：候选的 visits 来自它自己那行 info（rememberKataLine 写入），而
  // stats.nodes 是**根访问数**（整帧候选之和）——两者不是一个量。终局行
  // （`play X` / `= X`）再次登记同一着法时若照搬 stats.nodes，会把该候选的
  // visits 覆盖成根总量（回归测试实测：13 → 20）。所以 kata 路径下保留原值。
  const keepVisits = options && options.keepExistingVisits && existing && typeof existing.nodes === "number";
  const next = {
    move,
    pvIndex: stats.pvIndex,
    ...(stats.score === undefined ? {} : { score: stats.score }),
    ...(stats.winRate === undefined ? {} : { winRate: stats.winRate }),
    ...(keepVisits || (stats.nodes === undefined && stats.totalNodes === undefined) ? {} : { nodes: stats.totalNodes || stats.nodes }),
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
  // **轮次起点守卫（native rapfi，2026-10-01）**：旧轮被新命令中止时，引擎会把旧
  // 搜索的收尾输出（最后几条 INFO/MESSAGE + 终局裸坐标）排在 START 的 "OK" 应答
  // **之前**（设备实测：`MESSAGE Speed … / 6,5 / OK` 就是这个顺序）。这些残行若被
  // 算进新轮，就是用户看到的「前面的胜率/选点残留」，终局坐标还会被记成新轮的
  // bestMove。丢弃「本轮 OK 之前」的一切输出——与 kata 的「首个裸 = 之前丢弃」
  // 同构；升级 0.43.02 后时间管理变化让旧搜索尾巴更长，残留因此变明显。
  // 兜底：>1.5s 等不到 OK 视为异常放行（宁可短暂残留也不能吞掉整轮）。
  if (text === "OK" || text.startsWith("OK ")) { rapfiRoundAckSeen = true; return; }
  if (!rapfiRoundAckSeen) {
    if (performance.now() - rapfiRoundCommandsAt < 1500) return;
    rapfiRoundAckSeen = true;
  }
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
        send(stopCommand());
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

// ---- KataGo（GTP）解析层 ------------------------------------------------
// 本构建（ONNX-CPU 分支）的 kata-genmove_analyze 应答格式，已对真机逐字节核实：
//   1) 先打一行裸 "="（源码：genMove 之前先输出等号，避免线程竞争导致顺序错乱）；
//   2) 搜索中流式输出 info 行，且**每行是整个根节点候选列表的一项**
//      （order 0 是最佳着，后面依次变弱，还有 isSymmetryOf 标记的对称重复点）；
//   3) 收尾打一行 "play <vertex>"（不是 "= <vertex>"！源码 playChosenMove 路径），
//      随后空行结束应答。
// 因此：只有 order 0 的行能更新根节点统计（否则会被最后一名的 visits/winrate 覆盖），
// 对称重复点不入候选，终局认 "play " 行。
function rememberKataLine(request, text) {
  // 对称重复点（同一着法的镜像/旋转等价）：不入候选，否则面板会出现多个同值点。
  if (/\bisSymmetryOf\b/.test(text)) return;
  const orderMatch = text.match(/\border\s+(\d+)/i);
  const isPrimary = !orderMatch || Number(orderMatch[1]) === 0;
  const stats = request.stats;
  // PV 交替着色，首格是行棋方（request.player）
  let lineMoves = null;
  const pv = text.match(/\bpv\s+(.+)$/i);
  if (pv) {
    const tokens = pv[1].trim().split(/\s+/);
    lineMoves = [];
    for (let i = 0; i < tokens.length && i < 40; i += 1) {
      const point = parseGtpVertex(tokens[i], request.size);
      if (!point) break;
      point.player = i % 2 === 0 ? request.player : otherPlayer(request.player);
      lineMoves.push(point);
    }
  }
  const visits = text.match(/\bvisits\s+(\d+)/i);
  const winRate = text.match(/\bwinrate\s+(-?[\d.]+)/i);
  // 和棋率：本构建把 scoreMean 字段复用为 drawrate（gtp.cpp:649 逐行核实），
  // 每个候选各带一份（不只是 order 0）——「选点显示内容=和棋率」要用。
  const drawRateMatch = text.match(/\bscoreMean\s+(-?[\d.]+)/i);
  // **胜率视角（两个独立真机局面交叉验证）**：cfg 的 reportAnalysisWinratesAs=
  // SIDETOMOVE 配合 gtp.cpp:637-643 的翻转逻辑，输出的 winrate **就是行棋方视角**
  // （黑行棋输出黑、白行棋输出白）：空盘黑行棋输出 ≈0.97（黑大优，合理）、黑优
  // 局面白行棋输出 ≈0.065（白 6.5%，合理）。App 侧的 mover→黑方换算正好匹配，
  // **这里原样透传，任何再折算都会把黑白颠倒**（1.2.7 曾按"恒为白方视角"折算，
  // 装机实测空盘显示黑方胜率 3%，已撤）。
  if (isPrimary) {
    // 根节点的**胜率/PV**只认最佳着那一行（order 0）。
    // 注意：**访问数不在这里取**——order 0 的 visits 只是最佳着自己的子节点访问数，
    // 中后盘远小于根访问数（真机实测差到 6 倍，面板「速度」因此长期偏低）。
    // 根访问数由 accumulateKataFrameVisits 按「整帧候选之和」统一写入。
    if (winRate) {
      stats.winRate = normalizeWinRate(Number(winRate[1]));
      stats.primaryWinRate = stats.winRate;
    }
    if (lineMoves) stats.bestline = lineMoves;
    // **和棋率**：本构建的 gtp.cpp:649 把 scoreMean 字段复用为 drawrate
    // （源码逐行核实：`out << " scoreMean " << drawrate;`，drawrate = 100 × noResultValue，
    // 单位是百分数 0~100）。所以 scoreMean 在这里**不是评估分**，是「和棋率%」。
    // 面板因此把它显示为「和棋率」，绝不进评估分槽位（否则恒为 0，误导用户）。
    const scoreMean = text.match(/\bscoreMean\s+(-?[\d.]+)/i);
    if (scoreMean) {
      const pct = Number(scoreMean[1]);
      if (Number.isFinite(pct)) stats.drawRate = Math.max(0, Math.min(100, pct));
    }
  }
  const moveMatch = text.match(/^info\s+move\s+(\S+)/i);
  const move = moveMatch ? parseGtpVertex(moveMatch[1], request.size) : null;
  if (!move) return;
  // 还没被搜过的着法（visits 0，纯先验）不进候选：它们的位置近乎随机，混进
  // Top-N 就是「选点飘忽不定、飘得老远」（用户 09-27 报）。
  const visitCount = visits ? Number(visits[1]) : null;
  if (visitCount === 0) return;
  // 候选按行自带数值记录（不能借 stats——那是根节点/最佳着的数值）。
  // pvIndex 用引擎的 order 排序号：finish 按它排序后截 topN 就是引擎自己的强弱序。
  const order = orderMatch ? Number(orderMatch[1]) : 0;
  const key = `${move.row}:${move.col}`;
  const existing = (stats.candidates || []).find((candidate) => `${candidate.move.row}:${candidate.move.col}` === key);
  const next = {
    move,
    pvIndex: order,
    ...(winRate ? { winRate: normalizeWinRate(Number(winRate[1])) } : {}),
    ...(visits ? { nodes: visitCount } : {}),
    // 和棋率：本构建把 scoreMean 字段复用为 drawrate（gtp.cpp:649），每个候选各带一份，
    // 供「选点显示内容 = 和棋率」时展示（用户 09-29 要求它像胜率/计算量一样可选）。
    ...(drawRateMatch ? { drawRate: Math.max(0, Math.min(100, Number(drawRateMatch[1]))) } : {}),
    principalVariation: lineMoves || [],
  };
  if (existing) Object.assign(existing, next);
  else stats.candidates.push(next);
}

/** kata 的「速度」＝访问/秒：引擎 info 不报速率，用相邻两帧的访问增量现算。
 *  旧实现用「根访问数 ÷ 本轮已进行时间」——持续制下一轮可以跑几分钟，这个数会
 *  一路掉到个位数（用户 09-27 报「速度缩水一百倍」）。采样放在节流之前，保证
 *  即使本帧被节流，速度窗口也连续。 */
function updateKataSpeed(request) {
  const visits = request.stats.totalNodes || request.stats.nodes || 0;
  if (!visits) return;
  const now = performance.now();
  const prev = request.speedSample;
  if (prev && visits > prev.visits && now - prev.t >= 250) {
    request.stats.speed = Math.round((visits - prev.visits) / ((now - prev.t) / 1000));
    request.speedSample = { visits, t: now };
  } else if (!prev || visits < prev.visits) {
    request.speedSample = { visits, t: now };
  }
}

/** 发一次 progress（带 100ms 节流）。整行候选解析完后调用（见 parseKataOutput）。 */
function emitKataProgress(request) {
  updateKataSpeed(request);
  if (performance.now() - (request.lastProgressAt || 0) < 100) return;
  request.lastProgressAt = performance.now();
  // drawRate：本构建的和棋率（%），来自 order 0 的 scoreMean 字段（见 rememberKataLine）
  post({ type: "progress", requestId: request.requestId, generation: request.generation, variant: activeVariant, depth: request.stats.depth || 0, selDepth: request.stats.selDepth || 0, nodes: reportedNodes(request), speed: requestSpeed(request), score: request.stats.score, winRate: request.stats.winRate, drawRate: request.stats.drawRate, candidates: searchedCandidates(request.stats) });
}

/** 解析**单条** info 记录（一条 = 一个候选 + 它的数值）。
 *  parseKataOutput 负责把「一行多候选」的怪格式切成多条再调这里。 */
/** 累计本帧的**根访问数**（= 非对称候选 visits 之和），写入 stats.nodes/totalNodes。
 *
 *  为什么不能用 order 0 那一行的 visits：那是**最佳着自己的子节点**访问数，不是
 *  根节点访问数。中后盘候选多、分布散，两者能差好几倍。真机实测（KZM，作者网，t16）：
 *      局面 A（6 子）：order0=644  非对称之和=823  引擎日志自报 Root visits=824 → 比值 0.999
 *      局面 B（空盘 1 子，8 重对称）：order0=481  非对称之和=582  自报 583 → 比值 0.998
 *  含对称重复点之和在局面 B 是 2460（**虚高 4.2 倍**）——对称点是同一节点的镜像，
 *  visits 相同，必须排除。
 *  面板「速度」长期偏低就是这么来的（用户 09-28 报「稳定 20-60、平均 30-40」，
 *  引擎实际 92.9 访问/秒；order0 口径只有 15.6，差 5.96 倍）。
 *
 *  帧边界：引擎每帧都从 order 0 开始**完整重报**根节点候选列表，所以遇到 order 0
 *  就重置累计器。这样两种输出形态都能算对——本构建把整批候选挤在一行（一次调用
 *  拿到全部记录），上游格式是一行一个候选（多次调用、逐条累加）。
 */
function accumulateKataFrameVisits(request, records) {
  if (!request || !records.length) return;
  const stats = request.stats;
  let accum = request.kataFrameAccum;
  for (const rec of records) {
    // 对称重复点与本体共享同一个搜索节点，计入会双计（空盘等对称局面能翻好几倍）。
    if (/\bisSymmetryOf\b/i.test(rec)) continue;
    const v = rec.match(/\bvisits\s+(\d+)/i);
    if (!v) continue;
    const om = rec.match(/\border\s+(\d+)/i);
    if (om && Number(om[1]) === 0) accum = 0;   // order 0 = 新一帧
    accum = (accum || 0) + Number(v[1]);
  }
  if (!accum) return;
  request.kataFrameAccum = accum;
  stats.nodes = accum;
  stats.totalNodes = accum;
}

function parseKataRecord(text) {
    rememberKataLine(active, text);
    accumulateKataFrameVisits(active, [text]);
    emitKataProgress(active);
    // 做题/提示场景的「已证胜即停」（与 rapfi 路径同一契约）：胜率饱和说明答案
    // 已证明，提前收手别让用户白等满预算。停止后引擎会回 "play X"，走终局分支。
    if (active.stopOnProvenWin && !active.provenWinStopSent
        && typeof active.stats.primaryWinRate === "number" && active.stats.primaryWinRate >= 0.999) {
      active.provenWinStopSent = true;
      active.stopRequested = true;
      if (active.stopTimer) { clearTimeout(active.stopTimer); active.stopTimer = null; }
      send(stopCommand());
      active.stopTimer = setTimeout(() => {
        if (!active || active !== request || active.finished) return;
        finish(request, request.bestMove || (request.stats.candidates.length ? request.stats.candidates[0].move : null), request.stats);
      }, 800);
    }
}

function parseKataOutput(line) {
  if (typeof line !== "string") return;
  const text = line.trim();
  // 空行只是格式（真机日志里每条 `=` 应答后跟一个空行），**不能**算作应答——
  // 旧写法把空行也计入会以两倍速度关窗口，窗口提前关闭时旧收尾行会被误认成本轮
  // 终局行（正是「点一手没反应」的镜像错误）。
  if (!text) return;
  // setup 应答（裸 "="）/ GTP 拒绝（"?"）：关一格「待收输出窗口」。这两类必须在
  // `!active` 之前处理——stop 之后没有新轮、active 为空时它们照样会到达，漏计
  // 会让窗口关不掉（旧布尔标志就是这样被永久污染的）。
  if (text === "=") { if (kataSetupAcks > 0) kataSetupAcks -= 1; kataSeenRoundAck = true; return; }
  if (text.startsWith("?")) {
    if (kataSetupAcks > 0) kataSetupAcks -= 1;
    kataSeenRoundAck = true;
    if (active) post({ type: "log", message: "KataGo 拒绝命令：" + text.slice(0, 140) });
    return;
  }
  if (kataCalib) { handleKataCalibLine(text); return; }
  if (!active) return;                                     // 与请求无关的启动输出
  if (/^info\b/i.test(text)) {
    // **本轮首个裸 "=" 之前到达的 info 是旧搜索的管道残留——整行丢弃**（10-01 定位
    // 的「落子后旧选点残余、新思考的点慢慢覆盖旧点」根因，用户长期反馈终于闭环）：
    // 换手时新轮的 setup 命令经 any-input-line 打断旧搜索（gtp.cpp:1288），但旧搜索
    // **最后几帧 info 还躺在输出管道里**，排在新轮的 `=` 应答**之前**被读出。原实现
    // 见到 info 就清零窗口并把残行归给 active（=新轮），rememberKataLine 按坐标合并
    // → 新轮候选 = 旧点 + 新点的**并集**：旧选点残留到新搜索恰好访问到同一坐标才被
    // 覆盖，访问不到的永远挂着旧数值；isPrimary 残行还会把上一手的胜率写进新轮的
    // stats.winRate——这正是用户反复报的「胜率/选点残留」。小网搜得宽、每帧候选多，
    // 残行也多，所以「小网尤其严重」。
    // 判据是协议硬边界（gtp.cpp 顺序应答）：新轮自己的 info 必然在它的第一个裸 "="
    // 之后；「info 且尚未见过本轮 `=`」⇔ 旧搜索残行，不依赖时序猜测。
    // 兜底防挂死：若因任何意外迟迟等不到 `=`（>2s），视为异常放行——宁可短暂并集，
    // 也不能把新轮的帧吞光（1.1.8.11 增量同步回归的教训）。
    if (!kataSeenRoundAck) {
      if (performance.now() - kataRoundCommandsAt < 2000) return;
      kataSeenRoundAck = true;
    }
    kataSetupAcks = 0;
    touchKataSilence();
    // **本构建把整批候选挤在同一行**（真机实测：14 个 `info move …` 连成一串，
    // 只有行首有换行）——所以不能按「一行一个候选」解析：原先 rememberKataLine
    // 只会拿到第一个候选的 visits/winrate/order，其余候选的数值全是 undefined，
    // 面板因此「只有选点、没有胜率/计算量」（用户 09-26 报）。
    // 按 `info move` 把这一行切成多条记录，**全部解析完再发一次 progress**——
    // 逐条发的话节流器（100ms）只放行第一条，同行的其余候选要等 finish 才
    // 出现，看起来就是「选点一个个冒」（用户 09-26 对比 rapfi 的差异点）。
    const parts = text.split(/(?=\binfo move\b)/i).filter((chunk) => /^info move\b/i.test(chunk.trim()));
    if (parts.length > 1) {
      const records = parts.map((part) => part.trim());
      for (const rec of records) rememberKataLine(active, rec);
      // 根访问数 = 本帧非对称候选 visits 之和（对称重复点双计会虚高数倍，见函数注释）
      accumulateKataFrameVisits(active, records);
      emitKataProgress(active);
      return;
    }
    parseKataRecord(text);
    return;
  }
  if (text.startsWith("= ")) {
    // **旧分析的迟到收尾行**（09-27 真机定位的死锁根因）：落子轮（kata-genmove_
    // analyze）被打断时引擎 stopAndWait 会先吐旧收尾行，再依次应答我们新发的
    // setup 命令。所以「窗口未关时到达的收尾行」必是旧尾巴——丢弃并关一格窗口；
    // 窗口关闭后（或已被 info 清零）到达的才是本轮真正的终局行。持续分析用
    // kata-analyze（不落子、无收尾行），主路径根本不会产生旧尾巴。
    if (kataSetupAcks > 0) { kataSetupAcks -= 1; return; }
    // 常规 GTP 应答（setup 命令，或其它构建的 genmove 格式）。即使 parse 失败
    // 也要收尾（别把请求挂死）。
    const move = parseGtpVertex(text.slice(2), active.size);
    const finalMove = move || active.bestMove || (active.stats.candidates.length ? active.stats.candidates[0].move : null);
    if (move) { active.bestMove = move; rememberCandidate(active, move, { keepExistingVisits: true }); }
    finish(active, finalMove, active.stats);
    return;
  }
  const playResponse = text.match(/^play\s+(\S+)$/i);
  if (playResponse) {
    // 本构建（ONNX-CPU 分支）kata-genmove_analyze 的终局行：play <vertex>
    if (kataSetupAcks > 0) { kataSetupAcks -= 1; return; }
    const move = parseGtpVertex(playResponse[1], active.size);
    if (move) { active.bestMove = move; rememberCandidate(active, move, { keepExistingVisits: true }); }
    finish(active, move || active.bestMove || (active.stats.candidates.length ? active.stats.candidates[0].move : null), active.stats);
    return;
  }
  // 其余（启动 banner、Chat: 行等）忽略。
}

// ---- KataGo 启动标定（标定协议 v1）---------------------------------------
// 4 手空盘 genmove@1s：第 1 手含模型加载尾延迟弃掉，取后 3 手
// overhead = median(墙钟) − 1.0。此后每手预算 = 档位秒数 − overhead − 余量，
// 保证任何机型上用户等待都是档位值、机器快慢只体现在搜索量（棋力）上。
/** 同一时刻只允许一条标定在跑：启动重试复用进行中的那条（并发重跑会让两条
 *  标定写同一个 kataCalib、GTP 应答互相交错，测出的开销不可信）。 */
function calibrateKataOnce() {
  if (!kataCalibPromise) {
    kataCalibPromise = calibrateKata().finally(() => { kataCalibPromise = null; });
  }
  return kataCalibPromise;
}
function calibrateKata() {
  return new Promise((resolve) => {
    kataCalib = { times: [], rounds: 0, t0: 0, timer: null, resolve };
    kataCalib.timer = setTimeout(() => finishKataCalib(true), KATA_CALIB_TIMEOUT_MS);
    // 显式摆好标定局面：15 路空盘 + 自由规则（无禁手、不会提前判胜/禁手中断），
    // 保证测到的是「一次完整预算搜索」的墙钟，而不是默认盘面/规则下的异常路径。
    post({ type: "kata-command", line: "boardsize 15" });
    post({ type: "kata-command", line: "clear_board" });
    post({ type: "kata-command", line: "kata-set-rule basicrule freestyle" });
    kataCalibRound();
  });
}
function kataCalibRound() {
  if (!kataCalib) return;
  kataCalib.t0 = performance.now();
  post({ type: "kata-command", line: `kata-set-param maxTime ${KATA_CALIB_BUDGET_S.toFixed(2)}` });
  // 不带 interval：用引擎配置的默认汇报频率（省得猜 interval 的单位是厘秒还是访问数）。
  post({ type: "kata-command", line: "kata-genmove_analyze" });
}
function handleKataCalibLine(text) {
  // 本构建 kata-genmove_analyze 的收尾行是 "play <vertex>"（真机核实）；
  // 兼容其它构建的 "= <vertex>"。注意裸 "=" 是应答起始行，不能算作完成。
  if (!/^play\s+\S+$/i.test(text) && !/^=\s+\S/.test(text)) return;
  const elapsed = (performance.now() - kataCalib.t0) / 1000;
  kataCalib.times.push(elapsed);
  kataCalib.rounds += 1;
  // 标定进度：55% 起（模型加载完），每轮 +10%，到 95% 留给「就绪」
  postKataLoading(Math.min(95, 55 + kataCalib.rounds * 10), `标定本机性能（${kataCalib.rounds}/${KATA_CALIB_ROUNDS}）`);
  if (kataCalib.rounds < KATA_CALIB_ROUNDS) { kataCalibRound(); return; }
  finishKataCalib(false);
}
function finishKataCalib(timedOut) {
  if (!kataCalib) return;
  if (kataCalib.timer) clearTimeout(kataCalib.timer);
  const { times, resolve } = kataCalib;
  kataCalib = null;
  // 首手弃掉（含模型加载尾延迟）；样本 <2 或超时 → 保守默认
  const samples = times.slice(1);
  if (samples.length >= 2) {
    const sorted = samples.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    kataOverhead = Math.max(0, Math.min(1.0, median - KATA_CALIB_BUDGET_S));
  } else {
    kataOverhead = 0.10;
  }
  post({ type: "log", message: `KataGo 标定完成：每手固定开销 ≈ ${(kataOverhead * 1000).toFixed(0)}ms${timedOut ? "（超时兜底）" : ""}` });
  resolve();
  // 标定期间被挡在池子里的请求现在可以上路了（drain 的 kataCalib 闸门刚打开）
  drain();
}

function send(command) {
  if (engine) engine.sendCommand(command);
  else diag("send DROPPED (no engine): " + command);
}

/** 「KataGo 系」变体（本机旗舰 + iKataGo 云引擎）：协议、解析、命令序列完全同构，
 *  凡按 KataGo 语义分流的地方都必须用它，而不是逐个 `=== "kata"`——漏一处就会让
 *  云引擎走到 Rapfi 分支（用户 09-29 报「云端没选点」就是这个原因）。 */
const isKataFamily = () => activeVariant === "kata" || activeVariant === "ikatago";

/** 收尾命令按变体分流：Rapfi 用 YXSTOP，KataGo/iKataGo 是标准 GTP 的 stop。 */
const stopCommand = () => (activeVariant === "kata" || activeVariant === "ikatago" ? "stop" : "YXSTOP");

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
  // 预算从「引擎真正开始为这一手搜索」起算，而不是请求入队时刻。
  // 原先用 request.started（入队瞬间）算 deadline：旗舰冷启动要 6 秒加载模型，
  // 若盘面档位只有 2 秒，引擎还在加载、计时器就到期 → 发 stop → 没有合法落点
  // → finish 报 error → App 判定「旗舰引擎启动失败」并**杀掉正在加载的引擎**
  // 重试，新进程又从零开始，永远起不来（用户 09-26 报「非常容易启动未成功」）。
  // 现在 started 语义改为「真正开始搜索的时刻」：runKata 在 GTP 全部同步命令
  // 发完、genmove 发出前调用 markSearchStart()；rapfi 路径就在 run 里当场定。
  request.started = performance.now();
  const budgetMs = request.timeMs;
  const deferDeadline = isKataFamily();
  request.deadline = request.unlimited ? Number.POSITIVE_INFINITY
    : deferDeadline ? Number.POSITIVE_INFINITY          // 先不定，等 markSearchStart
    : request.started + budgetMs;
  request.pendingBudgetMs = deferDeadline ? budgetMs : 0;
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
  // KataGo 走 GTP 分支：stats/deadline/scheduleStop 等簿记已就绪，直接发 GTP 命令。
  if (isKataFamily()) { runKata(request); return; }
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
  // 本轮命令已发完：只有 native rapfi 需要等 START 的 OK 作轮次边界（见 parseOutput
  // 的守卫）。WASM 变体不设防——它同线程同步执行，不存在「旧搜索尾巴」这种跨轮残行，
  // 贸然丢弃反而可能吞掉它头 1.5 秒的正常输出。
  if (activeVariant === "native") {
    rapfiRoundAckSeen = false;
    rapfiRoundCommandsAt = performance.now();
  }
}

function drain() {
  diag(`drain: engine=${engine !== null} active=${active !== null} waiting=${waiting.length} kataCalib=${kataCalib !== null}`);
  if (!engine || active || !waiting.length) return;
  // 标定进行中不让请求上路：标定与请求共享同一条 GTP 流，而 parseKataOutput 在
  // kataCalib 期间把所有输出都当标定应答（否则标定墙钟会被请求的 info 行污染）。
  // 池子里等待即可——标定 ~4 秒后 finishKataCalib → drain() 自会放行。
  if (kataCalib) return;
  // **积压排空只跑最新**（10-01 「切换引擎无响应：加载完成、引擎在思考、就是没有
  // 信息输出」的根因）：引擎重启期间（loading）到达的请求在 waiting 里排队；就绪后
  // 若按 FIFO 逐个跑，最旧的「过期代」请求会占住 active——持续轮永不自行收尾，其帧
  // 又带着 App 已不认的旧 generation（App 侧全部丢弃）→ 引擎在算、面板无数据；而
  // App 以为自己的轮次还在跑、不再发新请求 → **双向死锁**。App 侧只认最新代，这里
  // 就只跑最新的那个，其余按 stopped 让路（它们的上代控制器早已被 App 换掉，stopped
  // 只是礼节性收尾）。正常运行时请求随到随跑、waiting 恒 ≤1，此分支不触发。
  while (waiting.length > 1) {
    const stale = waiting.shift();
    post({ type: "stopped", requestId: stale.requestId, generation: stale.generation });
  }
  run(waiting.shift());
}

// ---- KataGo（GTP）一轮请求 ------------------------------------------------
// 与 run() 的 Rapfi 序列对应：全量同步棋盘 → 下发预算 → 起搜索。
// 状态簿记（stats/deadline/scheduleStop/finish）由 run() 先行完成，此处只发命令。
function kataRuleName(rule) {
  // freestyle/standard 的差别只在长连是否算胜：standard 若分支不支持会在 QA 核实，
  // 应答 "? " 时 parseKataOutput 记 log，不中断请求（引擎按配置默认 RENJU 继续走）。
  return rule === "renju" ? "renju" : rule === "standard" ? "standard" : "freestyle";
}
function kataBudgetSeconds(timeMs) {
  // 标定协议 v1：预算 = 目标等待 − 本机每手固定开销 − 余量，下限 0.4s。
  const target = Math.max(0.1, (Number(timeMs) || 4000) / 1000);
  const margin = Math.max(0.05, 0.1 * kataOverhead);
  return Math.max(0.4, target - kataOverhead - margin);
}
/** 摆棋方案：决定用哪种命令序列把局面同步给引擎。
 *
 * 真机验收（2026-09-26，装机后的 katago-onnxcpu）实测三条：
 *   1. 本构建**没有 kata-set_position**（回 "? unknown command"，棋盘保持空盘——
 *      比报错更危险，会把空盘当目标局面分析）；
 *   2. `play` 接受任意颜色与顺序（同色连下、跳色都不会被拒，棋子全部正确落盘）；
 *   3. **下一手 = 最后一颗落子的反色**（空盘默认黑方）。
 * 因此：交替且行棋方与序列一致时按真实顺序 play（保留着法历史特征）；
 * 其余（白先习题等）把「行棋方的反色」一子放到最后，即可精确控制行棋方——
 * 颜色保持真实，胜率视角（SIDETOMOVE）与 PV 着色都不会错位。
 */
function kataPositionPlan(moves, mover) {
  const impliedMover = moves.length % 2 === 0 ? "black" : "white";
  if (isAlternatingSequence(moves) && (mover || "black") === impliedMover) {
    return { mode: "play", order: moves };
  }
  const desiredLast = mover === "white" ? "black" : "white";
  let pivotIndex = -1;
  for (let i = 0; i < moves.length; i += 1) if (moves[i].player === desiredLast) pivotIndex = i;
  if (pivotIndex < 0) return { mode: "unsupported" };
  const rest = moves.filter((_, index) => index !== pivotIndex);
  return { mode: "play", order: [...rest, moves[pivotIndex]] };
}
/** kata 的预算时钟起点：setup 命令发完、genmove 即将发出的时刻。
 *  与 run() 的 request.pendingBudgetMs 配合（见那里的注释：不能把模型加载
 *  与 setup 往返算进搜索预算，否则冷启动必然「预算耗尽却没有落点」）。
 *  持续分析（A 项改造）：**不设 deadline**——引擎在 info 流里持续产出，
 *  finish 只在「用户点停止 / 新局面到达（supersede）/ 胜率饱和」时发生，
 *  与弈境的持续制同构。预算制（落子/提示）照旧。 */
function markSearchStart(request) {
  if (!request || active !== request || request.finished) return;
  const budget = Number(request.pendingBudgetMs) || 0;
  request.started = performance.now();
  if (request.unlimited || request.continuous) {
    request.deadline = Number.POSITIVE_INFINITY;
    return;
  }
  request.deadline = request.started + budget;
  scheduleStop(request);
}

function runKata(request) {
  diag(`runKata: size=${request.size} moves=${request.moves.length} continuous=${request.continuous} activeVariant=${activeVariant} kataReady=${kataReady}`);
  // 盘面超上限（KataGo 五子棋分支编译到 15 路，超过连 GTP 坐标都拼不出来）：
  // App 选型阶段已让位给 Rapfi，这里是纵深守卫——预热过的 kata worker 可能
  // 收到别处（探测/旧请求）发来的超限局面。
  if (request.size > 15) {
    post({ type: "log", message: `KataGo 不支持 ${request.size} 路棋盘（编译上限 15 路），本手未搜索` });
    finish(request, null, request.stats);
    return;
  }
  // **恒全量重摆（2026-10-01 回退定案）**：09-27 曾因「引擎盘面 = 上次发的局面」
  // 守不住而改成恒重摆；10-01 我一度恢复增量同步，但真机实测：
  //   · 收益几乎为零——恒重摆 6 步累计 19/38/65/87/107/124，增量 16/34/51/74/102/119，
  //     曲线几乎重合（clear_board/play 不清 nnCacheTable，重摆只花几毫秒；真正重开
  //     搜索的是 kata-analyze 命令本身）；
  //   · **引入回归**：增量路径下每轮的 `=` 应答条数变了，而 `kataSetupAcks` 窗口是按
  //     「全量重摆 = 3 条 setup」算的 → 窗口计数错位 → **引擎吐的 info 帧被当成旧收尾行
  //     全部吞掉**（真机实证：82 帧 info、0 条 app:progress，面板只剩「思考中」）。
  // 结论：增量同步既无收益又有回归风险，恒全量重摆是正确选择（<200ms 开销换盘面绝对可信）。
  const canIncrement = false;
  if (!canIncrement) {
    send(`boardsize ${request.size}`);
    send("clear_board");
    send(`kata-set-rule basicrule ${kataRuleName(request.rule)}`);
    kataLiveDirty = false;             // 全量重摆后引擎盘面 = 本局面，基准恢复可信
  }
  const plan = kataPositionPlan(request.moves, request.player);
  if (plan.mode === "unsupported") {
    // 行棋方的反色一子都没有（真实对局不可能出现）：如实报错，别拿空盘凑合。
    post({ type: "log", message: "KataGo 无法表达该局面（缺少行棋方的反色子），本手未搜索" });
    finish(request, null, request.stats);
    return;
  }
  const newPoints = canIncrement ? plan.order.slice(kataLive.moves.length) : plan.order;
  for (const point of newPoints) {
    send(`play ${point.player} ${gtpVertex(point.row, point.col, request.size)}`);
  }
  // **待收输出窗口**（见 kataSetupAcks 的注释）：本轮会收到的「非本轮 info」输出
  // 条数 = 打断旧搜索留下的 1 条旧收尾行（若有）+ 每条 setup 命令各一个 `=` 应答
  // + 搜索命令自己的前导 `=`（gtp.cpp 在 analyze/genmove_analyze 开搜前先打一个
  // 裸 "="，真机日志可见）。
  const setupCount = (canIncrement ? 0 : 3) + newPoints.length + 1 + 1;   // +1 maxTime，+1 搜索前导 =
  kataSetupAcks = (request.pendingInterruptTail === true ? 1 : 0) + setupCount;
  kataRoundCommandsAt = performance.now();   // 旧搜索残行丢弃判定的兜底时钟（见 parseKataOutput）
  kataSeenRoundAck = false;                  // 首个裸 "=" 前的 info 一律是旧残行（见 parseKataOutput）
  // **持续分析（A 项核心，学弈境）**：maxTime 预算制下才是「本手时限」；持续分析
  // 下发一个极大的安全上限（弈境同款 maxTime 1e10 的等价物）——引擎持续搜索、
  // 每 0.4s 出一条 info，换手时新局面的 play 命令经 any-input-line 机制自动打断
  // 旧搜索（gtp.cpp:1288 实锤），原地接新局面——零延迟、缓存跨局面继承
  // （clear_board/play 都不清 nnCacheTable，源码实锤），同墙钟搜出更多访问。
  // 旧实现持续制不下发 maxTime，引擎按 cfg 的 30s 自行收尾——每 30s 白扔一次
  // 「收尾行 + 重启搜索」的往返，且收尾行的归属歧义正是死锁的来源之一。
  if (request.continuous || request.unlimited) {
    send(`kata-set-param maxTime ${KATA_CONTINUOUS_MAX_TIME_S}`);
  } else {
    send(`kata-set-param maxTime ${kataBudgetSeconds(request.timeMs).toFixed(2)}`);
  }
  // 汇报节奏（C 项）：显式 interval 40 厘秒 = 每 0.4s 一帧（弈境同款
  // reportDuringSearchEvery=0.4）；单位是厘秒（secondsPerReport = interval*0.01）。
  markSearchStart(request);
  // **两种搜索命令，语义差别是正确性的关键**（gtp.cpp 源码实证）：
  //   · 持续分析（continuous）→ `kata-analyze <行棋方> 40`：只搜不打子（analyze
  //     路径不 makeMove），引擎盘面始终 = 我们摆的局面 → 增量同步的基准可信、
  //     零延迟换手；也**不会**产生收尾行（被打断只是停止搜索），收尾行归属问题
  //     在分析主路径上彻底消失。
  //   · 需要落点的回合（提示/自对弈/人机对战，含不限时）→ `kata-genmove_analyze
  //     <行棋方>`：必须拿它的落点，代价是引擎内部真的落子（playChosenMove=true）
  //     → 基准标脏，下一轮全量重摆。
  // 行棋方必须是**当前该走的一方**（request.player）：旧实现硬编码 black，
  // 白先局面下引擎按黑方视角给候选——选点整批错位（09-27 真机日志实锤）。
  if (request.continuous) {
    // interval 10 厘秒 = 每 0.1s 一帧——**与参考软件（智子本地版）逐字一致**
    // （它的 dex 里就是 `kata-analyze 10`，用户 10-01 对照后要求对齐）。
    // 旧值 20（0.2s）是 09-30 那次"对标智子"的误解：注释写着对标，实际取了它两倍。
    // **不带行棋方参数**：parseAnalyzeCommand 里 player 是可选位，缺省用引擎盘面
    // 的行棋方（gtp.cpp:2193 getRootPla）——全量重摆后那就是真实行棋方。显式传参
    // 会覆盖盘面行棋方，App 侧一旦推错，整轮分析的就是错误的边。
    send("kata-analyze 10");
    armKataSilence(request, true);
  } else {
    send("kata-genmove_analyze");
    kataLiveDirty = true;              // 本轮结束/被打断时引擎会落下自己那一步
    armKataSilence(request, true);     // 不限时轮也挂（进程僵死时用快照收尾）
  }
  // 记录引擎当前局面（增量同步的基准；落子轮的脏标记在收尾时生效）
  kataLive.active = true;
  kataLive.size = request.size;
  kataLive.rule = kataRuleName(request.rule);
  kataLive.moves = request.moves.map((point) => ({ row: point.row, col: point.col, player: point.player }));
}

function startVariant(variant) {
  if (variant === "kata") return startKataVariant();
  if (variant === "ikatago") return startIkatagoVariant();
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

/** KataGo 原生变体：请主线程起进程；就绪后先跑标定（测本机每手固定开销），
 *  再把实例交给 finishLoad——首个真实请求到来时预算已经算准。
 *  标定值由主线程桥统一持有：桥带回已存值就跳过标定（多 worker 共用单例进程，
 *  各自标定会互相污染），自己标定则回报给桥缓存+持久化。
 *  全程发 engine-loading 进度（App 画进度条），100% 即就绪。 */
function postKataLoading(percent, label) {
  post({ type: "engine-loading", engine: "kata", percent, label, done: percent >= 100 });
}
const KATA_PHASE_LABEL = {
  prepare: "准备引擎文件",
  start: "启动引擎进程",
  // 加载神经网络是最长的一段（模型 + ONNX Runtime 初始化，热机 ~3-6 秒，
  // 冷机/后台/降频时更久）。文案里写明「首次较慢」，让用户知道在正常加载、
  // 不是在卡死——用户 09-26 报「1 秒就说启动失败」的观感问题一半来自这里。
  model: "加载神经网络（首次较慢，约几秒）",
};
function postKataLoadingPhase(phase) {
  const percent = phase === "prepare" ? 10 : phase === "start" ? 30 : 55;
  postKataLoading(percent, KATA_PHASE_LABEL[phase] || "加载中");
}
function startKataVariant() {
  return new Promise((resolve, reject) => {
    kataReady = false;
    kataPendingOverhead = null;
    const timer = setTimeout(() => {
      pendingKata = null;
      reject(new Error("KataGo 引擎启动超时"));
    }, KATA_START_TIMEOUT_MS);
    pendingKata = { resolve, reject, timer };
    post({ type: "kata-start" });
  })
    .then((instance) => {
      // **不再标定（E 项）**：弈境根本不标定——持续制下 maxTime 运行时下发，
      // 「本机每手固定开销」这个数只影响预算制的 stop 余量，固定 0.15s 就够。
      // 旧流程首启要跑 4 轮 genmove@1s（4 秒纯搜索）才就绪，现在直接就绪——
      // 首启省 4 秒，与「引擎启动太慢」的反馈直接相关。
      kataOverhead = 0.15;
      postKataLoading(100, "就绪");
      return instance;
    });
}

/** 主线程回报 KataGo 进程已就绪（payload.overhead 为已存标定值，可能为 null）。 */
function resolveKataReady(payload) {
  if (!pendingKata) return;
  const { resolve, timer } = pendingKata;
  clearTimeout(timer);
  pendingKata = null;
  kataReady = true;
  const overhead = payload && typeof payload.overhead === "number" && Number.isFinite(payload.overhead)
    ? payload.overhead : null;
  kataPendingOverhead = overhead;
  resolve({
    // 与 wasm 实例同一形状：只用到 sendCommand。
    sendCommand: (command) => {
      if (!kataReady) { diag("sendCommand DROPPED (not ready): " + command); return; }
      post({ type: "kata-command", line: command });
    },
  });
}

function rejectKataReady(reason) {
  if (!pendingKata) return;
  const { reject, timer } = pendingKata;
  clearTimeout(timer);
  pendingKata = null;
  // 必须清掉 loading：load() 开头 `if (loading || engine) return;`，不清的话
  // 本次失败会把 worker 永久卡在「加载中」——之后任何请求都不再尝试启动引擎
  // （用户 09-26 报「旗舰关掉再开就一直起不来」的机制之一）。
  clearLoadTimer();
  loading = false;
  reject(new Error(reason || "KataGo 引擎启动失败"));
}

function clearLoadTimer() {
  if (loadTimer !== null) {
    clearTimeout(loadTimer);
    loadTimer = null;
  }
}

// ---- iKataGo 云引擎：连接 / 收行 / 断开 ------------------------------------
// 远端就是一个真 KataGo 进程，所以**不做任何新解析**：收到的每一行直接喂给
// parseKataOutput（与本地旗舰同一条通路），命令走 ikatagoSend 发到 WebSocket。
// 这样「一行多候选」「迟到收尾行」「帧累计口径」等一堆已修好的坑全部自动继承。

function postIkatagoLoading(percent, label) {
  post({ type: "engine-loading", engine: "ikatago", percent, label, done: percent >= 100 });
}

/** 连接远端 KataGo。凭据按 iKataGo 约定走 query（见 ikatago.ts 的说明）。 */
function startIkatagoVariant() {
  return new Promise((resolve, reject) => {
    if (!ikatagoConfig || !ikatagoConfig.serverUrl) {
      reject(new Error("未配置 iKataGo 服务器地址"));
      return;
    }
    ikatagoReady = false;
    const timer = setTimeout(() => {
      pendingIkatago = null;
      try { ikatagoSocket?.close(); } catch { /* 已关 */ }
      ikatagoSocket = null;
      reject(new Error("iKataGo 连接超时（服务器未响应）"));
    }, IKATAGO_START_TIMEOUT_MS);
    pendingIkatago = { resolve, reject, timer };
    postIkatagoLoading(30, "连接云端引擎…");

    const params = new URLSearchParams();
    if (ikatagoConfig.username) params.set("username", ikatagoConfig.username);
    if (ikatagoConfig.password) params.set("password", ikatagoConfig.password);
    if (ikatagoConfig.platform) params.set("platform", ikatagoConfig.platform);
    const query = params.toString();
    const url = query
      ? (ikatagoConfig.serverUrl.includes("?") ? `${ikatagoConfig.serverUrl}&${query}` : `${ikatagoConfig.serverUrl}?${query}`)
      : ikatagoConfig.serverUrl;

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      clearTimeout(timer);
      pendingIkatago = null;
      reject(new Error("无法建立连接：" + (error instanceof Error ? error.message : String(error))));
      return;
    }
    ikatagoSocket = socket;
    ikatagoBuffer = "";

    socket.onopen = () => { postIkatagoLoading(60, "云端已连接，等待引擎就绪…"); };
    socket.onmessage = (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      if (!text) return;
      ikatagoBuffer += text;
      let index = ikatagoBuffer.indexOf("\n");
      while (index >= 0) {
        const line = ikatagoBuffer.slice(0, index).replace(/\r$/, "");
        ikatagoBuffer = ikatagoBuffer.slice(index + 1);
        ikatagoOnLine(line);
        index = ikatagoBuffer.indexOf("\n");
      }
    };
    socket.onerror = () => {
      if (pendingIkatago) {
        const p = pendingIkatago;
        clearTimeout(p.timer);
        pendingIkatago = null;
        p.reject(new Error("连接出错（检查地址、端口与用户名密码）"));
      } else if (ikatagoReady) {
        // 连上之后出错：当成断线处理（不静默）
        failIkatago("云端连接中断");
      }
    };
    socket.onclose = (event) => {
      ikatagoSocket = null;
      if (pendingIkatago) {
        const p = pendingIkatago;
        clearTimeout(p.timer);
        pendingIkatago = null;
        p.reject(new Error(`连接被关闭（code ${event.code}${event.reason ? " " + event.reason : ""}）`));
        return;
      }
      if (ikatagoReady) failIkatago("云端连接已断开");
    };
  }).then(() => {
    ikatagoReady = true;
    postIkatagoLoading(100, "云端就绪");
    return {
      sendCommand: (command) => {
        if (!ikatagoReady || !ikatagoSocket || ikatagoSocket.readyState !== 1) {
          diag("ikatago sendCommand DROPPED: " + command);
          return;
        }
        try { ikatagoSocket.send(command + "\n"); } catch { /* 断线由 onclose 处理 */ }
      },
    };
  });
}

/** 远端来的一行：先处理连接级握手，其余全部交给既有 KataGo 解析层。 */
function ikatagoOnLine(line) {
  // 就绪信号与本地旗舰一致（远端进程打出 GTP ready）——收到即认为握手完成。
  if (!ikatagoReady && pendingIkatago && /GTP ready/i.test(line)) {
    const p = pendingIkatago;
    clearTimeout(p.timer);
    pendingIkatago = null;
    p.resolve();
    // 不 return：这一行也交给解析层（保持与本地一致的行为）
  }
  parseKataOutput(line);
}

/** 云引擎失败：置放弃标记（不再自动重试，避免每手都赌一次网络往返），
 *  并把错误交给主线程决定降级。 */
function failIkatago(reason) {
  ikatagoReady = false;
  ikatagoBlocked = true;
  clearKataSilence();
  kataSetupAcks = 0;
  if (activeVariant === "ikatago") engine = null;
  if (active) { active.finished = true; active = null; }
  post({ type: "error", message: `iKataGo：${reason}` });
  drain();
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
  // **iKataGo 云引擎**（用户填自己的服务器地址自连）：优先级最高——它是用户
  // 显式配置的算力，连不上会明确报错，不该被静默降级到本机引擎（那样用户会
  // 以为「云引擎生效了」却实际在用手机算）。连接失败走 failIkatagoVariant。
  if (requested === "ikatago" && ikatagoAllowed && !ikatagoBlocked) return "ikatago";
  // KataGo 旗舰档：显式选择 + 已授权 + 不在放弃期才走。放弃期（kataBlocked，
  // 连续启动失败后置位）里继续请求旗舰会落到下面的 Rapfi 决策链——每一手都
  // 重新赌 2×40s 启动用户等不起；重新给机会的条件是用户显式切走再切回
  // （analyze 分支清标记）或设置变更重启（kata-stopped 分支）。
  if (requested === "kata" && kataAllowed && !kataBlocked) {
    // 注意：这里**不能**动 loading——load() 已把它置真表示「加载链在飞」，早期
    // 版本在这句顺手 `loading = false` 会拆掉防重入护栏，让 analyze 收尾的
    // load() 再起一条并发加载链（双 kata-start、双标定）。
    return "kata";
  }
  // requested === "kata" 但未授权或处于放弃期：按 Rapfi 决策链给本机最强可用档。
  // 放弃是有日志的（failKataVariant 发过「改用 Rapfi」），不是静默降级。
  // 原先这里「未授权也返回 kata」会导致引擎真的被启动——绕过了授权语义。
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
  // kata 不挂这个兜底：它有自己的两级超时（40s 启动 + 15s 标定）和重试上限，
  // 30s 的通用兜底会把「冷机慢启动/标定进行中」误判成失败并整链重跑——
  // 这正是 09-26「几分钟了一直加载中」的根因之一（kata 分支由此剔除）。
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
    if (started.variant === "kata") kataAttempts = 0;   // 真正就绪才清失败计数
    finishLoad(token, started.instance, started.variant);
  }).catch((error) => {
    if (token !== loadToken) return;
    clearLoadTimer();
    loading = false;
    if (variant === "kata") {
      failKataVariant(token, error instanceof Error ? error.message : String(error));
      return;
    }
    // iKataGo 云引擎失败：**不自动降级到本机引擎**——用户明确选了「云端算力」，
    // 悄悄换成手机算会让他以为云引擎生效了（算力/账单都对不上）。这里如实报错
    // 并置放弃标记（本 worker 生命周期内不再重试，避免每手都赌网络往返）；
    // 用户改配置或切引擎时会清标记重连。
    if (variant === "ikatago") {
      ikatagoBlocked = true;
      postIkatagoLoading(100, "云端未能连接");
      post({ type: "error", message: `iKataGo 连接失败：${error instanceof Error ? error.message : String(error)}` });
      return;
    }
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

/** kata 启动失败的唯一处置入口：第 1 次失败先真停进程再重试一次（Java start()
 *  对活进程是「早退复用」，不停的话僵死进程会被永远复用、看起来就是一直加载中
 *  ——09-26 主诉根因）；达到上限就如实放弃，本手落到 Rapfi，进度条关掉，
 *  等用户显式切引擎或设置重启再给旗舰全新机会（不再无限循环重试）。 */
function failKataVariant(token, reason) {
  kataAttempts += 1;
  if (kataAttempts < KATA_MAX_START_ATTEMPTS) {
    // 让桥把进程真正杀掉：下一次 start() 走全新 spawn（顺带 killStaleEngines
    // 清残留），而不是复用可能已僵死的旧进程。
    post({ type: "kata-stop" });
    post({ type: "log", message: "KataGo 启动失败，正在重试…（" + reason + "）" });
    load();
    return;
  }
  kataBlocked = true;
  loading = false;
  postKataLoading(100, "KataGo 未能启动");
  post({ type: "log", message: "KataGo 连续两次启动失败，暂时改用 Rapfi 引擎（" + reason + "）。可在引擎选择里切回旗舰重试" });
  startRapfiAfterKataFailure(token);
}

/** 放弃旗舰后的落点：本机最强的 Rapfi（安卓 = native 进程；native 也不可用再落 WASM）。 */
function startRapfiAfterKataFailure(token) {
  const useNative = nativeAllowed && !nativeBlocked;
  Promise.resolve()
    .then(() => startVariant(useNative ? "native" : "fallback"))
    .then((instance) => {
      if (token !== loadToken) return;
      finishLoad(token, instance, useNative ? "native" : "fallback");
    })
    .catch(() => startFallback(token));
}

function load() {
  if (loading || engine) return;
  loading = true;
  // Analysis stays offline: both variants load from the bundled assets and
  // this worker never downloads model data from a third-party host.
  const token = ++loadToken;
  void loadVariant(chooseVariant(enginePreference), token);
}

/** 档位变化时真正把引擎换掉：常驻 worker 原先只在「没有 engine」时加载，
 *  于是切到 katago 后仍一直用 rapfi（用户 09-26 报「选了 katago 却像没生效」）。
 *  这里比对「目标变体」与「当前已加载变体」，不同就卸载旧引擎并重新走加载链。 */
function ensureVariantMatchesPreference() {
  const target = chooseVariant(enginePreference);
  if (!engine) return;                       // 还没加载，交给 load()
  if (target === activeVariant) return;      // 已经是目标引擎
  // KataGo 系（本机旗舰 / 云引擎）→ 其它：停掉旧引擎。本机进程是单例，不停会与
  // rapfi 抢内存；云连接不停会一直占着服务端席位。
  if (isKataFamily()) { try { engine.sendCommand("quit"); } catch { /* 已退出 */ } void 0; }
  engine = null;
  loading = false;
  load();
}

self.onmessage = (event) => {
  const message = event.data || {};
  // ---- 原生引擎的回灌（主线程转发进程输出）----
  if (message.type === "native-ready") { resolveNativeReady(message); return; }
  if (message.type === "native-start-failed") { rejectNativeReady(message.reason); return; }
  if (message.type === "engine-loading") { post(message); return; }
  if (message.type === "native-stdout") { parseOutput(message.line); return; }
  if (message.type === "native-exit") {
    // 每个桥都会收到单例进程的退出事件；旧 Rapfi 的收尾不能取消当前
    // KataGo 的加载/搜索，也不能被上层误判成新引擎切换失败。
    // 切换过程中 activeVariant 仍可能暂时保留旧的 native 值；若 KataGo 已
    // 进入启动等待，旧 Rapfi 的退出事件不能打断这条新的启动链。
    if (pendingKata && !pendingNative) return;
    if (activeVariant !== "native" && !pendingNative) return;
    nativeReady = false;
    const hadEngine = engine !== null;
    if (activeVariant === "native") engine = null;
    if (message.intentional) return;         // 计划内停止（切引擎时 App 调 stop）：静默
    if (active) { active.finished = true; active = null; }
    // 只有真的带着活引擎在跑时崩溃才算事故；否则（启动失败后的余波）报了也只是噪音
    if (hadEngine || pendingNative) post({ type: "error", message: `原生引擎进程已退出（code ${message.code}）` });
    drain();
    return;
  }
  if (message.type === "native-stopped") {
    // 计划内停 Rapfi 进程（App 切引擎互斥）：清失效实例，不发错误
    if (activeVariant !== "native" && !pendingNative) return;
    nativeReady = false;
    if (activeVariant === "native") engine = null;
    return;
  }
  // ---- KataGo 旗舰引擎的回灌（主线程转发进程输出；类型独立不与 native 串线）----
  if (message.type === "kata-ready") { resolveKataReady(message); return; }
  if (message.type === "kata-start-failed") { rejectKataReady(message.reason); return; }
  if (message.type === "kata-start-deferred") {
    // 进程正被另一个 worker 的启动链持有（单例）：**不是失败**，别计入失败次数、
    // 别宣告失败。等持有者标定完，gate 放行时本 worker 会拿到现成的开销值就绪。
    post({ type: "log", message: "旗舰引擎正由另一处启动，稍候复用其就绪结果" });
    return;
  }
  if (message.type === "kata-phase") { postKataLoadingPhase(message.phase); return; }
  if (message.type === "kata-stdout") { parseKataOutput(message.line); return; }
  if (message.type === "kata-stopped") {
    // 计划内停旗舰进程（设置变更重启 / 切回 Rapfi）：清失效实例 + 重置失败记忆
    // （设置重启与显式切换一样算「用户动作」，给旗舰全新机会）。
    kataReady = false;
    clearKataSilence();
    kataSetupAcks = 0;
    if (kataCalib) finishKataCalib(true);
    if (isKataFamily()) engine = null;
    kataAttempts = 0;
    kataBlocked = false;
    return;
  }
  if (message.type === "kata-write-failed") {
    // GTP 命令写入失败（Java 侧「引擎未运行」）。**不等于进程死了**，也不该按
    // 死亡处理——旧实现把它当 kata-exit，于是：清 engine → 重新 spawn → 重发
    // 整串 setup 命令，最坏 47.9 秒没有输出（真机 09-28 实锤）。
    //
    // 这里只做「原地重连」：把当前轮标记为需要重摆（下一次 drain 会重新走
    // 全量同步），并请求主线程**重新确认/拉起进程**——start() 对活进程是早退
    // 复用（spawned=false），所以进程还活着时这条链是零成本的；真死了才会 spawn。
    kataReady = false;
    kataSetupAcks = 0;
    clearKataSilence();
    if (isKataFamily()) engine = null;
    const req = active;
    active = null;
    if (req) {
      // 本轮已发出的命令没被引擎收到，直接回池重发（保持原 requestId/generation，
      // App 侧的 generation 守卫仍然有效，不会把结果投给错误的局面）。
      req.finished = false;
      clearRequestTimers(req);
      waiting.unshift(req);
    }
    // 请主线程走一次启动链（活进程会立刻复用，无需冷启动）
    post({ type: "kata-start" });
    drain();
    return;
  }
  if (message.type === "kata-exit") {
    if (activeVariant !== "kata" && !pendingKata) return;
    kataReady = false;
    clearKataSilence();
    kataSetupAcks = 0;
    if (kataCalib) finishKataCalib(true);    // 标定中进程死了：立刻收尾，别干等 15s
    const hadEngine = engine !== null;
    if (isKataFamily()) engine = null;
    if (message.intentional) return;         // 计划内退出（quit/stop）：静默
    if (pendingKata) {
      // 启动阶段就崩了：立刻走失败链（重试→放弃），比干等 40s 超时快
      rejectKataReady(`KataGo 进程在启动时退出（code ${message.code}）`);
      return;
    }
    if (active) { active.finished = true; active = null; }
    if (hadEngine) post({ type: "error", message: `KataGo 引擎进程已退出（code ${message.code}）` });
    drain();
    return;
  }
  if (message.type === "stop") {
      if (active && message.requestId && active.requestId && message.requestId !== active.requestId) return;
    if (engine) engine.sendCommand(isKataFamily() ? "stop" : "YXSTOP");
    if (active) {
      const request = active;
      // 用户强制停止 → 落当前最强点（T29）。旗舰的**不限时**轮也要走这条路：
      // 引擎收到 GTP stop 后会收尾搜索并打出 `play X`（它必须落一手），若在这里
      // 立刻把 active 置空，那一行会被 `!active` 丢掉、App 永远等不到落点——
      // 「不限时思考 → 点停止 → 棋局卡住」。所以保留 active 等引擎的收尾行，
      // 宽限到期仍无声才用进度快照兜底（和 deadline 兜底同一通路）。
      // 旗舰要等引擎真正收尾（搜索线程停 + 打印），宽限给足 2s；Rapfi 维持 500ms。
      if (message.toResult === true && (isKataFamily() || !request.unlimited)) {
        request.stopRequested = true;
        clearRequestTimers(request);
        request.finishTimer = setTimeout(() => {
          if (!active || active !== request || request.finished) return;
          finish(request, request.bestMove || (request.stats.candidates.length ? request.stats.candidates[0].move : null), request.stats);
        }, isKataFamily() ? 2000 : 500);
        return;
      }
      request.finished = true;
      clearRequestTimers(request);
      active = null;
      // GTP stop 打断搜索。两种命令的收尾不同（见 runKata 的注释）：
      //  · 落子型（kata-genmove_analyze）：stopAndWait 后仍会执行 playChosenMove，
      //    既吐一条旧收尾行、又在引擎盘上真的落子——窗口欠 1 条尾巴 + 基准标脏；
      //  · 持续分析（kata-analyze）：只停止搜索，没有收尾行、不落子。
      if (isKataFamily()) {
        clearKataSilence();
        if (!request.continuous) {
          kataSetupAcks = Math.max(kataSetupAcks, 1);
          kataLiveDirty = true;
        }
      }
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
      if (message.engine === "kata") kataAllowed = true;
      pinIkatago(message);
      if (message.multi === false) engineMultiAllowed = false;
      else if (message.multi === true) engineMultiAllowed = true;
      if (ENGINE_PREFERENCES.has(message.engine)) enginePreference = message.engine;
      if (typeof message.dataUrl === "string" && message.dataUrl) dataUrlOverride = message.dataUrl;
      load();
    }
    return;
  }
  if (message.type !== "analyze") return;
  diag(`analyze in: engine=${message.engine} active=${active !== null} activeVariant=${activeVariant} loading=${loading}`);
  // The first analyze pins the engine preference and optional data package
  // location for this worker's lifetime; later requests reuse the engine.
  // 顺序不变式（全盘体检 P1-1）：钉死必须发生在 book 分支之前——book 首包未加载完
  // 走异步让路分支时会提前 return，若那时才钉死，miss 后 load() 会按未钉死状态起
  // fallback 变体且常驻 worker 整局锁死在轻量引擎（用户选强力却静默降档）。
  if (!engine && !loading) {
    if (message.native === true) nativeAllowed = true;
    if (message.engine === "kata") kataAllowed = true;
    pinIkatago(message);
      if (message.multi === false) engineMultiAllowed = false;
      else if (message.multi === true) engineMultiAllowed = true;
      if (ENGINE_PREFERENCES.has(message.engine)) enginePreference = message.engine;
    if (typeof message.dataUrl === "string" && message.dataUrl) dataUrlOverride = message.dataUrl;
  } else if (ENGINE_PREFERENCES.has(message.engine)) {
    // 引擎已在运行时也要接受档位变化（否则常驻 worker 永远停在旧引擎上）
    if (message.engine === "kata") kataAllowed = true;
    pinIkatago(message);
    if (message.native === true) nativeAllowed = true;
    if (message.engine !== enginePreference) {
      // 显式切换引擎（含切回旗舰）：清掉放弃期标记与失败计数，给全新机会
      enginePreference = message.engine;
      kataAttempts = 0;
      kataBlocked = false;
      ikatagoBlocked = false;
      ensureVariantMatchesPreference();
    } else if (chooseVariant(enginePreference) !== activeVariant) {
      // 偏好没变但引擎不对：放弃期被解除（kata-stopped / 显式切换清了标记）后
      // 再请求旗舰，就靠这里把 native 换回 kata。放弃期本身是稳定态
      // （chooseVariant 此时返回 native === activeVariant），不会误触发。
      ensureVariantMatchesPreference();
    }
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
  // **换手零延迟（对标「五子棋分析」App）**：GTP 引擎收到任何新输入行都会立刻
  // stopAndWait 当前分析（gtp.cpp: "Upon any input line at all, stop any analysis"）。
  // 旧流程 stop → 等 500ms 宽限 finish → 回 result → App 再发新请求，一来一回
  // 白等近 1 秒；现在直接让新请求上路，引擎自己打断旧搜索，旧轮由 onmessage 的
  // 中断分支收尾（finished + 落缓存），不再挡路。
  // **native rapfi 也能立即打断**（2026-10-01「升级后不流畅」的一半根因）：旧实现
  // 只有 kata 走打断分支，rapfi 的新请求要等旧轮 2 秒预算自然跑完才上路——落子后
  // 新局面的分析最多迟 2 秒才起步。native rapfi 每轮都全量重发 YXBOARD（引擎盘面
  // 不受打断影响），先发 YXSTOP 中止旧搜索、新轮立刻上路，无副作用；旧搜索的收尾
  // 残行由 parseOutput 的轮次守卫丢弃。WASM 变体保持原样（同步执行、语义不同）。
  const superseded = active && !active.finished && (isKataFamily() || activeVariant === "native");
  if (superseded) {
    const old = active;
    old.finished = true;                     // 不再接受它的任何收尾
    clearRequestTimers(old);
    active = null;
    clearKataSilence();
    // 新命令（随后的增量 play/搜索）会打断旧搜索。只有落子型旧轮会吐旧收尾行、
    // 并在引擎盘上真的落子（见 runKata 的注释）；持续分析（kata-analyze）被打断
    // 只是停止搜索。据此把「欠一条旧尾巴」记在新请求上、并在落子轮后标脏基准。
    if (!old.continuous) {
      message.pendingInterruptTail = true;
      kataLiveDirty = true;
    }
    // native rapfi：主动发 YXSTOP 中止旧搜索——引擎对「排队中的新命令」处理时机
    // 取决于它自己的输入轮询，靠新命令被动打断可能仍要等旧搜索跑完；显式 stop
    // 才能保证新轮马上开搜。旧搜索随后的收尾输出由轮次守卫丢弃。
    if (!isKataFamily()) send(stopCommand());
    // 旧轮立刻回 stopped（App 侧换手已在进行，不需要它的 result）
    post({ type: "stopped", requestId: old.requestId, generation: old.generation });
  }
  waiting.push({ ...message, size: message.size || 15 });
  load();
  drain();
};
