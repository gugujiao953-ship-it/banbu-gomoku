import { soulUnlockById } from "./soul-unlocks";

/** 固定白名单；存档里的待发商品不能指定任意 localStorage 键或任意写入内容。 */
export const SOUL_DELIVERY_UNLOCKS_KEY = "banbu-soul-unlocks-v1";
export const SOUL_DELIVERY_ITEMS_KEY = "banbu-vcf-items-v1";
export const SOUL_DELIVERY_RECEIPTS_KEY = "pendingSoulPurchases";

export type SoulPurchaseDelivery =
  | { key: typeof SOUL_DELIVERY_UNLOCKS_KEY; id: string }
  | { key: typeof SOUL_DELIVERY_ITEMS_KEY; id: "extra-time" | "hint" | "undo"; count: number };
export type PendingSoulPurchase = SoulPurchaseDelivery & { token: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isItemId = (value: unknown): value is "extra-time" | "hint" | "undo" =>
  value === "extra-time" || value === "hint" || value === "undo";

export const validSoulDelivery = (value: unknown): value is SoulPurchaseDelivery => {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (value.key === SOUL_DELIVERY_UNLOCKS_KEY) {
    const item = soulUnlockById(value.id);
    return !!item && !item.consumable;
  }
  return value.key === SOUL_DELIVERY_ITEMS_KEY && isItemId(value.id)
    && typeof value.count === "number" && Number.isSafeInteger(value.count) && value.count > 0 && value.count <= 1000;
};

export const validPendingSoulPurchase = (value: unknown): value is PendingSoulPurchase =>
  isRecord(value) && typeof value.token === "string"
    && value.token.length > 0 && value.token.length <= 200 && validSoulDelivery(value);

/** 已经不可写的商品存储先拒绝购买，减少需要延后投递的交易。 */
export const prepareSoulDelivery = (delivery: SoulPurchaseDelivery): boolean => {
  if (!validSoulDelivery(delivery)) return false;
  try {
    if (typeof localStorage === "undefined") return false;
    const current = localStorage.getItem(delivery.key);
    localStorage.setItem(delivery.key, current ?? (delivery.key === SOUL_DELIVERY_UNLOCKS_KEY ? "[]" : "{}"));
    return true;
  } catch { return false; }
};

const readJson = (storage: Storage, key: string): unknown => {
  const raw = storage.getItem(key);
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
};

export const soulDeliveryReceipts = (value: unknown): string[] => {
  if (!isRecord(value)) return [];
  const receipts = value[SOUL_DELIVERY_RECEIPTS_KEY];
  return Array.isArray(receipts)
    ? [...new Set(receipts.filter((token): token is string => typeof token === "string" && token.length > 0 && token.length <= 200))]
    : [];
};

/** 增量合并当前存档。道具数与 receipt 同一次写入，清账中断后重放也不重复加货。 */
export const applySoulDelivery = (storage: Storage, delivery: PendingSoulPurchase): "delivered" | "already" | "failed" => {
  if (!validPendingSoulPurchase(delivery)) return "failed";
  try {
    const raw = readJson(storage, delivery.key);
    if (delivery.key === SOUL_DELIVERY_UNLOCKS_KEY) {
      const owned = new Set(Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string" && !!soulUnlockById(id) && !soulUnlockById(id)!.consumable)
        : []);
      if (owned.has(delivery.id)) return "already";
      owned.add(delivery.id);
      storage.setItem(delivery.key, JSON.stringify([...owned]));
    } else {
      const current = isRecord(raw) ? raw : {};
      const receipts = soulDeliveryReceipts(current);
      if (receipts.includes(delivery.token)) return "already";
      const value = current[delivery.id];
      const have = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
      if (!Number.isSafeInteger(have + delivery.count)) return "failed";
      storage.setItem(delivery.key, JSON.stringify({
        ...current, [delivery.id]: have + delivery.count,
        [SOUL_DELIVERY_RECEIPTS_KEY]: [...receipts, delivery.token],
      }));
    }
    return "delivered";
  } catch { return "failed"; }
};

/** 清掉已从账本确认的 receipt；失败可下次再清，不能影响已经成交的商品。 */
export const pruneSoulDeliveryReceipts = (storage: Storage, pendingTokens: ReadonlySet<string>): void => {
  try {
    const raw = readJson(storage, SOUL_DELIVERY_ITEMS_KEY);
    if (!isRecord(raw)) return;
    const previous = soulDeliveryReceipts(raw);
    const retained = previous.filter((token) => pendingTokens.has(token));
    if (retained.length === previous.length) return;
    const next = { ...raw };
    if (retained.length) next[SOUL_DELIVERY_RECEIPTS_KEY] = retained;
    else delete next[SOUL_DELIVERY_RECEIPTS_KEY];
    storage.setItem(SOUL_DELIVERY_ITEMS_KEY, JSON.stringify(next));
  } catch { /* receipt 的清理可以延后 */ }
};
