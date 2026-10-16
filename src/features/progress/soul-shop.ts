/**
 * 棋魂商店的**运行期逻辑**：解锁集合的读写、购买、以及"一次性动作"的执行。
 *
 * ## 与 `soul.ts` 的分工
 *
 * `soul.ts` 管**钱**（账本、余额、扣费原子性）；本文件管**货**（买了什么、能不能用、怎么用）。
 * 分界与 `soul-economy.ts` 之于 `soul.ts` 一致：账务逻辑要过单测、要审；商品与解锁状态
 * 是另一条独立的事，混在一起会让"改商品表"变成"改账本代码"。
 *
 * ## 解锁状态为什么不进账本
 *
 * 账本是**流水**（每一笔钱怎么来怎么去），解锁状态是**当前拥有什么**。
 * 两者混在一起有两个坏处：
 *  · 解锁集合会随账本一起被 `SOUL_LEDGER_LIMIT` 折叠，买过的主题会"过期"；
 *  · 流水是只增的、解锁集合是"一次写入永久有效"，语义不同。
 * 所以独立一份 `banbu-soul-unlocks-v1`，只存 id 数组。
 */

import { recoverSoulPurchases, soulBalance, soulLedger, spendSoul, type SoulLedger } from "./soul";
import { prepareSoulDelivery, SOUL_DELIVERY_UNLOCKS_KEY } from "./soul-deliveries";
import { SOUL_UNLOCKS, soulUnlockById, soulUnlockForTarget, type SoulUnlock, type SoulUnlockKind } from "./soul-unlocks";

export const SOUL_UNLOCKS_KEY = "banbu-soul-unlocks-v1";

const safeStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

/**
 * 已解锁的 id 集合。
 *
 * 校验口径：**只认现在表里还存在的 id**（商品下架后旧存档里的残留 id 会被自然丢掉）。
 * 这一点是有意的 —— 如果把未知 id 也留着，将来某个 id 被复用就会"白送"。
 * 但反过来，**不校验价格**：价格是"买的时候是多少就多少"，改价不该追溯既往。
 */
/**
 * 读解锁集合。**顺带执行一次"在用即赠送"迁移**（见 `grantEquippedAppearance`）。
 *
 * 把迁移挂在这个函数里而不是 App 的启动流程里：任何读解锁状态的地方都会顺带完成它，
 * 不会出现"某个入口忘了调用 ⇒ 老用户看到自己在用的外观被锁"。
 * 迁移自己用 `loadSoulUnlocksRaw` 读，所以不会递归。
 */
export const loadSoulUnlocks = (): Set<string> => {
  recoverSoulPurchases();
  grantEquippedAppearance();
  return loadSoulUnlocksRaw();
};

export const saveSoulUnlocks = (unlocks: Set<string>): boolean => {
  const storage = safeStorage();
  if (!storage) return false;
  try { storage.setItem(SOUL_UNLOCKS_KEY, JSON.stringify([...unlocks])); return true; } catch { return false; }
};

/**
 * ## 老用户的"在用即赠送"（用户 2026-10-10：「如果旧版本的人之前用的是付费外观，
 * 那么上新版本后，就会识别到他用的那些主题呀棋盘棋子什么的，那么那一套就免费送他了」）
 *
 * 商店是这一版才有的，**之前那些外观全是免费的** —— 老用户可能正用着某个现在要收费的
 * 主题/棋盘/棋子。如果不处理，他升级后会发现"我正在用的东西突然要我付钱"，
 * 甚至因为锁着而被弹回默认外观 —— 那等于**把已经在用的功能收走**，是绝对不能做的。
 *
 * 所以做一次**一次性的迁移**：第一次加载商店状态时，把**当前正在用的**三项
 * （主题偏好 / 棋盘 / 棋子）对应的解锁项**直接写进解锁集合**（不扣棋魂），
 * 并打一个标记键防止以后重复执行。
 *
 * 三条口径：
 *  · **只在首次执行**（`SOUL_GRANT_KEY` 存在就跳过）。否则用户后来自己买了别的、
 *    把旧的那套"换掉"之后再切回来，会被再次白送 —— 那就不是迁移而是漏洞了；
 *  · **不扣棋魂**：它是补偿，不是交易；
 *  · 只送**正在用的那一个**（不是"以前用过的全部"）—— 我们只读得到"当前值"，
 *    读不到历史，而"正在用"恰好就是最需要保护的那一个。
 */
export const SOUL_GRANT_KEY = "banbu-soul-grant-v1";

/** 迁移要读的三个存储键（与 App.tsx 里的保持一致；只读，不写）。 */
const APPEARANCE_KEYS = {
  theme: "banbu-theme-preference-v1",
  board: "banbu-board-theme-v1",
  stone: "banbu-stone-theme-v1",
} as const;

/**
 * 首次加载时执行"在用即赠送"。返回是否**新**赠送了东西（调用方据此决定要不要提示）。
 *
 * 由 `loadSoulUnlocks()` 调用（见那里），所以任何读解锁状态的地方都会顺带完成迁移 ——
 * 不需要在 App 的启动流程里额外插一行（那种"记得调用"的约定迟早会漏）。
 */
export const grantEquippedAppearance = (): string[] => {
  const storage = safeStorage();
  if (!storage) return [];
  // 已经执行过就不再跑（见上面口径第一条）
  try { if (storage.getItem(SOUL_GRANT_KEY)) return []; } catch { return []; }

  const granted: string[] = [];
  const read = (key: string): string | null => {
    try { return storage.getItem(key); } catch { return null; }
  };

  const unlocks = new Set<string>();
  const kinds = ["theme", "board", "stone"] as const;
  for (const kind of kinds) {
    const raw = read(APPEARANCE_KEYS[kind]);
    if (!raw) continue;
    // 值可能是带引号的 JSON 字符串，也可能就是裸串（历史上两种都出现过）
    const value = raw.replace(/^"|"$/g, "");
    if (!value) continue;
    // ⚠ 两种写法都要试：主题存的是 `light`/`bamboo`，而材质存的是 `app-jade` 这类；
    // `soulUnlockForTarget` 已经处理了前后缀，这里只需要把原始值递进去。
    const item = soulUnlockForTarget(kind, value);
    // 免费项（默认主题/默认棋盘/默认棋子）没有对应商品 ⇒ undefined，本来就不该送
    if (item) granted.push(item.id);
  }

  if (granted.length) {
    const current = loadSoulUnlocksRaw();
    for (const id of granted) current.add(id);
    if (!saveSoulUnlocks(current)) return [];
  }
  // 赠送成功（或没有赠送项）才标记；存储失败留待下次重试。
  // （用户当时用的可能全是默认项 ⇒ granted 为空，那也是执行过了。）
  try { storage.setItem(SOUL_GRANT_KEY, JSON.stringify(granted)); } catch { /* 忽略 */ }
  return granted;
};

/** 读解锁集合，但**不触发迁移**（迁移内部用它，避免递归）。 */
const loadSoulUnlocksRaw = (): Set<string> => {
  const storage = safeStorage();
  if (!storage) return new Set();
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(SOUL_UNLOCKS_KEY) || "[]"); } catch { return new Set(); }
  if (!Array.isArray(raw)) return new Set();
  const known = new Set(SOUL_UNLOCKS.map((item) => item.id));
  return new Set(raw.filter((item): item is string => typeof item === "string" && known.has(item)));
};

/** 免费项 + 已买项都算"可用"。`cost === 0` 的项（理论上有，便于登记"本来就给你"）直接可用。 */
export const isSoulUnlocked = (unlocks: ReadonlySet<string>, item: SoulUnlock): boolean =>
  item.cost <= 0 || unlocks.has(item.id);

/** 按外观 id 查"这一项锁着吗"。设置页每个选项都调它，所以做成 O(1) 友好的写法。 */
export const isTargetUnlocked = (
  unlocks: ReadonlySet<string>,
  kind: SoulUnlockKind,
  target: string,
): boolean => {
  // ⚠ 免费项（不在商店表里）一律视为已解锁 —— 默认主题/默认棋盘/默认棋子走的就是这条路。
  const item = SOUL_UNLOCKS.find((entry) => entry.kind === kind && entry.target === target);
  return item ? isSoulUnlocked(unlocks, item) : true;
};

/** 取某个外观 id 的价格（没有对应商品 = 免费，返回 0）。 */
export const soulTargetCost = (kind: SoulUnlockKind, target: string): number => {
  const item = SOUL_UNLOCKS.find((entry) => entry.kind === kind && entry.target === target);
  return item ? item.cost : 0;
};

export type PurchaseCode = "ok" | "already" | "not-found" | "not-consumable" | "insufficient" | "daily-limit" | "storage" | "pending";

export interface PurchaseResult {
  code: PurchaseCode;
  /** 变动后的余额（失败时是原余额）。 */
  balance: number;
}

/**
 * 购买一个**可拥有**的解锁项。
 *
 * 顺序很讲究：**先判"买过没有"，再扣钱**。
 * 反过来的话，重复点击会把钱扣掉却什么都不给（幂等 token 用 `unlock:<id>` 兜第二道，
 * 但第一道必须在这里，否则用户看到的是"钱少了、东西没多"）。
 */
export const purchaseSoulUnlock = (
  ledger: SoulLedger,
  unlocks: Set<string>,
  id: string,
): PurchaseResult => {
  const item = soulUnlockById(id);
  if (!item) return { code: "not-found", balance: soulBalance(ledger) };
  // 一次性动作不走这里（它们不能"拥有"，每次使用都要付钱，见 useSoulAction）。
  if (item.consumable) return { code: "not-consumable", balance: soulBalance(ledger) };
  if (unlocks.has(item.id)) return { code: "already", balance: soulBalance(ledger) };
  recoverSoulPurchases(ledger);
  const delivery = { key: SOUL_DELIVERY_UNLOCKS_KEY, id: item.id } as const;
  if (!prepareSoulDelivery(delivery)) return { code: "storage", balance: soulBalance(ledger) };
  // 上次扣款后的投递可能已恢复，稳定 token 保证不会再次收费。
  if (ledger.usedTokens.has(`unlock:${item.id}`)) {
    const current = loadSoulUnlocksRaw();
    current.add(item.id);
    if (!saveSoulUnlocks(current)) return { code: "pending", balance: soulBalance(ledger) };
    unlocks.add(item.id);
    return { code: "ok", balance: soulBalance(ledger) };
  }

  const result = spendSoul(ledger, {
    amount: item.cost,
    reason: "manual",
    detail: `解锁：${item.title}`,
    // 幂等：同一个商品只会扣一次（第二道防线，第一道是上面的 already 判断）。
    token: `unlock:${item.id}`,
    delivery,
  });
  if (!result.ok) {
    return { code: result.code === "invalid" ? "storage" : result.code === "daily-limit" ? "daily-limit" : "insufficient", balance: result.balance };
  }
  if (result.deliveryPending) return { code: "pending", balance: result.balance };
  unlocks.add(item.id);
  return { code: "ok", balance: result.balance };
};

/**
 * 使用一个**一次性动作**（重置等级分之类）：扣费 → 执行 `run()`。
 *
 * ⚠ 顺序是**先扣钱、成功了再执行**。反过来（先执行再扣钱）的话，
 * 余额不足时动作已经生效了、钱却没扣 —— 那就是漏洞。
 *
 * `token` 由调用方给（例如 `reset-duel:<时间戳>`），每次使用都必须是新 token：
 * 这类动作是"用一次付一次"，不能像买商品那样按 id 幂等。
 */
export const useSoulAction = (
  ledger: SoulLedger,
  id: string,
  options: { run: () => void; token: string; detail?: string },
): PurchaseResult => {
  const item = soulUnlockById(id);
  if (!item) return { code: "not-found", balance: soulBalance(ledger) };
  if (!item.consumable) return { code: "not-consumable", balance: soulBalance(ledger) };

  const result = spendSoul(ledger, {
    amount: item.cost,
    reason: "manual",
    detail: options.detail || `使用：${item.title}`,
    token: options.token,
  });
  if (!result.ok) {
    return { code: result.code === "invalid" ? "storage" : result.code === "daily-limit" ? "daily-limit" : "insufficient", balance: result.balance };
  }
  options.run();
  return { code: "ok", balance: result.balance };
};

/**
 * **批量购买**（用户 2026-10-10：「商店里面目前还不能批量购买，只能一个个的买，
 * 你优化一下」）。
 *
 * ## 语义：**逐个买、如实汇报**（不是"全成功或全失败"）
 *
 * 做成事务（要么全买、要么全不买）听起来更"正确"，但实际更糟：
 * 用户勾了 10 件、钱只够 7 件，事务会把**能买的 7 件也退掉** ——
 * 他得自己一件件试才知道买得起哪几件。所以这里逐个走 `purchaseSoulUnlock`，
 * 每件独立成败，最后给他一份清单。
 *
 * 三条保证：
 *  · **不会买超**：每件都走同一个扣费入口，余额不足时那件自然失败（不会出现负余额）；
 *  · **不会重复扣**：`purchaseSoulUnlock` 里已有"买过就拒绝"（`already`）与
 *    幂等 token 两道防线；
 *  · **部分失败也照实落盘**：成功的那几件真的买了（钱也扣了），
 *    所以返回结果里必须逐条说清"哪几件成了、哪几件为什么没成"，
 *    不能让界面只显示一句"部分失败"。
 *
 * 顺序按传入的 `ids` 来（调用方一般按价格或按界面顺序传）——
 * 顺序有意义：同一笔余额下，排在前面的是"先买到"的。所以调用方应当把
 * **最想要的排在前面**（商店里按列表顺序传即可，与用户看到的顺序一致）。
 */
export interface BatchPurchaseResult {
  /** 买成功的 id（顺序与处理顺序一致）。 */
  bought: string[];
  /** 没买成的：id + 原因（用 `describePurchaseFailure` 能直接读给人听）。 */
  failed: Array<{ id: string; code: PurchaseCode }>;
  /** 全部处理完之后的余额。 */
  balance: number;
}

export const purchaseSoulUnlocks = (
  ledger: SoulLedger,
  unlocks: Set<string>,
  ids: readonly string[],
): BatchPurchaseResult => {
  const bought: string[] = [];
  const failed: Array<{ id: string; code: PurchaseCode }> = [];
  for (const id of ids) {
    const item = soulUnlockById(id);
    if (!item || item.consumable) { failed.push({ id, code: "not-found" }); continue; }
    // 已经拥有的当"成功"跳过：批量里重复勾选不该算失败
    if (unlocks.has(item.id)) { bought.push(item.id); continue; }
    const result = purchaseSoulUnlock(ledger, unlocks, item.id);
    if (result.code === "ok" || result.code === "already") bought.push(item.id);
    else failed.push({ id, code: result.code });
  }
  return { bought, failed, balance: soulBalanceOf(ledger) };
};

/** 账本余额（本文件里不想再引一遍 `soulBalance` 的名字，包一层更清楚）。
 *
 *  ⚠ 走**共享账本**（`soul.ts` 的 `soulLedger()`）：上一版这里现读一份盘，
 *  于是 `purchaseSoulUnlocks` 报的余额可能是"另一份副本"的（见共享账本那段）。 */
const soulBalanceOf = (ledger: SoulLedger): number =>
  ledger.entries.reduce((sum, item) => sum + item.amount, 0);

/** 给界面用的一句话（购买/使用失败时告诉用户到底怎么了，而不是只弹个"失败"）。 */
export const describePurchaseFailure = (code: PurchaseCode, cost: number): string => {
  switch (code) {
    case "already": return "这个已经解锁过了。";
    case "not-found": return "找不到这个项目（可能是版本更新后下架了）。";
    case "not-consumable": return "这个项目的类型不对（它不能这样买）。";
    case "daily-limit": return "今天的棋魂消费额度用完了，明天再来。";
    case "storage": return "本地存储暂时不可用，购买未扣费。请稍后重试。";
    case "pending": return "已扣费，商品正在等待保存。存储恢复后会自动到账，请稍后查看。";
    case "insufficient": return `棋魂不够：这个需要 ${cost} 枚。攒一攒（下棋、做题、点魂火都算）。`;
    default: return "";
  }
};

/** 进度条用：已解锁 / 总数（不含一次性动作，那些不是"拥有"）。 */
export const soulUnlockProgress = (unlocks: ReadonlySet<string>): { done: number; total: number; percent: number } => {
  const ownable = SOUL_UNLOCKS.filter((item) => !item.consumable);
  const done = ownable.filter((item) => unlocks.has(item.id)).length;
  const total = ownable.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
};

/** 当前账本余额（购买弹窗要显示"买完还剩多少"，所以要有这个便捷读法）。
 *
 *  ⚠ 必须读**共享账本**：上一版这里 `loadSoulLedger()` 现读一份盘，
 *  而盘上的内容可能已经被另一份副本的旧快照覆盖过 —— 那用户看到的余额就是错的。
 *  走单例既快（不解析 JSON）又准（就是账务用的那一份）。 */
export const currentSoulBalance = (): number =>
  soulLedger().entries.reduce((sum, item) => sum + item.amount, 0);
