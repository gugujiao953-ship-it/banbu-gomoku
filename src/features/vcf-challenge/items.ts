/**
 * VCF 挑战的**道具**（用户 2026-10-10：「我想搞几个 vcf 挑战的道具，加时卡，提示卡，悔棋卡。
 * 就这三种卡，你可以都做图标，下面是数量，有一个+号，可以知道价格以及用法」）。
 *
 * ## 只有三种，而且都是"帮一手"的性质
 *
 *  | 道具 | 效果 | 为什么它不破坏这个玩法 |
 *  |---|---|---|
 *  | 加时卡 | 本题时间 +30 秒 | 计时是 VCF 的难度档位之一（`PACE_GAIN` 影响得分），加时只是把这一局的时间补回来，**不改变等级分计算** |
 *  | 提示卡 | 亮出正确答案的**下一手**（只一步） | VCF 的难点是"连续冲四"的算路，看一手仍然要自己往下算 |
 *  | 悔棋卡 | 撤销本题的**上一手** | 与棋盘本身的"撤销"不同：本模块的悔棋**回退判定用的落子记录**，让用户能改一手重算 |
 *
 * ## 三道自律（延续 `soul-unlocks.ts` 的口径）
 *
 *  ① **不卖赢**：没有"直接过关""跳过本题"这类道具 —— 那会让等级分失去意义；
 *  ② **单价便宜、可反复买**：它们是消耗品，不是解锁项；定价按"一次收益≈几局棋"来；
 *  ③ **不卖数量上限**：不设"背包容量"之类的二次收费，买了就有。
 *
 * ## 存档
 *
 * 库存存在 `banbu-vcf-items-v1`（`{ [itemId]: 数量 }`）。**不进账本**：
 * 账本记的是"钱怎么来怎么去"，库存是"现在手上有什么"——与解锁集合同一条分工
 * （见 `soul-shop.ts` 顶上的注释）。
 */

import { recoverSoulPurchases, type SoulMutation } from "../progress/soul";
import {
  prepareSoulDelivery, SOUL_DELIVERY_ITEMS_KEY, SOUL_DELIVERY_RECEIPTS_KEY, soulDeliveryReceipts,
  type SoulPurchaseDelivery,
} from "../progress/soul-deliveries";

/** 三种道具的 id。**发布后不可改**（存档按它记数量）。 */
export type VcfItemId = "extra-time" | "hint" | "undo";

export interface VcfItem {
  id: VcfItemId;
  /** 界面上显示的名字 */
  name: string;
  /** 一句话说明它干什么（用户点名要"可以知道价格以及用法"里的**用法**） */
  text: string;
  /** 单价（棋魂）。 */
  cost: number;
  /** 一次使用生效多少（秒 / 手），用于文案与实现共用同一个数 */
  amount: number;
  /** 使用效果的量词（"+30 秒"里的"秒"） */
  unit: string;
}

/**
 * 道具表。定价口径：**一次使用 ≈ 一局棋的收益**（普通局 8、赢大师 60），
 * 所以取 15–40 之间 —— 让"偶尔用一下"没有负担，"一直靠道具过关"比下棋还贵。
 */
export const VCF_ITEMS: readonly VcfItem[] = [
  {
    id: "extra-time",
    name: "加时卡",
    text: "本题限时 +30 秒。只把这一局的时间补回来，不改等级分算法（计时影响的是得分倍率）。",
    cost: 15,
    amount: 30,
    unit: "秒",
  },
  {
    id: "hint",
    name: "提示卡",
    text: "亮出正解的下一手（只一步，剩下的仍要自己往下算）。",
    cost: 40,
    amount: 1,
    unit: "手",
  },
  {
    id: "undo",
    name: "悔棋卡",
    text: "撤销本题你刚下的那一手，重新算这一步。",
    cost: 25,
    amount: 1,
    unit: "手",
  },
];

export const vcfItemById = (id: VcfItemId): VcfItem | undefined =>
  VCF_ITEMS.find((item) => item.id === id);

/** 库存存档键。 */
export const VCF_ITEMS_KEY = "banbu-vcf-items-v1";

/** 库存：`{ [id]: 数量 }`。缺失 = 0。 */
export type VcfInventory = Partial<Record<VcfItemId, number>>;

const safeStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

/**
 * 读库存。**逐项校验**：只认现在表里还存在的 id、数量取非负整数
 * （与 `soul-shop` 的解锁集合同一条口径：下架项自然消失，坏数据当作没有）。
 */
export const loadVcfItems = (): VcfInventory => {
  recoverSoulPurchases();
  const storage = safeStorage();
  if (!storage) return {};
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(VCF_ITEMS_KEY) || "{}"); } catch { return {}; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: VcfInventory = {};
  for (const item of VCF_ITEMS) {
    const value = (raw as Record<string, unknown>)[item.id];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[item.id] = Math.floor(value);
    }
  }
  return out;
};

export const saveVcfItems = (inventory: VcfInventory): boolean => {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    let raw: unknown;
    try { raw = JSON.parse(storage.getItem(VCF_ITEMS_KEY) || "{}"); } catch { raw = {}; }
    const receipts = soulDeliveryReceipts(raw);
    const next: Record<string, unknown> = {};
    for (const item of VCF_ITEMS) {
      const value = inventory[item.id];
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) next[item.id] = value;
    }
    if (receipts.length) next[SOUL_DELIVERY_RECEIPTS_KEY] = receipts;
    storage.setItem(VCF_ITEMS_KEY, JSON.stringify(next));
    return true;
  } catch { return false; }
};

/** 某一项有几个（缺失 = 0）。 */
export const countOf = (inventory: VcfInventory, id: VcfItemId): number =>
  Math.max(0, Math.floor(inventory[id] ?? 0));

/** 加若干个（购买之后调）。返回新库存（**不改传入的那个**，便于 React 比对）。 */
export const addItem = (inventory: VcfInventory, id: VcfItemId, count = 1): VcfInventory =>
  ({ ...inventory, [id]: countOf(inventory, id) + Math.max(0, Math.floor(count)) });

/**
 * 消耗一个。**数量不足直接拒绝**（不写负数）——和 `spendSoul` 的余额底线同一个道理：
 * 调用方只看 `ok`，不必自己先查数量再扣（那中间有竞态窗口）。
 */
export const consumeItem = (inventory: VcfInventory, id: VcfItemId): { ok: boolean; inventory: VcfInventory } => {
  const have = countOf(inventory, id);
  if (have <= 0) return { ok: false, inventory };
  const next = { ...inventory, [id]: have - 1 };
  // 归零就把键删掉：存档干净，`countOf` 对缺失也返回 0，行为一致。
  if (next[id] === 0) delete next[id];
  return { ok: true, inventory: next };
};

/** 必须成功保存扣库存才允许页面执行效果；写盘失败时保留原道具。 */
export const consumeStoredVcfItem = (id: VcfItemId): boolean => {
  const result = consumeItem(loadVcfItems(), id);
  return result.ok && saveVcfItems(result.inventory);
};

// ─────────────────────────────────────────────────────────────────────
// 购买（花棋魂）
// ─────────────────────────────────────────────────────────────────────

/**
 * 买一个道具：**先从账本扣钱、成功了才加库存**。
 *
 * ⚠ 顺序不能反。反过来的话余额不足时会**白送一个道具**（加了库存、钱没扣成），
 * 而那种 bug 极难发现（用户只会觉得"有时不用钱"）。同 `soul-shop.ts` 的 `useSoulAction`。
 *
 * 幂等 token 用 `item:<id>:<时间戳>`：道具是**消耗品**，每次买都是新的一笔，
 * 所以不能用"按 id 幂等"（那会让第二次购买被挡掉）。时间戳保证每次唯一；
 * 同一毫秒内的重复点击由 UI 层的禁用挡（见 VcfItemBar）。
 */
type VcfItemSpend = (
  cost: number, detail: string, token: string, delivery: SoulPurchaseDelivery,
) => boolean | SoulMutation;

export const buyVcfItem = (
  inventory: VcfInventory,
  id: VcfItemId,
  spend: VcfItemSpend,
): { ok: boolean; inventory: VcfInventory; code?: "storage" | "pending" | "insufficient" | "daily-limit" } => {
  const result = buyVcfItems(inventory, id, 1, spend);
  return { ok: result.bought === 1, inventory: result.inventory, ...(result.code ? { code: result.code } : {}) };
};

/**
 * **批量买同一个道具的 n 个**（用户 2026-10-11：「棋魂商店里面的道具目前无法批量购买」）。
 *
 * ## 为什么是"同一种买 n 个"而不是"多选几种一起结"
 *
 * 商店里三种道具的价格**各自不同**（加时卡 / 提示卡 / 悔棋卡各一价），
 * 而"多选 → 一键结算"那套（外观那边用的）要求"每件单价一样"才好算总价
 * （那边的汇总写的是 `已选 N 件 · 共 N × 单价`）。道具没有这个前提，
 * 硬做多选就得逐项累加、还要处理"钱只够前两件"的部分成功——
 * 而用户要的其实是"这玩意儿我要一次买 5 个"。
 *
 * 所以这里做成**单个道具的份数**：`买 → [1] [5] [10]`，语义直白、总价一眼可算。
 *
 * ## 逐个买、不做事务（与 `purchaseSoulUnlocks` 同一条口径）
 *
 * 买第 3 个时钱不够 ⇒ 前 2 个**留着**（已经成交的不能退回，那才是把用户的钱
 * 凭空没收）。返回 `bought` 让调用方如实说"买到 2 个、还差 1 个"。
 *
 * token 带序号：一次买 5 个是**五笔独立消费**，不能用同一个 token
 * （那样后 4 笔会被幂等挡掉，变成"花了 5 个的钱只拿到 1 个"）。
 */
export const buyVcfItems = (
  inventory: VcfInventory,
  id: VcfItemId,
  count: number,
  spend: VcfItemSpend,
): { bought: number; inventory: VcfInventory; code?: "storage" | "pending" | "insufficient" | "daily-limit" } => {
  const item = vcfItemById(id);
  const wanted = Number.isFinite(count) ? Math.max(0, Math.min(1000, Math.floor(count))) : 0;
  if (!item || wanted <= 0) return { bought: 0, inventory };
  let next = inventory;
  let bought = 0;
  for (let index = 0; index < wanted; index += 1) {
    const delivery = { key: SOUL_DELIVERY_ITEMS_KEY, id, count: 1 } as const;
    if (!prepareSoulDelivery(delivery)) return { bought, inventory: next, code: "storage" };
    const paid = spend(
      item.cost,
      `购买道具：${item.name}${wanted > 1 ? `（第 ${index + 1}/${wanted} 个）` : ""}`,
      `item:${id}:${Date.now()}:${purchaseSeq++}`,
      delivery,
    );
    if (typeof paid === "boolean") {
      if (!paid) return { bought, inventory: next, code: "insufficient" };
      const added = addItem(next, id);
      if (!saveVcfItems(added)) return { bought, inventory: next, code: "pending" };
      next = added;
    } else {
      if (!paid.ok) return { bought, inventory: next, code: paid.code === "invalid" ? "storage" : paid.code === "daily-limit" ? "daily-limit" : "insufficient" };
      if (paid.deliveryPending) return { bought, inventory: next, code: "pending" };
      next = loadVcfItems();
    }
    bought += 1;
  }
  return { bought, inventory: next };
};

let purchaseSeq = 0;
