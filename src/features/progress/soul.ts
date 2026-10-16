/**
 * 棋魂（用户 2026-10-09：「我们再做一个『棋魂』系统…相当于是积分货币什么的，
 * 以后我准备在一些地方用上这个」）。
 *
 * ## 棋魂是什么
 *
 * **参与度货币**：在这个软件里认真做的事（下棋、做题、复盘、识谱、打谱批注、解锁成就）
 * 都会攒下棋魂。它和等级分是两回事——等级分衡量"你有多强"（由 `duel-history` 从战绩推算），
 * 棋魂衡量"你做了多少"（由本模块的流水累加）。两者刻意不混：
 * 混起来会让人以为"花棋魂能变强"。
 *
 * ⚠ **不是"只有成就才给棋魂"**（那是上一版的错误理解，用户当场纠正过）。
 * 成就只是其中一档、偏大奖的那档；来源表见 `soul-economy.ts`。
 *
 * ## 本模块负责三件事
 *
 *   ① 一份可持久化的账本（余额 = 流水的确定性结果，不单独存一个会飘的数）；
 *   ② 授予/消耗两个原子操作 + 一条可审计的流水（最近 50 条在棋魂说明页展示）；
 *   ③ **调度项**（怎么发、发多少、要不要发）——见下面「调度项」一节。
 *
 * 定价、消费登记、出厂默认值这些**数据**在 `soul-economy.ts`（工坊改那份）；
 * 本文件是**账务逻辑**（读写、幂等、折叠、调度执行），改动要过单测。
 *
 * **不做**：商店、充值/付费（README 承诺永久免费开源）、跨设备同步（没有账户体系）、
 * 抽卡/概率类消费（那是赌博机制，不适合一个研究工具）。
 *
 * ## 为什么余额是算出来的而不是存出来的
 *
 * 和 `duel-history.ts` 的等级分同一个理由（那里的原话：「分数**不落盘**，由整条历史在
 * 读取时推算」，改 K 值不用迁移存档）——这里同理：流水是唯一事实，余额是它的求和。
 * 好处是改规则（比如调整某件事给多少）不影响已有账本的一致性检查，
 * 也能在说明页上如实列出"哪来的这么多"。
 *
 * ## 账本上限
 *
 * 流水**不能无限长**：按 `DUEL_HISTORY_LIMIT = 400` 的先例，这里留 1000 条。
 * 但余额不能因为裁剪而变小——所以裁剪时把被裁掉的净额并进一条 `carry` 期初记录
 * （这行记录同时是"这个账本被裁剪过"的证据，说明页上要如实显示）。
 */

import {
  DEFAULT_SOUL_TUNING,
  SOUL_EARN_NOTE,
  SOUL_EARN_RULES,
  SOUL_SPEND_NOTE,
  SOUL_SPEND_POINTS,
  TUNABLE_REASONS,
  VCF_LEVEL_SOUL,
  vcfLevelSoul,
} from "./soul-economy";
import {
  applySoulDelivery, pruneSoulDeliveryReceipts, validPendingSoulPurchase, validSoulDelivery,
  type PendingSoulPurchase, type SoulPurchaseDelivery,
} from "./soul-deliveries";

export const SOUL_LEDGER_KEY = "banbu-soul-ledger-v1";

/** 账本裁剪上限。达到后最早的记录并进 carry，余额不变。 */
export const SOUL_LEDGER_LIMIT = 1000;

/** 棋魂的来源（`grant` 的 reason）。新增来源要同步 `SOUL_REASON_LABELS` 与来源表。 */
export type SoulReason =
  | "achievement"
  | "puzzle-solve"
  | "vcf-solve"
  | "duel-win"
  | "recognition"
  | "review"
  | "study"
  | "daily"
  /** 人机对弈的「悔棋」（用户 2026-10-13 定：10 棋魂一次，直接扣账本、不走道具卡）。 */
  | "duel-undo"
  | "carry"
  | "manual";

export const SOUL_REASON_LABELS: Record<SoulReason, string> = {
  achievement: "解锁成就",
  "puzzle-solve": "攻克题目",
  "vcf-solve": "VCF 挑战",
  "duel-win": "对弈取胜",
  recognition: "识谱成功",
  review: "整局复盘",
  study: "打谱批注",
  daily: "每日一题",
  "duel-undo": "对弈悔棋",
  carry: "期初结余",
  manual: "手动调整",
};

export interface SoulEntry {
  id: string;
  /** 发生时刻（ms）。列表按它排。 */
  at: number;
  /** 正数=获得，负数=消耗。**不允许 0**（0 是坏数据）。 */
  amount: number;
  reason: SoulReason;
  /** 人读说明，面板上直接显示（例如「解锁成就：首胜」）。 */
  detail: string;
  /** 幂等 token：同一个来源重复写第二次会被忽略（照 `duel-history` 的 `id` 用法）。 */
  token?: string;
  /** session token 只随最近流水保存，折叠后不再永久占用凭证空间。 */
  tokenRetention?: "session" | "persistent";
  /** 折叠记录的幂等凭证，与账本一起备份；余额仍只由 amount 求和。 */
  compactedTokens?: string[];
  /** 扣费与待发商品同笔落盘，商品存储恢复后按增量投递。 */
  pendingPurchases?: PendingSoulPurchase[];
}

export interface SoulLedger {
  version: 1;
  entries: SoulEntry[];
  /** 已发过的 token 集合（从流水与折叠凭证重建）。 */
  usedTokens: Set<string>;
}

const safeStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

const isReason = (value: unknown): value is SoulReason =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(SOUL_REASON_LABELS, value);

const isLegacyTapToken = (token: string): boolean => /^tap:\d+:\d+$/.test(token);

/** 单条校验：任何一处不像样就丢掉这一条（不整份作废——棋魂是累积资产）。 */
const isValidEntry = (value: unknown): value is SoulEntry => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SoulEntry>;
  return typeof item.id === "string"
    && typeof item.at === "number" && Number.isFinite(item.at)
    && typeof item.amount === "number" && Number.isInteger(item.amount) && item.amount !== 0
    && isReason(item.reason)
    && typeof item.detail === "string";
};

export const loadSoulLedger = (): SoulLedger => {
  const empty: SoulLedger = { version: 1, entries: [], usedTokens: new Set() };
  const storage = safeStorage();
  if (!storage) return empty;
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(SOUL_LEDGER_KEY) || "[]"); } catch { return empty; }
  if (!Array.isArray(raw)) return empty;
  const entries = raw.filter(isValidEntry).map((item) => ({
    ...item,
    detail: item.detail.slice(0, 120),
    token: typeof item.token === "string" ? item.token : undefined,
    tokenRetention: item.tokenRetention === "session"
      || (item.tokenRetention === undefined && item.reason === "manual"
        && typeof item.token === "string" && isLegacyTapToken(item.token)) ? "session" as const : "persistent" as const,
    compactedTokens: Array.isArray(item.compactedTokens)
      ? item.compactedTokens.filter((token): token is string => typeof token === "string" && token.length > 0 && !isLegacyTapToken(token))
      : undefined,
    pendingPurchases: Array.isArray(item.pendingPurchases)
      ? item.pendingPurchases.filter(validPendingSoulPurchase)
      : undefined,
  }));
  entries.sort((a, b) => a.at - b.at);
  const usedTokens = new Set<string>();
  for (const item of entries) {
    if (item.token) usedTokens.add(item.token);
    for (const token of item.compactedTokens ?? []) usedTokens.add(token);
  }
  return { version: 1, entries, usedTokens };
};

// ─────────────────────────────────────────────────────────────────────
// 共享账本实例（2026-10-11 修的真漏洞）
// ─────────────────────────────────────────────────────────────────────

/**
 * ## 为什么账本必须是"全应用同一个对象"
 *
 * 这个坑踩得很贵，值得写清楚。`grantSoul` / `spendSoul` 的语义是**改动传入的那个对象、
 * 并把它的整份 `entries` 写回存储**（读-改-写）。于是只要同时存在**两个**账本副本，
 * 后写的那一方就会把前者的记录整段覆盖掉：
 *
 * ```
 * ① useProgress 挂载时 loadSoulLedger() 拿一份，长期持有（它要渲染余额与流水）
 * ② useSoulShop 买一件 500 的东西 —— 它自己 loadSoulLedger() 又拿一份，
 *    扣费写进去、落盘（storage 里现在有这笔 -500）
 * ③ 用户赢一局 → progress.earn() 写的是 ① 那份**旧数组**（里面没有那笔 -500）
 *    ⇒ 落盘的内容 = 旧数组 + 20，**那笔 -500 被整段抹掉了**
 * ```
 *
 * 后果不是"数字差了一点"，而是**钱退回来了、东西还留着**（解锁集合在另一个键上，
 * 不受影响）——买完再随便做点什么，棋魂就白拿。实测复现过（见 `soul-shop`
 * 那组回归测试里的"买完再 earn 不许抹账"）。
 *
 * 修法：把账本收成**模块级单例**。所有持有者（hooks、商店）都从这里拿，
 * 拿到的就是同一个对象，所以"读-改-写"永远作用在同一份数据上。
 * `loadSoulLedger()` 保留原样（每次真读盘）——它是**只读**用途与测试的入口，
 * 写路径一律走 `soulLedger()`。
 *
 * 另外配一个**变更广播**（revision）：账本被写过之后通知订阅者重渲染。
 * 前面那个漏洞的另一半是"商店买了、进度那边不知道"，有了广播就一并解决
 * （原来只有 progress → 商店 一个方向，反向是漏的）。
 */
let sharedSoulLedger: SoulLedger | null = null;
let soulRevision = 0;
const soulLedgerListeners = new Set<() => void>();

/** 全应用共享的账本实例（第一次调用时读盘）。**写操作一律用它**。 */
export const soulLedger = (): SoulLedger => {
  if (!sharedSoulLedger) sharedSoulLedger = loadSoulLedger();
  return sharedSoulLedger;
};

/** 丢弃共享实例（下一次 `soulLedger()` 重新读盘）。恢复备份/清空数据与测试用。 */
export const resetSoulLedger = (): void => {
  sharedSoulLedger = null;
  bumpSoulRevision();
};

/** 账本每次成功写入后 +1（`useSyncExternalStore` 的快照就是它）。 */
export const soulLedgerRevision = (): number => soulRevision;

/** 订阅账本变更（返回取消订阅）。 */
export const subscribeSoulLedger = (listener: () => void): (() => void) => {
  soulLedgerListeners.add(listener);
  return () => { soulLedgerListeners.delete(listener); };
};

/** 只给本模块的写入路径用（见 `grantSoul` / `spendSoul` 成功分支）。 */
const notifySoulListeners = (): void => {
  for (const listener of [...soulLedgerListeners]) {
    try { listener(); } catch { /* 订阅者自己报错不该影响账务 */ }
  }
};
let soulNotificationQueued = false;
const bumpSoulRevision = (deferNotifications = false): void => {
  soulRevision += 1;
  if (!deferNotifications) { notifySoulListeners(); return; }
  // 商品恢复可能由 React 的快照读取触发；修订号即时更新，通知等当前渲染结束。
  if (soulNotificationQueued) return;
  soulNotificationQueued = true;
  queueMicrotask(() => { soulNotificationQueued = false; notifySoulListeners(); });
};

const persist = (entries: SoulEntry[]): boolean => {
  const storage = safeStorage();
  if (!storage) return false;
  try { storage.setItem(SOUL_LEDGER_KEY, JSON.stringify(entries)); return true; } catch { return false; }
};

/** 余额 = 流水求和。看着朴素，但这就是"单一事实来源"的全部实现。 */
export const soulBalance = (ledger: SoulLedger): number =>
  ledger.entries.reduce((sum, item) => sum + item.amount, 0);

/**
 * 账本自我修复：把超出上限的旧记录并成一条 `carry`。
 * **只在写入时调用**（读取时不动用户的账本），并保证余额不变。
 */
const compact = (entries: SoulEntry[]): SoulEntry[] => {
  if (entries.length <= SOUL_LEDGER_LIMIT) return entries;
  const overflow = entries.length - SOUL_LEDGER_LIMIT + 1;
  const dropped = entries.slice(0, overflow);
  const rest = entries.slice(overflow);
  const carried = dropped.reduce((sum, item) => sum + item.amount, 0);
  const compactedTokens = [...new Set(dropped.flatMap((item) => [
    ...(item.compactedTokens ?? []), ...(item.token && item.tokenRetention !== "session" ? [item.token] : []),
  ]))];
  const pendingPurchases = dropped.flatMap((item) => item.pendingPurchases ?? []);
  const first = rest[0];
  // carry 记在被裁掉那段之后、现存最早一条之前：时间上诚实，排序也不会乱。
  const carry: SoulEntry = {
    id: `soul-carry-${dropped.length}-${first?.at ?? Date.now()}`,
    at: (first?.at ?? Date.now()) - 1,
    amount: carried,
    reason: "carry",
    detail: `期初结余（已折叠更早的 ${dropped.length} 条记录）`,
    ...(compactedTokens.length ? { compactedTokens } : {}),
    ...(pendingPurchases.length ? { pendingPurchases } : {}),
  };
  if (carried !== 0) return [carry, ...rest];
  // 净额为零不能留无效的零元流水，凭证随最早一条保留记录继续走。
  if ((compactedTokens.length || pendingPurchases.length) && first) rest[0] = {
    ...first, compactedTokens: [...new Set([...compactedTokens, ...(first.compactedTokens ?? [])])],
    pendingPurchases: [...pendingPurchases, ...(first.pendingPurchases ?? [])],
  };
  return rest;
};

// ─────────────────────────────────────────────────────────────────────
// 调度项（用户 2026-10-10：「在棋魂的获取以及使用方面多多给我一些调度的选项」）
// ─────────────────────────────────────────────────────────────────────

/**
 * 棋魂的**调度项**：一组"乘数/开关/额度"，用来调"给多少、要不要给、最多给多少"。
 *
 * ## 为什么做成"全局生效"而不是"调用方传参"
 *
 * 这里的旋钮必须**无法被绕过**。如果只在 `useProgress.earn()` 里套一层，
 * 那么 `runAchievementCheck` 内部直接调 `grantSoul` 那条路径就漏了——将来再加一个
 * 结算点，也可能又漏一次，而"漏了"的表现是**数字悄悄不对**，没人会立刻发现。
 *
 * 所以调度统一在 **`grantSoul` / `spendSoul` 里面**执行（账本唯一的两个入口），
 * 调用方一个都不用改。当前生效的那份由 `useProgress` 在启动时从存储里加载一次
 * （`setActiveSoulTuning`），也可以在调用时显式传 `tuning` 覆盖（测试与工坊预览用）。
 *
 * ## 每一项都真的在跑
 *
 * 本项目的一条纪律：**不允许出现"界面上能调、实际没人读"的假旋钮**。
 * 下面每个字段后面都标了它在哪儿生效，`achievements.test.ts` 里有对应的边界单测。
 */
export interface SoulTuning {
  /** 【获取·全局】所有来源的倍率（作用于除成就以外的全部来源）。1 = 原样。 */
  earnMultiplier: number;
  /** 【获取·成就】成就奖励的单独倍率。和上面分开是因为成就是"偏大奖"那一档。 */
  achievementMultiplier: number;
  /** 【获取·上限】单次授予的天花板；任何一笔都不会超过它。0 = 不限（防脚本刷爆）。 */
  earnCapPerGrant: number;
  /** 【获取·上限】24 小时内最多入账多少（滚动窗口）。0 = 不限。 */
  dailyEarnLimit: number;
  /**
   * 【获取·开关】关掉的来源：这些 reason 一律不入账。
   *
   * ⚠ 关掉**成就**时要注意：成就照样会解锁（"达成"是事实），只是不发棋魂，
   * 而且之后重新打开也**不会补发**（补发要求重跑判定，而判定只认"从未解锁"）。
   * 这是有意的：奖励口径改了不该追溯既往。
   */
  disabledReasons: SoulReason[];
  /** 【获取·对局】输一局给多少。**默认 0**：保持用户 2026-10-09 的原话"输了不给也不扣"。 */
  lossAmount: number;
  /** 【获取·对局】和棋给多少。默认 0（同上）。 */
  drawAmount: number;
  /**
   * 【获取·连点】点一下魂火给多少（基础值，之后照样过全局倍率与单次上限）。
   * 用户点名 "+1"，所以默认 1。
   */
  tapAmount: number;
  /**
   * 【获取·连点】连点所得**是否计入"累计获得"**。
   *
   * `false` 的含义比字面更宽一点：它让连点变成一条**完全不计口径**的水龙头——
   * 不进"累计获得"、也不占每日额度（每日额度是防滥用的，而连点按设计就是无限的）。
   * 余额照常增加，账本照常留痕。默认 `true`（如实统计）。
   */
  tapCountsAsEarned: boolean;
  /** 【消耗·全局】所有消费点的倍率。0.1 = 一折、10 = 十倍。 */
  spendMultiplier: number;
  /** 【消耗·下限】打折之后不低于这个数（防止倍率把一次消费压到 0）。 */
  minimumSpend: number;
  /** 【消耗·上限】24 小时内最多花掉多少。0 = 不限。 */
  dailySpendLimit: number;
}

/** 调度项的存储键。默认值在 `soul-economy.ts`（工坊改那份）。 */
export const SOUL_TUNING_KEY = "banbu-soul-tuning-v1";

const TUNING_LIMITS = {
  earnMultiplier: [0, 10] as const,
  achievementMultiplier: [0, 10] as const,
  earnCapPerGrant: [0, 100000] as const,
  dailyEarnLimit: [0, 1000000] as const,
  lossAmount: [0, 1000] as const,
  drawAmount: [0, 1000] as const,
  tapAmount: [1, 100] as const,
  spendMultiplier: [0.1, 10] as const,
  minimumSpend: [1, 1000] as const,
  dailySpendLimit: [0, 1000000] as const,
};

/** 归一化：每个字段**逐项校验**，坏值回落默认（照 `sound-settings` 的先例）。 */
export const normalizeSoulTuning = (raw?: Partial<SoulTuning> | null): SoulTuning => {
  const source = raw ?? {};
  const pick = (key: keyof typeof TUNING_LIMITS): number => {
    const [min, max] = TUNING_LIMITS[key];
    const value = source[key];
    const fallback = DEFAULT_SOUL_TUNING[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  };
  const flag = (key: "tapCountsAsEarned"): boolean => {
    const value = source[key];
    return typeof value === "boolean" ? value : DEFAULT_SOUL_TUNING[key];
  };
  // 关掉的来源：只留合法的 reason，且**去重**；顺带丢掉 carry（它不是来源，是记账产物）。
  const disabled = Array.isArray(source.disabledReasons)
    ? [...new Set(source.disabledReasons.filter((item): item is SoulReason => isReason(item) && item !== "carry"))]
    : DEFAULT_SOUL_TUNING.disabledReasons;
  return {
    earnMultiplier: pick("earnMultiplier"),
    achievementMultiplier: pick("achievementMultiplier"),
    earnCapPerGrant: pick("earnCapPerGrant"),
    dailyEarnLimit: pick("dailyEarnLimit"),
    disabledReasons: disabled,
    lossAmount: pick("lossAmount"),
    drawAmount: pick("drawAmount"),
    tapAmount: pick("tapAmount"),
    tapCountsAsEarned: flag("tapCountsAsEarned"),
    spendMultiplier: pick("spendMultiplier"),
    minimumSpend: pick("minimumSpend"),
    dailySpendLimit: pick("dailySpendLimit"),
  };
};

export const loadSoulTuning = (): SoulTuning => {
  const storage = safeStorage();
  if (!storage) return { ...DEFAULT_SOUL_TUNING };
  try { return normalizeSoulTuning(JSON.parse(storage.getItem(SOUL_TUNING_KEY) || "null")); } catch { return { ...DEFAULT_SOUL_TUNING }; }
};

export const saveSoulTuning = (tuning: SoulTuning): boolean => {
  const storage = safeStorage();
  if (!storage) return false;
  try { storage.setItem(SOUL_TUNING_KEY, JSON.stringify(normalizeSoulTuning(tuning))); return true; } catch { return false; }
};

/**
 * 当前生效的调度项（模块级单例）。
 *
 * 为什么用单例而不是到处传参：见 `SoulTuning` 开头那段——**旋钮不能被绕过**。
 * 账单的两个入口（`grantSoul` / `spendSoul`）都读它，所以"有没有哪条路径漏了调度"
 * 这个问题在上线前就不存在了。
 *
 * 初始值是出厂默认（= 全部中性：倍率 1、上限 0=不限、开关全开），
 * 所以在 `useProgress` 装配之前，行为与"没有调度层"完全一致——老的单测因此不受影响。
 */
let activeTuning: SoulTuning = { ...DEFAULT_SOUL_TUNING };

export const getActiveSoulTuning = (): SoulTuning => activeTuning;

/** 由 `useProgress` 在启动时调用一次（也可以在调试/测试里随时改）。 */
export const setActiveSoulTuning = (tuning?: Partial<SoulTuning> | null): SoulTuning => {
  activeTuning = normalizeSoulTuning(tuning ?? DEFAULT_SOUL_TUNING);
  return activeTuning;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 这条流水是否计入"累计获得"这类统计口径。
 *
 * 连点（`manual`）在 `tapCountsAsEarned === false` 时不计——**同一个判据同时用在
 * `summarizeSoul`（面板上的累计）与 `soulEarnedWithin`（每日额度）**，
 * 两处共用一个函数，就不会出现"面板不算、额度却算"这种自相矛盾。
 */
export const countsTowardEarned = (entry: SoulEntry, tuning: SoulTuning = activeTuning): boolean => {
  if (entry.amount <= 0) return false;
  if (entry.reason === "manual" && !tuning.tapCountsAsEarned) return false;
  return true;
};

/** 24 小时内已入账多少（给 `dailyEarnLimit` 用）。 */
export const soulEarnedWithin = (
  ledger: SoulLedger,
  windowMs: number,
  now = Date.now(),
  tuning: SoulTuning = activeTuning,
): number =>
  ledger.entries
    .filter((item) => countsTowardEarned(item, tuning) && now - item.at <= windowMs)
    .reduce((sum, item) => sum + item.amount, 0);

/** 24 小时内已花掉多少（给 `dailySpendLimit` 用）。 */
export const soulSpentWithin = (ledger: SoulLedger, windowMs: number, now = Date.now()): number =>
  ledger.entries
    .filter((item) => item.amount < 0 && now - item.at <= windowMs)
    .reduce((sum, item) => sum + -item.amount, 0);

/**
 * 一笔"原始数额"过了调度之后实际该发多少。**纯函数**（工坊的实时预览直接调它）。
 *
 * 顺序是有讲究的：先倍率 → 再单次上限 → 最后每日余额。
 * 反过来的话，"上限 100、倍率 2、原始 80"会算出 160 而超过上限。
 */
export const applyEarnTuning = (
  ledger: SoulLedger,
  amount: number,
  reason: SoulReason,
  tuning: SoulTuning = activeTuning,
  now = Date.now(),
): number => {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (tuning.disabledReasons.includes(reason)) return 0;
  const multiplier = reason === "achievement" ? tuning.achievementMultiplier : tuning.earnMultiplier;
  let next = Math.max(0, Math.round(amount * multiplier));
  if (tuning.earnCapPerGrant > 0) next = Math.min(next, tuning.earnCapPerGrant);
  if (tuning.dailyEarnLimit > 0) {
    // 连点不计口径时也不占额度（见 tapCountsAsEarned 的注释）。
    const already = soulEarnedWithin(ledger, DAY_MS, now, tuning);
    next = Math.min(next, Math.max(0, tuning.dailyEarnLimit - already));
  }
  return next;
};

/** 消费点实际要扣多少（过了 `spendMultiplier` 与 `minimumSpend`）。 */
export const applySpendTuning = (cost: number, tuning: SoulTuning = activeTuning): number => {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return Math.max(tuning.minimumSpend, Math.round(cost * tuning.spendMultiplier));
};

// ─────────────────────────────────────────────────────────────────────
// 账务
// ─────────────────────────────────────────────────────────────────────

/** 失败原因。调用方可以只看 `ok`，也可以按它给用户一句准确的话。 */
export type SoulMutationCode = "ok" | "invalid" | "duplicate" | "disabled" | "insufficient" | "daily-limit";

export interface SoulMutation {
  ok: boolean;
  /** 变动后的余额（失败时是原余额）。 */
  balance: number;
  /** 实际写进去的那一条；被幂等跳过或参数非法时为 null。 */
  entry: SoulEntry | null;
  /** 失败原因（成功时是 `"ok"`）。**加这个字段是因为"余额不足"和"超了今日额度"
   *  需要给用户不同的话**——原来的布尔开关做不到，消费端一上来就会撞到这个。 */
  code: SoulMutationCode;
  /** 钱已安全入账但商品存储暂不可写；待发商品会在后续读取时恢复。 */
  deliveryPending?: boolean;
}

let seq = 0;
const nextId = (at: number) => `soul-${at.toString(36)}-${(seq++).toString(36)}`;

const fail = (ledger: SoulLedger, code: SoulMutationCode): SoulMutation =>
  ({ ok: false, balance: soulBalance(ledger), entry: null, code });

/** 恢复增量商品，不覆盖现有库存。已投递但清账失败时 receipt 阻止重放。 */
export const recoverSoulPurchases = (ledger: SoulLedger = soulLedger(), token?: string): boolean => {
  if (!ledger.entries.some((entry) => entry.pendingPurchases?.length)) return true;
  const storage = safeStorage();
  if (!storage) return false;
  const applied = new Set<PendingSoulPurchase>();
  let goodsChanged = false;
  let delivered = true;
  for (const entry of ledger.entries) {
    for (const purchase of entry.pendingPurchases ?? []) {
      const result = applySoulDelivery(storage, purchase);
      if (result !== "failed") applied.add(purchase);
      if (result === "delivered") goodsChanged = true;
      if (result === "failed" && (!token || token === purchase.token)) delivered = false;
    }
  }
  if (applied.size) {
    const entries = ledger.entries.map((entry) => {
      if (!entry.pendingPurchases?.some((purchase) => applied.has(purchase))) return entry;
      const pendingPurchases = entry.pendingPurchases.filter((purchase) => !applied.has(purchase));
      const next = { ...entry };
      if (pendingPurchases.length) next.pendingPurchases = pendingPurchases;
      else delete next.pendingPurchases;
      return next;
    });
    if (persist(entries)) {
      ledger.entries = entries;
      bumpSoulRevision(true);
    } else if (goodsChanged) {
      // 商品已到账而清账仍不可写：界面也要更新；receipt 保证下次读取不会重复通知/加货。
      bumpSoulRevision(true);
    }
  }
  pruneSoulDeliveryReceipts(storage, new Set(ledger.entries.flatMap((entry) =>
    (entry.pendingPurchases ?? []).map((purchase) => purchase.token))));
  return delivered;
};

/**
 * 授予棋魂。`token` 用于幂等——同一个 token 第二次调用直接失败，
 * 不写流水、不改余额（"终局→刷新→恢复→再结算"这类重复路径靠它兜住）。
 *
 * 金额必须是**正整数**：`1.5` 这种一律拒绝，不四舍五入——
 * 悄悄把 1.5 变成 2 等于替用户凭空造币（实测被单测抓到过一次）。
 *
 * **调度在这里执行**（见 `SoulTuning`）：倍率、单次上限、每日上限、开关、连点口径。
 * 调度之后为 0 的直接不入账（关掉的来源不该在账本里留下零元记录）。
 */
export const grantSoul = (
  ledger: SoulLedger,
  input: { amount: number; reason: SoulReason; detail: string; token?: string; tokenRetention?: "session" | "persistent"; at?: number; tuning?: SoulTuning },
): SoulMutation => {
  const amount = input.amount;
  if (!Number.isInteger(amount) || amount <= 0) return fail(ledger, "invalid");
  if (input.token && ledger.usedTokens.has(input.token)) return fail(ledger, "duplicate");
  const at = input.at ?? Date.now();
  const tuning = input.tuning ?? activeTuning;
  const granted = applyEarnTuning(ledger, amount, input.reason, tuning, at);
  if (granted <= 0) {
    return fail(ledger, tuning.disabledReasons.includes(input.reason) ? "disabled" : "daily-limit");
  }
  const entry: SoulEntry = {
    id: nextId(at),
    at,
    amount: granted,
    reason: input.reason,
    detail: input.detail.slice(0, 120),
    ...(input.token ? { token: input.token } : {}),
    ...(input.tokenRetention ? { tokenRetention: input.tokenRetention } : {}),
  };
  const entries = compact([...ledger.entries, entry]);
  if (!persist(entries)) return fail(ledger, "invalid");
  ledger.entries = entries;
  if (entry.token) ledger.usedTokens.add(entry.token);
  // 广播（见共享账本那段）：让另一个持有者的界面立刻跟上，别停在旧余额上。
  bumpSoulRevision();
  return { ok: true, balance: soulBalance(ledger), entry, code: "ok" };
};

/**
 * 消耗棋魂。**余额不足直接拒绝**，不写流水、不产生负余额——这是货币的底线，
 * 也是给消费端的硬保证：调用方只用看 `ok`（要区分原因就看 `code`）。
 *
 * 调度同样在这里执行（倍率、下限、每日额度）——**先调度再判余额**，
 * 否则"倍率打折后余额够了"会被误判成不足。
 */
export const spendSoul = (
  ledger: SoulLedger,
  input: { amount: number; reason: SoulReason; detail: string; token?: string; at?: number; tuning?: SoulTuning; delivery?: SoulPurchaseDelivery },
): SoulMutation => {
  const amount = input.amount;
  if (!Number.isInteger(amount) || amount <= 0) return fail(ledger, "invalid");
  if (input.delivery && (!validSoulDelivery(input.delivery) || !input.token || input.token.length > 200)) return fail(ledger, "invalid");
  if (input.delivery) recoverSoulPurchases(ledger);
  if (input.token && ledger.usedTokens.has(input.token)) return fail(ledger, "duplicate");
  const at = input.at ?? Date.now();
  const tuning = input.tuning ?? activeTuning;
  const cost = applySpendTuning(amount, tuning);
  const balance = soulBalance(ledger);
  if (cost > balance) return fail(ledger, "insufficient");
  if (tuning.dailySpendLimit > 0) {
    const already = soulSpentWithin(ledger, DAY_MS, at);
    if (already + cost > tuning.dailySpendLimit) return fail(ledger, "daily-limit");
  }
  const entry: SoulEntry = {
    id: nextId(at),
    at,
    amount: -cost,
    reason: input.reason,
    detail: input.detail.slice(0, 120),
    ...(input.token ? { token: input.token } : {}),
    ...(input.delivery ? { pendingPurchases: [{ ...input.delivery, token: input.token! }] } : {}),
  };
  const entries = compact([...ledger.entries, entry]);
  if (!persist(entries)) return fail(ledger, "invalid");
  ledger.entries = entries;
  if (entry.token) ledger.usedTokens.add(entry.token);
  // 广播（见共享账本那段）：同一笔消费可能由商店发起，而余额在进度那边也显示着。
  bumpSoulRevision();
  const deliveryPending = input.delivery ? !recoverSoulPurchases(ledger, input.token) : undefined;
  return { ok: true, balance: soulBalance(ledger), entry, code: "ok", ...(input.delivery ? { deliveryPending } : {}) };
};

/** 供面板显示的最近流水（倒序 = 最新在上，和改造表/迭代日志同一口径）。 */
export const recentSoulEntries = (ledger: SoulLedger, limit = 30): SoulEntry[] =>
  [...ledger.entries].sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit));

export interface SoulSummary {
  balance: number;
  earned: number;
  spent: number;
  /** 按来源汇总的获得额（面板上的构成条），从多到少。 */
  byReason: Array<{ reason: SoulReason; label: string; amount: number }>;
}

export const summarizeSoul = (ledger: SoulLedger, tuning: SoulTuning = activeTuning): SoulSummary => {
  let earned = 0;
  let spent = 0;
  const buckets = new Map<SoulReason, number>();
  for (const item of ledger.entries) {
    // "累计获得"走 countsTowardEarned —— 和每日额度共用同一个判据（见那里的注释）。
    if (countsTowardEarned(item, tuning)) earned += item.amount;
    else if (item.amount < 0) spent += -item.amount;
    // carry 是记账折叠产物，不算"赚到的"，否则面板上会凭空多出一大块。
    if (item.reason === "carry") continue;
    if (!countsTowardEarned(item, tuning)) continue;
    buckets.set(item.reason, (buckets.get(item.reason) || 0) + item.amount);
  }
  const byReason = [...buckets.entries()]
    .map(([reason, amount]) => ({ reason, label: SOUL_REASON_LABELS[reason], amount }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return { balance: soulBalance(ledger), earned, spent, byReason };
};

// ─────────────────────────────────────────────────────────────────────
// 定价辅助（"给多少"的口径，放在这里是为了可测）
// ─────────────────────────────────────────────────────────────────────

/**
 * **按来源取定价**（这一条是给"结算点"用的，别在调用处写死数字）。
 *
 * ## 为什么必须有它（2026-10-11 修的一个真 bug）
 *
 * 用户在「成就工坊」里把 `puzzle-solve` 从 5 调成 3、`daily` 从 15 调成 50、
 * `duel-win` 从 8 调成 20 —— 但 `App.tsx` 的那些结算点**写死着旧数字**。
 * 后果是：说明页显示 3，实际发 5；用户调的那些数值**只有显示效果、没有实际效果**。
 * 这是本项目最不能忍的那类错误（"假旋钮"的变体），而且**极难发现** ——
 * 数字差得不多，没人会去对账本。
 *
 * 所以口径定死：**结算点一律 `soulAmount(reason)` 取价，不许写数字**。
 * 表是唯一事实来源（`SOUL_EARN_RULES`），改了工坊就真的改了发放。
 *
 * ## ⚠ 同一 reason 有多条时要能挑档（2026-10-11 第二次踩到同一个坑）
 *
 * `duel-win` 在表里有**两条**（普通档 20 / 大师档 100）。第一版 `soulAmount` 只取
 * **第一条**、没有挑档的办法，于是 `soulForDuelWin` 这类"要分档"的函数只能自己
 * 写死一对手里的数（`SOUL_DUEL_WIN = 8` / `SOUL_DUEL_WIN_MASTER = 60`）——
 * 而那两个数**从来没跟着工坊改过**：表里早就是 20/100 了，实际发的还是 8/60。
 * 又是"说明页显示 20、账本里记 8"，只是这次我上一轮的修复**没覆盖到它**。
 *
 * 所以这里补一个 `index`（同一 reason 的第几条，按表里的顺序从 0 数）。
 * 分档取价的函数一律走它，**一个数字都不许再写在函数体里**。
 * 约定：**同一 reason 的多条按"由低到高"排列**（表里现在就是这个顺序：
 * 普通档在前、大师档在后），所以 `index: 0` 是基准档、`index: -1` 是最高档。
 */
export const soulAmount = (reason: SoulReason, index = 0): number => {
  const matches = SOUL_EARN_RULES.filter((item) => item.reason === reason);
  // 负下标从末尾数（-1 = 该来源的最后一档 = 最高档），越界就夹到两端：
  // 表里只配了一条时，0 与 -1 都该拿到那一条（不能因为"没有第二档"就返回 0）。
  const at = index < 0 ? matches.length + index : index;
  const rule = matches[Math.max(0, Math.min(matches.length - 1, at))];
  const amount = rule && Number.isFinite(rule.amount) && rule.amount > 0 ? Math.round(rule.amount) : 0;
  /**
   * ⚠ **表里查不到的来源要出声**（2026-10-11 补的一道德线）。
   *
   * 这条是踩出来的：用户在工坊里把 `study`（打谱批注）从来源表删掉之后，
   * 备份那处结算点 `soulAmount("study")` 静默返回 **0** —— 备份不再发棋魂了，
   * 而**没有任何迹象**（不报错、不提示、账本里连一条 0 元记录都没有，因为
   * `grantSoul` 拒收 0）。要不是门禁里那条"账本里出现成就以外的 reason"红了，
   * 这个功能就是**悄悄失效**的。
   *
   * 所以这里在开发/测试环境打印一条警告：让"来源被删了但代码还在发"这件事
   * 立刻可见。生产环境不打印（用户看不懂，而且刷屏）。
   *
   * 判断环境用 `import.meta.env.DEV`（Vite 注入）——测试里它不存在，
   * 所以测试环境**也会**走这条（测试正是最该看到它的地方）。
   */
  if (rule === undefined) {
    const dev = typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV !== false;
    if (dev) {
      console.warn(
        `[soul] 来源「${reason}」不在 SOUL_EARN_RULES 里 —— 这次发放会变成 0。\n`
        + "  要么把它补回 table（soul-economy.ts），要么断开调用它的那个结算点。\n"
        + "  见 soul-economy.ts 顶部那张「来源表与结算点对照表」。",
      );
    }
  }
  return amount;
};

/**
 * 表里有没有配这个来源（`soulForDuelWin` 这类分档函数用它决定"回落到哪个档"）。
 * 与 `soulAmount` 同源，所以不存在"两处各自判断"走散的可能。
 */
export const hasSoulEarnRule = (reason: SoulReason): boolean =>
  SOUL_EARN_RULES.some((item) => item.reason === reason);

/** 一条 `SOUL_EARN_RULES` 长什么样（表本身在 `soul-economy.ts`）。 */
export interface SoulEarnRule {
  reason: SoulReason;
  /** 每次给多少 */
  amount: number;
  /** 说明页上显示的文案 */
  title: string;
  text: string;
}

/** 棋魂**能花在哪儿**的一条（表本身在 `soul-economy.ts`）。 */
export interface SoulSpendPoint {
  id: string;
  /** 说明页上显示的价位 */
  cost: number;
  title: string;
  text: string;
  /** 是否已经接上（`false` = 登记了但还没做，说明页显示「筹建中」而不是做成能点的样子）。
   *  这是本项目的一条纪律：入口存在但没接线会让用户以为程序坏了，
   *  所以**没接线的地方要如实写出来**。 */
  ready: boolean;
}

/**
 * 人机对局取胜的定价：普通档 / 大师档**都从来源表读**（`duel-win` 的第 0 条与最后一条）。
 *
 * ## ⚠ 这里曾经写死过一对数字（2026-10-11 修）
 *
 * 上一版是 `export const SOUL_DUEL_WIN = 8; SOUL_DUEL_WIN_MASTER = 60;`
 * 而来源表里 `duel-win` 早就是 **20 / 100**（用户在工坊里调的）。
 * 后果与 `soulAmount` 那段讲的是同一个：**说明页写着 20，账本里记 8** ——
 * 用户调过的旋钮只有显示效果。上一轮的修复只覆盖了 `App.tsx` 里直接用
 * `soulAmount` 的四个点，**漏了这个函数**（它自己定价，没走表）。
 *
 * 现在它只是"取表里的哪一档"的翻译，价格本身一个数字都不写在这里。
 * 表里只配了一条时，两档都拿到那一条（不会因为"没配第二档"就少发）。
 */
export const soulForDuelWin = (strength: string): number =>
  strength === "大师" ? soulAmount("duel-win", -1) : soulAmount("duel-win", 0);

/**
 * 一局对弈结束该给多少——**把输/和也纳入口径**（用户 2026-10-10 要"更多调度选项"）。
 *
 * `lossAmount` / `drawAmount` 默认都是 **0**，也就是说默认行为仍然严格等于
 * 用户 2026-10-09 的原话「输了不给也不扣」。想改成"参与就给一点"，
 * 在工坊里把这两个数调上去即可，不用改代码。
 */
export const soulForDuelResult = (
  outcome: "won" | "lost" | "draw",
  strength: string,
  tuning: SoulTuning = activeTuning,
): number => {
  if (outcome === "won") return soulForDuelWin(strength);
  if (outcome === "lost") return tuning.lossAmount;
  return tuning.drawAmount;
};

/**
 * VCF 挑战的定价：**基础值从来源表读**（`vcf-solve`），加成是"题越深越多"。
 *
 * 加成口径（用户 2026-10-14：「改成基础为 10，每多一手加 2，上限 50」）：
 * **每多一手 +2**（`SOUL_VCF_HAND_BONUS`），**单题到手总数夹在 50**（`SOUL_VCF_TOTAL_CAP`）
 * —— 旧口径是"每 10 手 +2、最多加 10"，深题要 50 手才吃满，太钝。
 * 这几个是**比率的常数**，不是"一次给多少钱"，所以留在代码里是对的；
 * 而"基础给多少"是**单价**，那是工坊该管的事，必须从表读。
 *
 * ⚠ 上一版把基础也写死在这里（`SOUL_VCF_BASE = 6`），而表里 `vcf-solve` 是 **10** ——
 * 同一个"两处各记一份"的老毛病，说明页写 10、实际发 6+加成。
 *
 * `soulAmount` 那套调度的**基础值**语义：这里返回的是没进调度的原价，
 * 实际入账由 `grantSoul` 过一遍倍率与上限（说明页列的也是原价）。
 */
export const SOUL_VCF_HAND_BONUS = 2;
export const SOUL_VCF_TOTAL_CAP = 50;

/**
 * **VCF 等级奖励**每升一级发一次（用户 2026-10-10：「vcf挑战达到每个阶段等级都要给奖励，
 * 只给一次」）。
 *
 * 这是一个**纯函数**：给它"上次结算到几级"和"现在几级"，算出这一批该发哪几笔。
 * 之所以要这样拆，是因为等级可能**一次跳好几级**（从 1 级直接打到 5 级），
 * 那时中间三级也要一起补发 —— 只看"当前等级"会漏掉 2/3/4 级。
 *
 * 返回的每一项都带自己的 token（`vcf-level:<n>`）。
 *
 * ## ⚠ 这里曾经有个真漏洞（2026-10-10 修的）
 *
 * 上一版写的是"不需要 lastLevel 落盘，从 1 级全查一遍靠 token 幂等挡掉"。
 * 那个推理**漏了一个前提**：token 幂等只在 token 还在的时候成立。
 * 当时 `usedTokens` 只从现存流水重建，账本超过上限后最早记录会并成 `carry`，
 * 被折叠的 token 也随之丢失。本轮已把折叠凭证保存到账本，水位线继续负责支付进度。
 *
 * 实测复现：领过 1..11 级（665 魂）→ 连点把账本顶过 1000 条 → 重启 → 再解一题
 * ⇒ 1..11 级**又发一遍**。满级 34 级全领合计由 `VCF_LEVEL_SOUL` 的 34 项决定，可反复刷。
 *
 * 所以现在**必须**用 `loadVcfLevelPaid()` 的水位线（见下），
 * `fromLevelExclusive` 就是给水位线用的。token 仍然保留——
 * 它是第二道防线（同一轮里重复调用、或水位没抬成功时兜住）。
 */
export interface VcfLevelReward {
  level: number;
  amount: number;
  token: string;
  detail: string;
}

export const vcfLevelRewardsUpTo = (
  level: number,
  amountOf: (level: number) => number,
  /** 上一级（含）之前不再生成 —— 传水位线（见 `loadVcfLevelPaid`）。 */
  fromLevelExclusive = 0,
): VcfLevelReward[] => {
  if (!Number.isFinite(level) || level < 1) return [];
  const start = Math.max(1, Math.floor(fromLevelExclusive) + 1);
  const out: VcfLevelReward[] = [];
  for (let n = start; n <= Math.floor(level); n += 1) {
    const amount = amountOf(n);
    if (amount <= 0) continue;
    out.push({ level: n, amount, token: `vcf-level:${n}`, detail: `VCF 解答力升到 ${n} 级` });
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────
// VCF 等级奖励的**水位线**（2026-10-10 修的漏洞）
// ─────────────────────────────────────────────────────────────────────

/**
 * 已发过等级奖励的**水位线**存档键。
 *
 * 水位线记逐级支付的进度，账本 token 负责幂等。逐笔发奖失败时水位线停在失败级别，
 * 下一次只补尚未成功的等级；它与账本的折叠生命周期无关。
 *
 * 为什么是**水位线（一个数）而不是一个 token 集合**：
 * 等级奖励是严格递增的（1→2→…→`LEVEL_MAX`，现在到 34 级），发过 11 级就意味着 1..11 都发过。
 * 存一个数比存几十条 token 小得多，也不可能出现"集合里有洞"这种坏状态。
 */
export const VCF_LEVEL_PAID_KEY = "banbu-vcf-level-paid-v1";

/** 读水位线（0 = 一级都没发过）。坏数据当作 0，宁可重发也不漏发。 */
export const loadVcfLevelPaid = (): number => {
  const storage = safeStorage();
  if (!storage) return 0;
  try {
    const value = Number(storage.getItem(VCF_LEVEL_PAID_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch { return 0; }
};

/**
 * 把水位线抬到 `level`。**只升不降** —— 水位线的语义是"发到哪儿了"，
 * 降下来等于把已经发过的重新变成可发的（那正是这个 bug 本身）。
 */
export const saveVcfLevelPaid = (level: number): boolean => {
  if (!Number.isFinite(level) || level <= loadVcfLevelPaid()) return false;
  const storage = safeStorage();
  if (!storage) return false;
  try { storage.setItem(VCF_LEVEL_PAID_KEY, String(Math.floor(level))); return true; } catch { return false; }
};

/**
 * **老用户迁移**：水位线这个存档是 2026-10-10 才有的，之前版本的玩家已经领过
 * 一些等级奖励（记录在账本的 `vcf-level:<n>` token 上），但**没有水位线**。
 *
 * 不迁移的话，他们升级到这一版后第一次解 VCF 题，水位线还是 0
 * → 会把已领过的等级**再发一遍**（如果账本还没被折叠，token 能挡住；
 * 一旦折叠过、token 丢了，就是真金白银的重发）。
 *
 * 所以第一次用到水位线时，从账本里把已有的 `vcf-level:<n>` token 扫一遍、
 * 取最大 n 补上。这个动作**幂等且只做一次**（补完水位线就不为 0 了）。
 *
 * 为什么不放在 App 启动时跑：那又是一处"启动要记得调"的接线，
 * 而放在这里它天然只会在"真的要发等级奖励"之前发生 —— 少一个可能漏调的点。
 */
const VCF_LEVEL_TOKEN_PREFIX = "vcf-level:";

const migrateVcfLevelPaid = (): number => {
  const current = loadVcfLevelPaid();
  if (current > 0) return current;
  let highest = 0;
  try {
    for (const entry of loadSoulLedger().entries) {
      const token = entry.token ?? "";
      if (!token.startsWith(VCF_LEVEL_TOKEN_PREFIX)) continue;
      const parsed = Number.parseInt(token.slice(VCF_LEVEL_TOKEN_PREFIX.length), 10);
      if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
    }
  } catch { /* 读不到账本就当没领过（水位线 0，与迁移前行为一致） */ }
  if (highest > 0) saveVcfLevelPaid(highest);
  return highest;
};

/**
 * 结算 VCF 等级奖励：逐笔确认成功入账后推进水位线。
 * 额度/写盘失败时停在失败级别，下次补发；账本 token 负责挡住水位线写失败的重复。
 * 未传发奖回调时只返回计划，不能预先把尚未入账的奖励标为已支付。
 */
export const claimVcfLevelRewards = (
  level: number,
  amountOf: (level: number) => number,
  grant?: (reward: VcfLevelReward) => SoulMutationCode,
): VcfLevelReward[] => {
  const paid = migrateVcfLevelPaid();
  const rewards = vcfLevelRewardsUpTo(level, amountOf, paid);
  if (!grant) return rewards;
  const claimed: VcfLevelReward[] = [];
  for (const reward of rewards) {
    const code = grant(reward);
    if (code !== "ok" && code !== "duplicate") break;
    saveVcfLevelPaid(reward.level);
    if (code === "ok") claimed.push(reward);
  }
  return claimed;
};

export const soulForVcfProblem = (depth: number): number => {
  // 基础价从表读（见上面 SOUL_VCF_HAND_BONUS 那段：上一版写死 6、表里是 10）。
  const base = soulAmount("vcf-solve");
  if (!Number.isFinite(depth) || depth <= 0) return base;
  // 第 1 手算在基础价里，之后**每多一手 +2**；总数封顶 50（21 手起就顶格）。
  const bonus = (Math.floor(depth) - 1) * SOUL_VCF_HAND_BONUS;
  // 外面那层 max(base, …) 是给"工坊把单价调到 50 以上"留的：封顶不许把奖励压到基础价以下。
  return Math.max(base, Math.min(SOUL_VCF_TOTAL_CAP, base + bonus));
};

/**
 * 把棋魂数写成紧凑形式（用户 2026-10-09：「如果过万了，那么就用 w 省略，过亿了就用 e 代替」）。
 *
 * 用 **w / e** 而不是 k/M：这是中文语境的钱数写法（10 万 → 10w），
 * 和 `formatEngineCount` 的 k/M（引擎节点数，国际口径）刻意分开——两处语义不同，
 * 不共用一个函数是对的（那边是"技术指标"，这边是"钱"）。
 *
 * 进位规则照 `formatEngineCount` 的先例：**按四舍五入后的低级单位判进位**，
 * 否则 9999 会写成 `9999`（该进位却停在原地），而 99995000 会写成 `9999.5w` 看起来比 `1e` 还大。
 */
export const formatSoulAmount = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  const negative = value < 0;
  const abs = Math.abs(Math.round(value));
  const sign = negative ? "-" : "";
  // 一亿 = 1e（这里 e 是"亿"的缩写，不是科学计数法的 e）
  if (abs >= 100_000_000) {
    const billions = abs / 100_000_000;
    // 过 10 亿就不带小数了（1234567890 → 12e），否则保留一位（123456789 → 1.2e）
    return `${sign}${billions >= 10 ? Math.round(billions) : billions.toFixed(1).replace(/\.0$/, "")}e`;
  }
  // 一万 = 1w
  if (abs >= 10_000) {
    const tenThousands = abs / 10_000;
    return `${sign}${tenThousands >= 10 ? Math.round(tenThousands) : tenThousands.toFixed(1).replace(/\.0$/, "")}w`;
  }
  return `${sign}${abs}`;
};

/** 精确值（说明页上给"看真实数字"用，如 `12,345`）。 */
export const formatSoulExact = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString("zh-CN") : "0";

/**
 * 这个数额会不会被 `formatSoulAmount` **缩写**（过万 → `12w`、过亿 → `1.2e`）。
 *
 * 说明页靠它决定要不要多显示一行「精确 12345」：
 *  · 不缩写时那行是**同义重复**（大字已经是 101，再写一遍"精确 101"没信息量）；
 *  · 缩写时它才真的补充信息（`1.2w` 看不出是 12345 还是 12499）。
 *
 * 判据就是"渲染出来的字符串末尾是不是 w/e"，**不另写一套阈值**：
 * 一万/一亿这两个进位点是 `formatSoulAmount` 的实现细节，
 * 在这儿抄一份（`value >= 10000`）迟早会和那边走散。
 */
export const isSoulAmountAbbreviated = (value: number): boolean =>
  /[we]$/.test(formatSoulAmount(value));

// ─────────────────────────────────────────────────────────────────────
// 数据出口（定价表与默认值在 soul-economy.ts，由工坊改写）
// ─────────────────────────────────────────────────────────────────────

/**
 * 这三个表**住在 `soul-economy.ts`**，在这里转出去。
 *
 * 为什么要转一道而不是让使用方直接引 economy：说明页（`SoulPanel.tsx`）与单测
 * 从第一版起就 `from "./soul"` 拿它们，转出去就不用为了搬家去改那些文件——
 * 而真正该被工坊重写的只有 economy 那一份。
 */
export { SOUL_EARN_RULES, SOUL_EARN_NOTE, SOUL_SPEND_POINTS, SOUL_SPEND_NOTE, DEFAULT_SOUL_TUNING, TUNABLE_REASONS, VCF_LEVEL_SOUL, vcfLevelSoul };
