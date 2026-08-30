const DATABASE_NAME = "banbu-gomoku-recent-imports";
const STORE_NAME = "files";
const DATABASE_VERSION = 1;
const MAX_RECENT_IMPORTS = 5;
const MAX_STORED_FILE_BYTES = 16 * 1024 * 1024;

export type RecentImportKind = "record" | "puzzle";

export interface RecentImportEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: RecentImportKind;
  importedAt: number;
  available: boolean;
}

interface StoredRecentImport extends RecentImportEntry {
  blob?: Blob;
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

const idFor = (file: File, kind: RecentImportKind) => {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${file.name}-${file.size}-${file.lastModified}-${random}`;
};

const publicEntry = ({ blob: _blob, ...entry }: StoredRecentImport): RecentImportEntry => entry;

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
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = await readAll(store);
    const latestImportedAt = existing.reduce((latest, item) => Math.max(latest, item.importedAt), 0);
    const importedAt = Math.max(Date.now(), latestImportedAt + 1);
    const entry: StoredRecentImport = {
      id: idFor(file, kind),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind,
      importedAt,
      available: file.size <= MAX_STORED_FILE_BYTES,
      ...(file.size <= MAX_STORED_FILE_BYTES ? { blob: new Blob([file], { type: file.type || "application/octet-stream" }) } : {}),
    };
    existing.sort((a, b) => b.importedAt - a.importedAt);
    const sameFile = existing.find((item) => item.name === entry.name && item.size === entry.size && item.kind === entry.kind);
    if (sameFile) store.delete(sameFile.id);
    store.put(entry);
    const retained = [entry, ...existing.filter((item) => item.id !== sameFile?.id)].slice(0, MAX_RECENT_IMPORTS);
    const retainedIds = new Set(retained.map((item) => item.id));
    existing.forEach((item) => { if (!retainedIds.has(item.id)) store.delete(item.id); });
    await transactionDone(transaction);
    return publicEntry(entry);
  } finally {
    database.close();
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
