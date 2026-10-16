import type { OpeningRule, Player, Position } from "../../types";

/**
 * 整局复盘的纯逻辑（用户 09-17 第一梯队①）。输入是主线逐节点的引擎评估样本
 * （黑方视角胜率 + 引擎最佳点 + 行棋方），输出失误分档、曲线数据与中文讲解。
 * 与引擎 worker、React 全部解耦，可以纯函数单测——评估数字怎么来（真引擎/
 * 假引擎/缓存）是调用方的事。
 *
 * 分档口径（百分点 = 行棋方胜率损失）：
 *   ≤2 最佳/好 · ≤8 疑问手 · ≤20 失误 · >20 败着 · 错失必胜（行棋方原本已被
 *   引擎证明必胜，走完丢了）。连珠的引擎胜率波动比围棋大，阈值刻意比围棋宽；
 *   这里的分档是「研究提示」，面板上始终注明仅供参考。
 */

export type ReviewGrade = "best" | "inaccuracy" | "mistake" | "blunder" | "missedWin" | "opening";

export const REVIEW_GRADE_LABELS: Record<ReviewGrade, string> = {
  best: "最佳",
  inaccuracy: "疑问",
  mistake: "失误",
  blunder: "败着",
  missedWin: "错失必胜",
  opening: "开局流程",
};

/**
 * 开局规则流程覆盖到第几手（1-based，含）。**这一段不按普通失误判级**（用户 09-19）。
 *
 * 为什么必须区别对待——打点类规则把「一手棋」换成了「一套流程」：
 *   ① **决策者不是落子方**：主线第 5 手是黑棋，但那是**白方从黑方摆的候选里挑的**，
 *      黑方没有选择权；
 *   ② **引擎的最佳点常常不合法**：候选集由规则限定（山口/索索夫-8 摆 N 个打点、五手两打摆 2 个），
 *      塔十与塔拉还限定落点区域（中心 9×9、逐手扩大的 3×3→9×9）——引擎推荐的点可能压根不能下；
 *   ③ **胜率回落是规则设计**：打点的作用正是把必胜局面摊成多个候选由对方挑，
 *      「从必胜被制约到平衡」是规则的意图，不是下错了。
 * 拿这三条去套普通失误分档，就会出现「黑方摆的打点被白方挑走，却记成黑方失误」这种偏颇。
 *
 * 表里只列**落点受约束**的规则；自由开局的交换类（一手/三手交换、塔拉以外的交换）
 * 落点本身不受限，不该被免判。
 */
export const OPENING_PROCEDURE_LAST_MOVE: Partial<Record<OpeningRule, number>> = {
  "five-two": 5,
  "five-n": 5,
  yamaguchi: 5,
  "soosyrv-8": 5,
  "taraguchi-10": 5,
  tarannikov: 5,
};

export const openingProcedureLastMove = (openingRule: OpeningRule | undefined): number =>
  (openingRule && OPENING_PROCEDURE_LAST_MOVE[openingRule]) || 0;

/** 行棋方胜率损失的分档阈值（百分点）。导出便于测试与将来调整。 */
export const REVIEW_THRESHOLDS = { inaccuracy: 2, mistake: 8, blunder: 20 } as const;

/** 主线第 i 个节点（落子前局面）的评估样本。 */
export interface ReviewSample {
  nodeId: string;
  /** 该局面轮谁走＝本手的落子方。 */
  mover: Player;
  /** 黑方视角胜率 0-100。引擎没给 winRate 时为 undefined（该点在曲线与分档中缺席）。 */
  blackWinRate?: number;
  /** 引擎认为的最佳点。 */
  best?: Position | null;
  /** 引擎宣告「行棋方必胜」（Rapfi 的杀棋分 ≥10000）。 */
  provenWinForMover?: boolean;
}

export interface ReviewEntry {
  /** 本手落子后的节点 id（= samples[i+1].nodeId）。 */
  nodeId: string;
  /** 1-based 手数。 */
  moveNumber: number;
  mover: Player;
  /** 实际落的点；过手为 null。 */
  played: Position | null;
  best: Position | null;
  blackWinRateBefore?: number;
  blackWinRateAfter?: number;
  /** 行棋方胜率损失（百分点，非负；无评估时 undefined）。 */
  lossForMover?: number;
  grade?: ReviewGrade;
}

const samePosition = (a: Position | null | undefined, b: Position | null | undefined) =>
  Boolean(a && b) && a!.row === b!.row && a!.col === b!.col;

/** 行棋方视角的胜率（黑方视角 → 落子方视角）。 */
export const moverWinRate = (sample: Pick<ReviewSample, "mover" | "blackWinRate">): number | undefined =>
  sample.blackWinRate === undefined ? undefined : sample.mover === "black" ? sample.blackWinRate : 100 - sample.blackWinRate;

/** 行棋方损失（百分点）：落子前后的行棋方胜率差。两个局面都用**落子方**（before.mover）
 * 的视角换算——after 局面轮到的是对手，按 after.mover 换算会把损失符号弄反。 */
export const moverLossPercent = (before: ReviewSample, after: ReviewSample): number | undefined => {
  if (before.blackWinRate === undefined || after.blackWinRate === undefined) return undefined;
  return before.mover === "black"
    ? before.blackWinRate - after.blackWinRate
    : after.blackWinRate - before.blackWinRate;
};

export const gradeForLoss = (loss: number | undefined, missedWin: boolean): ReviewGrade | undefined => {
  if (loss === undefined) return undefined;
  if (missedWin && loss > REVIEW_THRESHOLDS.inaccuracy) return "missedWin";
  if (loss <= REVIEW_THRESHOLDS.inaccuracy) return "best";
  if (loss <= REVIEW_THRESHOLDS.mistake) return "inaccuracy";
  if (loss <= REVIEW_THRESHOLDS.blunder) return "mistake";
  return "blunder";
};

export type GameOutcomeForReview = "black" | "white" | "draw" | null;

/**
 * 由逐节点评估样本与实际落子序列生成分档明细。
 * samples 长度应为 N+1：0..N-1 是每一手落子前的引擎评估，第 N 个是终局伪样本
 * （黑方视角胜率按对局结果取 100/0/50，无 best）。某一手的前后样本只要有缺
 * （引擎没报 winRate、复盘被取消），就**跳过那一手**继续评后面的——真引擎在
 * 空盘这类「平凡局面」会秒答而不吐胜率，若遇到缺样就地停手，一个洞会让整局
 * 分档全部消失（09-19 用户实测：只剩曲线、没有分档/讲解）。中途取消时其后
 * 样本本就全缺，跳过与停手等价。
 */
export const buildReviewEntries = (
  samples: ReviewSample[],
  playedNodes: Array<{ nodeId: string; move: Position | null }>,
  /** openingLastMove：开局规则流程覆盖到第几手（`openingProcedureLastMove()` 的结果，0=无）。 */
  options: { openingLastMove?: number } = {},
): ReviewEntry[] => {
  const entries: ReviewEntry[] = [];
  for (let index = 0; index < playedNodes.length; index += 1) {
    const before = samples[index];
    const after = samples[index + 1];
    if (!before || !after) continue;
    const loss = moverLossPercent(before, after);
    if (loss === undefined) continue;
    const played = playedNodes[index].move;
    const best = before.best || null;
    const playedBest = samePosition(played, best);
    // 落了引擎首选就是最佳——噪声带来的小幅「负损失」也归这里。
    const missedWin = Boolean(before.provenWinForMover) && !playedBest && loss > REVIEW_THRESHOLDS.inaccuracy;
    // 开局流程内的手：落点受规则约束、决策者未必是落子方，一律标「开局流程」而不判失误。
    // 落了引擎首选仍算「最佳」（那是真信息，且说明这个合法点就是引擎首选）。
    const inOpeningProcedure = index + 1 <= (options.openingLastMove || 0);
    const grade = playedBest ? "best" : inOpeningProcedure ? "opening" : gradeForLoss(Math.max(0, loss), missedWin);
    entries.push({
      nodeId: playedNodes[index].nodeId,
      moveNumber: index + 1,
      mover: before.mover,
      played,
      best,
      blackWinRateBefore: before.blackWinRate,
      blackWinRateAfter: after.blackWinRate,
      lossForMover: Math.max(0, loss),
      grade,
    });
  }
  return entries;
};

/** 曲线点：x=手数（0=开局），y=黑方视角胜率。缺评估的点跳过（前端连线自动跨过）。
 *  null 容错：停止过的复盘落库时稀疏数组的洞会变成 null（JSON 化），读回后必须当「无样本」处理。 */
export const buildReviewCurve = (samples: ReviewSample[]): Array<{ moveNumber: number; blackWinRate: number }> =>
  samples
    .map((sample, index) => ({ moveNumber: index, blackWinRate: sample ? sample.blackWinRate : undefined }))
    .filter((point): point is { moveNumber: number; blackWinRate: number } => typeof point.blackWinRate === "number");

/** 常态胜率图（分析面板「胜率」页签）的数据合成：复盘样本优先（整局跑过就完整），
 *  其余局面用分析缓存里积累的胜率补（打谱/读谱随手分析过的局面自动上图）。
 *  cacheRates 的键是局面 nodeId、值是黑方视角胜率 0-100（调用方负责视角换算）。 */
export type WinrateSource = "review" | "cache" | "none";
export interface WinratePoint { moveNumber: number; blackWinRate?: number; source: WinrateSource }
export const buildWinrateSeries = (
  positions: Array<{ nodeId: string }>,
  reviewSamples: ReviewSample[] | undefined,
  cacheRates: Record<string, number | undefined>,
): WinratePoint[] =>
  positions.map((position, index) => {
    const reviewRate = reviewSamples?.[index]?.blackWinRate;
    if (typeof reviewRate === "number") return { moveNumber: index, blackWinRate: reviewRate, source: "review" as const };
    const cacheRate = cacheRates[position.nodeId];
    if (typeof cacheRate === "number") return { moveNumber: index, blackWinRate: cacheRate, source: "cache" as const };
    return { moveNumber: index, source: "none" as const };
  });

const formatPercent = (rate: number | undefined) => (rate === undefined ? "-" : `${Math.round(rate)}%`);

/** 单手讲解词（中文模板，纯本地生成）。 */
export const buildMoveComment = (entry: ReviewEntry, formatCoordinate: (position: Position) => string): string => {
  const coordinate = entry.played ? formatCoordinate(entry.played) : "过手";
  const colorLabel = entry.mover === "black" ? "黑" : "白";
  const moverBefore = entry.blackWinRateBefore === undefined ? undefined : entry.mover === "black" ? entry.blackWinRateBefore : 100 - entry.blackWinRateBefore;
  const moverAfter = entry.blackWinRateAfter === undefined ? undefined : entry.mover === "black" ? entry.blackWinRateAfter : 100 - entry.blackWinRateAfter;
  const gradeLabel = entry.grade ? REVIEW_GRADE_LABELS[entry.grade] : "未评估";
  const head = `第 ${entry.moveNumber} 手 ${colorLabel} ${coordinate}：${gradeLabel}。`;
  const detail = moverBefore !== undefined && moverAfter !== undefined
    ? `${colorLabel}方胜率 ${formatPercent(moverBefore)} → ${formatPercent(moverAfter)}`
    : "";
  // 开局流程里不报「引擎推荐」：那个点常常不在规则允许的候选集/落点区内，
  // 报了反而像在指责一手本来就下不了的棋。
  const bestNote = entry.grade === "opening"
    ? "（开局流程：打点/选择由规则限定，胜率波动不计入失误）"
    : entry.grade && entry.grade !== "best" && entry.best
      ? `，引擎推荐 ${formatCoordinate(entry.best)}`
      : "";
  return `${head}${detail}${bestNote}`;
};

export interface ReviewSummary {
  counts: Record<ReviewGrade, number>;
  /** 损失最大的三手（降序）。 */
  worst: ReviewEntry[];
  /** 一段话总结（本地模板生成）。 */
  text: string;
}

export const buildReviewSummary = (
  entries: ReviewEntry[],
  options: {
    formatCoordinate: (position: Position) => string;
    totalMoves: number;
    /** 开局流程覆盖到第几手（0=无）；给了就在汇总里说明这一段为什么不判失误。 */
    openingLastMove?: number;
    /** 开局规则的可读名字（如「五手多打（山口）」），用于说明段。 */
    openingRuleLabel?: string;
  },
): ReviewSummary => {
  const counts: Record<ReviewGrade, number> = { best: 0, inaccuracy: 0, mistake: 0, blunder: 0, missedWin: 0, opening: 0 };
  for (const entry of entries) if (entry.grade) counts[entry.grade] += 1;
  const worst = entries.filter((entry) => entry.grade === "blunder" || entry.grade === "missedWin" || entry.grade === "mistake")
    .sort((a, b) => (b.lossForMover ?? 0) - (a.lossForMover ?? 0))
    .slice(0, 3);
  const lines: string[] = [];
  const graded = entries.filter((entry) => entry.grade);
  lines.push(`本局共 ${options.totalMoves} 手，已评估 ${graded.length} 手：最佳 ${counts.best}、疑问 ${counts.inaccuracy}、失误 ${counts.mistake}、败着 ${counts.blunder}${counts.missedWin ? `、错失必胜 ${counts.missedWin}` : ""}${counts.opening ? `、开局流程 ${counts.opening}` : ""}。`);
  if (counts.opening > 0 && options.openingLastMove) {
    const ruleLabel = options.openingRuleLabel ? `〈${options.openingRuleLabel}〉` : "本局开局规则";
    lines.push(`第 1–${options.openingLastMove} 手属于${ruleLabel}规定的开局流程：落点受规则限定（打点候选与可落区域），且主线第 5 手往往是对方从你摆的候选里挑的一个——胜率在这一段回落是规则设计的一部分，故不判失误、也不计入下面的最差手。`);
  }
  for (const entry of worst) lines.push(buildMoveComment(entry, options.formatCoordinate));
  if (!worst.length) lines.push("没有出现明显失误，整体发挥稳定。");
  return { counts, worst, text: lines.join("\n") };
};

/** 复盘数据的持久化形状（按棋谱 id 一份，LRU 保留最近 8 份）。
 *
 * 键名从 v1 升到 v2（2026-09-30）：v1 时期的样本是**在错误的视角约定下算出来的**
 * ——cfg 说是 BLACK、引擎实际给行棋方视角、前端又原样透传，于是白行棋的样本把
 * 白方胜率记成了「黑方胜率」，失误分档跟着整体失真。这类数据无法可靠地事后修正
 * （同一字段里混着两套视角），所以直接换键作废旧数据；复盘随时可重跑。 */
export const GAME_REVIEW_STORAGE_KEY = "banbu-game-review-v2";
export const GAME_REVIEW_MAX_DOCUMENTS = 8;

export interface StoredGameReview {
  ts: number;
  /** 复盘覆盖的手数（主线长度）。 */
  totalMoves: number;
  samples: ReviewSample[];
  entries: ReviewEntry[];
}

const parseStoredReview = (raw: unknown): StoredGameReview | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<StoredGameReview> & Record<string, unknown>;
  if (typeof value.ts !== "number" || typeof value.totalMoves !== "number" || !Array.isArray(value.samples) || !Array.isArray(value.entries)) return null;
  // 稀疏数组的洞经 JSON 序列化变成 null：读回时补成无评估的占位样本，
  // 保住下标对齐（曲线 x 轴、分档跳过逻辑都依赖下标）。
  const samples = (value.samples as Array<ReviewSample | null>).map((sample): ReviewSample => sample || { nodeId: "", mover: "black" });
  return { ts: value.ts, totalMoves: value.totalMoves, samples, entries: value.entries as ReviewEntry[] };
};

export const loadStoredGameReviews = (): Record<string, StoredGameReview> => {
  try {
    const raw = localStorage.getItem(GAME_REVIEW_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const result: Record<string, StoredGameReview> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const review = parseStoredReview(value);
      if (review) result[key] = review;
    }
    return result;
  } catch {
    return {};
  }
};

export const loadStoredGameReview = (documentId: string): StoredGameReview | null => loadStoredGameReviews()[documentId] || null;

export const saveStoredGameReview = (documentId: string, review: StoredGameReview) => {
  try {
    const all = loadStoredGameReviews();
    all[documentId] = review;
    const keys = Object.keys(all).sort((a, b) => (all[b]?.ts || 0) - (all[a]?.ts || 0));
    for (const key of keys.slice(GAME_REVIEW_MAX_DOCUMENTS)) delete all[key];
    localStorage.setItem(GAME_REVIEW_STORAGE_KEY, JSON.stringify(all));
  } catch { /* storage can be unavailable */ }
};

export const removeStoredGameReview = (documentId: string) => {
  try {
    const all = loadStoredGameReviews();
    if (all[documentId]) {
      delete all[documentId];
      localStorage.setItem(GAME_REVIEW_STORAGE_KEY, JSON.stringify(all));
    }
  } catch { /* storage can be unavailable */ }
};
