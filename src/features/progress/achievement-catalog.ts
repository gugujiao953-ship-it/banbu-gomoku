/**
 * 成就目录（用户 2026-10-09：「成就系统这个可以，你可以多搞一点」）。
 *
 * 这份文件是**成就的唯一来源**——判定引擎（`achievements.ts`）、解锁弹窗
 * （`ProgressReward.tsx`）、成就面板（`AchievementsPanel.tsx`）三处都读它，
 * 和 `theme-options.ts` 之于主题是同一个道理（历史教训：5 个门禁各写一份 7 项主题列表）。
 *
 * ## 一条成就 = 文案 + 奖励 + 判据（2026-10-10 数据化）
 *
 * 上一版判据写死在 `achievements.ts` 的 `switch (id)` 里，导致「成就工坊」网页
 * 删掉的条目在判定层还留着（删不掉）、新增的条目又没人写判据（加不上）。
 * 现在判据就是每条上的 `rule` 字段（形状见 `achievement-rules.ts`），
 * **增删成就只需要改这个文件**；`scripts/apply-achievement-catalog.mjs`
 * 可以把工坊导出的 JSON 直接写回这里。
 *
 * ## 设计口径（与用户 09-19 那次删除打卡的关系）
 *
 * 用户删掉过「打卡 + 错题间隔排期」，原话是「有点鸡肋，感觉花哨了」。所以这里**不做**：
 *   · 不做每日签到、连续天数、登录奖励——那是"催你天天来"，不是"记你做过什么"；
 *   · 不做只有数字没有场景的成就（比如"累计点击 1000 次"）。
 *
 * 保留的每一条都满足两个条件之一：
 *   ① **一次性真实事件**（赢下大师档、第一次识谱成功、集齐 26 开局）——发生了就是发生了；
 *   ② **有意义的累积里程碑**（攻克 100 题、复盘 50 局）——对应真实的练习量。
 *
 * ## 分组
 *
 * 五个分组与产品的五条主线一一对应（对弈 / 做题 / 研究 / 识谱 / 探索），
 * 这样面板上的分组本身就回答了「这个软件能干什么」。
 *
 * ## 隐藏成就
 *
 * `secret: true` 的成就在解锁前**只显示占位**（灰色问号 + 分组里的"隐藏成就"计数），
 * 面板上不剧透条件。这是成就系统的乐趣来源之一，也避免了"照着清单刷"。
 */

import type { AchievementRule } from "./achievement-rules";
// ⚠ 这是**值**导入（不是 type）：`puzzle-vcf-level-max` 的阈值就是它。
// 从 rating.ts 引而不是抄一个数字 —— 抄了就会在 LEVEL_STEP 被改的那天变成
// "一条永远解不开的成就"（第一版硬编码 26、真值 25，就是这样）。
import { LEVEL_MAX } from "../vcf-challenge/rating";
// 同理：`explore-theme-all` 的套数必须是主题清单自己的长度，
// 不能写死（上一版写死 22，主题涨到 23 之后文案与判据就都错了）。
import { THEME_OPTIONS } from "../../theme-options";

/**
 * 成就的**级别**（用户 2026-10-10：「还有很多也是分级的，这些等级对应不同等级，
 * 不同层次设计的成就弹窗，有些过了四个层次也最多第四个等级」）。
 *
 * 四级封顶：再往上的成就也归第 4 级（用户原话「有些过了四个层次也最多第四个等级」）——
 * 所以它是"**至少**要到第几档"的意思，不是"恰好第几档"。
 *
 * 级别决定两件事（都在前端，不影响判定）：
 *  · **解锁弹窗的排场**（1 级小而快、4 级大而有仪式感，见 `ProgressReward.tsx`）；
 *  · **奖励的量级**（同级别的成就奖励落在同一档，便于用户建立"这个格子值多少"的直觉）。
 *
 * 未填 = 按 `soul` 自动推断（见 `tierOf`）。所以新增成就时**可以不管它**，
 * 想让某条特别一点再显式写。这条设计是为了避免"每加一条都要手填级别"的摩擦。
 */
export type AchievementTier = 1 | 2 | 3 | 4;

/** 分级阈值：按奖励棋魂数推断级别。写在这里而不是散在渲染层，
 *  是因为面板、弹窗、门禁三处都要用同一套口径。 */
export const TIER_SOUL_BOUNDS: ReadonlyArray<{ tier: AchievementTier; min: number }> = [
  { tier: 4, min: 200 },
  { tier: 3, min: 80 },
  { tier: 2, min: 40 },
  { tier: 1, min: 0 },
];

/** 一条成就该按第几级展示（显式 `tier` 优先，否则按奖励推断、封顶 4 级）。 */
export const tierOf = (definition: AchievementDefinition): AchievementTier => {
  if (definition.tier) return definition.tier;
  for (const band of TIER_SOUL_BOUNDS) {
    if (definition.soul >= band.min) return band.tier;
  }
  return 1;
};

/** 级别的展示信息（弹窗与面板共用，避免两处各写一套文案）。 */
export const ACHIEVEMENT_TIER_META: Record<AchievementTier, { label: string; hint: string }> = {
  1: { label: "初见", hint: "踏出第一步" },
  2: { label: "小成", hint: "已经上路了" },
  3: { label: "精进", hint: "认真练过一阵" },
  4: { label: "登峰", hint: "少见的高度" },
};

export type AchievementGroup = "duel" | "puzzle" | "study" | "recognition" | "explore" | "soul";

export interface AchievementGroupMeta {
  id: AchievementGroup;
  title: string;
  /** 面板分组标题下的一句话 */
  summary: string;
}

/** 分组顺序 = 面板上的显示顺序。顺序按「从玩到研究」排，和底部导航的心智一致。 */
export const ACHIEVEMENT_GROUPS: readonly AchievementGroupMeta[] = [
  { id: "duel", title: "对弈", summary: "和 AI 下棋、等级分与棋钟" },
  { id: "puzzle", title: "做题", summary: "题库、错题、VCF 挑战" },
  { id: "study", title: "研究", summary: "打谱、复盘、变化树与开局" },
  { id: "recognition", title: "识谱", summary: "图片识谱与手序复原" },
  { id: "explore", title: "探索", summary: "把软件本身用起来" },
  { id: "soul", title: "棋魂", summary: "点魂火、攒棋魂、买解锁（2026-10-10 新增）" },
] as const;

/** 奖励的棋魂数量（`soul`）。口径见 `soul.ts`：
 *  少 → 常见成就；多 → 难成就或隐藏成就。整体保持"解锁一件事就能解锁一样东西"的量级。 */
export interface AchievementDefinition {
  id: string;
  group: AchievementGroup;
  title: string;
  /** 解锁前也能看的说明（隐藏成就除外——那时面板不渲染这条）。 */
  text: string;
  /** 见 `ACHIEVEMENT_CATALOG` 校验：全局唯一，且一旦发布不能改（存档里按 id 记） */
  soul: number;
  /**
   * **判据**（2026-10-10 数据化）。写法见 `achievement-rules.ts`：
   * `{ from: "duel.wins", op: "gte", value: 10 }`。
   *
   * 唯一不填的是「集齐全图鉴」——它要断言"除自己以外全部达成"，
   * 那种自引用表达成普通规则会死循环，所以在引擎里按 `id` 特判（见 `achievements.ts`）。
   */
  rule?: AchievementRule;
  /** 隐藏成就：解锁前只显示占位，不剧透条件 */
  secret?: boolean;
  /** 目标进度（用于面板上的进度条）。不填 = 一次性事件，没有进度可显示。 */
  target?: number;
  /** 进度单位，例如「题」「局」。有 target 时必填。 */
  unit?: string;
  /** 级别（1–4，见 `AchievementTier`）。不填按 `soul` 自动推断。 */
  tier?: AchievementTier;
}

/**
 * 成就总表。**id 是存档键，发布后不可改名**（改了等于把用户已解锁的成就抹掉）。
 *
 * 每条都从**已有账本**里读，不新增埋点、不新增统计（来源见 `achievements.ts`
 * 的 `AchievementSources` 注释与 `achievement-rules.ts` 的 `SourceKey` 清单）。
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  // ── 对弈 ───────────────────────────────────────────
  { id: "duel-first-game", group: "duel", title: "初次交手", text: "完成第一局人机对战", soul: 10,
    rule: { from: "duel.games", op: "gte", value: 1 } },
  { id: "duel-first-win", group: "duel", title: "首胜", text: "第一次战胜 AI", soul: 50,
    rule: { from: "duel.wins", op: "gte", value: 1 } },
  { id: "duel-win-10", group: "duel", title: "十胜", text: "累计战胜 AI 十局", soul: 100, target: 10, unit: "局",
    rule: { from: "duel.wins", op: "gte", value: 10 } },
  { id: "duel-win-50", group: "duel", title: "五十胜", text: "累计战胜 AI 五十局", soul: 200, target: 50, unit: "局",
    rule: { from: "duel.wins", op: "gte", value: 50 } },
  { id: "duel-win-100", group: "duel", title: "百胜", text: "累计战胜 AI 一百局", soul: 500, target: 100, unit: "局",
    rule: { from: "duel.wins", op: "gte", value: 100 } },
  { id: "duel-games-50", group: "duel", title: "常客", text: "完成五十局人机对战（不管输赢）", soul: 200, target: 50, unit: "局",
    rule: { from: "duel.games", op: "gte", value: 50 } },
  { id: "duel-beat-master", group: "duel", title: "撼动大师", text: "战胜一次「大师」档 AI", soul: 100,
    rule: { from: "duel.wonMaster", op: "truthy" } },
  { id: "duel-beat-master-3", group: "duel", title: "大师克星", text: "对「大师」档 AI 取得三连胜", soul: 180, target: 3, unit: "连胜",
    rule: { from: "duel.masterStreak", op: "gte", value: 3 } },
  { id: "duel-never-forfeit", group: "duel", title: "完整对局", text: "不用认输，把一局下完到分出胜负", soul: 20,
    rule: { from: "duel.completedWithoutResign", op: "truthy" } },
  { id: "duel-fast-win", group: "duel", title: "速战速决", text: "在 20 手之内取胜", soul: 100,
    rule: { from: "duel.fastestWinMoves", op: "lte", value: 20 } },
  { id: "duel-forbidden-loss", group: "duel", title: "禁手教训", text: "因禁手被判负一次（知道了就记住了）", soul: 10,
    rule: { from: "duel.lostByForbidden", op: "truthy" } },
  { id: "duel-forbidden-win", group: "duel", title: "禁手反弹", text: "在因禁手输过之后，再赢下一局", soul: 50,
    rule: { from: "duel.wonAfterForbidden", op: "truthy" } },
  { id: "duel-clock-game", group: "duel", title: "比赛计时器", text: "使用「比赛计时器」", soul: 30,
    rule: { from: "duel.usedClock", op: "truthy" } },
  { id: "duel-rating-1500", group: "duel", title: "登堂", text: "等级分达到 1500", soul: 100,
    rule: { from: "duel.rating", op: "gte", value: 1500 } },
  { id: "duel-rating-2000", group: "duel", title: "入室", text: "等级分达到 2000", soul: 300,
    rule: { from: "duel.rating", op: "gte", value: 2000 } },
  { id: "duel-rating-3000", group: "duel", title: "一方高手", text: "等级分达到 3000", soul: 500,
    rule: { from: "duel.rating", op: "gte", value: 3000 } },
  { id: "duel-streak-5", group: "duel", title: "五连胜", text: "对人机对战取得五连胜", soul: 100, target: 5, unit: "连胜",
    rule: { from: "duel.streak", op: "gte", value: 5 } },
  { id: "duel-streak-10", group: "duel", title: "十连胜", text: "对人机对战取得十连胜", soul: 220, target: 10, unit: "连胜",
    rule: { from: "duel.streak", op: "gte", value: 10 } },
  { id: "duel-both-colors", group: "duel", title: "黑白皆可胜你", text: "执黑与执白各赢过一局", soul: 50,
    rule: { from: "duel.wonAsWhite", op: "gte", value: 1 } },
  { id: "duel-white-10", group: "duel", title: "执白十胜", text: "执白取胜十局（后手方本来就更难）", soul: 130, target: 10, unit: "局",
    rule: { from: "duel.wonAsWhite", op: "gte", value: 10 } },
  { id: "duel-draw", group: "duel", title: "势均力敌", text: "和 AI 下出一局和棋", soul: 100,
    rule: { from: "duel.draws", op: "gte", value: 1 } },
  { id: "duel-marathon", group: "duel", title: "持久战", text: "下完一局 100 手以上的对局", soul: 100,
    rule: { from: "duel.longestGame", op: "gte", value: 100 } },
  // ── 做题 ───────────────────────────────────────────
  { id: "puzzle-first-solve", group: "puzzle", title: "第一题", text: "攻克第一道题", soul: 10,
    rule: { from: "puzzle.solved", op: "gte", value: 1 } },
  { id: "puzzle-solve-10", group: "puzzle", title: "十题", text: "累计攻克十道题", soul: 50, target: 10, unit: "题",
    rule: { from: "puzzle.solved", op: "gte", value: 10 } },
  { id: "puzzle-solve-50", group: "puzzle", title: "五十题", text: "累计攻克五十道题", soul: 100, target: 50, unit: "题",
    rule: { from: "puzzle.solved", op: "gte", value: 50 } },
  { id: "puzzle-solve-100", group: "puzzle", title: "百题", text: "累计攻克一百道题", soul: 200, target: 100, unit: "题",
    rule: { from: "puzzle.solved", op: "gte", value: 100 } },
  { id: "puzzle-solve-500", group: "puzzle", title: "五百题", text: "累计攻克五百道题", soul: 500, target: 500, unit: "题",
    rule: { from: "puzzle.solved", op: "gte", value: 500 } },
  { id: "puzzle-solve-1000", group: "puzzle", title: "千题杀", text: "累计攻克一千道题", soul: 2000, target: 1000, unit: "题",
    rule: { from: "puzzle.solved", op: "gte", value: 1000 } },
  { id: "puzzle-attempts-200", group: "puzzle", title: "勤能补拙", text: "累计尝试做题两百次（含没做出来的）", soul: 200, target: 200, unit: "次",
    rule: { from: "puzzle.attempts", op: "gte", value: 200 } },
  { id: "puzzle-daily-done", group: "puzzle", title: "今日一题", text: "完成一次「每日一题」", soul: 50,
    rule: { from: "puzzle.dailyDone", op: "gte", value: 1 } },
  { id: "puzzle-daily-7", group: "puzzle", title: "七日七题", text: "累计完成七次「每日一题」（不要求连续）", soul: 200, target: 7, unit: "次",
    rule: { from: "puzzle.dailyDone", op: "gte", value: 7 } },
  { id: "puzzle-daily-30", group: "puzzle", title: "天天练", text: "累计完成三十次「每日一题」（不要求连续）", soul: 500, target: 30, unit: "次",
    rule: { from: "puzzle.dailyDone", op: "gte", value: 30 } },
  { id: "puzzle-wrongbook-10", group: "puzzle", title: "错题本", text: "错题本里同时躺着十道题", soul: 40, target: 10, unit: "题",
    rule: { from: "puzzle.wrongCount", op: "gte", value: 10 } },
  { id: "puzzle-wrong-cleared", group: "puzzle", title: "士别三日", text: "把一道错题重新做对（从错题本里移除）", soul: 30,
    rule: { from: "puzzle.clearedWrong", op: "truthy" } },
  { id: "puzzle-vcf-first", group: "puzzle", title: "第一次冲四", text: "在 VCF 挑战里解出第一题", soul: 20,
    rule: { from: "vcf.solved", op: "gte", value: 1 } },
  { id: "puzzle-vcf-50", group: "puzzle", title: "五十道冲四", text: "VCF 挑战累计解出五十题", soul: 200, target: 50, unit: "题",
    rule: { from: "vcf.solved", op: "gte", value: 50 } },
  { id: "puzzle-vcf-streak-5", group: "puzzle", title: "连解5题", text: "VCF 挑战五连胜", soul: 80, target: 5, unit: "连胜",
    rule: { from: "vcf.bestStreak", op: "gte", value: 5 } },
  { id: "puzzle-vcf-streak-10", group: "puzzle", title: "连解十题", text: "VCF 挑战十连胜", soul: 200, target: 10, unit: "连胜",
    rule: { from: "vcf.bestStreak", op: "gte", value: 10 } },
  { id: "puzzle-vcf-deep", group: "puzzle", title: "深水区", text: "解出一道 20 手以上的 VCF 挑战题", soul: 200,
    rule: { from: "signals.vcfDeepSolved", op: "truthy" } },
  { id: "puzzle-vcf-today-10", group: "puzzle", title: "今日猛攻", text: "一天之内解出十道 VCF 挑战题", soul: 120,
    rule: { from: "vcf.todaySolved", op: "gte", value: 10 } },
  { id: "puzzle-vcf-rating-3000", group: "puzzle", title: "解答力三千", text: "VCF 挑战等级分达到 3000", soul: 300,
    rule: { from: "vcf.rating", op: "gte", value: 3000 } },
  { id: "puzzle-vcf-rating-5000", group: "puzzle", title: "解答力五千", text: "VCF 挑战等级分达到 5000", soul: 500,
    rule: { from: "vcf.rating", op: "gte", value: 5000 } },
  { id: "puzzle-generator-first", group: "puzzle", title: "自己的题", text: "用「棋题生成器」造出第一道题", soul: 30,
    rule: { from: "generator.count", op: "gte", value: 1 } },
  { id: "puzzle-generator-10", group: "puzzle", title: "出题人", text: "用生成器累计造出十道题", soul: 100, target: 10, unit: "题",
    rule: { from: "generator.count", op: "gte", value: 10 } },
  { id: "puzzle-generator-shape", group: "puzzle", title: "画个图形", text: "生成一道图案题", soul: 45,
    rule: { from: "generator.hasShape", op: "truthy" } },
  { id: "puzzle-generator-text", group: "puzzle", title: "字里有棋", text: "生成一道文字题", soul: 45,
    rule: { from: "generator.hasText", op: "truthy" } },
  { id: "puzzle-generator-deep", group: "puzzle", title: "深水造题", text: "生成一道 30 手以上的题", soul: 150,
    rule: { from: "generator.maxDepth", op: "gte", value: 30 } },
  { id: "puzzle-vcf-play-1", group: "puzzle", title: "耍一把", text: "在 VCF 挑战里下第一盘（输赢都算）", soul: 12,
    rule: { from: "vcf.attempts", op: "gte", value: 1 } },
  { id: "puzzle-vcf-play-10", group: "puzzle", title: "挑战十次", text: "VCF 挑战累计下 10 盘（含没做出来的）", soul: 30, target: 10, unit: "盘",
    rule: { from: "vcf.attempts", op: "gte", value: 10 } },
  { id: "puzzle-vcf-play-100", group: "puzzle", title: "百战", text: "VCF 挑战累计下 100 盘", soul: 90, target: 100, unit: "盘",
    rule: { from: "vcf.attempts", op: "gte", value: 100 } },
  { id: "puzzle-vcf-play-1000", group: "puzzle", title: "历战千题", text: "VCF 挑战累计下 1000 盘", soul: 500, target: 1000, unit: "盘",
    rule: { from: "vcf.attempts", op: "gte", value: 1000 } },
  { id: "puzzle-vcf-play-5000", group: "puzzle", title: "挑战狂人", text: "VCF 挑战累计下 5000 盘（把一个玩法玩到底）", soul: 1000, target: 5000, unit: "盘",
    rule: { from: "vcf.attempts", op: "gte", value: 5000 } },
  { id: "puzzle-vcf-level-5", group: "puzzle", title: "解答力 5 级", text: "VCF 解答力达到等级 5", soul: 100,
    rule: { from: "vcf.level", op: "gte", value: 5 } },
  { id: "puzzle-vcf-level-10", group: "puzzle", title: "解答力 10 级", text: "VCF 解答力达到等级 10", soul: 300,
    rule: { from: "vcf.level", op: "gte", value: 10 } },
  { id: "puzzle-vcf-level-20", group: "puzzle", title: "解答力 20 级", text: "VCF 解答力达到等级 20", soul: 1000,
    rule: { from: "vcf.level", op: "gte", value: 20 } },
  { id: "puzzle-vcf-level-max", group: "puzzle", title: "挑战之巅", text: "VCF 解答力达到最高等级", soul: 9999, secret: true,
    rule: { from: "vcf.level", op: "gte", value: LEVEL_MAX } },
  // ── 研究 ───────────────────────────────────────────
  { id: "study-first-branch", group: "study", title: "开枝散叶", text: "在一份棋谱里创建第一个变化分支", soul: 15,
    rule: { from: "study.branches", op: "gte", value: 1 } },
  { id: "study-branch-100", group: "study", title: "树人", text: "累计创建一百个变化分支", soul: 100, target: 100, unit: "个",
    rule: { from: "study.branches", op: "gte", value: 100 } },
  { id: "study-first-review", group: "study", title: "复盘一次", text: "跑完一局「整局复盘」", soul: 25,
    rule: { from: "review.count", op: "gte", value: 1 } },
  { id: "study-review-50", group: "study", title: "复盘者", text: "累计复盘五十局", soul: 150, target: 50, unit: "局",
    rule: { from: "review.count", op: "gte", value: 50 } },
  { id: "study-cross-search", group: "study", title: "跨谱寻踪", text: "用「跨谱局面检索」找到别处的同一局面", soul: 40,
    rule: { from: "study.usedCrossSearch", op: "truthy" } },
  { id: "study-export", group: "study", title: "成果分享", text: "导出一次棋谱或分享图片", soul: 50,
    rule: { from: "signals.didExport", op: "truthy" } },
  { id: "study-bookmark-10", group: "study", title: "标记重点", text: "累计添加十个分支书签", soul: 55, target: 10, unit: "个",
    rule: { from: "library.bookmarks", op: "gte", value: 10 } },
  // ── 识谱 ───────────────────────────────────────────
  { id: "recognition-first", group: "recognition", title: "从照片到棋谱", text: "第一次成功导入一张棋盘图片", soul: 25,
    rule: { from: "recognition.count", op: "gte", value: 1 } },
  { id: "recognition-10", group: "recognition", title: "识图十谱", text: "累计成功识谱十张图", soul: 70, target: 10, unit: "张",
    rule: { from: "recognition.count", op: "gte", value: 10 } },
  { id: "recognition-50", group: "recognition", title: "五十图识谱", text: "累计成功识谱五十张图", soul: 240, target: 50, unit: "张",
    rule: { from: "recognition.count", op: "gte", value: 50 } },
  { id: "recognition-move-order", group: "recognition", title: "完美还原", text: "成功复原一次完整手序", soul: 90,
    rule: { from: "recognition.restoredOrder", op: "truthy" } },
  { id: "recognition-big-board", group: "recognition", title: "满盘识别", text: "识别一张五十手以上的棋谱图", soul: 120,
    rule: { from: "recognition.maxMoves", op: "gte", value: 50 } },
  // ── 探索 ───────────────────────────────────────────
  { id: "explore-library-10", group: "explore", title: "攒起来了", text: "棋谱库里存够十份棋谱", soul: 30, target: 10, unit: "份",
    rule: { from: "library.documents", op: "gte", value: 10 } },
  { id: "explore-library-50", group: "explore", title: "小有藏书", text: "棋谱库里存够五十份棋谱", soul: 120, target: 50, unit: "份",
    rule: { from: "library.documents", op: "gte", value: 50 } },
  { id: "explore-favorite-10", group: "explore", title: "深入研究", text: "收藏够十份棋谱或题集", soul: 60, target: 10, unit: "份",
    rule: { from: "library.favorites", op: "gte", value: 10 } },
  { id: "explore-openings-26", group: "explore", title: "二十六开局", text: "在棋谱库里集齐 26 种连珠开局各至少一份", soul: 200, target: 26, unit: "种",
    rule: { from: "openingKinds", op: "gte", value: 26 } },
  { id: "explore-theme-10", group: "explore", title: "换装", text: "累计使用过十种外观主题", soul: 60, target: 10, unit: "种",
    rule: { from: "signals.themeCount", op: "gte", value: 10 } },
  { id: "explore-theme-all", group: "explore", title: "服装店", text: "把全部外观主题都用过一遍", soul: 260, target: THEME_OPTIONS.length, unit: "种", secret: true,
    rule: { from: "signals.themeCount", op: "gte", value: THEME_OPTIONS.length } },
  { id: "explore-backup", group: "explore", title: "有备无患", text: "完整备份过一次资料", soul: 30,
    rule: { from: "signals.didBackup", op: "truthy" } },
  { id: "explore-manual", group: "explore", title: "说明引导", text: "打开使用手册看过任意一章", soul: 10,
    rule: { from: "signals.readManual", op: "truthy" } },
  { id: "explore-shortcut", group: "explore", title: "动手改布局", text: "自定义过底部工具栏的布局", soul: 30,
    rule: { from: "signals.customizedLayout", op: "truthy" } },
  { id: "explore-all-truth", group: "explore", title: "集齐全图鉴", text: "解锁除本条以外的全部成就", soul: 9999, secret: true },
  // ── 棋魂 ───────────────────────────────────────────
  { id: "soul-welcome-2026", group: "soul", title: "棋魂系统", text: "认识棋魂 —— 打开就有的见面礼，2026 枚棋魂", soul: 2026,
    rule: { from: "always", op: "always", value: undefined } },
  { id: "soul-tap-1", group: "soul", title: "无尽能源", text: "点一次魂火", soul: 10,
    rule: { from: "tap.total", op: "gte", value: 1 } },
  { id: "soul-tap-99", group: "soul", title: "火焰变装", text: "点魂火 99 次", soul: 50, target: 99, unit: "次",
    rule: { from: "tap.total", op: "gte", value: 99 } },
  { id: "soul-tap-299", group: "soul", title: "点点点.....", text: "点魂火 299 次", soul: 200, target: 299, unit: "次",
    rule: { from: "tap.total", op: "gte", value: 299 } },
  { id: "soul-tap-599", group: "soul", title: "屏幕杀手", text: "点魂火 599 次", soul: 400, target: 599, unit: "次",
    rule: { from: "tap.total", op: "gte", value: 599 } },
  { id: "soul-tap-999", group: "soul", title: "一瞬千杀", text: "点魂火 999 次", soul: 800, target: 999, unit: "次",
    rule: { from: "tap.total", op: "gte", value: 999 } },
  { id: "soul-tap-1999", group: "soul", title: "千锤百炼", text: "点魂火 1999 次", soul: 1500, target: 1999, unit: "次",
    rule: { from: "tap.total", op: "gte", value: 1999 } },
  { id: "soul-tap-3999", group: "soul", title: "火中取栗", text: "点魂火 3999 次", soul: 3000, target: 3999, unit: "次",
    rule: { from: "tap.total", op: "gte", value: 3999 } },
  { id: "soul-tap-6999", group: "soul", title: "连点器转世", text: "点魂火 6999 次", soul: 5000, target: 6999, unit: "次",
    rule: { from: "tap.total", op: "gte", value: 6999 } },
  { id: "soul-tap-9999", group: "soul", title: "薪王", text: "点魂火 9999 次（真正的亿点点）", soul: 9999, target: 9999, unit: "次", secret: true,
    rule: { from: "tap.total", op: "gte", value: 9999 } },
  { id: "soul-unlock-first", group: "soul", title: "第一件收藏", text: "用棋魂解锁任意一项（主题 / 棋盘 / 棋子）", soul: 40,
    rule: { from: "signals.unlockedAny", op: "truthy" } },
];

/** id → 定义 的索引（判定与面板共用；目录是常量，建一次即可）。 */
export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, AchievementDefinition> =
  new Map(ACHIEVEMENT_CATALOG.map((item) => [item.id, item]));

/** 每条成就的棋魂总额——用于面板顶部「全部成就可产出多少棋魂」与自检。 */
export const TOTAL_SOUL_FROM_ACHIEVEMENTS = ACHIEVEMENT_CATALOG
  .reduce((sum, item) => sum + item.soul, 0);

/** 某一组里的全部成就（面板按组渲染）。 */
export const achievementsInGroup = (group: AchievementGroup): AchievementDefinition[] =>
  ACHIEVEMENT_CATALOG.filter((item) => item.group === group);

/**
 * 「集齐全图鉴」的 id。它与其余成就不同：判据是"除自己以外全部达成"，
 * 表达成普通 `rule` 会自引用。引擎按这个常量特判，工坊网页也不许删它
 * （删了没人能拦住，但删掉它就少一条终极成就——所以页面上单独标注）。
 */
export const ALL_TRUTH_ACHIEVEMENT_ID = "explore-all-truth";

/**
 * 目录自检：id 唯一、soul 为正整数、有 target 就必须有 unit、**有判据或它就是全图鉴**。
 * 由单测调用（不抛在生产路径上——目录是常量，错了要在 CI 红，不是在用户面前崩）。
 */
export const validateAchievementCatalog = (): string[] => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of ACHIEVEMENT_CATALOG) {
    if (seen.has(item.id)) problems.push(`成就 id 重复：${item.id}`);
    seen.add(item.id);
    if (!Number.isInteger(item.soul) || item.soul <= 0) problems.push(`${item.id} 的棋魂奖励必须是正整数`);
    if (item.target !== undefined && (!Number.isInteger(item.target) || item.target < 2)) {
      problems.push(`${item.id} 的 target 必须是 ≥2 的整数（1 就是一次性事件，别写 target）`);
    }
    if (item.target !== undefined && !item.unit) problems.push(`${item.id} 有 target 就必须有 unit`);
    if (!item.title.trim() || !item.text.trim()) problems.push(`${item.id} 缺标题或说明`);
    if (!item.rule && item.id !== ALL_TRUTH_ACHIEVEMENT_ID) {
      problems.push(`${item.id} 缺判据（rule）——数据化之后每条成就都必须有；只有全图鉴由引擎特判`);
    }
    if (item.rule && !["truthy", "falsy", "always"].includes(item.rule.op) && typeof item.rule.value !== "number") {
      problems.push(`${item.id} 的规则是 ${item.rule.op}，必须给 value`);
    }
    // 级别：显式写了就必须是 1–4（用户 2026-10-10：「有些过了四个层次也最多第四个等级」）。
    // 不写是允许的（按 soul 自动推断），但**写了 0 或 99 这种**说明是手滑。
    if (item.tier !== undefined && ![1, 2, 3, 4].includes(item.tier)) {
      problems.push(`${item.id} 的级别必须是 1–4（四级封顶，用户口径），现在是 ${item.tier}`);
    }
  }
  return problems;
};
