import type { Player } from "../../types";
import type { DuelStrength } from "./duel-session";

/**
 * 人机对弈的**逐局战绩**（用户 10-02：「放到对弈里面，这个网页作为一个小按钮放在右上角吧，
 * 点开会有各种信息，比如人机对弈的信息，胜负和情况如何，然后还有等级分」）。
 *
 * 为什么必须新开一个键：原来跨局什么都不留。`banbu-duel-session-v1` 是**单条会被覆盖**的
 * 可恢复快照（`duel-session.ts:101`），而且终局离开界面就 `clearDuelSession()`；
 * 棋谱库那份只在用户主动保存（或开了「终局自动存档」）时才有，且档位只以字符串混在
 * `metadata.event` 里。所以战绩要的是"每打完一局追加一条"的 append-only 记录。
 *
 * 等级分**不落盘**：只存原始对局，分数在读取时从整条历史推出来（`computeRatingTrack`）。
 * 这样改 K 值、改档位锚点都不用迁移存档，也不会出现"存的分数和历史对不上"这种脏账。
 */

export const DUEL_HISTORY_KEY = "banbu-duel-history-v1";

/**
 * 这一局要不要进战绩账本（以及顺带的棋魂与成就判定）。
 *
 * **自定义开局不算**（用户 2026-10-13 点名「这个模式是没有棋魂奖励的」）。为什么连账本也不写：
 *  ① 成就 `duel-win-10/50/100` 与等级分都是从这份账本**现算**的，写进去就等于"以后某局正常
 *    赢棋时，把这一局的份一起补发出来"——「这一局不给」就漏了；
 *  ② 自定义开局可以自己摆一个必胜形再赢一手，记进等级分就是给 Elo 灌水。
 * 抽成纯函数是为了能被单测钉住（写在 effect 里的那条 if 没人会去测）。
 */
export const shouldRecordDuel = (game: { customOpening?: boolean } | null | undefined): boolean => !game?.customOpening;
/** 形状变了就 +1，旧数据整份丢弃（不猜怎么迁移——与 duel-session 同一口径）。 */
const HISTORY_VERSION = 1;
/** 上限：一局约 200 字节，400 条 ≈ 80KB。超出丢最旧的（战绩看的是近期状态）。 */
const MAX_ENTRIES = 400;

export type DuelOutcome = "won" | "lost" | "draw";
export type DuelEngineChoice = "light" | "strong" | "tuned" | "kata" | "ikatago";

export interface DuelHistoryEntry {
  /** 一局一个 token：写盘前拿它去重，避免"终局→刷新→恢复→再结算"计两次。 */
  id: string;
  /** 终局时刻（ms）。列表按它排，图也按它画。 */
  at: number;
  outcome: DuelOutcome;
  /** 终局原因，原样存应用里那句话（「你连成五子」/「认输」/「AI 没有合法落子，判和」…）。 */
  reason: string;
  humanPlayer: Player;
  strength: DuelStrength;
  engine: DuelEngineChoice;
  /** 人类包干时限（0 = 不限时）。 */
  timeLimitMs: number;
  /** 本局 AI 的思考预算——「自由」档要靠它推对手分，别的档也存着便于核对。 */
  thinkTimeMs: number;
  thinkDepth: number;
  moves: number;
  humanElapsedMs: number;
  forbidden: boolean;
  /** 存进棋谱库时带上那份的 id，便于从战绩跳回棋谱。 */
  recordId?: string;
}

const isOutcome = (value: unknown): value is DuelOutcome => value === "won" || value === "lost" || value === "draw";
const isEngine = (value: unknown): value is DuelEngineChoice => value === "light" || value === "strong" || value === "tuned" || value === "kata" || value === "ikatago";
const STRENGTHS: ReadonlyArray<DuelStrength> = ["初级", "中级", "高级", "大师", "自由"];
const nonNegative = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

/** 单条校验：任何一处不像样就丢掉这一条（不整份作废，战绩是累积资产）。 */
const normalizeEntry = (value: unknown): DuelHistoryEntry | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DuelHistoryEntry>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (!isOutcome(raw.outcome)) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at) || raw.at <= 0) return null;
  if (raw.humanPlayer !== "black" && raw.humanPlayer !== "white") return null;
  if (!STRENGTHS.includes(raw.strength as DuelStrength)) return null;
  return {
    id: raw.id,
    at: Math.round(raw.at),
    outcome: raw.outcome,
    reason: typeof raw.reason === "string" ? raw.reason.slice(0, 60) : "",
    humanPlayer: raw.humanPlayer,
    strength: raw.strength as DuelStrength,
    engine: isEngine(raw.engine) ? raw.engine : "strong",
    timeLimitMs: nonNegative(raw.timeLimitMs),
    thinkTimeMs: nonNegative(raw.thinkTimeMs),
    thinkDepth: nonNegative(raw.thinkDepth),
    moves: nonNegative(raw.moves),
    humanElapsedMs: nonNegative(raw.humanElapsedMs),
    forbidden: Boolean(raw.forbidden),
    recordId: typeof raw.recordId === "string" ? raw.recordId : undefined,
  };
};

export const loadDuelHistory = (): DuelHistoryEntry[] => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(DUEL_HISTORY_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const list = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown[] })?.entries;
  if (!Array.isArray(list)) return [];
  const byId = new Map<string, DuelHistoryEntry>();
  // 老数据在前、新数据在后（写入时是 push 到尾部）。同 id 取**最后写的那条**、位置保持在第一次
  // 出现处：终局→刷新→恢复这条链可能把同一局写两次，去重要留最新的结算结果。
  for (const item of list.slice(-MAX_ENTRIES * 2)) {
    const entry = normalizeEntry(item);
    if (!entry) continue;
    byId.set(entry.id, entry);
  }
  return [...byId.values()].slice(-MAX_ENTRIES);
};

/** 追加一条。返回是否真的写进去了——写失败（配额满）不该弄坏对局，静默即可。 */
export const appendDuelHistory = (entry: DuelHistoryEntry): boolean => {
  try {
    const next = [...loadDuelHistory(), entry].slice(-MAX_ENTRIES);
    localStorage.setItem(DUEL_HISTORY_KEY, JSON.stringify({ version: HISTORY_VERSION, entries: next }));
    return true;
  } catch {
    return false;
  }
};

export const clearDuelHistory = () => {
  try { localStorage.removeItem(DUEL_HISTORY_KEY); } catch { /* 存储不可用就当已经清了 */ }
};

/* ── 等级分 ─────────────────────────────────────────────────────────────── */

/**
 * 刻度原点与档位锚点 —— **两条假设说得清，不抄外部等级分的数值区间**。
 *
 * Elo 分数的绝对零点是任意的（只有差值有意义），所以"从多少分开始"必须给得出理由：
 *  - **原点：初级 AI = 1000 分，新档案也从 1000 起**。本机能提供的最弱对手就是刻度的底座，
 *    意思是"先假定你跟最弱档一样强"。比"起始分落在中级线"诚实，也不会让用户头几局
 *    一直掉分、看起来像软件在给他降分。
 *  - **间距：相邻档 +240 分**，即高一档对低一档约 **80% 期望胜率**
 *    （`400·log10(0.8/0.2) = 241`，取整 240 让锚点是整数）。
 *  ⚠ 这条间距是**假设不是实测**：`docs/ai-*-benchmark-2026-08-29.md` 那批基准只有
 *  "引擎解三手胜题的正确率"（0/30、19/30 这种），没有档与档的互搏胜负，所以推不出真实差距。
 *  将来跑一轮 初级×中级×高级×大师 的互搏基准，把 `TIER_EXPECTED_WIN` 换成实测胜率就行 ——
 *  等级分是从历史现推的（不落盘），所以**历史不用迁移、分数自动重算**。
 */
export const TIER_EXPECTED_WIN = 0.8;
/** 期望胜率 → Elo 分差：p=0.5 得 0 分，p=0.8 得 241 分。 */
export const ratingGapFromWinRate = (winRate: number) => Math.round(400 * Math.log10(winRate / (1 - winRate)));
/** 一档的间距（取整数好读；对回期望胜率约 79.7%）。 */
export const TIER_GAP = 240;
/** 原点 = 初级 AI = 新档案起始分。 */
export const RATING_START = 1000;
export const STRENGTH_ANCHORS: Record<Exclude<DuelStrength, "自由">, number> = {
  初级: RATING_START, 中级: RATING_START + TIER_GAP, 高级: RATING_START + TIER_GAP * 2, 大师: RATING_START + TIER_GAP * 3,
};
/** 「自由」档没有档位名可查，按思考时间在锚点间**对数插值**（时间在 0.6s~10s 之外就夹到端点）。
 *  四个时间点取自代码里的 `AI_STRENGTH_PROFILES`（600/2000/5000/10000ms），
 *  不是 08-29 那批旧提案文档写的 600/1200/1800/3000。 */
const FREE_POINTS: ReadonlyArray<[number, number]> = [
  [600, STRENGTH_ANCHORS.初级], [2000, STRENGTH_ANCHORS.中级], [5000, STRENGTH_ANCHORS.高级], [10000, STRENGTH_ANCHORS.大师],
];

export const opponentRating = (entry: Pick<DuelHistoryEntry, "strength" | "thinkTimeMs">): number => {
  if (entry.strength !== "自由") return STRENGTH_ANCHORS[entry.strength];
  const ms = Math.min(FREE_POINTS[FREE_POINTS.length - 1][0], Math.max(FREE_POINTS[0][0], entry.thinkTimeMs || FREE_POINTS[0][0]));
  for (let i = 1; i < FREE_POINTS.length; i += 1) {
    const [hiMs, hi] = FREE_POINTS[i];
    const [loMs, lo] = FREE_POINTS[i - 1];
    if (ms <= hiMs) {
      const t = (Math.log(ms) - Math.log(loMs)) / (Math.log(hiMs) - Math.log(loMs));
      return Math.round(lo + t * (hi - lo));
    }
  }
  return FREE_POINTS[FREE_POINTS.length - 1][1];
};

export const expectedScore = (rating: number, opponent: number) => 1 / (1 + 10 ** ((opponent - rating) / 400));
/** 前 20 局 K=40（新档案要快速收敛），之后 K=24。 */
export const kFactor = (gameIndex: number) => (gameIndex < 20 ? 40 : 24);
const scoreValue: Record<DuelOutcome, number> = { won: 1, draw: 0.5, lost: 0 };

export interface RatingPoint { at: number; rating: number; delta: number; opponent: number; outcome: DuelOutcome }

/** 从整条历史按时间正序推一遍等级分轨迹。 */
export const computeRatingTrack = (entries: readonly DuelHistoryEntry[]): RatingPoint[] => {
  let rating = RATING_START;
  const track: RatingPoint[] = [];
  entries.forEach((entry, index) => {
    const opponent = opponentRating(entry);
    const delta = Math.round(kFactor(index) * (scoreValue[entry.outcome] - expectedScore(rating, opponent)));
    rating += delta;
    track.push({ at: entry.at, rating, delta, opponent, outcome: entry.outcome });
  });
  return track;
};

/** 样本不足时给的是"区间"而不是一个假精确的数：±400/√n 只当粗略的收敛程度指示。 */
export const ratingUncertainty = (games: number) => (games <= 0 ? RATING_START : Math.round(400 / Math.sqrt(games)));
export const PROVISIONAL_GAMES = 10;

/** 分数落在哪条 AI 档位线上——这是这套刻度唯一可辩护的"称号"。分界取相邻锚点的中点。 */
export const ratingBandLabel = (rating: number): string => {
  const half = TIER_GAP / 2;
  if (rating < STRENGTH_ANCHORS.初级 + half) return "初级 AI 以下";
  if (rating < STRENGTH_ANCHORS.中级 + half) return "初级～中级 AI 之间";
  if (rating < STRENGTH_ANCHORS.高级 + half) return "中级～高级 AI 之间";
  if (rating < STRENGTH_ANCHORS.大师 + half) return "高级～大师 AI 之间";
  return "大师 AI 一线或以上";
};

/* ── 聚合 ───────────────────────────────────────────────────────────────── */

export interface DuelTierRow {
  key: string;
  strength: DuelStrength;
  engine: DuelEngineChoice;
  games: number;
  won: number;
  lost: number;
  draw: number;
  /** 未定义 = 一场没打（不是 0%）。 */
  winRate?: number;
  opponent: number;
  avgMoves?: number;
}

export interface DuelSummary {
  games: number;
  won: number;
  lost: number;
  draw: number;
  winRate?: number;
  /** 当前连串：type 是最近一段的性质，count 是长度（没打过就是 none/0）。 */
  streak: { type: DuelOutcome | "none"; count: number };
  bestWinStreak: number;
  worstLossStreak: number;
  totalMoves: number;
  totalHumanMs: number;
  avgMoves?: number;
  firstAt?: number;
  lastAt?: number;
  rating: {
    current: number;
    delta: number;
    /** 最近 10 局的净变化（开局阶段比"距起始分多少"更有信息）。 */
    recentDelta: number;
    games: number;
    provisional: boolean;
    uncertainty: number;
    band: string;
    track: RatingPoint[];
    high: number;
    low: number;
  };
  tiers: DuelTierRow[];
  /** 按引擎汇总（同一档位换引擎实际棋力会变，所以这张表要单独给）。 */
  engines: Array<{ engine: DuelEngineChoice; games: number; won: number; lost: number; draw: number; winRate?: number }>;
}

const rate = (won: number, games: number) => (games > 0 ? won / games : undefined);

/** 最近一段连串（按时间正序的最后一条往前数）。 */
const currentStreak = (ordered: readonly DuelHistoryEntry[]) => {
  if (!ordered.length) return { type: "none" as const, count: 0 };
  const want = ordered[ordered.length - 1].outcome;
  let count = 0;
  for (let i = ordered.length - 1; i >= 0 && ordered[i].outcome === want; i -= 1) count += 1;
  return { type: want, count };
};

const longestRun = (ordered: readonly DuelHistoryEntry[], outcome: DuelOutcome) => {
  let best = 0;
  let run = 0;
  for (const entry of ordered) { run = entry.outcome === outcome ? run + 1 : 0; best = Math.max(best, run); }
  return best;
};

export const summarizeDuelHistory = (entries: readonly DuelHistoryEntry[]): DuelSummary => {
  const ordered = [...entries].sort((a, b) => a.at - b.at);
  const won = ordered.filter((entry) => entry.outcome === "won").length;
  const lost = ordered.filter((entry) => entry.outcome === "lost").length;
  const draw = ordered.filter((entry) => entry.outcome === "draw").length;
  const games = ordered.length;
  const totalMoves = ordered.reduce((sum, entry) => sum + entry.moves, 0);
  const totalHumanMs = ordered.reduce((sum, entry) => sum + entry.humanElapsedMs, 0);
  const track = computeRatingTrack(ordered);
  const current = track.length ? track[track.length - 1].rating : RATING_START;
  const recent = track.slice(-10);

  const tierMap = new Map<string, Omit<DuelTierRow, "winRate" | "avgMoves" | "opponent"> & { movesSum: number; opponentSum: number }>();
  const engineMap = new Map<DuelEngineChoice, { games: number; won: number; lost: number; draw: number }>();
  for (const entry of ordered) {
    const key = `${entry.strength}|${entry.engine}`;
    const row = tierMap.get(key) || { key, strength: entry.strength, engine: entry.engine, games: 0, won: 0, lost: 0, draw: 0, movesSum: 0, opponentSum: 0 };
    row.games += 1;
    if (entry.outcome === "won") row.won += 1; else if (entry.outcome === "lost") row.lost += 1; else row.draw += 1;
    row.movesSum += entry.moves;
    // 「自由」档同组里也可能设了不同思考时间，所以对手分取本组均值，不是第一局的值。
    row.opponentSum += opponentRating(entry);
    tierMap.set(key, row);
    const engine = engineMap.get(entry.engine) || { games: 0, won: 0, lost: 0, draw: 0 };
    engine.games += 1;
    if (entry.outcome === "won") engine.won += 1; else if (entry.outcome === "lost") engine.lost += 1; else engine.draw += 1;
    engineMap.set(entry.engine, engine);
  }
  const tiers: DuelTierRow[] = [...tierMap.values()].map((row) => ({
    key: row.key, strength: row.strength, engine: row.engine, games: row.games, won: row.won, lost: row.lost, draw: row.draw,
    opponent: Math.round(row.opponentSum / row.games),
    // 与总胜率、引擎表同一个口径：和局算半分（否则一张表两种"胜率"）。
    winRate: rate(row.won + row.draw / 2, row.games),
    avgMoves: Math.round(row.movesSum / row.games),
  })).sort((a, b) => b.games - a.games || a.strength.localeCompare(b.strength, "zh-CN"));

  return {
    games, won, lost, draw,
    winRate: rate(won + draw / 2, games),
    streak: currentStreak(ordered),
    bestWinStreak: longestRun(ordered, "won"),
    worstLossStreak: longestRun(ordered, "lost"),
    totalMoves, totalHumanMs,
    avgMoves: games ? Math.round(totalMoves / games) : undefined,
    firstAt: ordered[0]?.at,
    lastAt: ordered[ordered.length - 1]?.at,
    rating: {
      current,
      delta: current - RATING_START,
      recentDelta: recent.length ? recent[recent.length - 1].rating - recent[0].rating + recent[0].delta : 0,
      games,
      provisional: games < PROVISIONAL_GAMES,
      uncertainty: ratingUncertainty(games),
      band: ratingBandLabel(current),
      track,
      high: track.reduce((max, point) => Math.max(max, point.rating), RATING_START),
      low: track.reduce((min, point) => Math.min(min, point.rating), RATING_START),
    },
    tiers,
    engines: [...engineMap.entries()].map(([engine, value]) => ({ engine, ...value, winRate: rate(value.won + value.draw / 2, value.games) }))
      .sort((a, b) => b.games - a.games),
  };
};

/** 胜率口径：胜 1 / 和 0.5 / 负 0（与等级分的 scoreValue 同一条，别一处一个算法）。 */
export const formatWinRate = (value: number | undefined) => (value === undefined ? "—" : `${Math.round(value * 100)}%`);

export const ENGINE_LABELS: Record<DuelEngineChoice, string> = {
  light: "轻量", strong: "标准", tuned: "调优", kata: "KataGo", ikatago: "云端 KataGo",
};

export const OUTCOME_LABELS: Record<DuelOutcome, string> = { won: "胜", lost: "负", draw: "和" };
