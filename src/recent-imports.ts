const DATABASE_NAME = "banbu-gomoku-recent-imports";
const STORE_NAME = "files";
const DATABASE_VERSION = 1;
// 8 份、单份最大 48MB：定式/开局 .lib 常见 1~20MB（山口谱 17MB），16MB 的上限会把这类
// 文件降级成「只留名字」，那正是群友报「导入的开局谱下次还得重导」的原因。
const MAX_RECENT_IMPORTS = 8;
const MAX_STORED_FILE_BYTES = 48 * 1024 * 1024;

/* 来源种类：棋谱文件 / 题库文件 / **图片识谱** / **粘贴的坐标代码** / **在线棋谱**。
   2026-10-06 用户：「导入那里不应该只有最近导入的棋谱，图片识别或者其他来源的也可以算进去」。
   前两种是文件（存 blob，可一键重开）；后三种不是文件：坐标存文本、图片存那张图片、
   在线棋谱存导下来的 SGF，所以这里既可以是文件也可以是文本。 */
export type RecentImportKind = "record" | "puzzle" | "image" | "coordinate" | "online";

export interface RecentImportEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: RecentImportKind;
  importedAt: number;
  available: boolean;
  /** 非文件来源（坐标代码）的原文；文件来源没有这一项 */
  text?: string;
}

interface StoredRecentImport extends RecentImportEntry {
  blob?: Blob;
  /** 非文件来源（坐标代码）就地存文本 */
  text?: string;
}

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === "undefined") {
    reject(new Error("当前环境不支持最近导入记录"));
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("无法打开最近导入记录"));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error("最近导入记录保存失败"));
  transaction.onabort = () => reject(transaction.error || new Error("最近导入记录保存已中止"));
});

const readAll = (store: IDBObjectStore) => new Promise<StoredRecentImport[]>((resolve, reject) => {
  const request = store.getAll();
  request.onsuccess = () => resolve((request.result || []) as StoredRecentImport[]);
  request.onerror = () => reject(request.error || new Error("无法读取最近导入记录"));
});

const importId = () => {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return random;
};

const publicEntry = ({ blob: _blob, ...entry }: StoredRecentImport): RecentImportEntry => entry;

/** Upserts and trims inside one read/write transaction, so concurrent imports
 * see each other's completed entries and cannot race the eight-item limit. */
const storeRecentEntry = async (
  create: (importedAt: number) => StoredRecentImport,
  matches: (existing: StoredRecentImport, entry: StoredRecentImport) => boolean,
): Promise<RecentImportEntry> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = await readAll(store);
    const importedAt = Math.max(Date.now(), existing.reduce((latest, item) => Math.max(latest, item.importedAt), 0) + 1);
    const entry = create(importedAt);
    // Display names and text prefixes are not identities. Reuse the id only
    // when the actual source matches, including legacy text ids.
    const sameEntry = existing.find((item) => matches(item, entry));
    if (sameEntry) entry.id = sameEntry.id;
    store.put(entry);
    const retained = [entry, ...existing.filter((item) => item.id !== entry.id).sort((a, b) => b.importedAt - a.importedAt)].slice(0, MAX_RECENT_IMPORTS);
    const retainedIds = new Set(retained.map((item) => item.id));
    existing.forEach((item) => { if (!retainedIds.has(item.id)) store.delete(item.id); });
    await transactionDone(transaction);
    return publicEntry(entry);
  } finally {
    database.close();
  }
};

export const loadRecentImports = async (): Promise<RecentImportEntry[]> => {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const entries = await readAll(transaction.objectStore(STORE_NAME));
      return entries.sort((a, b) => b.importedAt - a.importedAt).slice(0, MAX_RECENT_IMPORTS).map(publicEntry);
    } finally {
      database.close();
    }
  } catch {
    return [];
  }
};

export const saveRecentImport = async (file: File, kind: RecentImportKind): Promise<RecentImportEntry> => {
  return storeRecentEntry((importedAt) => ({
      id: `${kind}-${importId()}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind,
      importedAt,
      available: file.size <= MAX_STORED_FILE_BYTES,
      ...(file.size <= MAX_STORED_FILE_BYTES ? { blob: new Blob([file], { type: file.type || "application/octet-stream" }) } : {}),
    }), (item, entry) => item.text === undefined && item.name === entry.name && item.size === entry.size && item.kind === entry.kind);
};

export interface OpenedRecentImport { file: File | null; text: string | null }

/** 非文件来源（粘贴的坐标代码）也进最近列表：就地存文本，不占 blob。 */
export const saveRecentText = async (text: string, kind: RecentImportKind, name: string): Promise<RecentImportEntry> => {
  return storeRecentEntry((importedAt) => ({
    id: `t-${kind}-${importId()}`, name, mimeType: "text/plain", size: text.length, kind,
    importedAt, available: true, text,
  }), (item, entry) => item.kind === entry.kind && item.text === text);
};

/** 读回非文件来源的原文（坐标代码重放用）。 */
export const readRecentImportText = async (id: string): Promise<string | null> => {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(id);
      const entry = await new Promise<StoredRecentImport | undefined>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as StoredRecentImport | undefined);
        request.onerror = () => reject(request.error || new Error("无法读取最近导入"));
      });
      return entry?.text ?? null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
};

export const openRecentImport = async (id: string): Promise<File | null> => {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(id);
      const entry = await new Promise<StoredRecentImport | undefined>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as StoredRecentImport | undefined);
        request.onerror = () => reject(request.error || new Error("无法读取最近导入文件"));
      });
      if (!entry?.blob) return null;
      return new File([entry.blob], entry.name, { type: entry.mimeType, lastModified: entry.importedAt });
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
};
