/**
 * 做题的**共同结算口径**（2026-10-11）。
 *
 * ## 为什么要有这个模块
 *
 * 做题有两个入口，它们必须给出**完全相同的结果**：
 *  · 打谱工作区里的「做题模式」（`openPuzzle` 那一路，题目来自题库）；
 *  · 新的「每日一题」专门界面（`DailyPuzzlePage`）。
 *
 * "两个入口各写一套结算"是这个项目反复出问题的地方（改价只改一处、发钱只挂一处）。
 * 所以这里把**判据与数额**提成纯函数：两个入口都调它、只负责把结果写进各自的 state。
 * 数额一律从来源表取（`soulAmount`），不在这里写死 —— 那是上一轮修过的 bug 形态。
 *
 * ## 一个真实存在过的漏发（这里修掉）
 *
 * `SOUL_EARN_RULES` 里 `puzzle-solve`（"攻克一道题"）的说明是**"题库、生成器出的题都算"**，
 * 而实际上只有**生成器**那条路在发（`onSolved` → `puzzle-solve`）。
 * 工作区里从题库做题的那条路只发了 `daily`（而且仅限"今天那道"）——
 * 也就是说：从题库里攻克十道题，一块棋魂都没有，而说明页写着会给。
 * 这是"说明页承诺了、代码没做"的同一类问题（`daily` 那次也是），
 * 现在由这个共用口径一并保证。
 */

import type { SoulReason } from "../progress/soul";

export interface PuzzleSoulGrant {
  reason: SoulReason;
  /** 从来源表取到的数额（0 → 调用方应当跳过，不发也不写流水）。 */
  amount: number;
  token: string;
  detail: string;
}

export interface PuzzleSettleInput {
  collectionId: string;
  collectionTitle: string;
  puzzleId: string;
  puzzleTitle: string;
  /** 本题这次是否做出来了。**只有做对才发钱**（做错不发也不扣）。 */
  solved: boolean;
  /** 这一题是不是"今天的每日一题"（由调用方按同一个 `dailyDecision` 判）。 */
  isTodaysDaily: boolean;
  /** 本地日期键（`localDateKey()`）—— 每日一题的去重靠它。 */
  today: string;
  /** 取价函数（注入 `soulAmount`，免得这里引整份来源表）。 */
  amountOf: (reason: SoulReason) => number;
}

/**
 * 这一次结算该发哪几笔。**纯函数**：同一份输入永远给出同一份清单，
 * 所以两个入口不可能发出不同的东西。
 *
 * 三条口径：
 *  · **做错不发**：`solved === false` 直接空清单（不扣、不记）；
 *  · **攻克一题**每次都发，但 token 用题号 ⇒ 同一题重复做对只入账一次
 *    （与生成器那条路现在的 token 口径一致：`puzzle:<collection>/<id>`）；
 *  · **每日一题**另发一笔，token 带日期 ⇒ 每天一次，且**只在做对时**
 *    （与 `dailyDone` 成就、`recordPuzzleCompletion` 的口径一致）。
 */
export const planPuzzleSoul = (input: PuzzleSettleInput): PuzzleSoulGrant[] => {
  if (!input.solved) return [];
  const key = `${input.collectionId}/${input.puzzleId}`;
  const grants: PuzzleSoulGrant[] = [
    {
      reason: "puzzle-solve",
      amount: input.amountOf("puzzle-solve"),
      token: `puzzle:${key}`,
      detail: `攻克《${input.collectionTitle}》${input.puzzleTitle}`,
    },
  ];
  if (input.isTodaysDaily) {
    grants.push({
      reason: "daily",
      amount: input.amountOf("daily"),
      token: `daily:${input.today}`,
      detail: "完成每日一题",
    });
  }
  // 数额为 0 的（表里被删/被清零）不发：`grantSoul` 也会拒收，但在这里挡掉
  // 能少一次调用，也让"这一笔没发"在本函数层面就是明确的。
  return grants.filter((grant) => grant.amount > 0);
};

export interface PuzzleProgressEntry {
  solved: boolean;
  attempts: number;
  updatedAt: string;
}

/**
 * 进度表该更新成什么。**纯函数**（原先是 `recordPuzzleAttempt` 里内联的一段）。
 *
 * 口径（与原来一字不差地搬过来，只是提出来共用）：
 *  · `solved` 一旦为真就**不回落**（做对过就是做对过）；
 *  · `attempts` **只在本会话首次落子时 +1**（避免每落一子都计数）——
 *    所以 `countAttempt` 由调用方判（工作区用 `puzzleAttemptRecordedRef`，
 *    每日一题页用它自己的"这一局是否已记过"标记）。
 */
export const nextPuzzleProgressEntry = (
  existing: PuzzleProgressEntry | undefined,
  solved: boolean,
  countAttempt: boolean,
  now: string,
): PuzzleProgressEntry => ({
  solved: solved || Boolean(existing?.solved),
  attempts: countAttempt ? (existing?.attempts || 0) + 1 : (existing?.attempts || 0),
  updatedAt: now,
});
