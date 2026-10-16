/**
 * 成就判定引擎（用户 2026-10-09）。
 *
 * ## 核心设计：**只读已有账本，不新增埋点**
 *
 * 这是这份实现最重要的约束。成就系统最容易走歪的路子是"到处插一行 `recordEvent()`"，
 * 结果是核心流程里散布几十个埋点、每个都可能成为新的 bug 源。这里换个做法：
 *
 *   **统计量全部从已经存在的持久化账本里推**（战绩账本、做题进度、VCF 挑战状态、
 *   复盘样本、识谱历史……）。判定是纯函数：给一份 `AchievementSources` → 得出
 *   应当解锁哪些成就。既不用改任何业务代码的写法，也能对**历史数据**一次性生效
 *   （用户装上新版，过去下的 200 局棋立刻兑现成成就——这比"从今天开始记"好得多）。
 *
 * 唯一的例外是少数"一次性动作"（打开手册、导出棋谱、换主题……），那些确实没有账本，
 * 走 `signal-store.ts` 的 `recordAchievementSignals()` 记一个轻量信号位（只增不减）。
 *
 * ## 判定时机
 *
 * 调用方（App.tsx）在几个天然节点调 `runAchievementCheck()`：对局结算、做题结算、
 * 复盘完成、识谱成功、进入成就面板。这个函数是**幂等**的——已成就不重复解锁、
 * 不重复发棋魂（靠 `soul.ts` 的 token 幂等 + `unlockedAt` 判重）。
 *
 * ## 与棋魂的耦合
 *
 * 解锁成就 → 发棋魂，走同一个 token（`achievement:<id>`），所以即使判定被并发调两次，
 * 棋魂也只发一次。这一层不反过来影响判定（棋魂余额不是任何成就的判据）。
 */

import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_BY_ID,
  ALL_TRUTH_ACHIEVEMENT_ID,
  type AchievementDefinition,
} from "./achievement-catalog";
import { grantSoul, soulBalance, soulLedger, type SoulLedger } from "./soul";
// 判据的数据化：规则形状与解释器（见 achievement-rules.ts 开头"为什么要有这个文件"）。
import { evaluateRule, ruleProgress } from "./achievement-rules";
import { loadAchievementSignals, type AchievementSignals } from "./signal-store";

export const ACHIEVEMENT_STATE_KEY = "banbu-achievements-v1";

/** 解锁时间戳表：成就 id → 首次解锁时刻（ms）。 */
export type AchievementState = Record<string, number>;

const PENDING_SOUL_REWARDS_KEY = "pendingSoulRewards";

const safeStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

export const loadAchievementState = (): AchievementState => {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(ACHIEVEMENT_STATE_KEY) || "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: AchievementState = {};
    for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at) && ACHIEVEMENT_BY_ID.has(id)) out[id] = at;
    }
    return out;
  } catch { return {}; }
};

/** 解锁与发奖分别记账：临时发奖失败不能把已经解锁的奖励永久吞掉。 */
export const loadPendingSoulRewards = (): string[] => {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(ACHIEVEMENT_STATE_KEY) || "{}");
    const pending: unknown = raw?.[PENDING_SOUL_REWARDS_KEY];
    return Array.isArray(pending)
      ? [...new Set(pending.filter((id): id is string => typeof id === "string" && ACHIEVEMENT_BY_ID.has(id)))]
      : [];
  } catch { return []; }
};

export const saveAchievementState = (
  state: AchievementState,
  pendingSoulRewards: readonly string[] = loadPendingSoulRewards(),
): boolean => {
  const storage = safeStorage();
  if (!storage) return false;
  const pending = [...new Set(pendingSoulRewards.filter((id) => state[id] !== undefined && ACHIEVEMENT_BY_ID.has(id)))];
  const saved = pending.length ? { ...state, [PENDING_SOUL_REWARDS_KEY]: pending } : state;
  try { storage.setItem(ACHIEVEMENT_STATE_KEY, JSON.stringify(saved)); return true; } catch { return false; }
};

const loadSignals = loadAchievementSignals;

/**
 * 判定时读得到的全部外部事实。**每一项都来自已有存储**（来源见行内注释）。
 * 全部可选——缺失一律按 0/false 处理，所以拿不到某项时只是少解锁几条，不会误判。
 *
 * 这些来源由 `achievement-sources.ts` 的 `collectAchievementSources()` 组装
 * （那里是唯一读盘的地方，本文件保持纯判定）。
 */
export interface AchievementProgress {
  current: number;
  target: number;
  unit: string;
}

/**
 * 判定时读得到的全部外部事实。**每一项都来自已有存储**（来源见行内注释）。
 * 全部可选——缺失一律按 0/false 处理，所以拿不到某项时只是少解锁几条，不会误判。
 */
export interface AchievementSources {
  /** 战绩账本 `banbu-duel-history-v1`（src/features/duel/duel-history.ts） */
  duel?: {
    games: number;
    wins: number;
    /** 是否赢过「大师」档 */
    wonMaster: boolean;
    /** 对「大师」档的当前连胜 */
    masterStreak: number;
    /** 最短取胜手数（没有胜局时 undefined） */
    fastestWinMoves?: number;
    /** 是否有因禁手判负的一局 */
    lostByForbidden: boolean;
    /** 因禁手判负之后是否赢过 */
    wonAfterForbidden: boolean;
    /** 是否有一局没认输、下到分出胜负 */
    completedWithoutResign: boolean;
    /** 是否用过比赛计时器下完整局 */
    usedClock: boolean;
    /** 当前等级分 */
    rating: number;
    /** 当前连胜 */
    streak: number;
    /** 和棋局数（2026-10-10 新增，供"和平主义"类成就用） */
    draws: number;
    /** 最长一局的落子手数（供"持久战"类成就用） */
    longestGame: number;
    /** 执白取胜的局数（供"换色也赢"类成就用） */
    wonAsWhite: number;
    /** 执黑取胜的局数 */
    wonAsBlack: number;
  };
  /** 做题进度 `renju-note-puzzle-progress-v1` + 题库（src/puzzles.ts） */
  puzzle?: {
    solved: number;
    /** 做题尝试总次数（含没做出来的） */
    attempts: number;
    /** 是否有任一题集全清 */
    clearedCollection: boolean;
    /** 错题本里现有多少道 */
    wrongCount: number;
    /** 是否把一道错题重新做对过 */
    clearedWrong: boolean;
    /** 每日一题累计完成次数 */
    dailyDone: number;
  };
  /** VCF 挑战状态 `vcfch-state-v1`（src/features/vcf-challenge/rating.ts） */
  vcf?: {
    solved: number;
    streak: number;
    bestStreak: number;
    rating: number;
    /** 今日解出题数（VCF 状态里本来就有 daily 表） */
    todaySolved: number;
    /**
     * **参与总次数**（解出 + 失败）。用户 2026-10-10 要的持久累积线量的是
     * "玩了多少次"而不是"做对了多少次"——在 VCF 里反复试不出来是常态，那也是在练。
     */
    attempts: number;
    /** 解答力**等级**（直接取 `rating.ts` 的 `levelOf`，与 VCF 页显示的必须是同一个数）。 */
    level: number;
    /** 最长连解（当前等于 bestStreak；留两个名字是为了将来口径可能分叉时不误改）。 */
    longestWinStreak: number;
  };
  /** 复盘样本 `banbu-game-review-v2`（src/features/research/game-review.ts） */
  review?: {
    /** 累计复盘局数 */
    count: number;
    /** 是否存在"零失误"的一局 */
    flawless: boolean;
  };
  /** 识谱（走信号位 + 识别历史） */
  recognition?: {
    /** 累计成功识谱张数 */
    count: number;
    /** 是否复原过完整手序 */
    restoredOrder: boolean;
    /** 最大识别手数 */
    maxMoves: number;
  };
  /** 变化树（棋谱库里的全部分支数） */
  study?: {
    branches: number;
    /** 是否打开过十万节点以上的大谱 */
    openedBigLibrary: boolean;
    /** 是否用跨谱检索命中过 */
    usedCrossSearch: boolean;
  };
  /** 开局识别覆盖：集齐了多少种开局（`explore-openings-26` 用） */
  openingKinds?: number;
  /** 生成器产出（信号位） */
  generator?: { kinds: string[]; maxDepth: number; count: number };
  /**
   * 棋谱库规模（2026-10-10 新增）。**直接读库，不需要任何业务代码配合** ——
   * 这是本模块"只读已有存储"纪律的最纯粹例子：棋谱库本来就是用户资产，
   * 从它派生成就（"存了 50 份棋谱""收藏了 10 份"）不需要新增埋点。
   */
  library?: {
    /** 棋谱库里的棋谱份数 */
    documents: number;
    /** 收藏的棋谱 + 题集份数 */
    favorites: number;
    /** 分支书签数 */
    bookmarks: number;
  };
  /** 一次性动作信号位 */
  signals?: AchievementSignals;
  /**
   * 点魂火的累计次数（用户 2026-10-10：「点击棋魂也算成就，1下，99下，299下……9999下」）。
   *
   * 读的是**信号位里的 `tapCount`**（只增不减的计数），不是账本里数 `manual` 条数 ——
   * 账本超上限会被折叠、连点又受 `tapCountsAsEarned` 口径影响，只有独立计数才数得准。
   */
  tap?: { total: number };
}

/** 判定出的单条结果（含进度，供弹窗与面板共用）。 */
export interface AchievementEvaluation {
  id: string;
  definition: AchievementDefinition;
  /** 判定时看到的进度（累积型才有） */
  progress?: AchievementProgress;
  met: boolean;
}

const atLeast = (current: number, target: number) => current >= target;

/**
 * 纯判定：读 `sources`，返回**全部**成就的判定结果（不只是新解锁的）。
 * 面板要显示"未解锁的还差多少"，所以这里算全量；只取新解锁的由调用方过滤。
 */
/**
 * 判定（2026-10-10 起是**数据驱动的小解释器**）。
 *
 * 上一版这里有 58 个 `case` 加 58 行 `metById` 字面量。改成读每条成就自己的
 * `rule` 之后，增删成就**只需要改 `achievement-catalog.ts`** —— 这也是
 * 「成就工坊」网页能把删改结果直接落回源码的前提。
 *
 * 两个特殊处理（都只影响这一条）：
 *  · **「集齐全图鉴」**（`ALL_TRUTH_ACHIEVEMENT_ID`）：判据是"除自己以外全部达成"，
 *    表达成普通 rule 会自引用 ⇒ 等其余判定跑完再补齐。它**故意**把
 *    `secret` 成就也算进去（隐藏成就也是成就），所以要先跑完一整轮。
 *  · **没有 rule 的条目**：保守判为未达成（正常目录里只有全图鉴这一条会走到，
 *    自检会把其他缺 rule 的条目在 CI 里报红）。
 */
/**
 * 进度（数据驱动，2026-10-10）：直接把成就自己的 `rule` 与 `target` 交给 `ruleProgress`，
 * 不再按 id 逐个 switch —— 那是上一版"删不掉、加不上"的另一半原因。
 */
const progressOf = (
  sources: AchievementSources,
  definition: AchievementDefinition,
): AchievementProgress | undefined => {
  if (!definition.rule || !definition.target || !definition.unit) return undefined;
  return {
    current: ruleProgress(sources, definition.rule, definition.target),
    target: definition.target,
    unit: definition.unit,
  };
};

export const evaluateAchievements = (sources: AchievementSources): AchievementEvaluation[] => {
  const metById: Record<string, boolean> = {};
  for (const definition of ACHIEVEMENT_CATALOG) {
    if (!definition.rule) { metById[definition.id] = false; continue; }
    metById[definition.id] = evaluateRule(sources, definition.rule);
  }

  // 全图鉴补齐：此时 metById 已完全建好，可以安全引用自己以外的每一条。
  metById[ALL_TRUTH_ACHIEVEMENT_ID] = ACHIEVEMENT_CATALOG
    .filter((item) => item.id !== ALL_TRUTH_ACHIEVEMENT_ID)
    .every((item) => Boolean(metById[item.id]));

  return ACHIEVEMENT_CATALOG.map((definition) => ({
    id: definition.id,
    definition,
    progress: progressOf(sources, definition),
    met: Boolean(metById[definition.id]),
  }));
};

export interface AchievementCheckResult {
  /** 本次判定**新**解锁的成就（按目录顺序，弹窗要按顺序逐个播） */
  unlocked: AchievementDefinition[];
  /** 判定后的完整解锁表（调用方存回 / 更新 state） */
  state: AchievementState;
  /** 已解锁但因额度/存储暂未到账的奖励；调用方也持有它以覆盖存储全面不可用的时段。 */
  pendingSoulRewards: string[];
  /** 解锁/补发元数据是否已落盘；失败时调用方在下一次检查重试。 */
  statePersisted: boolean;
  /** 本次实际发放的棋魂总额 */
  soulGranted: number;
  /** 判定后的余额（给弹窗显示"当前棋魂"） */
  soulBalance: number;
}

/**
 * 判定 + 落盘 + 发棋魂。已解锁的不再进 `unlocked`，失败的奖励在下一次检查补发。
 *
 * `ledger` 由调用方传入（App 里持有同一个实例）——传了就复用，不传就取**共享账本**
 * （`soulLedger()`，见 `soul.ts` 那段）。**不能在这里现读一份盘**：读-改-写一旦
 * 发生在两个副本上，后写的那方会把先写的那方的记录整段覆盖掉
 * （实测过"商店买了东西，下一次 earn 把钱退回来"）。
 */
export const runAchievementCheck = (
  sources: AchievementSources,
  options: { state?: AchievementState; ledger?: SoulLedger; at?: number; pendingSoulRewards?: readonly string[]; retryStatePersistence?: boolean } = {},
): AchievementCheckResult => {
  const at = options.at ?? Date.now();
  const state = { ...(options.state ?? loadAchievementState()) };
  const ledger = options.ledger ?? soulLedger();
  const evaluations = evaluateAchievements(sources);
  const unlocked: AchievementDefinition[] = [];
  const previousPending = options.pendingSoulRewards ?? loadPendingSoulRewards();
  const pending = new Set(previousPending
    .filter((id) => state[id] !== undefined && ACHIEVEMENT_BY_ID.has(id)));
  let soulGranted = 0;

  for (const item of evaluations) {
    if (!item.met) continue;
    if (state[item.id] !== undefined) continue;  // 已经解锁过
    state[item.id] = at;
    unlocked.push(item.definition);
    pending.add(item.id);
  }

  for (const id of [...pending]) {
    const definition = ACHIEVEMENT_BY_ID.get(id)!;
    const granted = grantSoul(ledger, {
      amount: definition.soul,
      reason: "achievement",
      detail: `解锁成就：${definition.title}`,
      // 幂等 token：即使判定被并发跑两次，这一笔也只入账一次。
      token: `achievement:${id}`,
      at,
    });
    if (granted.ok) soulGranted += granted.entry!.amount;
    // disabled 是用户的停发设置；只补发暂时受限或写盘失败的奖励。
    if (granted.code !== "invalid" && granted.code !== "daily-limit") pending.delete(id);
  }

  const pendingSoulRewards = [...pending];
  const needsSave = unlocked.length > 0 || previousPending.length > 0 || options.retryStatePersistence;
  const statePersisted = !needsSave || saveAchievementState(state, pendingSoulRewards);
  return { unlocked, state, pendingSoulRewards, statePersisted, soulGranted, soulBalance: soulBalance(ledger) };
};

/** 给面板用：已完成 / 总数。 */
export const achievementCompletion = (state: AchievementState): { done: number; total: number; percent: number } => {
  const total = ACHIEVEMENT_CATALOG.length;
  const done = ACHIEVEMENT_CATALOG.filter((item) => state[item.id] !== undefined).length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
};
