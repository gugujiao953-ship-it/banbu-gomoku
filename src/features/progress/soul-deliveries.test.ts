import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  grantSoul, loadSoulLedger, recoverSoulPurchases, resetSoulLedger, setActiveSoulTuning, soulBalance,
  soulLedger, spendSoul, SOUL_LEDGER_KEY, SOUL_LEDGER_LIMIT,
} from "./soul";
import {
  loadSoulUnlocks, grantEquippedAppearance, purchaseSoulUnlock, SOUL_GRANT_KEY, SOUL_UNLOCKS_KEY,
} from "./soul-shop";
import { soulUnlockById } from "./soul-unlocks";
import {
  buyVcfItem, buyVcfItems, consumeStoredVcfItem, loadVcfItems, saveVcfItems, vcfItemById, VCF_ITEMS_KEY,
} from "../vcf-challenge/items";

/** 提示卡的单价：断言一律从表里取，**不写死数字**（价格是用户在调的旋钮，钉死等于每次调价都要改测试）。 */
const HINT = vcfItemById("hint")!;
const UNDO = vcfItemById("undo")!;

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  });
  resetSoulLedger();
  setActiveSoulTuning();
});

const seededLedger = () => {
  const ledger = soulLedger();
  grantSoul(ledger, { amount: 5000, reason: "manual", detail: "测试本金" });
  return ledger;
};

describe("购买写盘失败与中断恢复", () => {
  it("商品存储预检不可写时，外观和道具都不扣费、不报成功", () => {
    const ledger = seededLedger();
    const before = soulBalance(ledger);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === SOUL_UNLOCKS_KEY || key === VCF_ITEMS_KEY) throw new Error("quota");
      values.set(key, value);
    });
    expect(purchaseSoulUnlock(ledger, new Set(), "theme-eye").code).toBe("storage");
    expect(buyVcfItem({}, "hint", (cost, detail, token, delivery) =>
      spendSoul(ledger, { amount: cost, reason: "manual", detail, token, delivery })).code).toBe("storage");
    expect(soulBalance(ledger)).toBe(before);
  });

  it("外观扣款后连续写盘失败，重启恢复后自动解锁，重试购买不再扣费", () => {
    const ledger = seededLedger();
    const item = soulUnlockById("theme-eye")!;
    let unlockWrites = 0;
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === SOUL_UNLOCKS_KEY && ++unlockWrites > 1) throw new Error("quota");
      values.set(key, value);
    });
    expect(purchaseSoulUnlock(ledger, new Set(), item.id).code).toBe("pending");
    expect(recoverSoulPurchases(ledger)).toBe(false);
    expect(ledger.entries.flatMap((entry) => entry.pendingPurchases ?? [])).toHaveLength(1);
    expect(soulBalance(ledger)).toBe(5000 - item.cost);
    vi.restoreAllMocks();
    resetSoulLedger();
    expect(loadSoulUnlocks().has(item.id)).toBe(true);
    expect(purchaseSoulUnlock(soulLedger(), new Set(), item.id).code).toBe("ok");
    expect(soulBalance(soulLedger())).toBe(5000 - item.cost);
    expect(soulLedger().entries.flatMap((entry) => entry.pendingPurchases ?? [])).toEqual([]);
  });

  it("道具扣费后库存不可写，补发增量保留其他道具与已有库存", () => {
    const ledger = seededLedger();
    let inventoryWrites = 0;
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === VCF_ITEMS_KEY && ++inventoryWrites > 1) throw new Error("quota");
      values.set(key, value);
    });
    const result = buyVcfItem({}, "hint", (cost, detail, token, delivery) =>
      spendSoul(ledger, { amount: cost, reason: "manual", detail, token, delivery }));
    expect(result.code).toBe("pending");
    expect(result.ok).toBe(false);
    expect(soulBalance(ledger)).toBe(5000 - HINT.cost);
    vi.restoreAllMocks();
    // 恢复之前已经有别的道具，不能把购买时的 {} 快照覆盖回来。
    saveVcfItems({ hint: 2, undo: 3 });
    resetSoulLedger();
    expect(loadVcfItems()).toEqual({ hint: 3, undo: 3 });
    expect(loadVcfItems()).toEqual({ hint: 3, undo: 3 });
    expect(soulBalance(soulLedger())).toBe(5000 - HINT.cost);
  });

  it("道具已投递但清账持续失败，随后消费、重启、再恢复都不重发", () => {
    const ledger = seededLedger();
    let ledgerWrites = 0;
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === SOUL_LEDGER_KEY && ++ledgerWrites > 1) throw new Error("ledger unavailable");
      values.set(key, value);
    });
    const result = buyVcfItem({}, "hint", (cost, detail, token, delivery) =>
      spendSoul(ledger, { amount: cost, reason: "manual", detail, token, delivery }));
    expect(result.ok).toBe(true);
    expect(loadVcfItems()).toEqual({ hint: 1 });
    expect(consumeStoredVcfItem("hint")).toBe(true);
    expect(loadVcfItems()).toEqual({});
    resetSoulLedger();
    expect(loadVcfItems()).toEqual({});
    vi.restoreAllMocks();
    resetSoulLedger();
    expect(loadVcfItems()).toEqual({});
    expect(soulLedger().entries.flatMap((entry) => entry.pendingPurchases ?? [])).toEqual([]);
    expect(JSON.parse(values.get(VCF_ITEMS_KEY)!)).toEqual({});
    expect(soulBalance(soulLedger())).toBe(5000 - HINT.cost);
  });

  it("流水折叠净额为零或非零都保留尚未投递的商品", () => {
    for (const zeroCarry of [false, true]) {
      values.clear();
      const pendingPurchases = [{ key: VCF_ITEMS_KEY, id: "hint", count: 1, token: "pending" }];
      values.set(SOUL_LEDGER_KEY, JSON.stringify([
        { id: "paid", at: 1, amount: -30, reason: "manual", detail: "已扣费", token: "pending", pendingPurchases },
        { id: "offset", at: 2, amount: zeroCarry ? 30 : 31, reason: "manual", detail: "本金" },
        ...Array.from({ length: SOUL_LEDGER_LIMIT - 2 }, (_, index) => ({
          id: `fill-${index}`, at: index + 3, amount: 1, reason: "manual", detail: "流水",
        })),
      ]));
      const ledger = loadSoulLedger();
      grantSoul(ledger, { amount: 1, reason: "manual", detail: "触发折叠" });
      expect(loadSoulLedger().entries.flatMap((entry) => entry.pendingPurchases ?? [])).toHaveLength(1);
      expect(recoverSoulPurchases(ledger)).toBe(true);
      resetSoulLedger();
      expect(loadVcfItems()).toEqual({ hint: 1 });
    }
  });

  it("未可信存档不能投递任意键、未知道具、非法数量或一次性动作", () => {
    values.set("sensitive-key", "preserved");
    values.set(SOUL_LEDGER_KEY, JSON.stringify([{
      id: "bad", at: 1, amount: -1, reason: "manual", detail: "坏待发", pendingPurchases: [
        { key: "sensitive-key", id: "hint", count: 1, token: "bad1" },
        { key: VCF_ITEMS_KEY, id: "unknown", count: 1, token: "bad2" },
        { key: VCF_ITEMS_KEY, id: "hint", count: -1, token: "bad3" },
        { key: VCF_ITEMS_KEY, id: "hint", count: Infinity, token: "bad4" },
        { key: SOUL_UNLOCKS_KEY, id: "action-vcf-start-3", token: "bad5" },
      ],
    }]));
    resetSoulLedger();
    recoverSoulPurchases();
    expect(values.get("sensitive-key")).toBe("preserved");
    expect(values.has(VCF_ITEMS_KEY)).toBe(false);
    expect(values.has(SOUL_UNLOCKS_KEY)).toBe(false);
    expect(soulLedger().entries[0].pendingPurchases).toEqual([]);
  });

  it("同一毫秒连续购买仍分别扣费和到账，批量保留已成交数量", () => {
    const ledger = seededLedger();
    vi.spyOn(Date, "now").mockReturnValue(100);
    const spend = (amount: number, detail: string, token: string, delivery: Parameters<typeof spendSoul>[1]["delivery"]) =>
      spendSoul(ledger, { amount, reason: "manual", detail, token, delivery });
    expect(buyVcfItem({}, "hint", spend).ok).toBe(true);
    expect(buyVcfItem(loadVcfItems(), "hint", spend).ok).toBe(true);
    expect(loadVcfItems()).toEqual({ hint: 2 });
    expect(soulBalance(ledger)).toBe(5000 - HINT.cost * 2);
    const batch = buyVcfItems(loadVcfItems(), "undo", 1000, spend);
    /**
     * 买到几个 = **剩下的钱能买几个**，所以这个数完全由单价推出来，不写死：
     * 上一版这里钉的是 `494`（提示 30 ×2 + 悔棋 10 → 正好除尽、余额归零），
     * 而 2026-10-13 把三张卡的定价退回用户最初那版（加时 15 / 提示 40 / 悔棋 25）之后
     * 那个数就变了 —— 写死等于每次调价都要来改测试（同一口径见 `qa/soul-pricing-check.mjs`）。
     */
    const affordable = Math.floor((5000 - HINT.cost * 2) / UNDO.cost);
    expect(batch.bought).toBe(affordable);
    expect(loadVcfItems()).toEqual({ hint: 2, undo: affordable });
    expect(soulBalance(ledger)).toBe(5000 - HINT.cost * 2 - affordable * UNDO.cost);
    expect(soulBalance(ledger)).toBeLessThan(UNDO.cost);   // 余额只剩"买不起一张"的零头，这才叫买光了
    vi.restoreAllMocks();
  });

  it("道具消费无法落盘时不生效，赠送无法落盘时不标记迁移完成", () => {
    saveVcfItems({ hint: 1 });
    values.set("banbu-theme-preference-v1", "bamboo");
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(consumeStoredVcfItem("hint")).toBe(false);
    expect(loadVcfItems()).toEqual({ hint: 1 });
    expect(grantEquippedAppearance()).toEqual([]);
    expect(values.has(SOUL_GRANT_KEY)).toBe(false);
    vi.restoreAllMocks();
    expect(grantEquippedAppearance()).toEqual(["theme-bamboo"]);
    expect(loadSoulUnlocks().has("theme-bamboo")).toBe(true);
  });
});
