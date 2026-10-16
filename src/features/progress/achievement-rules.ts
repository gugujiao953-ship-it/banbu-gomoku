/**
 * 成就规则的**数据化**（2026-10-10）。
 *
 * ## 为什么要有这个文件
 *
 * 上一版的判定写死在 `achievements.ts` 里：一个巨大的 `switch (id)` 加一个巨大的
 * `metById` 对象字面量。那有两个后果，在「成就工坊」网页做出来之后都变成了硬伤：
 *
 *  ① **删不掉**：从 `ACHIEVEMENT_CATALOG` 里删一条，判据还留在 `metById` 里 ——
 *     成了永远不会被读到的死代码；更糟的是有人手滑把 catalog 里某条删了、
 *     判定里那条又被当成"已解锁"来源去算「集齐全图鉴」，结果不对。
 *  ② **加不上**：网页上新增一条成就，还得有人去改 `achievements.ts` 写判据 ——
 *     那就不是"保存下来就能进入后续开发"，只是半个工具。
 *
 * 所以把判据变成**目录上的一个字段**（`rule`）：一条成就 = 它的文案 + 它的奖励 +
 * 它的判据，全在 `ACHIEVEMENT_CATALOG` 里。判定引擎退化成一个小解释器
 * （`evaluateRule`），**增删成就只需要改目录**，网页导出的 JSON 直接就是可落地的源。
 *
 * ## 规则长什么样
 *
 * 每条规则 = 「从哪取值」+「怎么比」+「比什么」，三个字段全是可序列化的：
 *
 * ```ts
 * { from: "duel.wins", op: "gte", value: 10 }    // 累计胜场 ≥ 10
 * { from: "duel.wonMaster", op: "truthy" }        // 赢过大师档
 * ```
 *
 * 这比"写成表达式字符串再 eval"安全得多（本项目不引入任何代码求值），
 * 也比"每条写个函数"更适合工具链 —— 网页可以直接把三个字段渲染成三个下拉/输入框。
 *
 * ## 取值路径（`SourceKey`）
 *
 * 全部来自**已经存在的存储**，不新增埋点（这是本模块从第一版就立的规矩）。
 * 新增路径时必须同时在 `readSource` 里接线，否则 `evaluateRule` 会保守地返回未达成
 * （**宁可不解锁，也不误解锁**）。
 */

import type { AchievementSources } from "./achievements";

/**
 * 可取的数值/布尔路径。命名规则：`来源.字段`，来源与 `AchievementSources` 的键同名。
 *
 * ⚠ 想加新路径时的检查清单：① 这个值**现在**存在哪里？② 读它要不要改业务代码？
 * 如果答案是要改业务代码，那这条先别加 —— 本模块的纪律是"只读已有账本"。
 */
export type SourceKey =
  // ── 对弈（duel-history 账本）──
  | "duel.games" | "duel.wins" | "duel.draws" | "duel.rating" | "duel.streak"
  | "duel.masterStreak" | "duel.wonMaster" | "duel.fastestWinMoves"
  | "duel.longestGame" | "duel.wonAsWhite" | "duel.wonAsBlack"
  | "duel.usedClock" | "duel.lostByForbidden" | "duel.wonAfterForbidden"
  | "duel.completedWithoutResign"
  // ── 做题（做题进度 + 题库）──
  | "puzzle.solved" | "puzzle.attempts" | "puzzle.clearedCollection"
  | "puzzle.wrongCount" | "puzzle.clearedWrong" | "puzzle.dailyDone"
  // ── VCF 挑战（vcfch-state）──
  | "vcf.solved" | "vcf.bestStreak" | "vcf.rating" | "vcf.todaySolved"
  // ── 复盘（game-review 样本）──
  | "review.count" | "review.flawless"
  // ── 识谱 ──
  | "recognition.count" | "recognition.restoredOrder" | "recognition.maxMoves"
  // ── 打谱研究 ──
  | "study.branches" | "study.openedBigLibrary" | "study.usedCrossSearch"
  // ── 棋谱库（新增：直接读库与收藏，不需要业务代码配合）──
  | "library.documents" | "library.favorites" | "library.bookmarks"
  // ── 开局 ──
  | "openingKinds"
  // ── 棋题生成器 ──
  | "generator.count" | "generator.maxDepth" | "generator.hasShape" | "generator.hasText"
  // ── 点魂火（用户 2026-10-10：「点击棋魂也算成就，1下，99下，299下……9999下」）──
  //  这是**唯一一个"参与度本身就是成就"的来源**：点魂火除了加余额什么都不做，
  //  所以它量的是纯粹的"你愿意在这里花多久"。九档梯度的口径见 catalog 里的注释。
  | "tap.total"
  // ── VCF 挑战的**持久累积**（用户 2026-10-10：「vcf挑战也还可以加，第一次耍，10次耍，
  //    100次，1000次，5000次耍」）──
  | "vcf.attempts" | "vcf.level" | "vcf.longestWinStreak"
  // ── 无条件（用户 2026-10-10：「棋魂系统，这个成就没有任何限制，就是打开就有，
  //    相当于每个人的福利，2026棋魂」）──
  | "always"
  // ── 一次性动作信号位（signal-store）──
  | "signals.themeCount" | "signals.readManual" | "signals.customizedLayout"
  | "signals.didBackup" | "signals.didExport" | "signals.vcfDeepSolved"
  | "signals.unlockedAny" | "signals.tapCount";

/** 判定算符。`value` 只在需要比较时给。 */
export type RuleOp =
  /** 数值 ≥ value */
  | "gte"
  /** 数值 ≤ value */
  | "lte"
  /** 布尔为真（不填 value） */
  | "truthy"
  /** 布尔为假（"从没发生过"，例如"从未因禁手判负"） */
  | "falsy"
  /**
   * **永远成立**（用户 2026-10-10：「棋魂系统，这个成就没有任何限制，就是打开就有，
   * 相当于每个人的福利，2026棋魂」）。
   *
   * 刻意做成一个**算符**而不是"没有 rule 的条目"：目录自检要求每条成就都有判据
   * （只有「集齐全图鉴」由引擎特判、允许没有），留一个"没判据也解锁"的口子会让那条约束
   * 彻底失效。而 `always` 是一个**显式**、有名字的判据 —— 读代码的人一眼知道
   * 这条是故意无条件发的，不是漏写了条件。
   */
  | "always";

/**
 * 一条判据。三种合法形状：
 *  · `{ from: "duel.wins", op: "gte", value: 10 }`
 *  · `{ from: "duel.wonMaster", op: "truthy" }`
 *  · `{ from: "duel.lostByForbidden", op: "falsy" }`
 */
export interface AchievementRule {
  from: SourceKey;
  op: RuleOp;
  value?: number;
}

/** 需要"除本条以外全部达成"的特殊成就用它（只有「集齐全图鉴」一条）。 */
export const ALL_OTHERS_RULE_KEY = "ALL_OTHERS" as const;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/**
 * 取值。**取不到一律返回 undefined**，由 `evaluateRule` 决定怎么保守处理。
 *
 * 这里的 `switch` 是"数据化"唯一没有消化掉的地方 —— 但它与上一版的巨大 `switch (id)`
 * 有本质区别：那是"每条成就一个分支"（58 条就 58 个分支，增删都要改这里），
 * 这是"每个**数据源**一个分支"（13 个来源块，新增成就只要从已有来源取字段就完全不用改这里）。
 */
export const readSource = (sources: AchievementSources, key: SourceKey): number | boolean | undefined => {
  const d = sources.duel;
  const p = sources.puzzle;
  const v = sources.vcf;
  const r = sources.review;
  const rec = sources.recognition;
  const st = sources.study;
  const lib = sources.library;
  const gen = sources.generator;
  const sig = sources.signals;

  switch (key) {
    // 对弈
    case "duel.games": return d ? num(d.games) : undefined;
    case "duel.wins": return d ? num(d.wins) : undefined;
    case "duel.draws": return d ? num(d.draws) : undefined;
    case "duel.rating": return d ? num(d.rating) : undefined;
    case "duel.streak": return d ? num(d.streak) : undefined;
    case "duel.masterStreak": return d ? num(d.masterStreak) : undefined;
    case "duel.wonMaster": return d ? bool(d.wonMaster) : undefined;
    case "duel.fastestWinMoves": return d ? num(d.fastestWinMoves) : undefined;
    case "duel.longestGame": return d ? num(d.longestGame) : undefined;
    case "duel.wonAsWhite": return d ? num(d.wonAsWhite) : undefined;
    case "duel.wonAsBlack": return d ? num(d.wonAsBlack) : undefined;
    case "duel.usedClock": return d ? bool(d.usedClock) : undefined;
    case "duel.lostByForbidden": return d ? bool(d.lostByForbidden) : undefined;
    case "duel.wonAfterForbidden": return d ? bool(d.wonAfterForbidden) : undefined;
    case "duel.completedWithoutResign": return d ? bool(d.completedWithoutResign) : undefined;
    // 做题
    case "puzzle.solved": return p ? num(p.solved) : undefined;
    case "puzzle.attempts": return p ? num(p.attempts) : undefined;
    case "puzzle.clearedCollection": return p ? bool(p.clearedCollection) : undefined;
    case "puzzle.wrongCount": return p ? num(p.wrongCount) : undefined;
    case "puzzle.clearedWrong": return p ? bool(p.clearedWrong) : undefined;
    case "puzzle.dailyDone": return p ? num(p.dailyDone) : undefined;
    // VCF
    case "vcf.solved": return v ? num(v.solved) : undefined;
    case "vcf.bestStreak": return v ? num(v.bestStreak) : undefined;
    case "vcf.rating": return v ? num(v.rating) : undefined;
    case "vcf.todaySolved": return v ? num(v.todaySolved) : undefined;
    // VCF 的持久累积（attempts = solved + failed，都是账本里已有的数）
    case "vcf.attempts": return v ? num(v.attempts) : undefined;
    case "vcf.level": return v ? num(v.level) : undefined;
    case "vcf.longestWinStreak": return v ? num(v.longestWinStreak) : undefined;
    // 复盘
    case "review.count": return r ? num(r.count) : undefined;
    case "review.flawless": return r ? bool(r.flawless) : undefined;
    // 识谱
    case "recognition.count": return rec ? num(rec.count) : undefined;
    case "recognition.restoredOrder": return rec ? bool(rec.restoredOrder) : undefined;
    case "recognition.maxMoves": return rec ? num(rec.maxMoves) : undefined;
    // 打谱
    case "study.branches": return st ? num(st.branches) : undefined;
    case "study.openedBigLibrary": return st ? bool(st.openedBigLibrary) : undefined;
    case "study.usedCrossSearch": return st ? bool(st.usedCrossSearch) : undefined;
    // 棋谱库
    case "library.documents": return lib ? num(lib.documents) : undefined;
    case "library.favorites": return lib ? num(lib.favorites) : undefined;
    case "library.bookmarks": return lib ? num(lib.bookmarks) : undefined;
    // 开局
    case "openingKinds": return num(sources.openingKinds);
    // 生成器
    case "generator.count": return num(gen?.count);
    case "generator.maxDepth": return num(gen?.maxDepth);
    case "generator.hasShape": return gen ? bool(gen.kinds.includes("shape")) : undefined;
    case "generator.hasText": return gen ? bool(gen.kinds.includes("text")) : undefined;
    // 点魂火（累计次数）
    case "tap.total": return num(sources.tap?.total);
    // 信号位
    // 无条件：不参与判定（evaluateRule 已经直接返回 true），给个稳定值以便复用
    case "always": return true;
    case "signals.themeCount": return sig?.themes ? num(sig.themes.length) : undefined;
    case "signals.readManual": return sig ? bool(sig.readManual) : undefined;
    case "signals.customizedLayout": return sig ? bool(sig.customizedLayout) : undefined;
    case "signals.didBackup": return sig ? bool(sig.didBackup) : undefined;
    case "signals.didExport": return sig ? bool(sig.didExport) : undefined;
    case "signals.vcfDeepSolved": return sig ? bool(sig.vcfDeepSolved) : undefined;
    case "signals.unlockedAny": return sig?.unlockedAny === undefined ? undefined : bool(sig.unlockedAny > 0);
    case "signals.tapCount": return num(sig?.tapCount);
    default: return undefined;
  }
};

/**
 * 判定一条规则。**取不到值一律按未达成**（宁可不解锁，也不误解锁）。
 *
 * 唯一的例外是 `falsy`：它要断言的正是"这件事没发生过"，而"读不到来源"与
 * "来源说没发生"是两回事 —— 来源缺失时也返回 false，避免"数据没读到就白送一条成就"。
 */
export const evaluateRule = (sources: AchievementSources, rule: AchievementRule): boolean => {
  // `always` 不看任何数据源 —— 它就是"打开就有"。
  if (rule.op === "always") return true;
  const value = readSource(sources, rule.from);
  if (value === undefined) return false;
  switch (rule.op) {
    case "truthy": return value === true;
    case "falsy": return value === false;
    case "gte": {
      const n = num(value);
      return n !== undefined && rule.value !== undefined && n >= rule.value;
    }
    case "lte": {
      const n = num(value);
      return n !== undefined && rule.value !== undefined && n <= rule.value;
    }
    default: return false;
  }
};

/**
 * 进度（给面板上的进度条）。只有"累积到某个数"的规则才有进度：
 * 数数型（gte/lte）直接拿当前值，其余（truthy/falsy）没有中间态。
 */
export const ruleProgress = (
  sources: AchievementSources,
  rule: AchievementRule,
  target: number,
): number => {
  if (rule.op !== "gte" && rule.op !== "lte") return 0;
  const value = readSource(sources, rule.from);
  const n = num(value);
  return n === undefined ? 0 : Math.min(n, target);
};

/** 把规则写成一句人话（面板与工坊网页都用它，避免两处各写一套文案）。 */
export const describeRule = (rule: AchievementRule): string => {
  const label = SOURCE_LABELS[rule.from] ?? rule.from;
  switch (rule.op) {
    case "always": return "无条件（打开就有）";
    case "truthy": return label;
    case "falsy": return `尚未：${label}`;
    case "gte": return `${label} ≥ ${rule.value ?? 0}`;
    case "lte": return `${label} ≤ ${rule.value ?? 0}`;
    default: return label;
  }
};

/** 取值路径 → 中文名。工坊网页与面板共用。 */
export const SOURCE_LABELS: Record<SourceKey, string> = {
  "duel.games": "完成对局数",
  "duel.wins": "战胜 AI 局数",
  "duel.draws": "和棋局数",
  "duel.rating": "等级分",
  "duel.streak": "当前连胜",
  "duel.masterStreak": "对大师档连胜",
  "duel.wonMaster": "赢过大师档",
  "duel.fastestWinMoves": "最快取胜手数（越少越好）",
  "duel.longestGame": "最长一局手数",
  "duel.wonAsWhite": "执白取胜局数",
  "duel.wonAsBlack": "执黑取胜局数",
  "duel.usedClock": "用过比赛计时器",
  "duel.lostByForbidden": "因禁手判负过",
  "duel.wonAfterForbidden": "禁手判负后又赢过",
  "duel.completedWithoutResign": "不用认输下完过一局",
  "puzzle.solved": "攻克题目数",
  "puzzle.attempts": "做题尝试总次数",
  "puzzle.clearedCollection": "清空过题集",
  "puzzle.wrongCount": "错题本题目数",
  "puzzle.clearedWrong": "把错题重新做对过",
  "puzzle.dailyDone": "每日一题完成次数",
  "vcf.solved": "VCF 挑战解出题数",
  "vcf.bestStreak": "VCF 挑战最高连胜",
  "vcf.rating": "VCF 挑战等级分",
  "vcf.todaySolved": "VCF 今日解出题数",
  "review.count": "整局复盘局数",
  "review.flawless": "有过零失误的一局",
  "recognition.count": "成功识谱张数",
  "recognition.restoredOrder": "复原过完整手序",
  "recognition.maxMoves": "识别过的最大手数",
  "study.branches": "创建变化分支数",
  "study.openedBigLibrary": "打开过十万节点大谱",
  "study.usedCrossSearch": "用过跨谱局面检索",
  "library.documents": "棋谱库棋谱数",
  "library.favorites": "收藏数",
  "library.bookmarks": "分支书签数",
  "openingKinds": "集齐的开局种类数",
  "generator.count": "造出的题目数",
  "generator.maxDepth": "造出的最深手数",
  "generator.hasShape": "造过图案题",
  "generator.hasText": "造过文字题",
  "tap.total": "累计点魂火次数",
  "vcf.attempts": "VCF 挑战参与总次数",
  "vcf.level": "VCF 解答力等级",
  "vcf.longestWinStreak": "VCF 最长连胜",
  "signals.themeCount": "用过的外观主题数",
  "signals.readManual": "看过使用手册",
  "signals.customizedLayout": "自定义过工具栏布局",
  "signals.didBackup": "完整备份过",
  "signals.didExport": "导出过棋谱或分享图片",
  "signals.vcfDeepSolved": "解出过 20 手以上 VCF 题",
  "signals.unlockedAny": "买过棋魂解锁项",
  "signals.tapCount": "点魂火次数（信号位）",
  "always": "无条件（打开就有）",
};

/** 全部合法路径（工坊网页的下拉选项来源）。 */
export const ALL_SOURCE_KEYS = Object.keys(SOURCE_LABELS) as SourceKey[];
