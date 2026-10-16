/**
 * 做题结算口径的单测（2026-10-11）。
 *
 * 守的是一类"说明页承诺了、代码没做"的问题：
 *  · `puzzle-solve` 的说明写着"题库、生成器出的题都算"，而实际上只有生成器在发；
 *  · `daily` 曾经在表里但根本没有结算点。
 * 这两个入口（打谱工作区 / 每日一题页）现在共用这一份口径，所以这里把它钉住。
 */

import { describe, expect, it } from "vitest";
import { nextPuzzleProgressEntry, planPuzzleSoul, type PuzzleSettleInput } from "./puzzle-settle";

/** 取价：与真实来源表同量级的一组值（测的是"怎么算"，不是"多少钱"）。 */
const amountOf = (reason: string) => reason === "puzzle-solve" ? 3 : reason === "daily" ? 50 : 0;

const base: PuzzleSettleInput = {
  collectionId: "col-a",
  collectionTitle: "题集甲",
  puzzleId: "p1",
  puzzleTitle: "第一题",
  solved: true,
  isTodaysDaily: false,
  today: "2026-10-11",
  amountOf: amountOf as PuzzleSettleInput["amountOf"],
};

describe("做题结算：该发哪几笔", () => {
  it("做对一道普通题 ⇒ 发「攻克一题」，token 用题号（同题重复做对不重复入账）", () => {
    const grants = planPuzzleSoul(base);
    expect(grants).toHaveLength(1);
    expect(grants[0].reason).toBe("puzzle-solve");
    expect(grants[0].amount).toBe(3);
    expect(grants[0].token).toBe("puzzle:col-a/p1");
    // token 稳定 ⇒ 同一题再做一遍仍是同一个 token（幂等挡掉）
    expect(planPuzzleSoul(base)[0].token).toBe(grants[0].token);
  });

  it("**做错不发**（不扣也不记）", () => {
    expect(planPuzzleSoul({ ...base, solved: false })).toEqual([]);
    // 做错时哪怕是"今天这道"也不发 —— 每日一题只认做对（与 dailyDone 成就同口径）
    expect(planPuzzleSoul({ ...base, solved: false, isTodaysDaily: true })).toEqual([]);
  });

  it("做对「今天的每日一题」⇒ 两笔：攻克一题 + 每日一题（token 带日期）", () => {
    const grants = planPuzzleSoul({ ...base, isTodaysDaily: true });
    expect(grants.map((grant) => grant.reason)).toEqual(["puzzle-solve", "daily"]);
    const daily = grants.find((grant) => grant.reason === "daily")!;
    expect(daily.token).toBe("daily:2026-10-11");
    expect(daily.detail).toBe("完成每日一题");
    // 换一天 ⇒ 新 token（每天一次）
    expect(planPuzzleSoul({ ...base, isTodaysDaily: true, today: "2026-10-12" })
      .find((grant) => grant.reason === "daily")!.token).toBe("daily:2026-10-12");
  });

  it("每日一题**不是今天那道**时只发攻克（不会蹭到每日奖励）", () => {
    const grants = planPuzzleSoul({ ...base, isTodaysDaily: false });
    expect(grants.some((grant) => grant.reason === "daily")).toBe(false);
  });

  it("来源表里数额为 0 的（被删/被清零）就不产生那一笔", () => {
    // 只有每日一题有价、攻克那道被清零时：做对普通题 ⇒ 什么都不发
    const onlyDaily = (reason: string) => reason === "daily" ? 50 : 0;
    expect(planPuzzleSoul({ ...base, amountOf: onlyDaily as PuzzleSettleInput["amountOf"] })).toEqual([]);
    const grants = planPuzzleSoul({ ...base, isTodaysDaily: true, amountOf: onlyDaily as PuzzleSettleInput["amountOf"] });
    expect(grants.map((grant) => grant.reason)).toEqual(["daily"]);
  });

  it("详情文案带上题集与题目名（流水里能认出是哪道题）", () => {
    expect(planPuzzleSoul(base)[0].detail).toBe("攻克《题集甲》第一题");
  });
});

describe("做题进度条目", () => {
  it("solved 一旦为真不回落（做对过就是做对过）", () => {
    const existing = { solved: true, attempts: 2, updatedAt: "旧" };
    expect(nextPuzzleProgressEntry(existing, false, false, "新").solved).toBe(true);
    expect(nextPuzzleProgressEntry(existing, false, false, "新").updatedAt).toBe("新");
  });

  it("attempts 只在 countAttempt 为真时 +1（本会话首次落子）", () => {
    const existing = { solved: false, attempts: 2, updatedAt: "旧" };
    expect(nextPuzzleProgressEntry(existing, true, true, "新").attempts).toBe(3);
    expect(nextPuzzleProgressEntry(existing, true, false, "新").attempts).toBe(2);
  });

  it("没有旧条目时从 0 起算（首次落子记 1 次，没落子记 0 次）", () => {
    expect(nextPuzzleProgressEntry(undefined, true, true, "新").attempts).toBe(1);
    expect(nextPuzzleProgressEntry(undefined, false, false, "新").attempts).toBe(0);
  });
});
