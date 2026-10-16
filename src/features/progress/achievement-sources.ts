/**
 * 把**已经存在的各个账本**读成一份 `AchievementSources`（用户 2026-10-09）。
 *
 * 这一层存在的意义：`achievements.ts` 的判定引擎要保持纯函数、可单测；而"去哪里读
 * 战绩、读题库、读复盘"是脏活。脏活集中在这里，被测的（判定）和读盘的（这里）分开。
 *
 * **读取一律容错**：任何一份账本坏了/缺失/格式变了，都只是让对应那几条成就保持未解锁，
 * 绝不抛错、绝不连累其它来源。每个来源各自 try——用户的历史数据要紧，
 * 不能因为 VCF 状态的格式问题导致战绩成就也读不出来。
 *
 * 只读不写：本模块不修改任何账本。
 */

import { loadDuelHistory, summarizeDuelHistory, type DuelHistoryEntry } from "../duel/duel-history";
// 本地日期键：**共享一处**（2026-10-11 收敛，见 local-date.ts 的说明）。
import { localDateKey } from "../../local-date";
import { loadPuzzleCollections, loadPuzzleProgress } from "../../puzzles";
import { levelOf, loadState as loadVcfState } from "../vcf-challenge/rating";
import { loadStoredGameReviews, type StoredGameReview } from "../research/game-review";
// 棋谱库 / 收藏 / 书签：**直接读既有存储**，不需要任何业务代码配合
// （这是"只读已有账本"纪律的最纯粹例子——它们本来就是用户资产）。
import { loadLibrary } from "../../storage";
import { loadFavorites } from "../../library-favorites";
import { loadAchievementSignals, type AchievementSignals } from "./signal-store";
// 每日一题：**从它自己的存档里数**（2026-10-11 修的一个死源，见 buildPuzzle 里的注释）。
import { loadDailyTraining } from "../puzzles/daily-training";
import type { AchievementSources } from "./achievements";

/**
 * 棋谱库规模（2026-10-10 新增）。三处都是**直接读 localStorage**：
 *  · 棋谱份数 —— `storage.loadLibrary()`（就是棋谱库列表本身）；
 *  · 收藏数 —— `library-favorites.loadFavorites()` 的棋谱 + 题集两份；
 *  · 分支书签数 —— 书签键下各棋谱的数组长度之和（结构是 `{ [documentId]: [...] }`）。
 *
 * 全是"用户已经攒下来的东西"，所以从它们派生成就不需要新增任何埋点。
 */
const buildLibrary = (): NonNullable<AchievementSources["library"]> => {
  const documents = safe(() => loadLibrary().length, 0);
  const favorites = safe(() => {
    const value = loadFavorites();
    return (value.records?.length ?? 0) + (value.puzzleCollections?.length ?? 0);
  }, 0);
  const bookmarks = safe(() => {
    const raw = localStorage.getItem("renju-note-branch-bookmarks-v1");
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    // 每份棋谱挂一个书签数组 ⇒ 数所有数组的总长度。
    return Object.values(parsed as Record<string, unknown>)
      .reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  }, 0);
  return { documents, favorites, bookmarks };
};

/** 单条记录的安全读取（坏了一条丢一条，不整份作废）。 */
const safe = <T>(read: () => T, fallback: T): T => {
  try { return read(); } catch { return fallback; }
};

// ── 对弈 ────────────────────────────────────────────────────────────

/** 「大师」档在账本里的 `strength` 存的就是这个中文名（`duel-history.ts` 的 STRENGTHS）。 */
const MASTER_STRENGTH = "大师";

const buildDuel = (entries: DuelHistoryEntry[]): NonNullable<AchievementSources["duel"]> => {
  const ordered = [...entries].sort((a, b) => a.at - b.at);
  const wins = ordered.filter((item) => item.outcome === "won");
  const summary = summarizeDuelHistory(entries);

  // 对「大师」档的**当前**连胜：从最后一局往前数，遇到非「大师胜」就停。
  let masterStreak = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const item = ordered[i];
    if (item.outcome === "won" && item.strength === MASTER_STRENGTH) masterStreak += 1;
    else break;
  }

  // 2026-10-10 新增的四个派生量：全部来自同一条战绩账本，不需要任何业务代码配合。
  const draws = ordered.filter((item) => item.outcome === "draw").length;
  const longestGame = ordered.length ? Math.max(...ordered.map((item) => item.moves)) : 0;
  const wonAsWhite = wins.filter((item) => item.humanPlayer === "white").length;
  const wonAsBlack = wins.filter((item) => item.humanPlayer === "black").length;

  // 战绩账本把禁手判负记成 outcome=lost + reason 里带「禁手」。
  const forbiddenLossAt = ordered.find((item) => item.outcome === "lost" && /禁手/.test(item.reason))?.at;
  // 「没用认输下完」：终局原因不含认输/超时这类主动放弃或被迫判负的非正常结束。
  const normalFinish = /连成五|五连|满盘|没有合法/.test(ordered.map((item) => item.reason).join(" "));

  return {
    games: ordered.length,
    wins: wins.length,
    wonMaster: wins.some((item) => item.strength === MASTER_STRENGTH),
    masterStreak,
    fastestWinMoves: wins.length ? Math.min(...wins.map((item) => item.moves)) : undefined,
    lostByForbidden: forbiddenLossAt !== undefined,
    // 严格晚于禁手判负那一刻再赢过一局。
    wonAfterForbidden: forbiddenLossAt !== undefined && wins.some((item) => item.at > forbiddenLossAt),
    completedWithoutResign: normalFinish,
    // 棋钟：账本里 `timeLimitMs > 0` 就是这个人类方带包干时限的对局。
    usedClock: ordered.some((item) => item.timeLimitMs > 0),
    rating: summary.rating.current,
    // 当前连胜：`summary.streak` 带 type，只有连胜时才算（连败/和棋不算）。
    streak: summary.streak.type === "won" ? summary.streak.count : 0,
    draws,
    longestGame,
    wonAsWhite,
    wonAsBlack,
  };
};

// ── 做题 ────────────────────────────────────────────────────────────

const buildPuzzle = (signals: AchievementSignals): NonNullable<AchievementSources["puzzle"]> => {
  const collections = safe(() => loadPuzzleCollections(), []);
  const progress = safe(() => loadPuzzleProgress(), {});
  const keys = Object.keys(progress);
  const solved = keys.filter((key) => progress[key]?.solved).length;
  // 「清空一个题集」：题集里每一道题都 solved（空题集不算）。
  const clearedCollection = collections.some((collection) =>
    collection.puzzles.length > 0
    && collection.puzzles.every((puzzle) => progress[`${collection.id}/${puzzle.id}`]?.solved));
  // 错题本口径与 `deriveWrongPuzzleEntries` 一致：尝试过、但尚未攻克。
  const wrongCount = keys.filter((key) => !progress[key]?.solved && (progress[key]?.attempts || 0) > 0).length;
  // 尝试总次数：进度表里每题都记了 attempts（含"试过但没攻克"的）。
  const attempts = keys.reduce((sum, key) => sum + (progress[key]?.attempts || 0), 0);
  return {
    solved,
    attempts,
    clearedCollection,
    wrongCount,
    // 「把错题重新做对」只能靠信号位：进度表分不清"从没错过"和"错过又做对了"。
    clearedWrong: Boolean(signals.clearedWrongPuzzle),
    /**
     * **每日一题完成次数**（2026-10-11 修的一个死源）。
     *
     * ⚠ 原来读的是 `signals.dailyDoneCount` —— 而**没有任何地方写过它**
     * （全仓搜只有这一处读、零处写）。于是那三条成就（今日一题 / 七日七题 / 天天练）
     * **永远不可能解锁**：用户老老实实一天做一道，做到第三十天也不弹。
     * 这与「表里有价、代码没接线」是同一类问题，只是换成了"成就读一个没人写的计数"。
     *
     * 现在改成从**每日一题的存档本身**数：那份存档每天一条记录（`solved: true`
     * 才算完成），它就是"完成了多少次"的唯一事实来源 —— 不必另设一个计数
     * （另设一个就得有人记得在正确的地方 +1，而那正是这次坏掉的原因）。
     *
     * 口径：只数 `solved === true` 的天数。做了但没做出来不算（与
     * `recordPuzzleCompletion` 的写入条件、以及 `daily` 那条棋魂的发放条件一致）。
     */
    dailyDone: safe(() => Object.values(loadDailyTraining().days).filter((day) => day?.solved === true).length, 0),
  };
};

// ── VCF 挑战 ────────────────────────────────────────────────────────

const buildVcf = (): NonNullable<AchievementSources["vcf"]> => {
  const state = safe(() => loadVcfState(), null);
  if (!state) return { solved: 0, streak: 0, bestStreak: 0, rating: 1000, todaySolved: 0, attempts: 0, level: 1, longestWinStreak: 0 };
  // 今日解出数：状态里本来就有 `daily: { "YYYY-MM-DD": { solved, failed } }`，
  // 直接按**本地**日期取。日期键走共享的 `localDateKey`（2026-10-11 收敛：
  // 这句原来在 VCF 页、VCF rating、战绩面板、这里各抄了一份）。
  const key = localDateKey();
  const today = safe(() => state.daily?.[key], undefined);
  /**
   * **参与总次数** = 解出 + 失败。
   *
   * 用户 2026-10-10 要的是「第一次耍，10次耍，100次，1000次，5000次耍」——
   * 量的是"**玩了多少次**"而不是"做对了多少次"。这一条刻意把做不出来的次数也算进去：
   * 在 VCF 里反复试不出来是常态，那也是在练（同 `puzzle-attempts-200` 的口径）。
   */
  const attempts = (Number(state.solved) || 0) + (Number(state.failed) || 0);
  /**
   * 等级：直接用 `rating.ts` 自己的 `levelOf`（**不另算一套阈值**）。
   * VCF 页显示的"等级 N"就是它，两处必须是同一个数，否则用户会看到
   * "页面上写等级 5，成就却说没到"这种自相矛盾。
   */
  const level = safe(() => levelOf(state.rating ?? 1000), 1);
  return {
    solved: Array.isArray(state.solvedIds) ? state.solvedIds.length : 0,
    streak: state.streak ?? 0,
    bestStreak: state.bestStreak ?? 0,
    rating: state.rating ?? 1000,
    todaySolved: today?.solved ?? 0,
    attempts,
    level,
    /**
     * 最长连胜：状态里只有 `bestStreak`（那是"历史最高"），这里直接复用。
     * 之所以在 sources 里另起一个名字：`bestStreak` 的语义是"最高连胜"，
     * 而成就文案想说的是"最长连解"——同一个数、两种叫法，保留两个名字是为了
     * 将来若真出现"另一种连胜口径"时不会误改（现在是同一个值）。
     */
    longestWinStreak: state.bestStreak ?? 0,
  };
};

// ── 复盘 ────────────────────────────────────────────────────────────

const buildReview = (): NonNullable<AchievementSources["review"]> => {
  const stored = safe(() => loadStoredGameReviews(), {} as Record<string, StoredGameReview>);
  const list = Object.values(stored);
  // 「零失误」：这一局逐手分档里没有 失误 / 败着 / 错失必胜 三类。
  // 开局流程（opening）不算失误——它本来就被豁免判定（见 game-review 的 inOpeningProcedure）。
  const flawless = list.some((item) =>
    Array.isArray(item.entries)
    && item.entries.length > 0
    && item.entries.every((entry) =>
      entry.grade !== "mistake" && entry.grade !== "blunder" && entry.grade !== "missedWin"));
  return { count: list.length, flawless };
};

// ── 识谱 / 变化树 / 开局 ────────────────────────────────────────────

const buildRecognition = (signals: AchievementSignals): NonNullable<AchievementSources["recognition"]> => ({
  count: signals.recognitionCount || 0,
  restoredOrder: Boolean(signals.restoredMoveOrder),
  maxMoves: signals.recognitionMaxMoves || 0,
});

const buildStudy = (signals: AchievementSignals): NonNullable<AchievementSources["study"]> => ({
  branches: signals.branchCount || 0,
  openedBigLibrary: Boolean(signals.openedBigLibrary),
  usedCrossSearch: Boolean(signals.usedCrossSearch),
});

/**
 * 组装全部来源。**调用方可以传 `overrides` 补最新事实**——例如刚打完一局，
 * 账本虽已写盘，但为避免"写盘 → 读盘"的时序差，可以直接把最新结果塞进来。
 */
export const collectAchievementSources = (
  overrides: Partial<AchievementSources> = {},
): AchievementSources => {
  const signals = safe(() => loadAchievementSignals(), {} as AchievementSignals);
  return {
    duel: safe(() => buildDuel(loadDuelHistory()), undefined),
    puzzle: safe(() => buildPuzzle(signals), undefined),
    vcf: safe(() => buildVcf(), undefined),
    review: safe(() => buildReview(), undefined),
    recognition: safe(() => buildRecognition(signals), undefined),
    study: safe(() => buildStudy(signals), undefined),
    library: safe(() => buildLibrary(), undefined),
    openingKinds: signals.openingKinds || 0,
    // 点魂火累计次数（信号位里的只增计数，不是账本条数 —— 理由见 AchievementSources 的注释）
    tap: { total: signals.tapCount || 0 },
    generator: {
      kinds: signals.generatorKinds || [],
      maxDepth: signals.generatorMaxDepth || 0,
      // 造题总数：信号位里记的是"累计造出多少道"（只增不减）
      count: signals.generatorCount || 0,
    },
    signals,
    ...overrides,
  };
};
