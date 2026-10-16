/**
 * 棋魂商店的**可订阅状态**（`useSyncExternalStore`）。
 *
 * ## 为什么不用 props 往下传
 *
 * 解锁状态要用的地方有：外观设置里的主题卡、棋盘材质卡、棋子材质卡，以及设置页里
 * 几个"一次性动作"按钮。而它们分别处在
 * `App` → `SettingsPage` → `AppearancePanes`/`VisualThemeSettings` 这条四层链上
 * （外观还分三个版面，各自渲染一遍）。
 *
 * 把 `unlocks` / `ledger` / `buy` 三个东西沿这条链逐层透传，会改动七八处签名，
 * 而 `App.tsx` 长期有并行会话在改（改造表里反复出现"两个会话撞车"）。
 *
 * 账本是 `soulLedger()` 的共享单例，进度与商店订阅同一修订号。这里做的是一个
 * **只读投影 + 写命令**的小 store：它不存余额，余额永远从共享账本实读；
 * 它只维护"解锁集合"这一份状态，并在变更时通知所有订阅者。
 *
 * ## 口径
 *
 *  · `subscribe` / `getSnapshot` 遵守 `useSyncExternalStore` 的契约
 *    （`getSnapshot` 必须返回**稳定引用**，否则会无限重渲染 —— 所以快照是缓存的）；
 *  · 外观/道具购买把扣款和待发商品一起写入账本，商品存储失败时增量恢复，
 *    道具使用则先成功保存扣库存再执行效果；这里负责命令接线与快照通知。
 */

import { useCallback, useSyncExternalStore } from "react";
import { recoverSoulPurchases, soulLedger, soulLedgerRevision, spendSoul, subscribeSoulLedger, type SoulLedger, type SoulReason } from "./soul";
import {
  describePurchaseFailure, loadSoulUnlocks, purchaseSoulUnlock, purchaseSoulUnlocks,
  useSoulAction, type BatchPurchaseResult, type PurchaseCode,
} from "./soul-shop";
import type { SoulUnlock } from "./soul-unlocks";
// VCF 道具：库存也由这个 store 持有（它是"用棋魂买到的东西"的另一半，
// 与解锁集合同一个生命周期；见 vcf-challenge/items.ts 顶上的分工说明）。
import {
  buyVcfItem, buyVcfItems, consumeStoredVcfItem, loadVcfItems, vcfItemById, type VcfInventory, type VcfItemId,
} from "../vcf-challenge/items";

/** 缓存的快照。**必须是稳定引用**（`useSyncExternalStore` 的要求）。 */
interface ShopSnapshot {
  /** 已解锁的 id（每次变更换一个新 Set —— Set 的内容比对不可靠，换引用最省事）。 */
  unlocks: ReadonlySet<string>;
  /** VCF 道具库存（每次变更换一个新对象，理由同上）。 */
  items: VcfInventory;
  /** 当前余额。**跟着账本修订号走**（见 `getSnapshot`：账本一变就重读）。 */
  balance: number;
}

/**
 * 快照缓存 + 它对应哪一版账本（`soulLedgerRevision()`）。
 *
 * 为什么要记这个修订号：余额会在**商店之外**变（下棋赢了、成就发奖），
 * 而那时没人调 `emit()`。如果快照只是"上次 emit 时的余额"，界面就会停在旧数字上
 * （实测过"账本 3226、商店面板 1200"）。所以 `getSnapshot` 每次被问到都先看一眼
 * 修订号，变了就重算 —— 这样"任何来源的入账"都会反映出来，且不必到处插通知。
 */
let snapshot: ShopSnapshot = { unlocks: loadSoulUnlocks(), items: loadVcfItems(), balance: readBalance() };
let snapshotRevision = soulLedgerRevision();
const listeners = new Set<() => void>();

function readBalance(): number {
  try {
    return soulLedger().entries.reduce((sum, item) => sum + item.amount, 0);
  } catch { return 0; }
}

/**
 * 把快照换成一个**全新的对象 + 全新的 Set**，再通知订阅者。
 *
 * ⚠ 两处引用都必须是新的，少一处就会出"买了不生效"：
 *  · `useSyncExternalStore` 用 `Object.is` 比对快照 —— 对象换了它才会重渲染；
 *  · 而 `isUnlocked` 是 `useCallback(..., [state.unlocks])`，`Set` 引用不变时
 *    回调不会重建、`LockableOption` 拿到的 `unlocked` 就一直是旧的 `false`
 *    （表现：钱扣了、存档也写了，卡片上那枚魂火价格**还在**）。
 *
 * 我第一版这里写的是 `{ unlocks: snapshot.unlocks, ... }`（复用同一个 Set），
 * 门禁第 4 组两条直接红 —— 这正是那条断言存在的理由。
 */
function emit() {
  snapshot = { unlocks: new Set(loadSoulUnlocks()), items: { ...loadVcfItems() }, balance: readBalance() };
  snapshotRevision = soulLedgerRevision();
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  /**
   * **同时跟着账本修订号**（2026-10-11 补的关键一条）。
   *
   * 余额会在商店之外变（下棋赢了、解了题、成就发奖），那些路径不会调 `emit()`，
   * 所以只订阅本 store 的话，商店显示的余额会停在旧数字上
   * （实测过"账本 3226、商店面板 1200"）。
   * 挂上账本订阅之后：任何入账/消费都会让 React 重新问一次 `getSnapshot`，
   * 而它会按修订号发现"该重算了" —— 两边永远一致。
   */
  const unsubscribeLedger = subscribeSoulLedger(listener);
  return () => { listeners.delete(listener); unsubscribeLedger(); };
};

/**
 * 快照读法：**先对账本修订号**（见 `snapshot` 的注释）。
 *
 * 修订号变了 ⇒ 余额（可能还有别的）已经不是这一份了，重算一份新的再交出去。
 * `useSyncExternalStore` 用 `Object.is` 比对返回值，所以换了引用它就会重渲染。
 */
const getSnapshot = (): ShopSnapshot => {
  recoverSoulPurchases();
  if (soulLedgerRevision() !== snapshotRevision) {
    snapshot = { unlocks: new Set(loadSoulUnlocks()), items: { ...loadVcfItems() }, balance: readBalance() };
    snapshotRevision = soulLedgerRevision();
  }
  return snapshot;
};

/**
 * 账本实例：**共享的那一份**（`soulLedger()`）。
 *
 * ⚠ 上一版这里是 `loadSoulLedger()` —— 每次真读盘、拿一份**新副本**。
 * 后果是买完之后 `useProgress` 再用它自己那份旧副本写一笔，就把这次消费
 * 整段覆盖掉（钱退回、东西还在）。详见 `soul.ts` 里"共享账本实例"那段。
 * 现在买卖与入账都落在同一个对象上，读-改-写不会互相覆盖。
 */
const ledgerRef = (): SoulLedger => soulLedger();

/** 给非 React 调用方：现在解锁了哪些。 */
export const currentUnlocks = (): ReadonlySet<string> => getSnapshot().unlocks;

/**
 * 让外部（例如"清空数据"、恢复备份）也能把商店状态重新同步一遍。
 *
 * 现在它主要是"解锁集合与库存变了但账本没变"那类改动的收口点
 * （余额那一半由修订号自动兜住，见 `getSnapshot`）。
 */
export const refreshSoulShop = (): void => {
  emit();
};

export interface ShopApi {
  unlocks: ReadonlySet<string>;
  balance: number;
  /** VCF 道具库存（图标下面那个数量）。 */
  items: VcfInventory;
  /**
   * 买一个道具（花棋魂）。返回 `""` 表示成功，否则是给人看的失败原因。
   * 供 VCF 页的"用完了 → 弹购买框"那条路用。
   */
  buyItem: (id: VcfItemId) => string;
  /**
   * **批量买同一种道具**（用户 2026-10-11：「道具目前无法批量购买」）。
   * 返回实际买到的个数和未成交原因，支持余额/额度/存储故障的准确提示。
   */
  buyItems: (id: VcfItemId, count: number) => { bought: number; failure: string };
  /**
   * 消耗一个道具。**调用方负责在成功后再执行效果**（返回 `true` 才继续），
   * 这样"扣掉道具"与"生效"的顺序是确定的（先扣、再做事）。
   */
  useItem: (id: VcfItemId) => boolean;
  /** 买一个可拥有的项。返回 `""` 表示成功，否则是给人看的失败原因。 */
  buy: (item: SoulUnlock) => string;
  /**
   * **批量购买**（用户 2026-10-10：「商店里面目前还不能批量购买，只能一个个的买」）。
   * 逐个买、如实汇报（见 `purchaseSoulUnlocks` 的注释：不做事务，因为
   * 钱只够一部分时把能买的也退掉更糟）。
   */
  buyMany: (ids: readonly string[]) => BatchPurchaseResult;
  /** 用一个一次性动作（先扣钱、成功了再执行 `run`）。 */
  spend: (item: SoulUnlock, run: () => void, detail?: string) => string;
  /**
   * **按数额直接消费**（2026-10-13，人机对弈的「悔棋」10 魂一次）。
   *
   * 为什么单开一条：`spend()` 要一个 `SoulUnlock`（商店里那 76 项注册表商品），
   * 而"悔一次棋"不是商品 —— 它没有 id、不上架、可重复买。硬套 `SoulUnlock` 就得
   * 往注册表里塞一条假商品，那条表是按"外观/一次性解锁"渲染的，假商品会出现在商店列表里。
   * 返回 `""` 表示扣成功，否则是给人看的失败原因（余额不足 / 当日限额）。
   */
  spendAmount: (amount: number, reason: SoulReason, detail: string, token?: string) => string;
  /** 这个外观 id 解锁了吗（`item` 为 undefined = 没上架，永远可用）。 */
  isUnlocked: (item: SoulUnlock | undefined) => boolean;
}

export function useSoulShop(): ShopApi {
  // 余额会**在商店之外**变（下棋、做题、成就都会入账），而快照里带着余额 ——
  // 所以 `subscribe` 里同时挂上了账本修订号（见那里的注释），这里不必再单独订阅一次。
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const buy = useCallback((item: SoulUnlock): string => {
    const result = purchaseSoulUnlock(ledgerRef(), ensureMutableUnlocks(), item.id);
    if (result.code === "ok") {
      emit();
      return "";
    }
    if (result.code === "already") { emit(); return ""; }   // 幂等：已拥有视作成功
    return describePurchaseFailure(result.code as PurchaseCode, item.cost);
  }, []);

  /**
   * 批量购买。**每次都重新读一份解锁集合**（理由同 `ensureMutableUnlocks`：
   * 连点确认时第二次可能还拿着旧的引用）。
   */
  const buyMany = useCallback((ids: readonly string[]): BatchPurchaseResult => {
    const result = purchaseSoulUnlocks(ledgerRef(), ensureMutableUnlocks(), ids);
    emit();
    return result;
  }, []);

  const spend = useCallback((item: SoulUnlock, run: () => void, detail?: string): string => {
    const token = `action:${item.id}:${Date.now()}`;
    const result = useSoulAction(ledgerRef(), item.id, { run, token, detail });
    if (result.code === "ok") {
      emit();
      return "";
    }
    return describePurchaseFailure(result.code as PurchaseCode, item.cost);
  }, []);

  const spendAmount = useCallback((amount: number, reason: SoulReason, detail: string, token?: string): string => {
    const result = spendSoul(ledgerRef(), { amount, reason, detail, token: token ?? `spend:${reason}:${Date.now()}` });
    if (result.ok) {
      emit();
      return "";
    }
    return describePurchaseFailure(result.code as PurchaseCode, amount);
  }, []);

  /**
   * ⚠ 每次购买都**重新读一份**解锁集合（而不是复用上面 `state.unlocks`）：
   * 后者是 React 渲染时的快照，连点两次确认框时第二次可能还拿着旧引用。
   * 读盘很便宜（一个小数组），换来"不会因为拿到旧集合而重复买/漏记"。
   */
  function ensureMutableUnlocks(): Set<string> {
    return new Set(loadSoulUnlocks());
  }

  const buyItem = useCallback((id: VcfItemId): string => {
    const item = vcfItemById(id);
    if (!item) return "找不到这个道具（可能是版本更新后下架了）。";
    const ledger = ledgerRef();
    const result = buyVcfItem(loadVcfItems(), id, (cost, detail, token, delivery) =>
      spendSoul(ledger, { amount: cost, reason: "manual", detail, token, delivery }));
    if (!result.ok) return describePurchaseFailure(result.code ?? "insufficient", item.cost);
    emit();
    return "";
  }, []);

  /**
   * **批量买同一种道具**（用户 2026-10-11：「棋魂商店里面的道具目前无法批量购买」）。
   *
   * 返回**实际买到的个数**：逐个买、不做事务（口径见 `buyVcfItems` 的注释）——
   * 钱只够前几个时，已成交的留着，调用方拿这个数如实汇报"买到 3 个、还差 2 个"。
   */
  const buyItems = useCallback((id: VcfItemId, count: number): { bought: number; failure: string } => {
    const ledger = ledgerRef();
    const result = buyVcfItems(loadVcfItems(), id, count, (cost, detail, token, delivery) =>
      spendSoul(ledger, { amount: cost, reason: "manual", detail, token, delivery }));
    if (result.bought > 0) emit();
    return {
      bought: result.bought,
      failure: result.code ? describePurchaseFailure(result.code, vcfItemById(id)?.cost ?? 0) : "",
    };
  }, []);

  const useItem = useCallback((id: VcfItemId): boolean => {
    // ⚠ 每次都**重新读一份**库存再消耗（不是复用 state.items）：连点两次"用"时
    // 第二次可能还拿着旧快照，会多扣一个（或扣不掉）。
    if (!consumeStoredVcfItem(id)) return false;
    emit();
    return true;
  }, []);

  const isUnlocked = useCallback(
    (item: SoulUnlock | undefined) => !item || item.cost <= 0 || state.unlocks.has(item.id),
    [state.unlocks],
  );

  return { unlocks: state.unlocks, balance: state.balance, items: state.items, buy, buyMany, spend, spendAmount, buyItem, buyItems, useItem, isUnlocked };
}

/**
 * ⚠ 这里原本有一个 `writeUnlocksForTest(ids)` ——"测试用，直接写解锁集合"。
 * **2026-10-11 删掉了**，两个原因：
 *
 *  ① **没有任何调用者**（连测试都没用；全仓库搜只有它自己的定义）。
 *     留着一个"产品路径不要调"的导出，等于留一把放在门口却没人管的钥匙。
 *  ② 它是一条**现成的白拿通道**：`__bb.eval` 能执行任意表达式，
 *     而 `?debug=1` 在正式网页包里也有效（见 debug-bridge 的激活条件），
 *     于是 `__bb.eval('…writeUnlocksForTest([...全部 id])')` 就能一次拿全。
 *
 * 测试要直接写解锁集合的话用 `saveSoulUnlocks()`（`soul-shop.ts` 里本来就有，
 * 语义清楚、也不假装自己是产品 API）。删除而不是"加个环境判断"：
 * 本项目不留死代码，而这个函数的存在价值从一开始就是零。
 */
