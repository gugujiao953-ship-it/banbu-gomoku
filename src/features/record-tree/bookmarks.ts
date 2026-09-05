export const RECORD_BOOKMARKS_KEY = "renju-note-branch-bookmarks-v1";

export type BookmarkAccent = "jade" | "gold" | "blue" | "rose";

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

const accents = new Set<BookmarkAccent>(["jade", "gold", "blue", "rose"]);

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
