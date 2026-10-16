export const RECORD_BOOKMARKS_KEY = "renju-note-branch-bookmarks-v1";

// 书签标识色（audit 2026-09-17）：原来只有 jade/gold/blue/rose 四色，用户拿书签当
// 轻量分类用时不够分。扩到八色；旧存档里的四色值照旧有效（新增的只是多几个选项）。
export type BookmarkAccent = "jade" | "gold" | "blue" | "rose" | "violet" | "teal" | "orange" | "slate";

/** 供 UI 渲染取色用的稳定顺序（改顺序会让用户记住的位置漂移，别随意动）。 */
export const BOOKMARK_ACCENTS: readonly BookmarkAccent[] = ["jade", "gold", "blue", "rose", "violet", "teal", "orange", "slate"];

export interface RecordBookmark {
  id: string;
  nodeId: string;
  title: string;
  note: string;
  accent?: BookmarkAccent;
  createdAt: string;
  updatedAt: string;
}

export type RecordBookmarks = Record<string, RecordBookmark[]>;

const accents = new Set<BookmarkAccent>(BOOKMARK_ACCENTS);

const text = (value: unknown) => typeof value === "string" ? value : "";
const validDate = (value: unknown, fallback: string) => {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : fallback;
};

export const migrateBookmarkEntry = (value: unknown, now = new Date().toISOString()): RecordBookmark | null => {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const nodeId = text(entry.nodeId).trim();
  if (!nodeId) return null;
  const createdAt = validDate(entry.createdAt, now);
  const rawAccent = text(entry.accent) as BookmarkAccent;
  return {
    id: text(entry.id).trim() || `bookmark-${createdAt.replace(/\D/g, "")}-${nodeId}`,
    nodeId,
    // v1 called this field `name`; keep it as the editable title in v2.
    title: text(entry.title).trim() || text(entry.name).trim() || "未命名书签",
    note: text(entry.note),
    ...(accents.has(rawAccent) ? { accent: rawAccent } : {}),
    createdAt,
    updatedAt: validDate(entry.updatedAt, createdAt),
  };
};

export const migrateBookmarkStore = (value: unknown, now = new Date().toISOString()): RecordBookmarks => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: RecordBookmarks = {};
  for (const [documentId, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const migrated = entries.map((entry) => migrateBookmarkEntry(entry, now)).filter((entry): entry is RecordBookmark => Boolean(entry));
    if (migrated.length) result[documentId] = migrated;
  }
  return result;
};

export const loadRecordBookmarks = (storage: Pick<Storage, "getItem"> = localStorage): RecordBookmarks => {
  try {
    return migrateBookmarkStore(JSON.parse(storage.getItem(RECORD_BOOKMARKS_KEY) || "{}"));
  } catch {
    return {};
  }
};

export const saveRecordBookmarks = (bookmarks: RecordBookmarks, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) => {
  const current = storage.getItem(RECORD_BOOKMARKS_KEY);
  if (current) {
    try { JSON.parse(current); }
    catch {
      const recoveryKey = `${RECORD_BOOKMARKS_KEY}-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      storage.setItem(recoveryKey, current);
    }
  }
  storage.setItem(RECORD_BOOKMARKS_KEY, JSON.stringify(bookmarks));
};

export const searchRecordBookmarks = (bookmarks: RecordBookmark[], query: string) => {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return bookmarks;
  return bookmarks.filter((bookmark) => `${bookmark.title}\n${bookmark.note}`.toLocaleLowerCase("zh-CN").includes(normalized));
};

export const toggleRecordBookmark = (
  bookmarks: RecordBookmark[],
  nodeId: string,
  defaultTitle: string,
  now = new Date().toISOString(),
) => {
  const existing = bookmarks.find((bookmark) => bookmark.nodeId === nodeId);
  if (existing) return bookmarks.filter((bookmark) => bookmark.id !== existing.id);
  return [...bookmarks, {
    id: `bookmark-${Date.parse(now).toString(36)}-${bookmarks.length.toString(36)}`,
    nodeId,
    title: defaultTitle,
    note: "",
    createdAt: now,
    updatedAt: now,
  }];
};

export const updateRecordBookmark = (
  bookmarks: RecordBookmark[],
  id: string,
  patch: Partial<Pick<RecordBookmark, "title" | "note" | "accent">>,
  now = new Date().toISOString(),
) => bookmarks.map((bookmark) => bookmark.id === id ? {
  ...bookmark,
  ...patch,
  title: patch.title === undefined ? bookmark.title : patch.title.trim() || bookmark.title,
  updatedAt: now,
} : bookmark);

export const mergeRecordBookmarks = (bookmarks: RecordBookmark[], additions: RecordBookmark[]) => {
  const additionIds = new Set(additions.map((bookmark) => bookmark.id));
  return [...bookmarks.filter((bookmark) => !additionIds.has(bookmark.id)), ...additions];
};

export const removeRecordBookmarks = (bookmarks: RecordBookmark[], ids: Iterable<string>) => {
  const removed = new Set(ids);
  return removed.size ? bookmarks.filter((bookmark) => !removed.has(bookmark.id)) : bookmarks;
};

/**
 * 孤儿书签检测与清理（audit 2026-09-17）。
 *
 * 删掉一个分支后，挂在被删节点上的书签**不会**被一起清掉——书签只按 nodeId 匹配，
 * 而删除节点走的是 `delete-subtree` 草稿，不触碰 `branchBookmarks`。于是它们会一直
 * 留在书签面板里，点进去找不到棋谱/节点（列表里显示成「未找到的棋谱」）。以前既没有
 * 检测也没有清理入口，只能靠用户自己发现一条条删。
 *
 * 这里给两个纯函数：扫出孤儿的、以及按结果清理。注意**棋谱整份不在了**也算孤儿，
 * 但那种情况恢复备份/换设备时可能出现，所以清理时连同该棋谱的分组一起摘掉。
 */
export interface OrphanBookmarkReport {
  /** documentId → 该棋谱下已失效的书签（节点已不存在或棋谱已不在库中）。 */
  orphans: Record<string, RecordBookmark[]>;
  /** 孤儿书签总数。 */
  count: number;
  /** 涉及多少份棋谱。 */
  documents: number;
}

export const findOrphanBookmarks = (
  bookmarks: RecordBookmarks,
  nodeIdsFor: (documentId: string) => ReadonlySet<string> | null,
): OrphanBookmarkReport => {
  const orphans: Record<string, RecordBookmark[]> = {};
  let count = 0;
  for (const [documentId, entries] of Object.entries(bookmarks)) {
    const nodeIds = nodeIdsFor(documentId);
    // 拿不到节点集合（棋谱已不在库中 / 读取失败）时，该谱下的书签全部视为孤儿。
    const stale = nodeIds ? entries.filter((bookmark) => !nodeIds.has(bookmark.nodeId)) : [...entries];
    if (!stale.length) continue;
    orphans[documentId] = stale;
    count += stale.length;
  }
  return { orphans, count, documents: Object.keys(orphans).length };
};

/** 按检测结果清理，返回清理后的书签库（空分组一并摘掉）。 */
export const pruneOrphanBookmarks = (bookmarks: RecordBookmarks, report: OrphanBookmarkReport): RecordBookmarks => {
  const next: RecordBookmarks = {};
  for (const [documentId, entries] of Object.entries(bookmarks)) {
    const staleIds = new Set((report.orphans[documentId] || []).map((bookmark) => bookmark.id));
    const kept = staleIds.size ? entries.filter((bookmark) => !staleIds.has(bookmark.id)) : entries;
    if (kept.length) next[documentId] = kept;
  }
  return next;
};

export const orphanBookmarkConfirmation = (report: OrphanBookmarkReport) =>
  `发现 ${report.count} 条失效书签（分布 ${report.documents} 份棋谱）：它们指向的节点或棋谱已经不在了。清理后无法撤销，确定清理吗？`;
