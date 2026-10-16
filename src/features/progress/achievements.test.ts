/**
 * 成就与棋魂的单测（2026-10-09）。
 *
 * 重点覆盖三件容易出错、且在真机上很难发现的事：
 *  1. **目录自检**——id 唯一、奖励合法（目录是常量，错了要在 CI 红）。
 *  2. **账本数学**——余额是流水求和、幂等 token、超限折叠（carry）不改变余额。
 *  3. **判定引擎**——离线的 `AchievementSources` → 应该解锁什么；特别是
 *     "全图鉴"那条的自引用不能死循环、进度条不该超过目标。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACHIEVEMENT_CATALOG, ACHIEVEMENT_BY_ID, achievementsInGroup, validateAchievementCatalog, TOTAL_SOUL_FROM_ACHIEVEMENTS } from "./achievement-catalog";
import { ACHIEVEMENT_STATE_KEY, evaluateAchievements, achievementCompletion, loadAchievementState, loadPendingSoulRewards, runAchievementCheck, saveAchievementState, type AchievementSources } from "./achievements";
import {
  applyEarnTuning, applySpendTuning, claimVcfLevelRewards, countsTowardEarned, formatSoulAmount, formatSoulExact,
  isSoulAmountAbbreviated, grantSoul,
  loadSoulLedger, loadVcfLevelPaid, normalizeSoulTuning, recentSoulEntries, saveVcfLevelPaid,
  setActiveSoulTuning, soulBalance,
  soulEarnedWithin, soulForDuelResult, soulForDuelWin, soulForVcfProblem, soulSpentWithin, spendSoul,
  soulAmount, SOUL_VCF_TOTAL_CAP, SOUL_VCF_HAND_BONUS,
  summarizeSoul, SOUL_LEDGER_KEY, SOUL_LEDGER_LIMIT, SOUL_SPEND_POINTS, SOUL_EARN_RULES, SOUL_TUNING_KEY, vcfLevelSoul, TUNABLE_REASONS,
  type SoulLedger, type SoulTuning,
} from "./soul";
import { DEFAULT_SOUL_TUNING, SOUL_SPEND_NOTE } from "./soul-economy";

/** 内存版 Storage（照 `backup.test.ts` 的写法——本模块不依赖 jsdom）。 */
class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

/** 每个用例前换一份干净存储，避免互相污染。 */
beforeEach(() => { vi.stubGlobal("localStorage", new MemoryStorage()); });

describe("成就目录", () => {
  it("自检零问题（id 唯一 / 奖励正整数 / target 与 unit 配对）", () => {
    expect(validateAchievementCatalog()).toEqual([]);
  });

  it("按用户「多搞一点」的要求，条目数够多且五组都有", () => {
    expect(ACHIEVEMENT_CATALOG.length).toBeGreaterThanOrEqual(40);
    for (const group of ["duel", "puzzle", "study", "recognition", "explore"] as const) {
      expect(achievementsInGroup(group).length).toBeGreaterThan(0);
    }
  });

  it("id 全局唯一（重复会让存档串味）", () => {
    const ids = ACHIEVEMENT_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ACHIEVEMENT_BY_ID.size).toBe(ids.length);
  });

  it("棋魂总额是各条之和，且量级合理（不能一条就送出一个天文数字）", () => {
    expect(TOTAL_SOUL_FROM_ACHIEVEMENTS).toBe(ACHIEVEMENT_CATALOG.reduce((sum, item) => sum + item.soul, 0));
    expect(TOTAL_SOUL_FROM_ACHIEVEMENTS).toBeGreaterThan(1000);
    // ⚠ 上限从 40000 提到 80000：用户在工坊里把奖励普遍上调了
    // （连点九档的顶端给到 9999、VCF 满级 9999、五千盘 1000…），总额 56855。
    // 这条断言**不是产品口径**，防的是"某条不小心多打了个 0"这种事故，
    // 所以它只随用户的真实意图上抬，不反过来限制用户。
    expect(TOTAL_SOUL_FROM_ACHIEVEMENTS).toBeLessThan(80000);
    // 单条上限见下面的断言（现在是 2026：福利成就「棋魂系统」）
    // 之前的最高两条是「千题」800 与「集齐全图鉴」500（2026-10-10 扩表时
    // 千题那条突破了原来的 500 上限，属于有意的——它对应真实的一千道题）。
    // ⚠ 上限现在是 **9999**：这是用户在评审稿里亲手定的最高档
    // （「薪王」点魂火 9999 次、VCF 满级「挑战之巅」、集齐全图鉴 —— 三条都给 9999，
    //  另有 5000 一档）。2026-10-10 时上限是 2026（棋魂系统的见面礼）。
    //
    // 这条断言**不是产品口径**，防的是"某条不小心多打了一个 0"（比如 99999 这种）。
    // 所以它跟着用户的真实意图走，不反过来限制用户 —— 用户要的量大，它就是大的。
    for (const item of ACHIEVEMENT_CATALOG) expect(item.soul).toBeLessThanOrEqual(9999);
  });
});

describe("棋魂账本", () => {
  it("余额 = 流水求和，授予与消耗都对得上", () => {
    const ledger = loadSoulLedger();
    expect(soulBalance(ledger)).toBe(0);
    expect(grantSoul(ledger, { amount: 30, reason: "achievement", detail: "测试" }).ok).toBe(true);
    expect(soulBalance(ledger)).toBe(30);
    expect(grantSoul(ledger, { amount: 20, reason: "duel-win", detail: "对局" }).ok).toBe(true);
    expect(soulBalance(ledger)).toBe(50);
    expect(spendSoul(ledger, { amount: 20, reason: "manual", detail: "花掉" }).ok).toBe(true);
    expect(soulBalance(ledger)).toBe(30);
  });

  it("余额不足时拒绝消耗，且**不产生负余额**、不写流水", () => {
    const ledger = loadSoulLedger();
    grantSoul(ledger, { amount: 10, reason: "achievement", detail: "十" });
    const before = ledger.entries.length;
    const result = spendSoul(ledger, { amount: 999, reason: "manual", detail: "买不起" });
    expect(result.ok).toBe(false);
    expect(result.balance).toBe(10);
    expect(soulBalance(ledger)).toBe(10);
    expect(ledger.entries.length).toBe(before);
  });

  it("非法金额（0 / 负数 / 小数）一律拒绝", () => {
    const ledger = loadSoulLedger();
    for (const amount of [0, -5, 1.5]) {
      expect(grantSoul(ledger, { amount, reason: "manual", detail: "坏" }).ok).toBe(false);
      expect(spendSoul(ledger, { amount, reason: "manual", detail: "坏" }).ok).toBe(false);
    }
    expect(soulBalance(ledger)).toBe(0);
  });

  it("同一个 token 只入账一次（挡住「终局→刷新→恢复→再结算」）", () => {
    const ledger = loadSoulLedger();
    const first = grantSoul(ledger, { amount: 25, reason: "achievement", detail: "首胜", token: "achievement:duel-first-win" });
    const second = grantSoul(ledger, { amount: 25, reason: "achievement", detail: "首胜", token: "achievement:duel-first-win" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(soulBalance(ledger)).toBe(25);
  });

  it("流水超上限时折叠成 carry，**余额保持不变**", () => {
    const ledger = loadSoulLedger();
    // 每条 +2，写到超过上限。
    for (let i = 0; i < SOUL_LEDGER_LIMIT + 40; i += 1) {
      grantSoul(ledger, { amount: 2, reason: "puzzle-solve", detail: `第 ${i} 题` });
    }
    const expected = (SOUL_LEDGER_LIMIT + 40) * 2;
    expect(soulBalance(ledger)).toBe(expected);
    expect(ledger.entries.length).toBeLessThanOrEqual(SOUL_LEDGER_LIMIT);
    // 折叠后要留一条 carry 记录，且它如实写明折掉了多少条。
    expect(ledger.entries.some((item) => item.reason === "carry")).toBe(true);
    expect(recentSoulEntries(ledger, 1)[0].reason).not.toBe("carry");
  });

  /**
   * **VCF 等级奖励不会被折叠重发**（2026-10-10 修的真漏洞）。
   *
   * 旧实现"从 1 级全查一遍、靠 token 幂等挡掉"有个致命前提：
   * `usedTokens` 是 `loadSoulLedger` 从**现存流水**重建的，而账本超限会把最早的
   * 记录并成一条 carry —— **被并掉的记录上的 token 就永久丢了**。
   * 于是重启之后再解一题，已发的等级会**全部重发一遍**
   * （实测：领过 1..11 级 665 魂 → 顶过上限 → 重启 → 又发 665）。
   *
   * 现在靠 `claimVcfLevelRewards` 的水位线（独立存档）挡住，与账本裁剪无关。
   */
  it("账本折叠之后，VCF 等级奖励**不会重发**（水位线兜住）", () => {
    const ledger = loadSoulLedger();

    // 一、第一次爬到 11 级：领到 1..11 级。
    // ⚠ 总额**从表里算**，不写死 —— 等级奖励表是用户在工坊里调的
    // （2026-10-11 从 20/25/30… 调成了 20/40/40…，写死 665 就会假失败）。
    // 这条测试真正守的是"折叠之后不会重发"，金额只是个随行值。
    const expectedFirst = Array.from({ length: 11 }, (_, i) => vcfLevelSoul(i + 1)).reduce((a, b) => a + b, 0);
    claimVcfLevelRewards(11, vcfLevelSoul, (reward) => grantSoul(ledger, {
      amount: reward.amount, reason: "vcf-solve", detail: reward.detail, token: reward.token,
    }).code);
    const balanceAfterFirst = soulBalance(ledger);
    expect(balanceAfterFirst).toBe(expectedFirst);
    expect(loadVcfLevelPaid()).toBe(11);

    // 二、把账本顶过上限，让最早那批奖励记录被折叠。
    for (let i = 0; i < SOUL_LEDGER_LIMIT + 50; i += 1) {
      grantSoul(ledger, { amount: 1, reason: "manual", detail: "点了一下魂火", token: `tap:${i}` });
    }
    expect(ledger.entries.some((item) => item.reason === "carry")).toBe(true);

    // 三、模拟重启：折叠凭证仍能重建 usedTokens。
    const reloaded = loadSoulLedger();
    expect(reloaded.usedTokens.has("vcf-level:1")).toBe(true);

    // 四、再解一题（还是 11 级）：水位线挡着，一笔都不该发。
    const again = claimVcfLevelRewards(11, vcfLevelSoul);
    expect(again).toEqual([]);
    expect(soulBalance(reloaded)).toBe(balanceAfterFirst + SOUL_LEDGER_LIMIT + 50);

    // 五、但**跳级仍要补发**（水位线记的是"发到几级"，不是"发过哪几级"）：
    //     从 11 级涨到 13 级 → 只补 12、13 两笔，1..11 不会重来。
    const jump = claimVcfLevelRewards(13, vcfLevelSoul, () => "ok");
    expect(jump.map((item) => item.level)).toEqual([12, 13]);
    expect(loadVcfLevelPaid()).toBe(13);
  });

  it("水位线**只升不降**（降下来等于把发过的重新变成可发的）", () => {
    expect(loadVcfLevelPaid()).toBe(0);
    expect(saveVcfLevelPaid(7)).toBe(true);
    expect(loadVcfLevelPaid()).toBe(7);
    // 往回设：不生效（返回 false），水位线保持 7。
    expect(saveVcfLevelPaid(3)).toBe(false);
    expect(loadVcfLevelPaid()).toBe(7);
    // 坏数据当作 0（宁可重发也不漏发，且不能让 NaN 把比较搞崩）。
    localStorage.setItem("banbu-vcf-level-paid-v1", "不是数字");
    expect(loadVcfLevelPaid()).toBe(0);
  });

  /**
   * **老用户迁移**：水位线是 2026-10-10 才加的，老玩家的账本里已经有
   * `vcf-level:<n>` 记录但没有水位线。第一次结算时要从账本把最高的 n 补上，
   * 否则他们升级后会被"重发一遍"（这正是那个漏洞在最老用户身上的表现）。
   */
  it("老账本（有 vcf-level token、无水位线）第一次结算会**先补水位线**，不重发", () => {
    // 造一份"旧版本留下的账本"：已领到 7 级，直接写盘（绕开本次会话）。
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
      { id: "old-1", at: 1, amount: 20, reason: "vcf-solve", detail: "VCF 解答力升到 1 级", token: "vcf-level:1" },
      { id: "old-2", at: 2, amount: 65, reason: "vcf-solve", detail: "VCF 解答力升到 6 级", token: "vcf-level:6" },
      { id: "old-3", at: 3, amount: 75, reason: "vcf-solve", detail: "VCF 解答力升到 7 级", token: "vcf-level:7" },
    ]));
    expect(loadVcfLevelPaid()).toBe(0);

    // 第一次结算：水位线补到 7（账本里的最大值），所以 1..7 一笔都不发。
    const rewards = claimVcfLevelRewards(7, vcfLevelSoul);
    expect(rewards).toEqual([]);
    expect(loadVcfLevelPaid()).toBe(7);

    // 只有**新**涨到的 8 级才会发。
    const next = claimVcfLevelRewards(8, vcfLevelSoul, () => "ok");
    expect(next.map((item) => item.level)).toEqual([8]);
  });

  it("普通题目奖励在折叠、重启后仍幂等，包括被折叠净额为零的情况", () => {
    for (const zeroCarry of [false, true]) {
      localStorage.clear();
      const ledger = loadSoulLedger();
      grantSoul(ledger, { amount: 10, reason: "puzzle-solve", detail: "题", token: "puzzle:book/one" });
      if (zeroCarry) spendSoul(ledger, { amount: 10, reason: "manual", detail: "消费", token: "buy:first" });
      for (let i = ledger.entries.length; i <= SOUL_LEDGER_LIMIT; i += 1) {
        grantSoul(ledger, { amount: 1, reason: "manual", detail: "填满账本" });
      }
      const reloaded = loadSoulLedger();
      const balance = soulBalance(reloaded);
      expect(grantSoul(reloaded, { amount: 10, reason: "puzzle-solve", detail: "重做", token: "puzzle:book/one" }).code).toBe("duplicate");
      expect(soulBalance(reloaded)).toBe(balance);
      if (zeroCarry) expect(reloaded.usedTokens.has("buy:first")).toBe(true);
    }
  });

  it("VCF 等级发奖失败时保留失败级别，下次只补尚未付成功的奖励", () => {
    const ledger = loadSoulLedger();
    const paid = (reward: { amount: number; detail: string; token: string }) => grantSoul(ledger, {
      ...reward, reason: "vcf-solve",
    }).code;
    const first = claimVcfLevelRewards(3, vcfLevelSoul, (reward) => reward.level === 2 ? "daily-limit" : paid(reward));
    expect(first.map((reward) => reward.level)).toEqual([1]);
    expect(loadVcfLevelPaid()).toBe(1);
    const retry = claimVcfLevelRewards(3, vcfLevelSoul, paid);
    expect(retry.map((reward) => reward.level)).toEqual([2, 3]);
    expect(loadVcfLevelPaid()).toBe(3);
    expect(soulBalance(ledger)).toBe(vcfLevelSoul(1) + vcfLevelSoul(2) + vcfLevelSoul(3));
  });

  it("只取 VCF 等级奖励计划不能提前把未入账的奖励标成已领取", () => {
    expect(claimVcfLevelRewards(3, vcfLevelSoul)).toHaveLength(3);
    expect(loadVcfLevelPaid()).toBe(0);
    expect(claimVcfLevelRewards(3, vcfLevelSoul)).toHaveLength(3);
  });

  it("短期点击 token 本会话仍幂等，但不会随折叠凭证无限增大存档", () => {
    const ledger = loadSoulLedger();
    const first = { amount: 1, reason: "manual" as const, detail: "魂火", token: "tap:123:1", tokenRetention: "session" as const };
    grantSoul(ledger, first);
    for (let i = 2; i <= SOUL_LEDGER_LIMIT + 50; i += 1) grantSoul(ledger, { ...first, token: `tap:123:${i}` });
    expect(grantSoul(ledger, first).code).toBe("duplicate");
    expect(ledger.entries.flatMap((entry) => entry.compactedTokens ?? [])).toEqual([]);
    const reloaded = loadSoulLedger();
    expect(reloaded.usedTokens.has(first.token)).toBe(false);
    expect(reloaded.usedTokens.size).toBeLessThanOrEqual(SOUL_LEDGER_LIMIT);
  });

  it("旧魂火流水迁移为短期 token，不把历史点击永久留在折叠凭证里", () => {
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
      { id: "tap", at: 1, amount: 1, reason: "manual", detail: "魂火", token: "tap:123:1" },
      ...Array.from({ length: SOUL_LEDGER_LIMIT - 1 }, (_, i) => ({ id: `fill-${i}`, at: i + 2, amount: 1, reason: "manual", detail: "旧流水" })),
    ]));
    const ledger = loadSoulLedger();
    grantSoul(ledger, { amount: 1, reason: "manual", detail: "触发折叠" });
    expect(ledger.usedTokens.has("tap:123:1")).toBe(true);
    expect(loadSoulLedger().usedTokens.has("tap:123:1")).toBe(false);
  });

  it("成就发放汇总使用调度后的实际入账数额", () => {
    setActiveSoulTuning({ achievementMultiplier: 2 });
    try {
      const result = runAchievementCheck({ signals: { tapCount: 1 } }, { state: {}, ledger: loadSoulLedger() });
      expect(result.unlocked.length).toBeGreaterThan(0);
      const nominal = result.unlocked.reduce((sum, item) => sum + item.soul, 0);
      expect(result.soulGranted).toBe(nominal * 2);
      expect(result.soulBalance).toBe(result.soulGranted);
    } finally { setActiveSoulTuning(); }
  });

  it("成就解锁时棋魂写盘失败，恢复存储后只补发一次并保留原解锁时间", () => {
    const ledger = loadSoulLedger();
    const write = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === SOUL_LEDGER_KEY) throw new Error("quota");
      write(key, value);
    });
    const first = runAchievementCheck({ signals: { tapCount: 1 } }, { ledger, at: 100 });
    expect(first.unlocked.length).toBeGreaterThan(0);
    expect(first.soulGranted).toBe(0);
    expect(loadPendingSoulRewards()).toEqual(first.unlocked.map((item) => item.id));
    expect(loadAchievementState()).toEqual(first.state);
    // 普通存档调用也不能擦掉等待补发的奖励。
    expect(saveAchievementState(first.state)).toBe(true);
    expect(loadPendingSoulRewards()).toEqual(first.pendingSoulRewards);
    vi.restoreAllMocks();
    const retry = runAchievementCheck({}, { ledger: loadSoulLedger(), at: 200 });
    expect(retry.unlocked).toEqual([]);
    expect(retry.state).toEqual(first.state);
    expect(retry.soulGranted).toBe(first.unlocked.reduce((sum, item) => sum + item.soul, 0));
    expect(loadPendingSoulRewards()).toEqual([]);
    expect(runAchievementCheck({}, { ledger: loadSoulLedger() }).soulGranted).toBe(0);
  });

  it("成就奖励被每日上限阻挡时下次补发，用户停发设置仍保持不补发", () => {
    const ledger = loadSoulLedger();
    grantSoul(ledger, { amount: 1, reason: "manual", detail: "已到今日上限" });
    setActiveSoulTuning({ dailyEarnLimit: 1 });
    try {
      const first = runAchievementCheck({ signals: { tapCount: 1 } }, { ledger });
      expect(first.pendingSoulRewards.length).toBeGreaterThan(0);
      expect(first.soulGranted).toBe(0);
      setActiveSoulTuning();
      const retry = runAchievementCheck({}, { ledger });
      expect(retry.unlocked).toEqual([]);
      expect(retry.soulGranted).toBe(first.unlocked.reduce((sum, item) => sum + item.soul, 0));
      expect(retry.pendingSoulRewards).toEqual([]);
      localStorage.clear();
      setActiveSoulTuning({ disabledReasons: ["achievement"] });
      const disabled = runAchievementCheck({ signals: { tapCount: 1 } }, { ledger: loadSoulLedger() });
      expect(disabled.unlocked.length).toBeGreaterThan(0);
      expect(disabled.soulGranted).toBe(0);
      expect(disabled.pendingSoulRewards).toEqual([]);
      setActiveSoulTuning();
      expect(runAchievementCheck({}, { ledger: loadSoulLedger() }).soulGranted).toBe(0);
    } finally { setActiveSoulTuning(); }
  });

  it("存储全面不可用时调用方可持有补发列表，同一会话恢复后奖励不丢", () => {
    const ledger = loadSoulLedger();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    const first = runAchievementCheck({ signals: { tapCount: 1 } }, { ledger });
    expect(first.pendingSoulRewards.length).toBeGreaterThan(0);
    expect(loadAchievementState()).toEqual({});
    vi.restoreAllMocks();
    const retry = runAchievementCheck({}, {
      ledger, state: first.state, pendingSoulRewards: first.pendingSoulRewards,
    });
    expect(retry.unlocked).toEqual([]);
    expect(retry.soulGranted).toBe(first.unlocked.reduce((sum, item) => sum + item.soul, 0));
    expect(retry.pendingSoulRewards).toEqual([]);
  });

  it("棋魂已发但成就表写盘失败时，无新解锁也重试落盘且不重复发奖", () => {
    const ledger = loadSoulLedger();
    const write = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === ACHIEVEMENT_STATE_KEY) throw new Error("quota");
      write(key, value);
    });
    const first = runAchievementCheck({ signals: { tapCount: 1 } }, { ledger });
    expect(first.soulGranted).toBeGreaterThan(0);
    expect(first.pendingSoulRewards).toEqual([]);
    expect(first.statePersisted).toBe(false);
    vi.restoreAllMocks();
    const retry = runAchievementCheck({}, {
      ledger, state: first.state, pendingSoulRewards: first.pendingSoulRewards,
      retryStatePersistence: !first.statePersisted,
    });
    expect(retry.unlocked).toEqual([]);
    expect(retry.soulGranted).toBe(0);
    expect(retry.statePersisted).toBe(true);
    expect(loadAchievementState()).toEqual(first.state);
  });

  it("坏存档条目被逐条丢掉，不整份作废（棋魂是累积资产）", () => {
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
      { id: "ok", at: 1, amount: 10, reason: "achievement", detail: "好的" },
      { id: "bad-amount", at: 2, amount: 0, reason: "achievement", detail: "零" },
      { id: "bad-reason", at: 3, amount: 5, reason: "不存在的来源", detail: "坏" },
      { nope: true },
      { id: "ok2", at: 4, amount: 7, reason: "duel-win", detail: "也好" },
    ]));
    const ledger = loadSoulLedger();
    expect(ledger.entries.map((item) => item.id)).toEqual(["ok", "ok2"]);
    expect(soulBalance(ledger)).toBe(17);
  });

  it("汇总按来源归类，carry 不计入「累计获得」（否则面板会凭空多一大块）", () => {
    const ledger = loadSoulLedger();
    for (let i = 0; i < SOUL_LEDGER_LIMIT + 20; i += 1) grantSoul(ledger, { amount: 1, reason: "puzzle-solve", detail: "题" });
    grantSoul(ledger, { amount: 50, reason: "achievement", detail: "成就" });
    const summary = summarizeSoul(ledger);
    expect(summary.balance).toBe(SOUL_LEDGER_LIMIT + 70);
    expect(summary.byReason.some((item) => item.reason === "carry")).toBe(false);
    // 成就那 50 必须完整出现在归类里。
    expect(summary.byReason.find((item) => item.reason === "achievement")?.amount).toBe(50);
  });

  it("消费表按用户口径**留空**（消费路径由用户指定，不自己臆造）", () => {
    // 上一版曾自己写三条（看答案/要提示/深度复盘）并渲染进界面 —— 用户当场纠正
    // 「有的功能也不是像你说的那样是用棋魂解锁的」。所以现在必须是空表，
    // 但机制要保留（说明页要靠它渲染"暂未开放"那一块）。
    expect(SOUL_SPEND_POINTS.length).toBe(0);
  });

  it("来源表覆盖多渠道，**不只是成就**（用户更正：棋魂不是只有成就可以解锁）", () => {
    const reasons = new Set(SOUL_EARN_RULES.map((rule) => rule.reason));
    // 下棋、做题、识谱、每日、连点、成就 —— 至少这六类。
    // ⚠ 用户的评审稿里删掉了 `review`（复盘）与 `study`（打谱批注）两条 ——
    // 那是产品决定，所以它们**不该**出现在这张清单里了。
    // （但代码里那两处仍在发：已作为待决定的 ⚠ 记在 soul-economy.ts 的对照表里。）
    for (const expected of ["duel-win", "puzzle-solve", "recognition", "daily", "manual", "achievement"] as const) {
      expect(reasons.has(expected)).toBe(true);
    }
    // 每条规则都要有正数金额（成就那条是 0，因为按各成就自己的奖励走）
    for (const rule of SOUL_EARN_RULES) {
      expect(rule.amount).toBeGreaterThanOrEqual(0);
      expect(rule.title.trim()).not.toBe("");
      expect(rule.text.trim()).not.toBe("");
      if (rule.reason !== "achievement") expect(rule.amount).toBeGreaterThan(0);
    }
    // 战胜大师档要比普通取胜给得多（难度定价口径）。
    // ⚠ 具体数额**不写死**（用户在工坊里会调：8/60 → 20/100 就是这么来的）——
    // 这条守的是"两档存在且大师档更高"，不是"必须等于某个数"。
    const duelWinRules = SOUL_EARN_RULES.filter((rule) => rule.reason === "duel-win");
    expect(duelWinRules.length).toBeGreaterThanOrEqual(2);
    const amounts = duelWinRules.map((rule) => rule.amount).sort((a, b) => a - b);
    expect(amounts[0]).toBeLessThan(amounts[amounts.length - 1]);
    // 普通档与大师档都必须是正整数
    for (const amount of amounts) expect(Number.isInteger(amount) && amount > 0).toBe(true);
  });

  it("调度开关表（TUNABLE_REASONS）**不许列出不发棋魂的来源**（假旋钮）", () => {
    /**
     * ⚠ 这条是 2026-10-11 补的，因为踩到了：`TUNABLE_REASONS` 里一直留着
     * `review` / `study`，而它们早已被用户从来源表删掉、代码里的结算点也断了。
     * 于是工坊里那两个"停发"开关**点了什么也不发生** —— 假旋钮。
     * 本项目对假旋钮一贯的态度：宁可没有这个开关。
     *
     * 判据：开关表必须是来源表 reason 的**子集**（反过来不要求 —— 每天一次类的
     * 来源不进开关表是有意的，见那里的注释）。
     */
    const known = new Set(SOUL_EARN_RULES.map((rule) => rule.reason));
    const ghosts = TUNABLE_REASONS.filter((reason) => !known.has(reason) && reason !== "manual" && reason !== "achievement");
    expect(ghosts).toEqual([]);
    // 反向：真来源里"能停发"的那几个必须都在（少一个就是"想停停不掉"）
    for (const reason of ["duel-win", "puzzle-solve", "vcf-solve", "recognition"] as const) {
      expect(TUNABLE_REASONS).toContain(reason);
    }
    // carry 不是来源，不许出现在开关表里（与 normalizeSoulTuning 的过滤口径一致）
    expect(TUNABLE_REASONS).not.toContain("carry");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 棋魂调度项（用户 2026-10-10：「在棋魂的获取以及使用方面多多给我一些调度的选项」）
//
// 这一组测的是**每个旋钮都真的在跑**。本项目的一条纪律：不允许出现
// "界面上能调、实际没人读"的假旋钮 —— 那比没有这个功能更坏，因为它会让用户
// 以为自己改生效了，然后对着不对的数字找半天原因。
// ─────────────────────────────────────────────────────────────────────
describe("棋魂调度项（倍率 / 上限 / 开关 / 口径）", () => {
  /** 每个用例都用干净的账本，避免互相污染。 */
  const freshLedger = (): SoulLedger => ({ version: 1, entries: [], usedTokens: new Set() });
  const tuning = (patch: Partial<SoulTuning> = {}): SoulTuning => normalizeSoulTuning({ ...DEFAULT_SOUL_TUNING, ...patch });

  it("出厂默认是**全中性**的（倍率 1、上限 0=不限、开关全开）", () => {
    const base = normalizeSoulTuning(null);
    expect(base).toEqual(DEFAULT_SOUL_TUNING);
    // 默认下每一档都原样通过 —— 这才保证"没调过的人"看到的就是表上的定价。
    const ledger = freshLedger();
    expect(applyEarnTuning(ledger, 8, "duel-win", base)).toBe(8);
    expect(applyEarnTuning(ledger, 60, "duel-win", base)).toBe(60);
    expect(applySpendTuning(120, base)).toBe(120);
  });

  it("归一化：坏值逐项回落、超界被夹住、来源去重且拒收 carry", () => {
    const bad = normalizeSoulTuning({
      earnMultiplier: 999,            // 超上限 → 夹到 10
      achievementMultiplier: -5,      // 超下限 → 0
      tapAmount: 0,                   // 连点不能是 0（否则机制失效）→ 1
      spendMultiplier: Number.NaN,    // 坏值 → 回落默认
      disabledReasons: ["duel-win", "duel-win", "carry", "不存在的来源"] as never,
      tapCountsAsEarned: "yes" as never,
    });
    expect(bad.earnMultiplier).toBe(10);
    expect(bad.achievementMultiplier).toBe(0);
    expect(bad.tapAmount).toBe(1);
    expect(bad.spendMultiplier).toBe(DEFAULT_SOUL_TUNING.spendMultiplier);
    // carry 不是"来源"，是记账折叠的产物 —— 放进开关里没有意义，必须被丢掉。
    expect(bad.disabledReasons).toEqual(["duel-win"]);
    expect(bad.tapCountsAsEarned).toBe(DEFAULT_SOUL_TUNING.tapCountsAsEarned);
  });

  it("【获取·全局】倍率作用于日常来源，但**不作用于成就**（成就有自己的倍率）", () => {
    const ledger = freshLedger();
    const t = tuning({ earnMultiplier: 3, achievementMultiplier: 1 });
    expect(applyEarnTuning(ledger, 8, "duel-win", t)).toBe(24);
    expect(applyEarnTuning(ledger, 5, "puzzle-solve", t)).toBe(15);
    // 成就走 achievementMultiplier（这里 1）→ 原样
    expect(applyEarnTuning(ledger, 100, "achievement", t)).toBe(100);
    // 把成就倍率单独拉高，只有成就变
    const t2 = tuning({ earnMultiplier: 1, achievementMultiplier: 4 });
    expect(applyEarnTuning(ledger, 8, "duel-win", t2)).toBe(8);
    expect(applyEarnTuning(ledger, 100, "achievement", t2)).toBe(400);
  });

  it("【获取·上限】单次上限**在倍率之后**生效（否则能算出超上限的数）", () => {
    const ledger = freshLedger();
    const t = tuning({ earnMultiplier: 2, earnCapPerGrant: 100 });
    expect(applyEarnTuning(ledger, 80, "duel-win", t)).toBe(100);  // 160 → 夹到 100
    expect(applyEarnTuning(ledger, 40, "duel-win", t)).toBe(80);   // 没到上限，原样
  });

  it("【获取·上限】每日上限用**滚动 24 小时**，且已经入账的会占掉额度", () => {
    const now = 1_700_000_000_000;
    const ledger = freshLedger();
    const t = tuning({ dailyEarnLimit: 100 });
    // 先塞 90 点（10 小时前，窗口内）
    ledger.entries.push({ id: "a", at: now - 10 * 3600_000, amount: 90, reason: "duel-win", detail: "先前的胜局" });
    expect(soulEarnedWithin(ledger, 24 * 3600_000, now, t)).toBe(90);
    // 只剩 10 点额度
    expect(applyEarnTuning(ledger, 60, "duel-win", t, now)).toBe(10);
    // 窗口外的旧账不占额度
    ledger.entries.push({ id: "b", at: now - 30 * 3600_000, amount: 500, reason: "duel-win", detail: "很久以前" });
    expect(soulEarnedWithin(ledger, 24 * 3600_000, now, t)).toBe(90);
    expect(applyEarnTuning(ledger, 60, "duel-win", t, now)).toBe(10);
  });

  it("【获取·上限】额度过关后为 0 → **不写流水**（不留零元记录）", () => {
    const now = 1_700_000_000_000;
    const ledger = freshLedger();
    const t = tuning({ dailyEarnLimit: 10 });
    ledger.entries.push({ id: "a", at: now, amount: 10, reason: "duel-win", detail: "刚好用满" });
    const result = grantSoul(ledger, { amount: 8, reason: "duel-win", detail: "超额", at: now, tuning: t });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("daily-limit");
    expect(ledger.entries.length).toBe(1);      // 账本没被写脏
  });

  it("【获取·开关】停发的来源不入账，且失败原因能区分于额度用尽", () => {
    const ledger = freshLedger();
    const t = tuning({ disabledReasons: ["puzzle-solve"] });
    const off = grantSoul(ledger, { amount: 5, reason: "puzzle-solve", detail: "停发", tuning: t });
    expect(off.ok).toBe(false);
    expect(off.code).toBe("disabled");
    // 别的来源不受影响
    const on = grantSoul(ledger, { amount: 8, reason: "duel-win", detail: "照发", tuning: t });
    expect(on.ok).toBe(true);
    expect(on.balance).toBe(8);
  });

  it("【获取·连点】数额可调，且「不计入累计」时连面板与额度都不算它", () => {
    const ledger = freshLedger();
    const t = tuning({ tapAmount: 5, tapCountsAsEarned: false });
    const result = grantSoul(ledger, { amount: t.tapAmount, reason: "manual", detail: "点了一下魂火", tuning: t });
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(5);
    // 账本照常留痕（余额是真金白银），但统计口径不算它
    expect(countsTowardEarned(result.entry!, t)).toBe(false);
    const summary = summarizeSoul(ledger, t);
    expect(summary.balance).toBe(5);
    expect(summary.earned).toBe(0);
    expect(summary.byReason).toEqual([]);
    // 也不占每日额度（连点按设计就是无限的）
    expect(soulEarnedWithin(ledger, 24 * 3600_000, Date.now(), t)).toBe(0);
    // 反过来：默认口径下它是算的
    const counted = summarizeSoul(ledger, tuning());
    expect(counted.earned).toBe(5);
  });

  it("【获取·对局】输/和默认不给（严格等于用户 10-09 的原话），调了才给", () => {
    const base = tuning();
    // 赢的数额从**来源表**读（表里 20/100 是用户在工坊里调的值；写死 8/60 就是
    // 上一版那个"代码发旧价、说明页显示新价"的 bug，这一条原来还替它兜着）。
    expect(soulForDuelResult("won", "中级", base)).toBe(soulAmount("duel-win", 0));
    expect(soulForDuelResult("won", "大师", base)).toBe(soulAmount("duel-win", -1));
    expect(soulForDuelResult("lost", "中级", base)).toBe(DEFAULT_SOUL_TUNING.lossAmount);
    // ⚠ 和棋是否给钱由 `drawAmount` 决定，而那是用户在工坊里调的旋钮
    // （2026-10-11 他把它设成了 30）——所以这里**跟着调度项走**，不钉死 0。
    // 这条断言真正守的是"默认口径为 0 时不给"，见上一条 `lossAmount` 的写法。
    expect(soulForDuelResult("draw", "中级", base)).toBe(DEFAULT_SOUL_TUNING.drawAmount);
    const generous = tuning({ lossAmount: 3, drawAmount: 5 });
    expect(soulForDuelResult("lost", "中级", generous)).toBe(3);
    expect(soulForDuelResult("draw", "中级", generous)).toBe(5);
    // 取值路径仍与旧函数一致（默认口径不许悄悄漂）
    expect(soulForDuelWin("大师")).toBe(soulForDuelResult("won", "大师", base));
  });

  it("【消耗·倍率与下限】打折不会把消费压到 0（那是白送）", () => {
    expect(applySpendTuning(100, tuning({ spendMultiplier: 1 }))).toBe(100);
    expect(applySpendTuning(100, tuning({ spendMultiplier: 0.5 }))).toBe(50);
    expect(applySpendTuning(100, tuning({ spendMultiplier: 0.1, minimumSpend: 1 }))).toBe(10);
    // 下限生效：再小的倍率也至少扣 minimumSpend
    expect(applySpendTuning(100, tuning({ spendMultiplier: 0.1, minimumSpend: 30 }))).toBe(30);
    // 非法价格不产生消费
    expect(applySpendTuning(0, tuning())).toBe(0);
  });

  it("【消耗·每日上限】超了当天额度就拒绝，且**先算价再判余额**", () => {
    const now = 1_700_000_000_000;
    const ledger = freshLedger();
    ledger.entries.push({ id: "seed", at: now, amount: 1000, reason: "achievement", detail: "本金" });
    const t = tuning({ dailySpendLimit: 100 });
    // 第一笔 60 可以
    const first = spendSoul(ledger, { amount: 60, reason: "manual", detail: "买一", at: now, tuning: t });
    expect(first.ok).toBe(true);
    expect(soulSpentWithin(ledger, 24 * 3600_000, now)).toBe(60);
    // 第二笔 60 会超（60+60 > 100）
    const second = spendSoul(ledger, { amount: 60, reason: "manual", detail: "买二", at: now, tuning: t });
    expect(second.ok).toBe(false);
    expect(second.code).toBe("daily-limit");
    expect(second.balance).toBe(940);           // 余额没动
    // 打折之后够得着的，就该让买 —— 证明是"先算价再判余额"
    const cheap = tuning({ spendMultiplier: 0.1, minimumSpend: 1, dailySpendLimit: 100 });
    const third = spendSoul(ledger, { amount: 60, reason: "manual", detail: "打折买", at: now, tuning: cheap });
    expect(third.ok).toBe(true);
    expect(third.balance).toBe(934);            // 扣了 6（60 × 0.1）
  });

  it("【消耗·余额】不足时给出 insufficient（消费端要据此说不同的话）", () => {
    const ledger = freshLedger();
    const result = spendSoul(ledger, { amount: 10, reason: "manual", detail: "买不起", tuning: tuning() });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("insufficient");
  });

  it("幂等在调度之前判：重复 token 不会被扣两次，也不会被算成额度超限", () => {
    const ledger = freshLedger();
    ledger.entries.push({ id: "seed", at: 1, amount: 500, reason: "achievement", detail: "本金" });
    const t = tuning({ dailySpendLimit: 100 });
    const first = spendSoul(ledger, { amount: 50, reason: "manual", detail: "买", token: "buy:1", tuning: t });
    expect(first.ok).toBe(true);
    const again = spendSoul(ledger, { amount: 50, reason: "manual", detail: "买", token: "buy:1", tuning: t });
    expect(again.ok).toBe(false);
    expect(again.code).toBe("duplicate");       // 不是 daily-limit —— 顺序错了就会误报
    expect(again.balance).toBe(450);
  });

  it("调度单例：`setActiveSoulTuning` 之后**不传 tuning 的调用**也走新档", () => {
    // 这一条钉住的是"旋钮无法被绕过"：grantSoul 不传 tuning 时读的是模块单例。
    const ledger = freshLedger();
    setActiveSoulTuning({ earnMultiplier: 2 });
    const result = grantSoul(ledger, { amount: 10, reason: "duel-win", detail: "走单例" });
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(20);
    setActiveSoulTuning();                      // 还原成出厂默认，别影响后面的用例
    const reset = grantSoul(freshLedger(), { amount: 10, reason: "duel-win", detail: "还原后" });
    expect(reset.balance).toBe(10);
  });

  it("存储键是独立的（改调度不动账本）", () => {
    // 两者分开存是有意的：账本是资产，调度是偏好，混在一起会让"改设置"变成"改账本"。
    expect(SOUL_TUNING_KEY).toBe("banbu-soul-tuning-v1");
  });

  it("消费区文案指向真的商店（2026-10-10 商店上线后不再说「暂未开放」）", () => {
    // 手写消费表仍是空的（它已被 soul-unlocks 的注册表取代，保留只为工坊工具链，
    // 见 soul-economy.ts 里那段注释）——但**说明页不再因此说"暂未开放"**：
    // 现在列的是 76 项真商品，文案要指路到设置页。
    expect(SOUL_SPEND_POINTS.length).toBe(0);
    expect(SOUL_SPEND_NOTE).toContain("设置");
    expect(SOUL_SPEND_NOTE).toContain("解锁");
    // 反向：不许再出现"暂未开放"这类过时说法（它会让用户以为没东西可买）
    expect(SOUL_SPEND_NOTE).not.toContain("暂未开放");
    expect(SOUL_SPEND_NOTE).not.toContain("花不出去");
  });
});

describe("棋魂定价（VCF 挑战 / 人机对局）", () => {
  /**
   * 基础价从**来源表**读，不写死。
   *
   * ⚠ 这里原来的期望是写死的 `6` —— 而表里 `vcf-solve` 是 10（用户在工坊里调的）。
   * 那正是"两处各记一份"的 bug 本身：代码按 6 发、说明页按 10 显示，
   * 而单测把这个错误**钉住了**（它保证的是"6 一直没变"，不是"发了表上的价"）。
   * 所以现在三条 VCF 用例全部以 `SOUL_EARN_RULES` 为基准推导。
   */
  const vcfBase = soulAmount("vcf-solve");

  /**
   * 2026-10-14 用户改口径：「改成基础为 10，每多一手加 2，上限 50」。
   * 旧口径是"每 10 手 +2、最多加 10"（要 50 手才吃满），现在是**逐手**加、**总数**封顶。
   * 线性那几条仍从 vcfBase 推（单价归工坊管），只有封顶那条读常数。
   */
  it("VCF：基础 + 每多一手 +2（第 1 手算在基础价里）", () => {
    expect(soulForVcfProblem(1)).toBe(vcfBase);
    expect(soulForVcfProblem(2)).toBe(vcfBase + SOUL_VCF_HAND_BONUS);
    expect(soulForVcfProblem(10)).toBe(vcfBase + 9 * SOUL_VCF_HAND_BONUS);
    expect(soulForVcfProblem(11)).toBe(vcfBase + 10 * SOUL_VCF_HAND_BONUS);
  });

  it("VCF：单题总数封顶 50，超深题不会失控", () => {
    expect(soulForVcfProblem(20)).toBe(vcfBase + 19 * SOUL_VCF_HAND_BONUS);   // 48，还没顶格
    expect(soulForVcfProblem(21)).toBe(SOUL_VCF_TOTAL_CAP);                   // 10 + 40 = 50 正好顶格
    expect(soulForVcfProblem(50)).toBe(SOUL_VCF_TOTAL_CAP);
    expect(soulForVcfProblem(100)).toBe(SOUL_VCF_TOTAL_CAP);
    expect(soulForVcfProblem(100000)).toBe(SOUL_VCF_TOTAL_CAP);
  });

  it("VCF：坏输入不产生负数或 NaN（0 / 负 / 小数 / Infinity）", () => {
    expect(soulForVcfProblem(0)).toBe(vcfBase);
    expect(soulForVcfProblem(-5)).toBe(vcfBase);
    expect(soulForVcfProblem(10.9)).toBe(vcfBase + 9 * SOUL_VCF_HAND_BONUS);   // 小数按 floor(10.9) = 10 手
    // 非有限数按"无效输入"处理 → 只给基础分，**不给**封顶加成。
    // 理由：真实题目的 depth 永远是有限整数，Infinity/NaN 只可能来自 bug；
    // 那种情况下多发奖励是错的、退回基础分是无害的（这条期望值一开始写反了，被单测纠正）。
    expect(soulForVcfProblem(Number.NaN)).toBe(vcfBase);
    expect(soulForVcfProblem(Number.POSITIVE_INFINITY)).toBe(vcfBase);
    expect(soulForVcfProblem(Number.NEGATIVE_INFINITY)).toBe(vcfBase);
  });

  it("对弈：大师档比普通档给得多", () => {
    /**
     * ⚠ 这两条以前写死 60 / 8 —— 而表里是 100 / 20（用户在工坊里调的）。
     * 与 VCF 那组同一个毛病：单测把 bug 钉住了。现在从表推导，
     * 真正守的是"**分档存在、大师档更高**"，而不是"必须等于某个数"。
     */
    const master = soulAmount("duel-win", -1);
    const normal = soulAmount("duel-win", 0);
    expect(master).toBeGreaterThan(normal);
    expect(soulForDuelWin("大师")).toBe(master);
    for (const strength of ["初级", "中级", "高级", "自由", ""]) {
      expect(soulForDuelWin(strength)).toBe(normal);
    }
    // App 的对局结算走的是同一个函数（不是另抄一份价格），这里反向钉住
    expect(soulForDuelWin("大师")).toBe(soulForDuelResult("won", "大师"));
  });

  it("对弈：**输/和都不扣** —— 定价函数没有任何负值分支", () => {
    // 用户 10-09 明确要求「只有赢了会加，输了不加不扣」。这条函数只会被赢的那一支调用，
    // 但这里反向钉住"无论传什么档位都不可能返回负数/0"。
    for (const strength of ["大师", "初级", "中级", "高级", "自由", "不存在的档", ""]) {
      expect(soulForDuelWin(strength)).toBeGreaterThan(0);
    }
  });
});

describe("棋魂数字格式（过万 w / 过亿 e）", () => {
  it("一万以下原样显示", () => {
    expect(formatSoulAmount(0)).toBe("0");
    expect(formatSoulAmount(1)).toBe("1");
    expect(formatSoulAmount(9999)).toBe("9999");
  });

  it("过万用 w，过亿用 e", () => {
    expect(formatSoulAmount(10_000)).toBe("1w");
    expect(formatSoulAmount(12_345)).toBe("1.2w");
    expect(formatSoulAmount(1_000_000)).toBe("100w");
    expect(formatSoulAmount(100_000_000)).toBe("1e");
    expect(formatSoulAmount(123_456_789)).toBe("1.2e");
  });

  it("进位必须正确：9999 不进位、99999 进到 10w（不能停在 10.0w）", () => {
    expect(formatSoulAmount(9999)).toBe("9999");
    expect(formatSoulAmount(99_999)).toBe("10w");
    // 一亿差一点也不能写成 10000w
    expect(formatSoulAmount(99_999_999)).toBe("10000w");
    expect(formatSoulAmount(100_000_000)).toBe("1e");
  });

  it("过 10 亿不带小数（避免 13.7e 这种读不出量级的写法）", () => {
    expect(formatSoulAmount(1_234_567_890)).toBe("12e");
  });

  it("isSoulAmountAbbreviated 与缩写口径**同源**（说明页靠它决定要不要多写一行「精确」）", () => {
    // 不缩写：说明页不该再写一行"精确 101"—— 那和上面的大字是同一个数（同义重复）。
    expect(isSoulAmountAbbreviated(0)).toBe(false);
    expect(isSoulAmountAbbreviated(101)).toBe(false);
    expect(isSoulAmountAbbreviated(9999)).toBe(false);
    // 缩写：这时紧凑写法有损（1.2w 看不出是 12345 还是 12499），才需要精确值。
    expect(isSoulAmountAbbreviated(10_000)).toBe(true);
    expect(isSoulAmountAbbreviated(12_345)).toBe(true);
    expect(isSoulAmountAbbreviated(123_456_789)).toBe(true);
    // 判据必须是"渲染结果结尾是 w/e"而不是自己抄一份阈值：
    // 边界上要与 formatSoulAmount 完全一致（这里用两边对拍钉住）。
    for (const value of [0, 1, 9999, 10_000, 99_999, 100_000_000]) {
      expect(isSoulAmountAbbreviated(value)).toBe(/[we]$/.test(formatSoulAmount(value)));
    }
    // 负数（退账）走同一条路
    expect(isSoulAmountAbbreviated(-12_345)).toBe(true);
    expect(isSoulAmountAbbreviated(-101)).toBe(false);
  });

  it("负数带负号（退账场景）", () => {
    expect(formatSoulAmount(-250)).toBe("-250");
    expect(formatSoulAmount(-12_345)).toBe("-1.2w");
  });

  it("精确值另给一份（紧凑写法不能让用户查不到真实数字）", () => {
    expect(formatSoulExact(12345)).toBe((12345).toLocaleString("zh-CN"));
  });
});

describe("成就判定引擎", () => {
  const empty: AchievementSources = {};

  it("什么数据都没有时不误解锁 —— **唯一的例外是那条福利成就**", () => {
    const results = evaluateAchievements(empty);
    const met = results.filter((item) => item.met).map((item) => item.id);
    // 用户 2026-10-10：「棋魂系统，这个成就没有任何限制，就是打开就有，相当于每个人的福利」。
    // 所以空数据下**应当且只应当**解开这一条 —— 这条断言把"白送"的边界钉死：
    // 将来谁误把别的成就写成 always，这里立刻红。
    expect(met).toEqual(["soul-welcome-2026"]);
    expect(results.find((item) => item.id === "explore-all-truth")?.met).toBe(false);
  });

  it("福利成就：不需要任何数据源，判据是显式的 always（不是「漏写条件」）", () => {
    const welcome = ACHIEVEMENT_CATALOG.find((item) => item.id === "soul-welcome-2026");
    expect(welcome).toBeDefined();
    expect(welcome?.rule).toEqual({ from: "always", op: "always" });
    // 用户更正过口径：成就名是「棋魂系统」，奖励是 **2026 个棋魂**
    // （第一版我做成了"66 魂的小福利"，被当场纠正）。
    expect(welcome?.title).toBe("棋魂系统");
    expect(welcome?.soul).toBe(2026);
    expect(welcome?.group).toBe("soul");
    // 它**必须**有判据（而不是靠"没有 rule 就解锁"的口子）—— 目录自检也这么要求。
    expect(validateAchievementCatalog()).toEqual([]);
  });

  it("空数据不会让「全图鉴」自己解锁自己（不能死循环/自证）", () => {
    const results = evaluateAchievements(empty);
    const allTruth = results.find((item) => item.id === "explore-all-truth");
    expect(allTruth).toBeDefined();
    expect(allTruth?.met).toBe(false);
  });

  it("对弈首胜 → 解锁首胜与初次交手两条", () => {
    const results = evaluateAchievements({ duel: { games: 1, wins: 1, wonMaster: false, masterStreak: 0, fastestWinMoves: 23, lostByForbidden: false, wonAfterForbidden: false, completedWithoutResign: true, usedClock: false, rating: 1020, streak: 1, draws: 0, longestGame: 30, wonAsWhite: 0, wonAsBlack: 1 } });
    const met = new Set(results.filter((item) => item.met).map((item) => item.id));
    expect(met.has("duel-first-game")).toBe(true);
    expect(met.has("duel-first-win")).toBe(true);
    // 23 手不是速胜（门槛 20 手）。
    expect(met.has("duel-fast-win")).toBe(false);
  });

  it("20 手内取胜才算速胜（边界 20 算、21 不算）", () => {
    // 用户 10-09 第十轮把门槛从 10 手放宽到 20 手：「速战速决这个成就改一下，改成 20 手胜利」
    // （10 手对一般爱好者太苛刻，实战里很难达成）。
    const base = { games: 1, wins: 1, wonMaster: false, masterStreak: 0, lostByForbidden: false, wonAfterForbidden: false, completedWithoutResign: true, usedClock: false, rating: 1000, streak: 1, draws: 0, longestGame: 30, wonAsWhite: 0, wonAsBlack: 1 };
    const at20 = evaluateAchievements({ duel: { ...base, fastestWinMoves: 20 } });
    const at21 = evaluateAchievements({ duel: { ...base, fastestWinMoves: 21 } });
    expect(at20.find((item) => item.id === "duel-fast-win")?.met).toBe(true);
    expect(at21.find((item) => item.id === "duel-fast-win")?.met).toBe(false);
  });

  it("进度条不超过目标（超了要夹到 target，不能显示 120/100）", () => {
    const results = evaluateAchievements({ puzzle: { solved: 999, attempts: 999, clearedCollection: false, wrongCount: 0, clearedWrong: false, dailyDone: 0 } });
    const row = results.find((item) => item.id === "puzzle-solve-100");
    expect(row?.progress).toEqual({ current: 100, target: 100, unit: "题" });
    expect(row?.met).toBe(true);
  });

  it("VCF 挑战用 bestStreak 而不是当前 streak（连胜断了也该留下成就）", () => {
    const results = evaluateAchievements({ vcf: { solved: 12, streak: 0, bestStreak: 10, rating: 1500, todaySolved: 0, attempts: 12, level: 2, longestWinStreak: 10 } });
    const met = new Set(results.filter((item) => item.met).map((item) => item.id));
    expect(met.has("puzzle-vcf-streak-5")).toBe(true);
    expect(met.has("puzzle-vcf-streak-10")).toBe(true);
  });

  it("识谱「满盘」那条（225 手）已被用户在工坊里删掉", () => {
    // 2026-10-11：用户在评审稿里删了这条成就（连同另外 4 条）。
    // 这条测试因此**反向**钉住"它真的没了"——而不是继续断言它的行为
    // （保留旧断言会让测试红，而那与用户意图相反）。
    expect(ACHIEVEMENT_BY_ID.get("recognition-225")).toBeUndefined();
    // 但"识别过 225 手的图"这个事实本身仍然进得来（别的成就可能在用 maxMoves）
    const at225 = evaluateAchievements({ recognition: { count: 1, restoredOrder: true, maxMoves: 225 } });
    expect(at225.some((item) => item.id === "recognition-225")).toBe(false);
  });

  it("集齐 26 开局 / 全图鉴：只有全部其它成就都达成时，全图鉴才解锁", () => {
    // 先把除全图鉴外的每一条都喂成真，再检查全图鉴。
    const everything: AchievementSources = {
      duel: { games: 999, wins: 999, wonMaster: true, masterStreak: 9, fastestWinMoves: 5, lostByForbidden: true, wonAfterForbidden: true, completedWithoutResign: true, usedClock: true, rating: 4000, streak: 99, draws: 1, longestGame: 120, wonAsWhite: 50, wonAsBlack: 50 },
      puzzle: { solved: 9999, attempts: 9999, clearedCollection: true, wrongCount: 99, clearedWrong: true, dailyDone: 99 },
            // attempts 要喂过最高一档（5000）；level 要过 LEVEL_MAX；otherwise 全图鉴永远差几条。
      vcf: { solved: 99, streak: 99, bestStreak: 99, rating: 9999, todaySolved: 99, attempts: 9999, level: 99, longestWinStreak: 99 },
      review: { count: 99, flawless: true },
      recognition: { count: 99, restoredOrder: true, maxMoves: 225 },
      study: { branches: 999, openedBigLibrary: true, usedCrossSearch: true },
      library: { documents: 99, favorites: 99, bookmarks: 99 },
      openingKinds: 26,
      generator: { kinds: ["ordinary", "forbidden", "shape", "text"], maxDepth: 40, count: 99 },
      // tap 与 unlockedAny 是 2026-10-10 新增的两条来源（连点九档 + 第一件收藏）。
      // 全图鉴要求"除自己以外全部达成"，所以这里每一项都要喂满。
      tap: { total: 99_999 },
      signals: { themes: Array.from({ length: 30 }, (_, i) => `t${i}`), readManual: true, customizedLayout: true, didBackup: true, didExport: true, vcfDeepSolved: true, generatorKinds: ["shape", "text"], generatorMaxDepth: 40, generatorCount: 99, tapCount: 99_999, unlockedAny: 3 },
    };
    const results = evaluateAchievements(everything);
    const unmet = results.filter((item) => !item.met).map((item) => item.id);
    expect(unmet).toEqual([]);
    expect(results.find((item) => item.id === "explore-all-truth")?.met).toBe(true);
  });

  it("达成计数与面板进度一致", () => {
    const state = { "duel-first-win": 1, "puzzle-solve-10": 2 };
    const completion = achievementCompletion(state);
    expect(completion.done).toBe(2);
    expect(completion.total).toBe(ACHIEVEMENT_CATALOG.length);
    expect(completion.percent).toBe(Math.round((2 / ACHIEVEMENT_CATALOG.length) * 100));
  });
});
