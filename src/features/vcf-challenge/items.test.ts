import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VCF 道具（用户 2026-10-10）的行为测试。
 *
 * 这一组守的是**花钱买东西**这条路上最容易出的两类错：
 *  ① **买了不落地**（钱扣了、库存没加）；
 *  ② **用了不扣 / 没用也扣**（后者的实测案例：没落子时点悔棋卡，
 *     页面拒绝了，但道具已经少了一个 —— 见 VcfItemBar 的 onUse 契约）。
 */

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
});

const {
  VCF_ITEMS, vcfItemById, loadVcfItems, saveVcfItems, countOf, addItem, consumeItem, buyVcfItem, buyVcfItems,
  VCF_ITEMS_KEY,
} = await import("./items");

describe("道具表", () => {
  it("只有三种（用户：「就这三种卡」），id 唯一、价格是正整数", () => {
    expect(VCF_ITEMS.length).toBe(3);
    expect(VCF_ITEMS.map((item) => item.id).sort()).toEqual(["extra-time", "hint", "undo"]);
    const ids = new Set<string>();
    for (const item of VCF_ITEMS) {
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(Number.isInteger(item.cost) && item.cost > 0, `${item.id} 价格`).toBe(true);
      expect(item.name.trim().length).toBeGreaterThan(0);
      // 用户点名要"可以知道价格以及用法"：用法文案必须有
      expect(item.text.trim().length).toBeGreaterThan(6);
      expect(item.amount).toBeGreaterThan(0);
    }
  });

  it("定价不贵（一次使用约一局棋的收益，用户：卖的也不能太贵）", () => {
    for (const item of VCF_ITEMS) {
      // 普通局取胜给 8 魂，所以单价都在"几局就能买"的范围里
      expect(item.cost, `${item.name} 太贵了`).toBeLessThanOrEqual(60);
    }
  });

  it("三种效果互不相同（不是三个同名道具）", () => {
    const texts = VCF_ITEMS.map((item) => item.text);
    expect(new Set(texts).size).toBe(3);
  });
});

describe("库存读写", () => {
  beforeEach(() => store.clear());

  it("空存档 = 全 0（不炸）", () => {
    expect(loadVcfItems()).toEqual({});
    expect(countOf({}, "hint")).toBe(0);
  });

  it("数量为 0 的项不写进存档（保持干净）", () => {
    const next = addItem({}, "hint", 1);
    const used = consumeItem(next, "hint").inventory;
    expect(used.hint).toBeUndefined();
    expect(countOf(used, "hint")).toBe(0);
  });

  it("坏存档逐项丢弃（下架 id / 负数 / 字符串都不认）", () => {
    store.set(VCF_ITEMS_KEY, JSON.stringify({ hint: 3, "已经下架的道具": 5, undo: -2, "extra-time": "两个" }));
    const loaded = loadVcfItems();
    expect(loaded.hint).toBe(3);
    expect(loaded.undo).toBeUndefined();
    expect(loaded["extra-time"]).toBeUndefined();
    expect((loaded as Record<string, unknown>)["已经下架的道具"]).toBeUndefined();
  });

  it("存进去读得回来", () => {
    saveVcfItems({ hint: 2, undo: 1 });
    expect(loadVcfItems()).toEqual({ hint: 2, undo: 1 });
  });
});

describe("加减与消耗", () => {
  it("addItem **不改传入的那个**（React 靠引用比对）", () => {
    const before = { hint: 1 };
    const after = addItem(before, "hint", 2);
    expect(before.hint).toBe(1);
    expect(after.hint).toBe(3);
  });

  it("consumeItem 数量不足直接拒绝（不写负数）", () => {
    const result = consumeItem({}, "hint");
    expect(result.ok).toBe(false);
    expect(countOf(result.inventory, "hint")).toBe(0);
  });

  it("consumeItem 扣一个（改的是新对象）", () => {
    const before = { hint: 2 };
    const result = consumeItem(before, "hint");
    expect(result.ok).toBe(true);
    expect(result.inventory.hint).toBe(1);
    expect(before.hint).toBe(2);
  });
});

describe("购买：先扣钱、成功了才加库存", () => {
  beforeEach(() => store.clear());

  it("付款成功 → 库存 +1 并落盘", () => {
    const paid: Array<{ cost: number; detail: string }> = [];
    const result = buyVcfItem({}, "hint", (cost, detail) => { paid.push({ cost, detail }); return true; });
    expect(result.ok).toBe(true);
    expect(countOf(result.inventory, "hint")).toBe(1);
    expect(paid[0].cost).toBe(vcfItemById("hint")!.cost);
    expect(paid[0].detail).toContain("提示卡");
    // 落盘了（换一次会话还在）
    expect(countOf(loadVcfItems(), "hint")).toBe(1);
  });

  it("**付款失败 → 库存不变**（不能先加货后收钱）", () => {
    const result = buyVcfItem({}, "hint", () => false);
    expect(result.ok).toBe(false);
    expect(countOf(result.inventory, "hint")).toBe(0);
    expect(Object.keys(loadVcfItems()).length).toBe(0);
  });

  it("可以重复买（消耗品，不像解锁项那样按 id 幂等）", () => {
    let inventory = {};
    for (let i = 0; i < 3; i += 1) {
      const result = buyVcfItem(inventory, "undo", () => true);
      expect(result.ok).toBe(true);
      inventory = result.inventory;
    }
    expect(countOf(inventory, "undo")).toBe(3);
  });

  it("不存在的 id：拒绝，且**不扣钱**", () => {
    let charged = false;
    const result = buyVcfItem({}, "不存在的道具" as never, () => { charged = true; return true; });
    expect(result.ok).toBe(false);
    expect(charged).toBe(false);
  });

  /**
   * 批量购买（用户 2026-10-11：「棋魂商店里面的道具目前无法批量购买」）。
   *
   * 三条边界：正常买 n 个；钱只够一部分（逐笔停、已成交的留着）；
   * 每次都是**独立的一笔**（token 各不相同，否则会被幂等挡成"花了 n 个的钱只拿 1 个"）。
   */
  describe("批量买同一种道具", () => {
    it("买 5 个 → 库存 +5，且扣了 5 次钱、每次 token 都不同", () => {
      const charges: string[] = [];
      const result = buyVcfItems({}, "hint", 5, (_cost, _detail, token) => { charges.push(token); return true; });
      expect(result.bought).toBe(5);
      expect(countOf(result.inventory, "hint")).toBe(5);
      expect(charges.length).toBe(5);
      // token 必须各不相同（独立消费），否则后 4 笔会被幂等挡掉
      expect(new Set(charges).size).toBe(5);
      expect(countOf(loadVcfItems(), "hint")).toBe(5);   // 落盘
    });

    it("钱只够前 3 个 → 买到 3 个（已成交的留着，不回滚）", () => {
      let n = 0;
      const result = buyVcfItems({}, "undo", 5, () => { n += 1; return n <= 3; });
      expect(result.bought).toBe(3);
      expect(countOf(result.inventory, "undo")).toBe(3);
      expect(n).toBe(4);            // 第 4 次尝试被拒后就停手了（不再白打剩下的）
    });

    it("一次都没买成 → 库存不变、不落盘", () => {
      const result = buyVcfItems({}, "hint", 5, () => false);
      expect(result.bought).toBe(0);
      expect(countOf(result.inventory, "hint")).toBe(0);
      expect(Object.keys(loadVcfItems()).length).toBe(0);
    });

    it("份数非法（0 / 负数）→ 什么都不做；不存在的 id 同理", () => {
      let charged = false;
      expect(buyVcfItems({}, "hint", 0, () => { charged = true; return true; }).bought).toBe(0);
      expect(buyVcfItems({}, "hint", -3, () => { charged = true; return true; }).bought).toBe(0);
      expect(buyVcfItems({}, "不存在" as never, 2, () => { charged = true; return true; }).bought).toBe(0);
      expect(charged).toBe(false);
    });

    it("买 1 个与 buyVcfItem 等价（同一条实现，不是两套）", () => {
      const single = buyVcfItem({}, "hint", () => true);
      const batched = buyVcfItems({}, "hint", 1, () => true);
      expect(batched.bought).toBe(1);
      expect(JSON.stringify(batched.inventory)).toBe(JSON.stringify(single.inventory));
    });
  });
});
