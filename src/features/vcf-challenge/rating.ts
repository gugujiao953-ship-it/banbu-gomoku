// rating.ts — 解答力评分体系（2026-10-06 定标；2026-10-12 段位制改版：0 分起步、分数段阶梯、匹配改三级）。
//
// 四条口径（严谨版，改动前先读这段）：
//  ① **只有一把尺**：题目难度就是**手数**，题目等级 = 手数（`levelOfHands`），与玩家等级分同一套台阶
//     （每一级统一 300 分；1 级从 0 分起）。旧版曾在 14 级切换为 200 分，现已取消。
//     2026-10-12 段位改版后它与等级分脱钩，被当等级分用就造出了 R188 那个偏移（同级题加 +28~+44）；
//     **整条曲线已删除**，界面上也不再显示「题目 ≈X 分」，只写「N 手 · L 级」。
//     深浅两端以**实测题源**为准：静态池最深 13 手；**生成器（与棋题生成器同一台）实测到 40 手**
//     （35 手 2.6s、40 手 6.3s，45 手以上出不来）。所以 14 手以上一律由生成器即时出题。
//  ② 计时不再固定：玩家只选三档「计时难度」（默认 ×2 / 充裕 ×1 / 休闲 ×0.5），
//     **时限随等级（＝手数）伸缩**——1–3 级 30/35/40 秒起，在 4/6/9/11/12/13 级各加一次
//     （+5/+10/+20 秒）；13 级后**每 2 级**加一次，到挑战最高级收在三档上限
//     **120 / 210 / 300 秒**（式子不够就在最高级补满、超了也不越过，见 `paceSecondsFor`）。
//     加减分改**等级差表**（不再用 Elo 的 10^(分差/400)）：gap = 题目等级 − 解答力等级。
//     **题目等级 = 手数**（levelOfHands(depth)），解答力等级由**分数段阶梯**定（levelOf）。
//     同等级题：答对 +10（×难度倍数，默认档 +20）、答错 −10；答对越难的题加得越多
//     （式子 **10 + 4n**，n = 题目比自己高几级；2026-10-14 起**不再顶在 22**，
//      式子本身夹到 **1–150**（`GAIN_MAX`，这是**基础倍率那一层**），再乘计时难度倍数），
//     答错扣 4–100（低一级 −13 = **10 + 3n**，一路到 −100 封顶；**扣分不乘难度倍数**，
//     沿用"快棋输了不会多扣"的原则），扣分下限为 0（输棋绝不加分）。
//  ③ 等级 = **统一阶梯**：每一级 300 分（levelFloor 是唯一入口），
//     最高级由等级分上限推出（9999 ⇒ 最高等级 34）。加分顶格是 150 × 默认档 2 = **+300**，
//     正好等于一级宽；扣分最多 −100（不到 1/3 级）⇒ **一次胜负不会越过一级**（顶格时正好跨一级）。
//  ④ 等级差按**封顶后的等级分**算（eff = min(rating, MAX_MATCH_RATING)）：真实分高过挑战上限
//     （34 级的入门分 **9900**）时仍按最高等级比，不会出现"分数高到没有题配得上"的单边失衡。
//     ⚠ 这个封顶与结算里的题目分都走**等级分那把尺**（`levelFloor`），不用题分曲线
//     `problemRating`——两套尺度在 2026-10-12 改版后已经脱钩，混用会把题目算高 1~3 级（已修）。
import type { VcfTier } from "../vcf/vcf-corpus";
import type { Player } from "../../types";
// 今天的本地日期键：**共享一处**（2026-10-11 收敛）。
// 这句 `${getFullYear()}-${pad(getMonth()+1)}-${pad(getDate())}` 原来在
// vcf-challenge / duel / progress 三块里各手抄了一份 —— 而它决定的键一旦不一致，
// "今日进度"就会各算各的（页面显示 3、成就判定读不到），是"两处各记一份"的老病。
import { localDateKey } from "../../local-date";

const KEY = "vcfch-state-v1";

/** 计时难度三档（用户 2026-10-06 定稿，替换旧的固定 45/90/120/180 四档）：
 *  · 默认：得分 ×2；· 充裕：×1；· 休闲：×0.5。
 *  **时限随手数（＝等级）伸缩**，具体表见下面 `paceSecondsFor`（2026-10-12 重定、2026-10-14 改成「每 2 级一档 + 三档上限」）。 */
export type PaceMode = "default" | "ample" | "casual";
export const PACE_MODES: ReadonlyArray<PaceMode> = ["default", "ample", "casual"];
/** 各档得分倍数：只乘**加分**，扣分不乘（沿用既有原则）。 */
export const PACE_GAIN: Record<PaceMode, number> = { default: 2, ample: 1, casual: 0.5 };
export const PACE_LABELS: Record<PaceMode, string> = { default: "默认", ample: "充裕", casual: "休闲" };

/** 时限的基础**加档点**（1–13 级沿用既有分段）：从这一级起多给一次。
 *  13 级之后**每 2 级**继续加一次（用户 2026-10-14：「13 级后每 2 级加一次」），
 *  到挑战最高级按 `PACE_CAP` 收口（见 `paceSecondsFor`）。 */
export const PACE_STEPS: ReadonlyArray<number> = [4, 6, 9, 11, 12, 13];
/** 13 级之后加档的跨度（级）。 */
export const PACE_POST_STEP_EVERY = 2;

/** 本题的时限（秒）＝ 该档起点秒数 + 已过的加档次数 × 该档步长，**收口在 `PACE_CAP`**。
 *  三档的起点/步长/上限（用户 2026-10-14 逐档定的表）：
 *    · 1–3 级：默认 **30** / 充裕 **35** / 休闲 **40**
 *    · 4–5 级：+5 / +10 / +20 → 35 / 45 / 60
 *    · 6–8 级：再加一次 → 40 / 55 / 80
 *    · 9–10 级：再加一次 → 45 / 65 / 100
 *    · 11 级：50 / 75 / 120 · 12 级：55 / 85 / 140 · 13–14 级：60 / 95 / 160
 *    · 15–16 级 65 / 105 / 180 · 17–18 级 70 / 115 / 200 · 19–20 级 75 / 125 / 220
 *    · 21–22 级 80 / 135 / 240 · 23–24 级 85 / 145 / 260 · 25–26 级 90 / 155 / 280
 *    · 27–28 级 95 / 165 / **300**（休闲档在这里已经够到上限，之后不再涨）
 *    · 29–30 级 100 / 175 / 300 · 31–32 级 105 / 185 / 300 · 33–34 级 110 / 195 / 300
 *    · **35 级（挑战最高级）：120 / 210 / 300 ＝ 三档上限**
 *      默认按式子只到 115、充裕只到 205 ⇒ 在这一级**补到上限**（所以 34→35 级默认 +10、
 *      充裕 +15，比常规一档大一点，这是用户要的「不够就在最高等级的时候补」）；
 *      休闲按式子在这一级会是 380 ⇒ **不超过上限**，取 300。
 *  ⚠ 用户这次点名的区间是「1-3、4-5、6-7、9-10、11、12、13」，**没有说 8 手**；
 *    这里按"加档只在 4/6/9/11/12/13 这六个点上发生"落实 ⇒ 8 手留在 6 那一档（6–8 同级）。
 *    要改成"8 手并入 9–10"只需把 `PACE_STEPS` 里的 9 挪到 8。
 *  ⚠ 旧口径按 `depth` 两手段一档，新口径按**等级**（等级 = 手数，见 `levelOfHands`），
 *    所以传进来的 depth 直接当等级用。挑战计时上限 35 手；生成器 40 手仅供独立预览。 */
export const PACE_START: Record<PaceMode, number> = { default: 30, ample: 35, casual: 40 };
export const PACE_STEP_GAIN: Record<PaceMode, number> = { default: 5, ample: 10, casual: 20 };
/** 三档在**挑战最高级**（`CHALLENGE_MAX_DEPTH` 手）的时限上限（秒）。 */
export const PACE_CAP: Record<PaceMode, number> = { default: 120, ample: 210, casual: 300 };
export const paceSecondsFor = (depth: number, mode: PaceMode): number => {
  const level = Math.max(1, Math.min(CHALLENGE_MAX_DEPTH, Math.round(depth)));
  const cap = PACE_CAP[mode];
  // 最高级就是上限：式子不够补到上限、超了也不许越过（用户 2026-10-14 原话落实）。
  if (level >= CHALLENGE_MAX_DEPTH) return cap;
  const baseSteps = PACE_STEPS.reduce((n, at) => (level >= at ? n + 1 : n), 0);
  const lastBandLevel = PACE_STEPS[PACE_STEPS.length - 1];
  const postSteps = Math.max(0, Math.floor((level - lastBandLevel) / PACE_POST_STEP_EVERY));
  return Math.min(cap, PACE_START[mode] + (baseSteps + postSteps) * PACE_STEP_GAIN[mode]);
};

export interface VcfSettings {
  /** 计时难度：默认 ×2 / 充裕 ×1 / 休闲 ×0.5（时限随手数伸缩，不再是固定秒数） */
  pace: PaceMode;
  /** 9 手以上是否用生成器即时出题 */
  genDeep: boolean;
}

export const DEFAULT_SETTINGS: VcfSettings = { pace: "default", genDeep: true };

/** 旧档迁移（2026-10-06 前的设置存的是固定 `timeLimitSec`：45/90/120/180 四档）。
 *  改成「计时难度」后这个字段废弃——旧值**一律映射到 default**：旧的限时乘数（45s ×3 … 180s ×0.5）
 *  与新三档（×2/×1/×0.5）对不上，按秒数硬映射只会造出说不清的换算，不如统一从默认档重新开打。 */
export const migrateSettings = (raw?: Partial<VcfSettings> | null): VcfSettings => {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) } as Partial<VcfSettings> & { timeLimitSec?: unknown };
  const pace: PaceMode = merged.pace != null && PACE_MODES.includes(merged.pace) ? merged.pace : "default";
  return { pace, genDeep: merged.genDeep !== false };
};

/** 倒计时转红的阈值：只剩最后 1 秒（用户 2026-10-05：不要提前一大截就变红）。 */
export const TIMER_WARN_MS = 1000;
export const isTimerWarning = (remainMs: number, phase: string) => phase === "playing" && remainMs <= TIMER_WARN_MS;

export interface VcfHistoryEntry {
  ts: number;
  tier: VcfTier;
  depth: number;
  win: boolean;
  moves: number;
  delta: number;
  seconds: number;
  /** 下面四个用于记录里的局面预览与"点进去重做"（老记录可能没有） */
  id?: string;
  attacker?: Player;
  /** "黑子串/白子串"，坐标名连写，如 "H8I8J8/G7G8" */
  stones?: string;
  /** 攻方冲四参考序列，坐标名连写 */
  sol?: string;
}

export interface VcfChallengeState {
  rating: number;
  solvedIds: string[];
  /** 出过的题（含没做出来的）——同段题目全出过才允许重复 */
  seenIds: string[];
  solved: number;
  failed: number;
  streak: number;
  bestStreak: number;
  /** 今日进度：YYYY-MM-DD → {solved, failed} */
  daily: Record<string, { solved: number; failed: number }>;
  history: VcfHistoryEntry[];
  settings: VcfSettings;
}

/** ── 题目难度只有一把尺：手数 ────────────────────────────────────────
 *  旧版这里有一条「题分 = 1000 + 200 ×（手数 − 1）」的曲线（`problemRating` / `handsOfRating` /
 *  `BASE_RATING` / `RATING_STEP`），2026-10-12 段位改版后它与等级分脱钩，被当等级分用就产生了
 *  R188 那个偏移（同级题加 +28~+44、15 级只加 +8）。修正之后它**只剩状态行一个显示用途**，
 *  留着就是"同一个东西在两处各写一份"的下一个事故，所以整条删除：
 *  题目等级 = 手数（`levelOfHands`），要显示就显示「N 手 · L 级」。 */

/** **等级分 ↔ 手数**（等级制改版后的新桥，2026-10-12）。
 *  用户口径：「1 级就是 1 手、3 级就出 3 手的题、13 级出 13 手」——
 *  于是等级分只做一件事：**给玩家的水平定级**，题目难度直接由等级出手数。
 *  这条对齐静态题池与生成器：13 级 = 13 手；生成器本体上限 40 手，挑战匹配上限 35 手。 */
export const handsOfLevel = (level: number) => Math.max(1, Math.min(GEN_MAX_DEPTH, Math.round(level)));
/** 反向：这道题（这个手数）对应哪一级——匹配窗口与 "越级" 判定都读它。 */
export const levelOfHands = (depth: number) => Math.max(1, Math.min(GEN_MAX_DEPTH, Math.round(depth)));

/** 匹配：**按等级取上/本/下三级**（2026-10-12 用户改版）。
 *  「搞得可以匹配到上一个等级，这一个等级，以及下一个等级的题目，
 *    不过排到上下等级的概率不能太大」——所以是 10/80/10。
 *  边界（1 级、满级）：缺失的那一侧权重**并回本级**（不会因为没题就空手）。 */
export const MATCH_SAME_WEIGHT = 80;
export const MATCH_ADJACENT_WEIGHT = 10;

/** **能出的最难题目**（整条题目分曲线的天花板）。两处题源要分开看（2026-10-06 都实测过）：
 *  · **静态题池**（素材+批次）最深 **13 手**——12 手 1 道、13 手 2 道，14 手以上一道都没有；
 *  · **生成器**（与「棋题生成器」同一台引擎）实测能出到 **40 手**：35 手 2.6s、40 手 6.3s，
 *    45/50 手在 20s 预算内出不来。40 手正好与题目分曲线的上限一致。
 *  所以：**13 手是静态题池的上限，40 手是生成器本体上限，挑战匹配上限 35 手**；等级高过 13 手以后出题就全靠生成器。
 *  注意：早先"生成器只到 13 手"的结论量的是**旧引擎**（vcf-corpus 的素材变形），已废弃。 */
export const STATIC_MAX_DEPTH = 13;
export const GEN_MAX_DEPTH = 40;
/**
 * VCF 挑战的匹配深度上限。
 * 9999 分落在 34 级（9900 分起），匹配允许的相邻上一级题目因此到 35 手；
 * 36 手以上仍可由生成器生成或预览，但不再进入挑战等级体系。
 */
export const CHALLENGE_MAX_DEPTH = 35;

/** 等级分上限 **9999**（沿用：够高、又不会让显示变宽）。
 *  等级制改版后它的作用是"**分数还能涨但难度不再加**"：
 *  等级由 `levelOf` 按台阶算，满级后分数继续爬；挑战匹配深度封顶 35 手，生成器页面可更深。
 *  到顶之后赢不再加分、输照常扣；上限只拦上涨，不把已在上限之上的人往下拽。 */
export const MAX_RATING = 9999;

/** ── 等级台阶（2026-10-14）──────────────────────────────────────────────
 *  初始等级分为 0，之后每一级固定需要 300 分。旧版曾在 14 级起改用
 *  200 分台阶，导致深题升级速度突然变快；现在全等级统一 300 分。
 *
 *  这些导出名保留给旧 UI/存档与外部调用点，全部指向同一个 300 分真值，
 *  这样升级规则只需维护 `LEVEL_STEP` 一处。
 */
export const LEVEL_STEP = 300;
/** 兼容旧调用点：低段/高段现在均为统一的 300 分。 */
export const LEVEL_LOW_STEP = LEVEL_STEP;
export const LEVEL_HIGH_STEP = LEVEL_STEP;
/** 兼容旧调用点；不再表示台阶切换位置。 */
export const LEVEL_LOW_MAX = 13;
/** 等级分下限（用户：「初始等级分为 0，等级分也不会小于 0，在 0 还扣的话，扣分无效」）。 */
export const LEVEL_BASE = 0;

/** 第 level 级的**入门分**（该级第一分）。1 级 = 0。 */
export const levelFloor = (level: number): number => {
  const lv = Math.max(1, Math.floor(level));
  return LEVEL_BASE + (lv - 1) * LEVEL_STEP;
};

/** ── 两条「题源天花板」换算到**等级分**这把尺上（2026-10-12 修）─────────────
 *  ⚠ 必须用 `levelFloor(手数)`，**不能**再用题分曲线 `problemRating(手数)`：
 *    等级制改版后两套尺度已经脱钩（题分 1000 起、每手 +200；等级分 0 起、每级 300/200），
 *    拿题分去查 `levelOf` 会把题目整体算错级 —— 实测 1 手题算成 4 级、6 手算成 7 级
 *    （于是"同级赢"从 +20 变 +28、1 级新手做 1 手题直接顶格 +44），
 *    13 手反而算成 12 级；40 手示例同理属于历史偏移。 */
/** 静态题池的天花板等级分（= 13 手那一级的入门分）：高过它，题池里已经没有同等级的题了。 */
export const STATIC_CEILING_RATING = levelFloor(STATIC_MAX_DEPTH);

/** 满级：分数上限 9999 落在哪一级（改台阶时它跟着走，不再写死）。 */
export const LEVEL_MAX = (() => {
  let lv = 1;
  while (levelFloor(lv + 1) <= MAX_RATING) lv += 1;
  return lv;
})();

/**
 * 结算与匹配使用的最高可达等级分。
 *
 * 生成器可以尝试到 40 手，但挑战等级分上限 9999 只覆盖到 34 级（9900
 * 分）；挑战匹配到满级相邻的 35 手。36+ 题仍可作为生成器页面的深档题，
 * 但不会进入挑战等级匹配。
 */
export const MAX_MATCH_LEVEL = Math.min(GEN_MAX_DEPTH, LEVEL_MAX);
export const MAX_MATCH_RATING = levelFloor(MAX_MATCH_LEVEL);

export const levelOf = (rating: number) => {
  const r = Math.max(LEVEL_BASE, rating);
  // 等级统一使用同一条 300 分台阶；保留 LEVEL_MAX 夹位以适配 9999 分封顶。
  return Math.max(1, Math.min(LEVEL_MAX, Math.floor((r - LEVEL_BASE) / LEVEL_STEP) + 1));
};
/** 当前等级内的进度 0..1（满级恒 1），用于进度条。每级宽度固定 300 分。 */
export const levelProgress = (rating: number) => {
  const lv = levelOf(rating);
  if (lv >= LEVEL_MAX) return 1;
  const span = levelFloor(lv + 1) - levelFloor(lv);
  return Math.max(0, Math.min(1, (rating - levelFloor(lv)) / span));
};
/** 该级的跨度（固定 300 分）：UI 说明与进度条共用，避免页面各写一份。 */
export const levelSpanOf = (level: number) => levelFloor(Math.floor(level) + 1) - levelFloor(Math.floor(level));

/** ── 起始档位（2026-10-12 用户定稿：五档 **1 / 3 / 6 / 9 / 12 级**）────────────
 *  「要不还是搞成，1级，3级，6级，9级，12级吧，就是五个档位，
 *    每个档位要的棋魂都不一样，越高越多，1 级最少。」
 *
 *  分数直接用 `levelFloor` 推（改台阶这里跟着走，不再写死分数）。
 *  档位的**定价**在 `soul-unlocks.ts` 的 `SOUL_PRICE_RULES.startLevelCost`（同一处唯一定价）。 */
export const START_RATINGS = {
  lv1: levelFloor(1),
  lv3: levelFloor(3),
  lv6: levelFloor(6),
  lv9: levelFloor(9),
  lv12: levelFloor(12),
} as const;
export type StartLevel = keyof typeof START_RATINGS;
/** 各档位对应的等级（1/3/6/9/12）。 */
export const START_LEVEL_LV: Record<StartLevel, number> = { lv1: 1, lv3: 3, lv6: 6, lv9: 9, lv12: 12 };
export const START_LEVELS = Object.keys(START_RATINGS) as StartLevel[];

/** 单次**加分式子**的上限（用户 2026-10-14：「单次最高不用锁死在 44 了……上限提高到最高加 150 分，
 *  最低加 1 分，再高也限制在 150 分」，随后补明「这些是基础倍率，默认模式下还是会 ×2 的，
 *  比如 150×2 等于 300」。
 *  ⚠ 所以 150 夹在**乘计时难度倍数之前**：默认档（×2）实际最高 +300、充裕 +150、休闲 +75。
 *  旧的"44"是 22 × 2 那个**乘完**的数，与这一层的 150 不是同一回事，别混。 */
export const GAIN_MAX = 150;
/** 单次**扣分**最狠的一档（同一轮：「低一级是扣 13 分，扣分定式就是 10+3n，最高扣 100 分，最低扣 1 分」）。 */
export const LOSS_MAX = 100;
/** 加减法的最小幅度都是 1 分：乘完 0.5 倍也不会出现"赢了不加一分"或"输了扣 0 分还显示结算"。 */
const DELTA_MIN = 1;

/** 等级差 → 加分（用户 2026-10-06 定稿的表，2026-10-14 把上端放开成式子）。
 *  gap = 题目等级（手数）− 解答力等级（分段阶梯的 levelOf；解答力先封顶到 MAX_MATCH_RATING）。
 *  gap ≥ 0 走 **10 + 4n**：同级 +10、高一级 +14、高两级 +18、高三级 +22（**到这里都与旧表一模一样**，
 *  旧表在 +3 处顶死在 22，现在继续往上：高 10 级 +50、高 35 级 +150）；
 *  gap < 0 保留旧表那三条"做比自己低的题加得少"的地板：−1 → +7、−2 → +4、≤−3 → +2。 */
const gainForGap = (gap: number): number => {
  if (gap >= 0) return 10 + 4 * gap;
  if (gap === -1) return 7;
  if (gap === -2) return 4;
  return 2;                                 // 做比自己低 3 级以上的题：+2
};

/** 等级差 → 扣分（与加分表同一套 gap）。**扣分不乘难度倍数**；扣分下限为 0——
 *  输棋绝不反向加分，等级分下限 **0**（0 分再输扣分无效）。
 *  gap ≥ +2 → −4；+1 → −7；0 → −10（这三条与旧表一致）；
 *  gap < 0 走 **10 + 3n**：低一级 −13、低两级 −16（旧表这两条本来就是式子的值），
 *  旧表在 −3 处顶死在 −18，现在继续往上扣，**低 30 级起顶格在 −100**。 */
const lossForGap = (gap: number): number => {
  if (gap >= 2) return -4;
  if (gap === 1) return -7;
  if (gap === 0) return -10;
  return -Math.min(LOSS_MAX, 10 + 3 * -gap);
};

/** 一次胜利加多少分：**式子 → 夹 1–150 → 乘计时难度倍数 → 至少 +1**。
 *  `applyResult` 与界面说明面板走的是这**同一个函数**（抄一份数字就会漂）。 */
export const gainPreview = (gap: number, paceGain = 1): number =>
  Math.max(DELTA_MIN, Math.floor(Math.min(GAIN_MAX, gainForGap(gap)) * paceGain));
/** 一次失败扣多少分（不乘倍数；`lossForGap` 内部已夹到 −100）。 */
export const lossPreview = (gap: number): number => lossForGap(gap);

/** 单场结算更新。不再用期望分 10^(分差/400)，改查**等级差表**（见 gainForGap/lossForGap）：
 *  加分是**式子先夹 1–150、再乘难度倍数**（默认档顶格 = 150×2 = 300）；扣分不乘、夹在 1–100；
 *  同等级题默认档 → 赢 +20、输 −10（这两条与改版前一致）。
 *  ⚠ 第二个参数必须是**等级分那把尺上的题目分**（= `levelFloor(该题手数)`，`withResult` 就是这么传的）。
 *    传 `problemRating(depth)` 那条题分曲线会让 `levelOf(problemR)` 读出错的级数（改版后两套尺度脱钩）。
 *  等级分限制在 **[0, MAX_RATING 9999]**（下限 2026-10-12 从 1000 改成 0：用户
 *  「初始等级分为 0，等级分也不会小于 0，在 0 还扣的话，扣分无效」）。
 *  上限只"拦上涨"，不把已在上限之上的人往下拽（老存档里可能停在旧上限之上）。 */
export const applyResult = (rating: number, problemR: number, win: boolean, paceGain = 1) => {
  const eff = Math.min(rating, MAX_MATCH_RATING);
  // Player ratings are capped at 9999 (level 34), while the challenge's
  // adjacent 35-hand puzzle is represented by its natural floor (10200).
  // Do not run that question floor through `levelOf`, which intentionally
  // clamps player ratings to LEVEL_MAX and would silently score 35 hands as
  // level 34.
  const problemLevel = problemR > MAX_RATING
    ? Math.max(1, Math.floor((problemR - LEVEL_BASE) / LEVEL_STEP) + 1)
    : levelOf(problemR);
  const gap = problemLevel - levelOf(eff);
  /** 加减分都走上面那两个函数——界面说明面板调的也是它们，所以"说明里写的数"与
   *  "结算实际给的数"不可能各说一套（`GAIN_MAX` 是**基础倍率那一层**的顶：150，
   *  默认档 ×2 ⇒ 单次最高 300；扣分不乘倍数、最多 −100）。 */
  const raw = win ? gainPreview(gap, paceGain) : lossPreview(gap);
  const next = Math.min(Math.max(LEVEL_BASE, rating + raw), Math.max(MAX_RATING, rating));
  return { rating: next, delta: next - rating };
};

/** 这道题相对**你现在的等级**是"同级 / 高 N 级 / 低 N 级"。
 *  用的是与结算**同一条** gap 式子（`applyResult`：题目等级＝手数、解答力先夹到 MAX_MATCH_RATING），
 *  所以状态行上写的和最后加减分的依据不会各说一套。
 *  用户 2026-10-12：状态行原来写「N 手 · ≈X 分」，那个 X 来自旧题分曲线、与等级分不同尺度
 *  （看着像"这题比我高 500 分"，其实是同级）⇒ 换成这个相对说法，比"6 手 · 6 级"也有信息量。 */
export const levelGapLabel = (depth: number, rating: number): string => {
  const gap = levelOfHands(depth) - levelOf(Math.min(rating, MAX_MATCH_RATING));
  return gap === 0 ? "同级" : gap > 0 ? `高 ${gap} 级` : `低 ${-gap} 级`;
};

/** 起始档位的显示名（等级现算，改阶梯不会再留下写死的过时标签）。
 *  2026-10-12 五档定稿后，档位名直接用**等级**说（「1 级 / 3 级 …」），
 *  不再借"九手档/十三手档"那套（那套的手数语义仍在，但不是档位名了）。 */
export const startLevelLabel = (lv: StartLevel): string => {
  const r = START_RATINGS[lv];
  return `等级 ${START_LEVEL_LV[lv]}（${r} 分）`;
};

/** 该档位会遇到的题手数区间（用于设置里的档位说明）。
 *  ⚠ 等级制改版后是**三级匹配**（本级 80% + 上下各 10%），所以区间就是 [本级手数−1, +1]，
 *    边界（1 级）下限仍是 1 手、满级相邻题上限 35 手。 */
export const startLevelHandRange = (lv: StartLevel): string => {
  const hand = START_LEVEL_LV[lv];
  const lo = Math.max(1, hand - 1);
  const hi = Math.min(CHALLENGE_MAX_DEPTH, hand + 1);
  return lo === hi ? `${lo} 手` : `${lo}–${hi} 手`;
};

const todayKey = () => localDateKey();

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const ids = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(-SEEN_LIMIT) : [];

const historyEntry = (value: unknown): VcfHistoryEntry | null => {
  const raw = record(value);
  if (!finite(raw.ts) || raw.ts < 0 || !finite(raw.depth) || raw.depth < 1 || typeof raw.win !== "boolean"
    || (raw.tier !== "short" && raw.tier !== "middle" && raw.tier !== "deep")) return null;
  return {
    ts: raw.ts, depth: Math.floor(raw.depth), tier: raw.tier, win: raw.win,
    moves: count(raw.moves), delta: finite(raw.delta) ? raw.delta : 0,
    seconds: finite(raw.seconds) && raw.seconds >= 0 ? raw.seconds : 0,
    ...(typeof raw.id === "string" ? { id: raw.id } : {}),
    ...(raw.attacker === "black" || raw.attacker === "white" ? { attacker: raw.attacker } : {}),
    ...(typeof raw.stones === "string" ? { stones: raw.stones } : {}),
    ...(typeof raw.sol === "string" ? { sol: raw.sol } : {}),
  };
};

export const loadState = (): VcfChallengeState => {
  const base: VcfChallengeState = {
    rating: START_RATINGS.lv1, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0,
    daily: {}, history: [], settings: { ...DEFAULT_SETTINGS },
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = record(JSON.parse(raw));
    const streak = count(parsed.streak);
    return {
      rating: finite(parsed.rating) && parsed.rating >= LEVEL_BASE ? parsed.rating : base.rating,
      solved: count(parsed.solved), failed: count(parsed.failed), streak,
      bestStreak: Math.max(streak, count(parsed.bestStreak)),
      daily: Object.fromEntries(Object.entries(record(parsed.daily))
        .filter(([day, value]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Object.keys(record(value)).length > 0)
        .map(([day, value]) => { const entry = record(value); return [day, { solved: count(entry.solved), failed: count(entry.failed) }]; })),
      solvedIds: ids(parsed.solvedIds),
      seenIds: ids(parsed.seenIds),
      history: Array.isArray(parsed.history) ? parsed.history.map(historyEntry)
        .filter((entry): entry is VcfHistoryEntry => entry !== null).slice(0, HISTORY_LIMIT) : [],
      settings: migrateSettings(record(parsed.settings)),
    };
  } catch {
    return base;
  }
};

export const saveState = (state: VcfChallengeState) => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 存储满等：挑战进度丢失可接受 */ }
};

/** 做题记录上限（每页 10 题，最多 20 页）。 */
export const HISTORY_LIMIT = 200;
export const HISTORY_PAGE_SIZE = 10;
/** 已出过的题记忆上限（足够覆盖各段题目一轮以上）。 */
export const SEEN_LIMIT = 4000;

export interface ResultProblem {
  id: string;
  tier: VcfTier;
  depth: number;
  attacker: Player;
  /** 初始局面（用于记录里的预览） */
  stones: string;
  /** 攻方参考解答（坐标名连写） */
  sol: string;
}

/** 标记"这道题已经出过"（出题那一刻记，做没做出来都算，避免短期重复）。 */
export const markSeen = (state: VcfChallengeState, id: string): VcfChallengeState =>
  state.seenIds.includes(id) ? state : { ...state, seenIds: [...state.seenIds, id].slice(-SEEN_LIMIT) };

/** 一题结算：按等级差表更新（加分乘计时难度倍数、扣分不乘）+ 连胜/日统计/历史/已解集合/已出集合。 */
export const withResult = (state: VcfChallengeState, problem: ResultProblem, win: boolean, moves: number, seconds = 0, paceGain = 1): VcfChallengeState => {
  // 题目在结算里的"分"＝**该手数那一级的入门分**，与玩家等级分同一把尺（见上面
  // `MAX_MATCH_RATING` 那段：等级制改版后题分曲线 `problemRating` 只用于显示与统计，
  // 再拿它当结算输入会把题目整体算高 1~3 级 —— 用户 10-12 报的"同级题也加三十多、四十多"就是它）。
  const pr = levelFloor(levelOfHands(problem.depth));
  const { rating, delta } = applyResult(state.rating, pr, win, paceGain);
  const day = todayKey();
  const daily = { ...state.daily, [day]: {
    solved: (state.daily[day]?.solved ?? 0) + (win ? 1 : 0),
    failed: (state.daily[day]?.failed ?? 0) + (win ? 0 : 1),
  } };
  const streak = win ? state.streak + 1 : 0;
  const entry: VcfHistoryEntry = {
    ts: Date.now(), tier: problem.tier, depth: problem.depth, win, moves, delta, seconds,
    id: problem.id, attacker: problem.attacker, stones: problem.stones, sol: problem.sol,
  };
  return {
    ...state,
    rating,
    solved: state.solved + (win ? 1 : 0),
    failed: state.failed + (win ? 0 : 1),
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    daily,
    history: [entry, ...state.history].slice(0, HISTORY_LIMIT),
    solvedIds: win ? [...state.solvedIds, problem.id].slice(-4000) : state.solvedIds,
    seenIds: state.seenIds.includes(problem.id) ? state.seenIds : [...state.seenIds, problem.id].slice(-SEEN_LIMIT),
  };
};

/** 只改设置。 */
export const withSettings = (state: VcfChallengeState, patch: Partial<VcfSettings>): VcfChallengeState =>
  ({ ...state, settings: { ...state.settings, ...patch } });

/** 把等级分重置到指定起始档（可同时清空进度）。设置不受影响。 */
export const resetToStartLevel = (state: VcfChallengeState, level: StartLevel, clearProgress: boolean): VcfChallengeState => {
  if (!clearProgress) return { ...state, rating: START_RATINGS[level] };
  return {
    rating: START_RATINGS[level], solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0,
    daily: {}, history: [], settings: state.settings,
  };
};
