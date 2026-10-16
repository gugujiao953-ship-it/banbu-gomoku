/**
 * 双人对弈的比赛棋钟（用户 2026-09-23）。
 *
 * 这是**纯函数状态机**，不碰 React、不碰 DOM、不读时钟——所有「现在几点」都由调用方
 * 以 `now` 传进来。这样它可单测（时间相关逻辑最难靠手点验证），也让「息屏回来时间对不对」
 * 这种事能用一行断言钉住。
 *
 * ## 为什么用「到期时间戳」而不是累加计数
 *
 * 每 200ms 的定时器只负责**重绘**，真正的时间真相是 `deadline`（某方的到期时刻）。
 * 浏览器会把后台标签页的定时器节流到 1 次/秒甚至更久，手机息屏还会直接停掉；
 * 如果按「每次 tick 加 200ms」累加，时间就会走慢——一场 2 小时的比赛能偏差几分钟，
 * 而棋钟走慢等于作弊。用 deadline 就在任何节流下都精确：回来时算一次 `deadline - now`
 * 即可，中间漏掉多少次 tick 都不影响。
 *
 * ## 制式
 *
 * 四种，跟实体棋钟（DGT / LEAP）一一对应：
 *
 *  - **包干**（`fischer` 且 increment 为 0）：每人一份总时间，用完判负。线下最基础。
 *  - **菲舍尔加秒**（`fischer`）：每走一手**无条件加回**固定额度（走得快时剩余会变多）。
 *    连珠正式比赛的事实标准（RIF 世锦赛/欧锦赛统一 2 小时 + 每手 30 秒）。
 *  - **布龙斯坦延时**（`bronstein`）：每走一手加回**实际用时与延时额度中的较小者**，
 *    所以剩余时间**永远不会增长**。它与「简单延时」在时间总量上等价，只是算法不同：
 *    简单延时是主时间先等延时额度走完才开始扣，布龙斯坦是扣完再加回来。
 *    这里实现布龙斯坦（加回式），因为它只需要一个字段就能表达，且对局结束时的
 *    剩余时间就是玩家真实看到的数字，不用另外做「延时倒计时」的显示层。
 *    **延时是这一手的保护时**：主时间走完不等于判负，要用掉「主时间 + 延时额度」才走完；
 *    保护期里屏上的数字是负的，那个负值的绝对值就是已经吃掉的延时（落子交钟时补回来）。
 *  - **读秒**（`readOff`，byo-yomi）：主时间用完后进入读秒段，每手限 `readOffMs`，
 *    用完扣一个周期，周期尽即判负。围棋/将棋的习惯，连珠也有比赛采用。
 */

export type ClockSide = "black" | "white";

/** 计时制式。 */
export type ClockMode = "fischer" | "bronstein" | "readOff";

export interface ClockSettings {
  mode: ClockMode;
  /** 双方初始总时限（毫秒）。 */
  baseMs: number;
  /** 菲舍尔加秒：每走一手无条件加回（毫秒）。0 = 简单计时。 */
  incrementMs: number;
  /** 布龙斯坦延时额度（毫秒），仅 bronstein 制式用。 */
  delayMs: number;
  /** 每手读秒时限（毫秒），仅 readOff 制式用。 */
  readOffMs: number;
  /** 读秒周期数：用完 `readOffMs` 扣一个周期，周期尽即负。仅 readOff 制式用。 */
  readOffPeriods: number;
}

export interface ClockState {
  settings: ClockSettings;
  /** 双方剩余主时间（毫秒）。允许为负——负值精确表示超时了多少，便于显示与判定。 */
  remaining: Record<ClockSide, number>;
  /** 轮走方；暂停或已结束时仍表示「轮到谁」。 */
  turn: ClockSide;
  /** 暂停中：不停表，但双方都不走时间。 */
  paused: boolean;
  /** 每一手已落子的次数（用于显示与校验）。 */
  moves: Record<ClockSide, number>;
  /** 读秒制式下的剩余周期数（按方记）。 */
  periods: Record<ClockSide, number>;
  /** 终局原因：某一方超时（flag fall）。 */
  flagged: ClockSide | null;
  /**
   * 双方都已超时 → **和棋**（连珠/五子棋规则如此，见 clockWinner 的注释）。
   * 只有一方超时时为 false；这个标志一置起，`flagged` 里的那一方也不再是输方。
   */
  flaggedBoth: boolean;
  /** 手动认负。 */
  resigned: ClockSide | null;
  /**
   * 当前这一方开始计时的时刻。暂停或**还没开始**为 null。
   * 「剩余时间」= remaining - (now - runningSince)，由 `remainingAt` 计算。
   *
   * 开局（createClock）就是 null：钟摆好但**没按下去**。线下真实棋钟也是这样——
   * 谁先按下自己的键，谁的钟才开始跑。所以「点一下才开始计时」不是额外步骤，
   * 它本来就该是第一个动作（用户 2026-09-23 点名）。
   */
  runningSince: number | null;
  /**
   * **本手已经用了多久**（毫秒）。布龙斯坦结算返还要它，所以必须单独存：
   * `runningSince` 每 200ms 被 `tickClock` 往前挪一次（那是重绘与补算的锚点），
   * 拿 `now - runningSince` 当「本手用时」只会得到两次 tick 之间的 ≤200ms 尾巴
   * —— 2026-10-01 实测返还 0 秒、布龙斯坦退化成包干，就是这么来的。
   * 交钟（换手）时归零；暂停期间不累加（暂停不返还时间，也不偷时间）。
   */
  moveUsedMs: number;
  /**
   * 读秒段开始的时刻（仅 readOff 制式、且主时间已耗尽时有值）。
   * 单独记是因为读秒额度与主时间是两套计时，混在一个字段里会算错。
   */
  inReadOffSince: number | null;
  /**
   * 停表的时刻（未暂停时为 null）。暂停要把读秒段的进度**冻结住**，恢复时按暂停
   * 时长把 `inReadOffSince` 往前挪，这样暂停只意味着「这段时间不计」，而不是
   * 白送一手满额读秒。
   */
  pausedSince: number | null;
}

export const DEFAULT_CLOCK_SETTINGS: ClockSettings = {
  mode: "fischer",
  // 默认 5 分钟快棋（用户 09-23 点名）：线下最常用的一档，包干制（不加秒）。
  baseMs: 5 * 60 * 1000,
  incrementMs: 0,
  delayMs: 10 * 1000,
  readOffMs: 60 * 1000,
  readOffPeriods: 3,
};

// ── 常用时限 ──────────────────────────────────────────────────────────────
// 分组跟实体棋钟的档位分法一致（超快棋 / 快棋 / 标准 / 读秒），这样从 DGT 之类
// 实体钟换过来的人能按同一个名字找到对应档。
export interface ClockPreset {
  id: string;
  title: string;
  text: string;
  settings: ClockSettings;
}

/** 包干 = 只有总时限、不加秒（线下最基础的玩法）。 */
const suddenDeath = (minutes: number, seconds = 0): ClockSettings => ({
  mode: "fischer",
  baseMs: minutes * 60 * 1000 + seconds * 1000,
  incrementMs: 0,
  delayMs: 10 * 1000,
  readOffMs: 60 * 1000,
  readOffPeriods: 3,
});

/** 菲舍尔加秒（连珠正式比赛的配置）。base 用秒传，好写 1:30 这种非整分档。 */
const fischer = (baseSeconds: number, incrementSeconds: number): ClockSettings => ({
  mode: "fischer",
  baseMs: baseSeconds * 1000,
  incrementMs: incrementSeconds * 1000,
  delayMs: 10 * 1000,
  readOffMs: 60 * 1000,
  readOffPeriods: 3,
});

/** 布龙斯坦延时：每手加回 min(用时, 延时额度)，剩余时间只减不增。 */
const bronstein = (baseSeconds: number, delaySeconds: number): ClockSettings => ({
  mode: "bronstein",
  baseMs: baseSeconds * 1000,
  incrementMs: 0,
  delayMs: delaySeconds * 1000,
  readOffMs: 60 * 1000,
  readOffPeriods: 3,
});

/** 读秒：主时间用完后每手限 readOffSeconds，用完扣一周期。 */
const byoYomi = (baseSeconds: number, readOffSeconds: number, periods: number): ClockSettings => ({
  mode: "readOff",
  baseMs: baseSeconds * 1000,
  incrementMs: 0,
  delayMs: 10 * 1000,
  readOffMs: readOffSeconds * 1000,
  readOffPeriods: periods,
});

/** 预设分组：面板按这个顺序渲染，名字就用棋钟圈里的通用叫法。 */
export type ClockPresetGroup = "连珠正式赛" | "国内五子棋赛" | "快棋 / 超快棋" | "读秒" | "延时";
export const CLOCK_PRESET_GROUPS: readonly ClockPresetGroup[] = ["连珠正式赛", "国内五子棋赛", "快棋 / 超快棋", "读秒", "延时"];

export interface ClockPresetEntry extends ClockPreset {
  group: ClockPresetGroup;
}

/**
 * 预设按**连珠/五子棋赛事实际在用的时限**排（用户 09-24 要求「多参考同类软件」）。
 *
 * 之前这组预设是按国象的档位抄的（5+3、10+5 之类），那是错的：连珠和五子棋的
 * 正式时限跟国象完全不是一个路子。据 RIF《Tournament Rules in International
 * Championships》§4 与《中国五子棋竞赛规则》（2013 版，第八条）：
 *
 *  - RIF 世锦赛/欧锦赛个人·女子·团体：**2 小时 + 每手 30 秒（Fischer）**，§4.1/4.4/4.5/4.7；
 *  - RIF 资格赛/公开赛/青少年赛下限：**60 分钟 + 每手 30 秒**，§4.2/4.3/4.6/4.8；
 *  - 中国全国五子棋锦标赛男/女组：**每方 60 分钟 + 每走一步加 30 秒**；
 *    公开组：**60 分钟包干，超时判负**；
 *  - 规则只承认两种法定时限：**包干制** 与 **加秒制（FISHER 制）**（第八条）。
 *
 * 实务上从 renju.net 的赛事库还能看到一批真实值：国内 30min+15s、45min+20s、
 * 日韩 100min+60s / 60min+30s、以及快棋 5min+3s 这类。所以下面按「正式赛 /
 * 国内赛 / 快棋」三组排，把 RIF 与中国全国赛那几档放最前——那是这个应用最可能
 * 用得到的场景，也是唯一有权威出处的几档。
 */
export const CLOCK_PRESETS: readonly ClockPresetEntry[] = [
  // ── 连珠正式赛（RIF，全部是 Fischer 加秒；RIF 不用读秒）──────────────
  { id: "rif-wc", group: "连珠正式赛", title: "2 小时 + 30 秒", text: "RIF 世锦赛 / 欧锦赛", settings: fischer(7200, 30) },
  { id: "rif-open", group: "连珠正式赛", title: "60 分 + 30 秒", text: "RIF 公开赛 / 资格赛 / 青少年", settings: fischer(3600, 30) },
  { id: "rif-90", group: "连珠正式赛", title: "90 分 + 30 秒", text: "RIF 常见（俄/北欧赛事）", settings: fischer(5400, 30) },

  // ── 国内五子棋赛（中国棋院系统；规则只认包干与加秒两种）──────────────
  { id: "chn-nat", group: "国内五子棋赛", title: "60 分 + 30 秒", text: "全国锦标赛 · 男女组", settings: fischer(3600, 30) },
  { id: "chn-open", group: "国内五子棋赛", title: "60 分钟包干", text: "全国锦标赛 · 公开组", settings: suddenDeath(60) },
  { id: "chn-45", group: "国内五子棋赛", title: "45 分 + 20 秒", text: "职业联赛常见", settings: fischer(2700, 20) },
  { id: "chn-30", group: "国内五子棋赛", title: "30 分 + 15 秒", text: "省市赛 / 北京赛 A 组", settings: fischer(1800, 15) },
  { id: "chn-30d", group: "国内五子棋赛", title: "30 分钟包干", text: "省市赛 · 包干", settings: suddenDeath(30) },

  // ── 快棋 / 超快棋（加赛、快棋赛；用户 09-23 点名的 5 分钟与 20 分钟在这组）──
  { id: "blitz5", group: "快棋 / 超快棋", title: "5 分钟快棋", text: "包干 · 不加秒", settings: suddenDeath(5) },
  { id: "standard20", group: "快棋 / 超快棋", title: "20 分钟包干", text: "包干 · 不加秒", settings: suddenDeath(20) },
  { id: "blitz5i3", group: "快棋 / 超快棋", title: "5 分 + 3 秒", text: "加赛 / 双盘制", settings: fischer(300, 3) },
  { id: "blitz3i2", group: "快棋 / 超快棋", title: "3 分 + 2 秒", text: "加赛第二轮", settings: fischer(180, 2) },
  { id: "blitz1i2", group: "快棋 / 超快棋", title: "1 分 + 2 秒", text: "超快棋", settings: fischer(60, 2) },

  // ── 读秒（byo-yomi）：RIF 连珠不用，但国内五子棋旧规程与围棋都用，保留 ──
  { id: "yomi60x3", group: "读秒", title: "60 分 + 读秒 60 秒×3", text: "旧规程常见", settings: byoYomi(3600, 60, 3) },
  { id: "yomi20x1", group: "读秒", title: "20 分钟包干 + 60 秒读秒", text: "旧规程 · 1 分钟读秒", settings: byoYomi(1200, 60, 1) },
  { id: "yomi50x3", group: "读秒", title: "50 分 + 读秒 20 秒×3", text: "围棋常见配置", settings: byoYomi(3000, 20, 3) },

  // ── 延时（布龙斯坦）：非连珠主流，但国象/部分赛事在用，保留一档 ────────
  { id: "delay25i5", group: "延时", title: "25 分 + 延时 5 秒", text: "布龙斯坦 · 美式常见", settings: bronstein(1500, 5) },
];

/** 低时间警告阈值：剩余 ≤ 此值时数字变红并逐秒报时。 */
export const CLOCK_LOW_MS = 10 * 1000;

export const otherSide = (side: ClockSide): ClockSide => (side === "black" ? "white" : "black");

export const sideLabel = (side: ClockSide) => (side === "black" ? "黑方" : "白方");

export const createClock = (settings: ClockSettings, first: ClockSide = "black", now = 0): ClockState => ({
  settings,
  remaining: { black: settings.baseMs, white: settings.baseMs },
  turn: first,
  paused: false,
  moves: { black: 0, white: 0 },
  periods: { black: settings.readOffPeriods, white: settings.readOffPeriods },
  flagged: null,
  flaggedBoth: false,
  resigned: null,
  // 摆好但**没按下去**：钟是停的，等第一个走子方点一下自己的半屏才开始（用户 09-23 点名）。
  // 这样「双方就位、计时才开始」是可控的——摆钟的人不用抢时间。
  runningSince: null,
  moveUsedMs: 0,
  inReadOffSince: null,
  pausedSince: null,
});

/** 时钟是否还没被按下（双方都还没走第一手）。 */
export const isClockIdle = (state: ClockState) =>
  state.runningSince === null && !state.paused && !isClockOver(state);

/** 棋局是否已结束（超时或认负）。 */
export const isClockOver = (state: ClockState) => state.flagged !== null || state.resigned !== null || state.flaggedBoth;

/** 胜方：一方超时/认负则另一方胜；未结束为 null。 */
/**
 * 胜方：一方超时/认负则另一方胜；**双超时为和棋**；未结束为 null。
 *
 * 双超时判和是连珠/五子棋规则明确规定的，跟国象不一样（国象是双超时里后超时的一方
 * 也可能被判负）。《中国五子棋竞赛规则》（2013 版）的和棋条件第 4 项：
 * 「双方比赛时限在发现时均已超时，但又不能确定哪方先超时」→ 和棋；
 * RIF Gomoku Rules 5.7.2 同义：「A game immediately ends as a draw if both players
 * have used all of their time and neither of them... has claimed their victory」。
 *
 * 本状态机一次只判一方 `flagged`（先走完的那一方），所以双超时在这里表现为
 * 「已经判负之后，另一方的钟也走完了」——由 `flaggedBoth` 表达。
 */
export const clockWinner = (state: ClockState): ClockSide | null => {
  if (state.flaggedBoth) return null;
  if (state.flagged) return otherSide(state.flagged);
  if (state.resigned) return otherSide(state.resigned);
  return null;
};

/** 是否和棋收场（双方都超时）。 */
export const isClockDraw = (state: ClockState): boolean => state.flaggedBoth;

/**
 * 某方在 `now` 时刻显示用的剩余时间。各制式各不相同：
 *  - 读秒制式、主时间已耗尽 → 显示**本手读秒剩余**（这才是此刻真正在倒的东西）；
 *  - 读秒制式、主时间还有 → 显示主时间；
 *  - 包干/菲舍尔/布龙斯坦 → 显示主时间。
 * 只有「轮走方 + 未暂停 + 未结束 + **钟已在跑**」才在走时间；其余返回静态值。
 * 没按下时（runningSince 为 null）返回满额——钟没跑就不该扣时间。
 *
 * 布龙斯坦延时这里**不做「延时倒计时」显示**：它的实现是「每手加回 min(用时, 额度)」，
 * 所以走子前看到的数字就是真实剩余，不需要额外那一层。这是它与「简单延时」
 * （主时间先等延时走完才开始扣）在**显示**上的唯一区别——两者时间总量完全等价。
 */
export const remainingAt = (state: ClockState, side: ClockSide, now: number): number => {
  const base = state.remaining[side];
  const inPeriod = state.settings.mode === "readOff" && base <= 0 && state.periods[side] > 0;
  // 暂停在读秒段里时 `remaining` 停在 0，屏幕上该显示的是**冻结住的本手读秒余额**，
  // 不是 0:00（0:00 看起来像已经超时）。
  if (state.paused && side === state.turn && inPeriod && state.inReadOffSince !== null) {
    return state.settings.readOffMs - ((state.pausedSince ?? now) - state.inReadOffSince);
  }
  const still = state.paused || isClockOver(state) || state.runningSince === null || side !== state.turn;
  if (still) return inPeriod ? state.settings.readOffMs : base;
  const elapsed = now - state.runningSince!;
  // 读秒制式且主时间已用完：此刻在倒的是本手读秒额度，锚点必须是 inReadOffSince。
  // runningSince 每次 tick 都被前移，跨过「主时间归零」那一次它已经把溢出丢掉，
  // 用它当锚点会显示满额，而状态机那边其实已经把这整个周期耗掉了（2026-10-01 实测差 15 秒）。
  if (inPeriod) {
    const since = state.inReadOffSince ?? state.runningSince!;
    return state.settings.readOffMs - (now - since);
  }
  return base - elapsed;
};

/** 双方剩余（给 UI 一次取两个）。 */
export const remainingBothAt = (state: ClockState, now: number): Record<ClockSide, number> => ({
  black: remainingAt(state, "black", now),
  white: remainingAt(state, "white", now),
});

/**
 * 推进到 `now`：把流逝的时间落到 `remaining` 里，并在时间走完时判超时。
 *
 * 这是**幂等**的——重复调用同一时刻不会重复扣时间。UI 的 200ms 定时器与息屏回来
 * 的补算都走这一个入口，因此不存在"两套计时逻辑对不上"的可能。
 */
export const tickClock = (state: ClockState, now: number): ClockState => {
  if (state.paused || isClockOver(state) || state.runningSince === null) return state;
  const elapsed = now - state.runningSince;
  if (elapsed <= 0) return state;

  const side = state.turn;

  // ── 读秒制式 ──────────────────────────────────────────────────────────
  // 分两段：主时间没走完就吃主时间；主时间走完后进入「本手读秒」，
  // 本手读秒用完扣一个周期并重置本手额度，周期尽则判超时。
  if (state.settings.mode === "readOff") {
    let since = state.inReadOffSince ?? state.runningSince;
    if (state.remaining[side] > 0) {
      const left = state.remaining[side] - elapsed;
      if (left > 0) return { ...state, remaining: { ...state.remaining, [side]: left }, runningSince: now };
      since = state.runningSince + state.remaining[side];
    }
    // 一次 tick 可能跨过多个周期（息屏/后台节流）。按真实经过的周期数扣除，
    // 并保留当前周期已用掉的余量；交钟和暂停也走这里，不能把超时救回来。
    const duration = state.settings.readOffMs;
    const consumed = duration > 0 ? Math.floor((now - since) / duration) : state.periods[side];
    const periodsLeft = Math.max(0, state.periods[side] - consumed);
    if (periodsLeft > 0) {
      return {
        ...state,
        remaining: { ...state.remaining, [side]: 0 },
        periods: { ...state.periods, [side]: periodsLeft },
        inReadOffSince: since + consumed * duration,
        runningSince: now,
      };
    }
    return {
      ...state,
      remaining: { ...state.remaining, [side]: 0 },
      periods: { ...state.periods, [side]: 0 },
      flagged: side,
      inReadOffSince: null,
      runningSince: null,
    };
  }

  // ── 菲舍尔 / 包干 / 布龙斯坦 ───────────────────────────────────────────
  // 本手真实用时必须在这里累加：runningSince 每 tick 前移，靠它算不出「这一手想了多久」。
  const usedTotal = state.moveUsedMs + elapsed;
  const current = state.remaining[side] - elapsed;
  // 布龙斯坦的延时是这一手的**保护时**：只有用时超过「主时间 + 延时额度」才算走完。
  // 保护期里 remaining 允许为负，负值的绝对值就是已经吃掉的延时，落子交钟时补回来。
  const guard = state.settings.mode === "bronstein" ? state.settings.delayMs : 0;
  if (current <= -guard) {
    // 允许落到负数：UI 需要显示「超时了多久」，也便于断言精确边界。
    return { ...state, remaining: { ...state.remaining, [side]: current }, moveUsedMs: usedTotal, flagged: side, runningSince: null };
  }
  return { ...state, remaining: { ...state.remaining, [side]: current }, moveUsedMs: usedTotal, runningSince: now };
};

/**
 * 走一手：结算这一手的加时/延时，然后把钟交给对方。
 *
 * `side` 是刚落子的那一方。若传入的不是当前轮走方，说明调用方传错了——
 * 原样返回，宁可不动也不要给出错误的时间（棋钟算错比不响应严重得多）。
 *
 * **这一步同时也是「按下开始」**：开局 `runningSince` 是 null（钟停着等人按），
 * 第一个走子方点自己那半屏时按下的时间才算作他的起算点——他之前耗掉的时间一律不计，
 * 因为钟那时压根没跑。所以第一次调用只把钟启动起来，不加秒也不换手：
 * 「按下去」和「走完一手交钟」在实体棋钟上是两件不同的事，只有在钟已经在跑之后才合一。
 *
 * 加时规则按制式分三种（这是四种制式里唯一需要在这里分支的地方）：
 *  - **菲舍尔**：无条件加回 `incrementMs`，不封顶 → 剩余时间可以增长。
 *  - **布龙斯坦**：加回 `min(本手用时, delayMs)` → 剩余时间**永远不会超过上一手结束时**。
 *  - **包干 / 读秒**：不加，剩余只减。
 */
export const switchClock = (state: ClockState, side: ClockSide, now: number): ClockState => {
  if (state.paused || isClockOver(state)) return state;
  if (side !== state.turn) return state;

  // 第一次按：钟从这一刻起算，不换手、不加秒（还没走完一手交出去）。
  if (state.runningSince === null) return { ...state, runningSince: now, moveUsedMs: 0 };

  const advanced = tickClock(state, now);
  if (isClockOver(advanced)) return advanced;

  // 本手实际用了多久：读 tickClock 累加出来的 moveUsedMs，**不是** now - runningSince
  // （那个锚点每 200ms 前移一次，只会剩下一段尾巴）。
  const usedMs = advanced.moveUsedMs;
  const mode = advanced.settings.mode;
  const bonus = mode === "fischer"
    ? advanced.settings.incrementMs
    // 布龙斯坦：加回「用掉的」与「延时额度」中的较小者。用得快就只拿回用掉的，
    // 所以剩余时间只减不增——这正是它与菲舍尔加秒的本质区别。
    : mode === "bronstein"
      ? Math.min(usedMs, advanced.settings.delayMs)
      : 0;
  const nextRemaining = Math.max(0, advanced.remaining[side] + bonus);
  const nextTurn = otherSide(side);
  return {
    ...advanced,
    remaining: { ...advanced.remaining, [side]: nextRemaining },
    moves: { ...advanced.moves, [side]: advanced.moves[side] + 1 },
    turn: nextTurn,
    runningSince: now,
    moveUsedMs: 0,
    // 换手即开始新的「本手」：读秒段标记清掉，下一方从满额读秒起算
    // （读秒段是按手记的，不跨手继承）。
    inReadOffSince: null,
  };
};

/** 暂停：先把已流逝的时间结清，再停表。读秒段的锚点保留，暂停时长由 `pausedSince` 记账。 */
export const pauseClock = (state: ClockState, now: number): ClockState => {
  if (state.paused || isClockOver(state)) return state;
  const advanced = tickClock(state, now);
  if (isClockOver(advanced)) return advanced;
  return { ...advanced, paused: true, runningSince: null, pausedSince: advanced.runningSince === null ? null : now };
};

export const resumeClock = (state: ClockState, now: number): ClockState => {
  if (!state.paused || isClockOver(state)) return state;
  // 暂停只意味着「这一段不计」：读秒段把锚点按暂停时长整体前移，本手已经用掉的部分
  // 保持不变。此前这里是把 inReadOffSince 清掉、恢复时重新起算，等于每次暂停都白送
  // 一手满额读秒（2026-10-02 复核读秒分支时发现）。
  const pausedSpan = state.pausedSince === null ? 0 : now - state.pausedSince;
  const inPeriod = state.settings.mode === "readOff" && state.remaining[state.turn] <= 0 && state.periods[state.turn] > 0;
  return {
    ...state,
    paused: false,
    runningSince: state.pausedSince === null ? null : now,
    pausedSince: null,
    inReadOffSince: inPeriod && state.inReadOffSince !== null ? state.inReadOffSince + pausedSpan : null,
  };
};

/**
 * 双超时判和（连珠/五子棋规则）。
 *
 * 用途：裁判或双方**发现时两个钟都已经走完**，但无法确定谁先超时——规则说这是和棋，
 * 而不是让先被发现的那一方背锅。《中国五子棋竞赛规则》和棋条件第 4 项、
 * RIF Gomoku Rules 5.7.2。线下很常见的场景：两个人都没盯着钟，抬头一看两边都是 0。
 */
export const flagBothClock = (state: ClockState): ClockState => {
  if (state.resigned || state.flaggedBoth) return state;
  // 若已经判了一方超时，这里把它升级成和棋（flagged 留着当「曾经走过时间」的痕迹，
  // 但 clockWinner 会因为 flaggedBoth 返回 null）。
  return { ...state, flaggedBoth: true, runningSince: null, inReadOffSince: null };
};

/** 认负。 */
export const resignClock = (state: ClockState, side: ClockSide): ClockState => {
  if (isClockOver(state)) return state;
  return { ...state, resigned: side, runningSince: null, inReadOffSince: null };
};

/** 重开一局：保留设置，时间与手数归零。 */
export const restartClock = (state: ClockState, first: ClockSide = "black", now = 0): ClockState =>
  createClock(state.settings, first, now);

/** 换制式/时限：重新开局（改时限后旧的对局时间没有意义）。 */
export const reconfigureClock = (settings: ClockSettings, first: ClockSide = "black", now = 0): ClockState =>
  createClock(settings, first, now);

/** 是不是"轮走方即将超时"（用于 UI 高亮与报时）。钟还没按下时不算——报时会吓人。 */
export const isLowOnTime = (state: ClockState, side: ClockSide, now: number): boolean => {
  if (state.paused || isClockOver(state)) return false;
  if (side !== state.turn) return false;
  if (state.runningSince === null) return false;
  const left = remainingAt(state, side, now);
  return left > 0 && left <= CLOCK_LOW_MS;
};

/**
 * 报时用的整秒数字：返回「当前该报的秒数」，没到低时间或不是轮走方则为 null。
 * 调用方记住上一次的值，变了才出声——这样不必让 UI 自己算节流。
 */
export const lowTimeSecond = (state: ClockState, now: number): number | null => {
  if (!isLowOnTime(state, state.turn, now)) return null;
  return Math.ceil(remainingAt(state, state.turn, now) / 1000);
};

/**
 * 显示格式：小时位**只在真需要时才出现**。
 *
 * 这不是省几个字符的问题：`2:00:00` 比 `5:00` 长一倍，字号要按最长的那串来定，
 * 如果 5 分钟档也硬挂着小时位（`0:05:00`），快棋的数字就得跟着缩小一圈，
 * 而快棋恰恰是最需要大数字的（隔着一张桌子看）。实体棋钟也是这个行为：
 * 走不到一小时就不占小时位的位置。
 *
 * 用完的位不补零：9 秒显示 `0:09` 而不是 `00:09`（Twisty Timer 同样的取舍）。
 * 负值（超时后）带上负号，让「超了多久」一眼可见。
 */
export const formatClockMs = (milliseconds: number): string => {
  const negative = milliseconds < 0;
  const total = Math.ceil(Math.abs(milliseconds) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const body = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
};

/**
 * 时钟最长为这个字符串长度（用于字号自适应时预留位置）。
 *
 * 取「最大档的格式长度」而不是当前值的长度，是因为真正难受的是**跳动**：
 * 如果字号跟着当前字符串实时变，从 `10:00` 走到 `9:59` 时会突然变大一次，
 * 隔着桌子看像是卡住了。所以每次开局按该档**可能出现的最长字符串**定一次字号，
 * 整局不再变。6 小时档 = `5:59:59`（7 字符），2 小时档 = `1:59:59`（6 字符）。
 */
export const clockDisplaySlots = (baseMs: number): number => {
  const total = Math.ceil(Math.max(0, baseMs) / 1000);
  const hours = Math.floor(total / 3600);
  if (hours === 0) return 5;                        // M:SS      → "59:59"
  if (hours < 10) return 7;                         // H:MM:SS   → "9:59:59"
  return 8;                                         // HH:MM:SS  → "10:00:00"
};
