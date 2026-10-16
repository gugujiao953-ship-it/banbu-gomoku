import type { GameDocument } from "./types";
import type { PuzzleCollection } from "./puzzles";
import type { LargeDocumentSummary } from "./large-storage";

const RECYCLE_BIN_KEY = "banbu-recycle-bin-v1";

export type RecycleBinEntry =
  | { id: string; kind: "record"; item: GameDocument; folder: string; deletedAt: string }
  | { id: string; kind: "large-record"; item: LargeDocumentSummary; folder: string; deletedAt: string }
  | { id: string; kind: "puzzle-collection"; item: PuzzleCollection; folder: string; deletedAt: string };

const isEntry = (value: unknown): value is RecycleBinEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecycleBinEntry>;
  return typeof entry.id === "string"
    && (entry.kind === "record" || entry.kind === "large-record" || entry.kind === "puzzle-collection")
    && typeof entry.folder === "string"
    && typeof entry.deletedAt === "string"
    && Boolean(entry.item && typeof entry.item === "object");
};

export const loadRecycleBin = (): RecycleBinEntry[] => {
  try {
    const value = JSON.parse(localStorage.getItem(RECYCLE_BIN_KEY) || "[]") as unknown;
    return Array.isArray(value) ? value.filter(isEntry).sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)) : [];
  } catch { return []; }
};

export const saveRecycleBin = (entries: RecycleBinEntry[]) => {
  localStorage.setItem(RECYCLE_BIN_KEY, JSON.stringify(entries));
};

export const addToRecycleBin = (entry: RecycleBinEntry) => {
  const next = [entry, ...loadRecycleBin().filter((item) => !(item.kind === entry.kind && item.id === entry.id))];
  saveRecycleBin(next);
  return next;
};

export const removeFromRecycleBin = (kind: RecycleBinEntry["kind"], id: string) => {
  const next = loadRecycleBin().filter((item) => !(item.kind === kind && item.id === id));
  saveRecycleBin(next);
  return next;
};

export const clearRecycleBin = () => {
  saveRecycleBin([]);
  return [] as RecycleBinEntry[];
};

// ── 保留策略（audit 2026-09-17）────────────────────────────────────────────
// 回收站此前只能手动清空：删得多了会一路占着本机空间，用户也不知道自己攒了多少。
// 这里给一条**保守**上限，两件事都满足才丢，且只丢最旧的那些：
//   1. 总项数超过 MAX；2. 要丢的那一项本身已过 RETENTION_DAYS。
// 所以新删的东西永远来得及反悔，回收站也不会无限膨胀。时间解析不出来的条目一律留下——
// 宁可不清理，也不丢用户的东西。
export const RECYCLE_BIN_RETENTION_DAYS = 90;
export const RECYCLE_BIN_MAX_ENTRIES = 200;

/**
 * 按保留策略裁剪。返回裁剪后的列表与被移除的条数；没有该丢的时原样返回引用。
 * `now` 可注入，便于测试与"改系统时间"的场景。
 */
export const pruneRecycleBin = (entries: RecycleBinEntry[], now = Date.now()): { entries: RecycleBinEntry[]; removed: number } => {
  if (entries.length <= RECYCLE_BIN_MAX_ENTRIES) return { entries, removed: 0 };
  const cutoff = now - RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const isAged = (entry: RecycleBinEntry) => {
    const deletedAt = Date.parse(entry.deletedAt);
    return !Number.isNaN(deletedAt) && deletedAt < cutoff;
  };
  // 已经够旧、过期就走的那些条目。
  const aged = entries.filter(isAged);
  if (!aged.length) return { entries, removed: 0 };
  // 列表按 deletedAt 倒序（loadRecycleBin 已排序）：要丢的是其中最旧的一端。
  const doomed = new Set(aged.slice(Math.max(0, aged.length - (entries.length - RECYCLE_BIN_MAX_ENTRIES))));
  const kept = entries.filter((entry) => !doomed.has(entry));
  return { entries: kept, removed: doomed.size };
};

/** 载入的同时顺手裁剪，返回当前可用列表（在 App 启动/打开回收站时调用）。 */
export const loadRecycleBinPruned = (now = Date.now()): RecycleBinEntry[] => {
  const current = loadRecycleBin();
  const { entries, removed } = pruneRecycleBin(current, now);
  if (removed > 0) saveRecycleBin(entries);
  return entries;
};

/** 给设置页/回收站显示的占用说明。 */
export const recycleBinRetentionHint = (count: number) => `保留策略：最多 ${RECYCLE_BIN_MAX_ENTRIES} 项；超出后只清理 ${RECYCLE_BIN_RETENTION_DAYS} 天前删除的旧项（当前 ${count} 项）`;

export const recycleEntryTitle = (entry: RecycleBinEntry) => entry.kind === "puzzle-collection" ? entry.item.title : entry.item.metadata.title;

export const permanentDeleteConfirmation = (entry: RecycleBinEntry) => `确定永久删除“${recycleEntryTitle(entry)}”吗？此操作无法撤销。`;

export const emptyRecycleBinConfirmation = (count: number) => `确定清空回收站中的 ${count} 项内容吗？清空后无法恢复。`;
