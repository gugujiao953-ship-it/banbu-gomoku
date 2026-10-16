import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **账本只有一份**（2026-10-11 修的真实漏洞的回归守卫）。
 *
 * ## 漏洞是什么（修之前实测复现过）
 *
 * 棋魂账本原来有**两个持有者**，各自 `loadSoulLedger()` 读一份副本：
 *  · `useProgress`（渲染余额与流水，长期持有）；
 *  · `useSoulShop`（买卖时现读一份）。
 *
 * 而 `grantSoul` / `spendSoul` 是**读-改-写**（改传入对象、把它的整份 entries 写回）。
 * 于是：
 *
 * ```
 * ① progress 拿一份旧副本（里面没有商店那笔消费）
 * ② 商店买一件 500 → 扣费落盘
 * ③ 赢一局 → progress 用旧副本写回 ⇒ **那笔 -500 被整段抹掉**
 * ```
 *
 * 后果不是"数字差一点"，而是**钱退回来了、东西还留着**（解锁集合在另一个键上）。
 * 买完随便做点什么就白拿。
 *
 * ## 这一组守什么
 *
 *  · 两处拿到的必须是**同一个账本实例**（单例）；
 *  · 商店买完再 earn，消费记录**不许被抹掉**；
 *  · 反向：earn 之后商店读到的余额要跟着涨（两个方向都要通）；
 *  · 账本写入会**广播修订号**（界面靠它重渲染，不然数字停在旧的）。
 */

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
vi.stubGlobal("localStorage", new MemoryStorage());

const { grantSoul, soulLedger, soulLedgerRevision, resetSoulLedger } = await import("./soul");
const { purchaseSoulUnlock, currentSoulBalance } = await import("./soul-shop");
const { SOUL_UNLOCKS, soulUnlockForTarget } = await import("./soul-unlocks");

/** 一件真商品（不在乎是哪件，只要是收费的）。 */
const item = SOUL_UNLOCKS.find((entry) => !entry.consumable && entry.cost > 0)!;

describe("账本单例（防「两处各记一份」造成丢账）", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSoulLedger();
  });

  it("两处拿到的是**同一个对象**（不是各自读一份盘）", () => {
    const first = soulLedger();
    const second = soulLedger();
    expect(second).toBe(first);
  });

  it("**商店买完之后再 earn，那笔消费不许被抹掉**（修之前会）", () => {
    const ledger = soulLedger();
    grantSoul(ledger, { amount: 5000, reason: "achievement", detail: "本金", token: "seed" });
    const balanceAfterSeed = currentSoulBalance();
    expect(balanceAfterSeed).toBe(5000);

    const buy = purchaseSoulUnlock(ledger, new Set<string>(), item.id);
    expect(buy.code).toBe("ok");
    expect(currentSoulBalance()).toBe(5000 - item.cost);

    // 关键一步：**再用同一个账本**入一笔（模拟"买完接着赢一局"）
    grantSoul(ledger, { amount: 20, reason: "duel-win", detail: "赢一局", token: "duel:1" });

    // 消费记录还在（修之前这一笔会被整段覆盖掉，余额回到 5020）
    const spent = ledger.entries.filter((entry) => entry.amount < 0);
    expect(spent.length).toBe(1);
    expect(currentSoulBalance()).toBe(5000 - item.cost + 20);
  });

  it("反向：earn 之后商店读到的余额跟着涨（余额不再'停在旧数字'）", () => {
    const ledger = soulLedger();
    grantSoul(ledger, { amount: 100, reason: "achievement", detail: "本金", token: "seed" });
    expect(currentSoulBalance()).toBe(100);
    grantSoul(ledger, { amount: 20, reason: "duel-win", detail: "赢一局", token: "duel:2" });
    expect(currentSoulBalance()).toBe(120);
  });

  it("每次写入都广播修订号（界面靠它重渲染）", () => {
    const before = soulLedgerRevision();
    grantSoul(soulLedger(), { amount: 5, reason: "manual", detail: "点一下", token: "tap:1" });
    expect(soulLedgerRevision()).toBeGreaterThan(before);
    const afterEarn = soulLedgerRevision();
    // 幂等跳过（token 重复）**不该**广播 —— 没有变更就没有重渲染
    grantSoul(soulLedger(), { amount: 5, reason: "manual", detail: "点一下", token: "tap:1" });
    expect(soulLedgerRevision()).toBe(afterEarn);
  });

  it("失败的授予/消费也不广播（没有变更）", () => {
    const ledger = soulLedger();
    const before = soulLedgerRevision();
    // 余额不足：spendSoul 拒绝
    const tooMuch = purchaseSoulUnlock(ledger, new Set<string>(), item.id);
    expect(tooMuch.code).toBe("insufficient");
    expect(soulLedgerRevision()).toBe(before);
  });

  it("resetSoulLedger 之后重新读盘（恢复备份/清空数据要用）", () => {
    grantSoul(soulLedger(), { amount: 77, reason: "achievement", detail: "本金", token: "seed" });
    const revisionBefore = soulLedgerRevision();
    resetSoulLedger();
    expect(soulLedgerRevision()).toBeGreaterThan(revisionBefore);
    // 重新读盘：内容与落盘一致
    expect(soulLedger().entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(77);
  });

  it("外观解锁项也能查到（确认测试用的是真实商品，不是空表）", () => {
    expect(soulUnlockForTarget("theme", "bamboo")).toBeDefined();
    expect(item.cost).toBeGreaterThan(0);
  });
});
