/**
 * 引擎进度帧的合流闸（2026-10-15，用户报「落子初期很容易闪，过一会就稳定了，
 * 然后再落子又闪，往复循环」）。
 *
 * 为什么需要它：引擎每秒吐约 10 条 progress（真机 diag 实测「每秒 10 条，一直满速」，
 * KataGo 深搜时更密），而 App 每收到一条就 `setAiAnalysis` 一次。那是 **App 级 state**，
 * 等于每秒把整棵组件树重渲染十几次，棋盘 SVG 跟着反复重绘；棋盘区内那个带
 * `backdrop-filter` 的「思考中」浮标，每次重绘都要把背景重新糊一遍 —— 在安卓 WebView
 * 上就是肉眼可见的闪动。
 *
 * 为什么是「初期最容易闪」：搜索初期每一层的开销都小，info 帧最密；算到后面每层
 * 耗时指数上升，同样的时间内帧数骤降，于是自己「稳定」下来。落下一手 → 重新开始
 * 一轮浅层搜索 → 又闪，往复循环。
 *
 * 做法：窗口内的多帧**按字段合成一帧**再交给 React。合并函数由调用方传入，且必须
 * 与它自己 `setState` 的合并规则一一对应 —— 逐帧 merge 进 state 与「先合成再 merge」
 * 不等价，某一帧独带的字段（例如只有部分帧上报的 drawRate）会在合成时被后来的帧
 * 抹掉，那就是丢终值。
 *
 * 不丢终值：`flush()` 在 result / error / 停止 / 换手前调用，把窗口里最后一批字段补齐；
 * `reset()` 用于换手，丢掉上一轮的待发帧与节流窗口（否则新局面上会先闪一下旧读数）。
 */

/** 读数（深度/节点/胜率/速度）的一帧窗口。320ms ≈ 3.1 次/秒：旧 Android WebView
 *  在引擎刚启动、进度帧最密的阶段也不会被 App 级提交连续打断；对人眼仍足够跟读。 */
export const ANALYSIS_FRAME_INTERVAL_MS = 320;

/**
 * 候选点（棋盘上那一圈彩点 + 面板里的候选条）单独一档，**比读数慢得多**：600ms ≈ 1.7 次/秒。
 *
 * 为什么必须单独慢（2026-10-15，用户报「落子初期很容易闪，过一会就稳定了，然后再落子
 * 又闪，往复循环」）：搜索初期每一层的开销都小，引擎在**每一帧之间**都能推进好几层深度，
 * 于是几乎每一帧的 top-N 都和上一帧不同 —— 真机帧率 10/s，逐帧重画就是那圈彩点以每秒
 * 10 次的频率整体明灭。本地慢引擎（约 0.5 帧/秒）实测 25 秒 13 次集合变化、且**全是单向
 * 细化、没有 A→B→A 来回**，说明这不是抖动噪声，而是「榜单真的在变」：唯一无损的做法是
 * 把**呈现**降到人眼读得过来的频率，而不是每来一帧就重画一遍。算到深处每层越来越慢、
 * 榜单不再变化，于是自己「稳定」下来 —— 正好对应现象里的「过一会就稳定了」。
 *
 * 附带好处：候选棋盘层重绘从 ~10 次/秒降到 ~1.7 次/秒，手机上发热与掉帧一起降。
 */
export const ANALYSIS_CANDIDATE_FRAME_INTERVAL_MS = 600;

export interface ProgressFrameGate<TPayload> {
  /** 收一帧。窗口未到就并进待发帧，窗口已过就立刻落地（首帧不等待）。 */
  push: (payload: TPayload) => void;
  /** 立刻把待发帧补齐落地（结果/错误/停止前必须调，否则终值丢在窗口里）。 */
  flush: () => void;
  /** 丢弃待发帧与节流窗口（换手/新一轮开始）。 */
  reset: () => void;
}

export const createProgressFrameGate = <TPayload>(
  apply: (payload: TPayload) => void,
  merge: (previous: TPayload, next: TPayload) => TPayload,
  intervalMs: number = ANALYSIS_FRAME_INTERVAL_MS,
  now: () => number = () => Date.now(),
): ProgressFrameGate<TPayload> => {
  let pending: TPayload | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAppliedAt = Number.NEGATIVE_INFINITY;

  const fire = () => {
    timer = null;
    if (pending === null) return;
    const payload = pending;
    pending = null;
    lastAppliedAt = now();
    apply(payload);
  };
  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  return {
    push: (payload) => {
      pending = pending === null ? payload : merge(pending, payload);
      // 首帧立即落地：面板要马上从「思考中」切成读数，不能先等一个窗口。
      const elapsed = now() - lastAppliedAt;
      if (elapsed >= intervalMs) { clearTimer(); fire(); return; }
      if (timer === null) timer = setTimeout(fire, intervalMs - elapsed);
    },
    flush: () => { clearTimer(); fire(); },
    reset: () => { clearTimer(); pending = null; lastAppliedAt = Number.NEGATIVE_INFINITY; },
  };
};

/** 一路引擎（分析 / 对局）收到的 progress 流：读数与候选点各自合流，互不牵连。 */
export interface EngineProgressPump<TScalar, TCandidates> {
  /** 收一帧：读数按快档、候选按慢档分别合流（没有的字段不进闸）。 */
  push: (frame: { scalars?: TScalar; candidates?: TCandidates }) => void;
  /** 结果/错误/停止前调用：两档都把窗口里的终值补齐落地。 */
  flush: () => void;
  /** 换手/新一轮：丢弃两档的待发帧。 */
  reset: () => void;
}

/**
 * 把「读数」与「候选点」拆成两档合流的组合闸。候选点是棋盘上唯一会**每次重画都换一批**
 * 的东西，所以它单独慢一档（见 ANALYSIS_CANDIDATE_FRAME_INTERVAL_MS 的注释）；
 * 读数留在快档，面板上的深度/节点/胜率照旧跟手。
 */
export const createEngineProgressPump = <TScalar, TCandidates>(
  applyScalars: (scalars: TScalar) => void,
  mergeScalars: (previous: TScalar, next: TScalar) => TScalar,
  applyCandidates: (candidates: TCandidates) => void,
  scalarIntervalMs: number = ANALYSIS_FRAME_INTERVAL_MS,
  candidateIntervalMs: number = ANALYSIS_CANDIDATE_FRAME_INTERVAL_MS,
): EngineProgressPump<TScalar, TCandidates> => {
  const scalars = createProgressFrameGate<TScalar>(applyScalars, mergeScalars, scalarIntervalMs);
  // 候选只有「最新一帧覆盖前一帧」这一条语义（排行榜不该被窗口内的旧帧影响），
  // 所以合并就是取新的那份。
  const candidates = createProgressFrameGate<TCandidates>(applyCandidates, (_previous, next) => next, candidateIntervalMs);
  return {
    push: (frame) => {
      if (frame.scalars !== undefined) scalars.push(frame.scalars);
      if (frame.candidates !== undefined) candidates.push(frame.candidates);
    },
    flush: () => { scalars.flush(); candidates.flush(); },
    reset: () => { scalars.reset(); candidates.reset(); },
  };
};
