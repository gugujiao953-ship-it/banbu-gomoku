/**
 * 每日一题（用户 2026-09-17 要；2026-09-19 收窄）。
 *
 * 收窄原因（用户原话）：「做题打卡，错题重温去掉吧，有点鸡肋，感觉花哨了」——
 * 所以**打卡（连续天数/七天格子）与错题间隔重温（1/3/7/15/30 天排期、错题本「今日重温」区）
 * 整套去掉**，这里只留「每天出一道题」这一件事：当天出哪道、做了没有。
 *
 * 这一层只有纯计算和一个 localStorage 槽位，刻意不读系统时钟：所有函数都由调用方把
 * 「今天」（本地日期键）传进来。原因有两条——单测要能推进日期；以及选题必须确定性
 * （同一天、同一批数据必须算出同一道题，否则用户刷新一次就换题）。
 */

export const DAILY_TRAINING_KEY = "banbu-daily-training-v1";

export interface DailyPick {
  key: string;
  collectionId: string;
  puzzleId: string;
}

export interface DailyTrainingState {
  version: 1;
  /** 每日一题：本地日期键 → 当天出的题与是否已解出。 */
  days: Record<string, DailyPick & { solved: boolean }>;
}

/** 选题时需要知道的题目状态（由题库 + 做题进度派生）。 */
export interface DailyCandidate {
  collectionId: string;
  puzzleId: string;
  solved: boolean;
  attempts: number;
  updatedAt: string;
}

/** 为什么今天出这道：错题本里最久没碰的，还是没做过的新题。 */
export type DailyReason = "wrong" | "fresh";

export interface DailyDecision {
  pick: DailyPick;
  reason: DailyReason;
  /** 当天已经定过题（用户开始过），沿用它而不是重算。 */
  carriedOver: boolean;
}

export const dailyPickKey = (collectionId: string, puzzleId: string) => `${collectionId}/${puzzleId}`;

/**
 * 本地日期键 —— **转出自 `src/local-date.ts`**（2026-10-11 收敛）。
 *
 * 这一份原来长在这里，而同一句格式化在 vcf-challenge（两处）、duel、progress
 * 各又抄了一份。"今日进度"这类东西一旦口径不一致就会各算各的，
 * 所以定义收成一处、这里只保留**转出**（旧引用点不用改）。
 */
export { localDateKey } from "../../local-date";

export const emptyDailyTraining = (): DailyTrainingState => ({ version: 1, days: {} });

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * 读存档。旧版本里还有 `reviews`（错题排期）与打卡相关字段，这里**直接忽略**——
 * 不迁移、不报错，用户升上来只是那些数据不再被使用（不影响每日一题与做题进度）。
 */
export function loadDailyTraining(): DailyTrainingState {
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_TRAINING_KEY) || "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyDailyTraining();
    const value = raw as { days?: unknown };
    const days: DailyTrainingState["days"] = {};
    for (const [date, entry] of Object.entries(value.days && typeof value.days === "object" ? (value.days as Record<string, unknown>) : {})) {
      if (!entry || typeof entry !== "object") continue;
      const pick = entry as Partial<DailyPick> & { solved?: boolean };
      if (!isNonEmptyString(pick.collectionId) || !isNonEmptyString(pick.puzzleId)) continue;
      days[date] = { key: dailyPickKey(pick.collectionId, pick.puzzleId), collectionId: pick.collectionId, puzzleId: pick.puzzleId, solved: pick.solved === true };
    }
    return { version: 1, days };
  } catch {
    return emptyDailyTraining();
  }
}

export function saveDailyTraining(state: DailyTrainingState): void {
  try {
    localStorage.setItem(DAILY_TRAINING_KEY, JSON.stringify(state));
  } catch {
    // 存储满或隐私模式下写入失败：功能退化为当次会话可用，不影响做题本身。
  }
}

const hashDateKey = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const candidateKey = (candidate: DailyCandidate) => dailyPickKey(candidate.collectionId, candidate.puzzleId);

/**
 * 今天出哪一道题。顺序：当天已定过的题 → 错题本里最久没碰的 → 没做过的题
 * （按日期哈希从候选里定序取一道，保证同一天稳定）。
 */
export function decideDailyPuzzle(state: DailyTrainingState, candidates: DailyCandidate[], today: string): DailyDecision | null {
  const byKey = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate]));
  const existing = state.days[today];
  if (existing && byKey.has(existing.key)) {
    const candidate = byKey.get(existing.key)!;
    return {
      pick: { key: existing.key, collectionId: existing.collectionId, puzzleId: existing.puzzleId },
      reason: candidate.attempts > 0 ? "wrong" : "fresh",
      carriedOver: true,
    };
  }
  const wrong = candidates
    .filter((candidate) => !candidate.solved && candidate.attempts > 0)
    .sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || "") || candidateKey(a).localeCompare(candidateKey(b)));
  if (wrong.length) {
    const chosen = wrong[0];
    return { pick: { key: candidateKey(chosen), collectionId: chosen.collectionId, puzzleId: chosen.puzzleId }, reason: "wrong", carriedOver: false };
  }
  const fresh = candidates.filter((candidate) => !candidate.solved && candidate.attempts <= 0).map(candidateKey).sort();
  if (fresh.length) {
    const key = fresh[hashDateKey(today) % fresh.length];
    const chosen = byKey.get(key);
    if (chosen) return { pick: { key, collectionId: chosen.collectionId, puzzleId: chosen.puzzleId }, reason: "fresh", carriedOver: false };
  }
  return null;
}

/** 把「今日一题」定下来（用户点开始时调用）。已经有当天记录就沿用，避免中途改题。 */
export function markDailyStarted(state: DailyTrainingState, pick: DailyPick, today: string): DailyTrainingState {
  if (state.days[today]) return state;
  return { ...state, days: { ...state.days, [today]: { ...pick, solved: false } } };
}

export interface PuzzleCompletionInput {
  collectionId: string;
  puzzleId: string;
  solved: boolean;
  today: string;
}

/**
 * 一次做题终局的结果回写：**只记「今天这道题做出来了没有」**，用于对弈页显示
 * 「今天已完成」。不再有错题排期与打卡（09-19 去掉）。
 */
export function recordPuzzleCompletion(state: DailyTrainingState, input: PuzzleCompletionInput): DailyTrainingState {
  const key = dailyPickKey(input.collectionId, input.puzzleId);
  const todayEntry = state.days[input.today];
  if (!input.solved || !todayEntry || todayEntry.solved || todayEntry.key !== key) return state;
  return { ...state, days: { ...state.days, [input.today]: { ...todayEntry, solved: true } } };
}
