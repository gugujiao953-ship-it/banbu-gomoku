const DATABASE_NAME = "banbu-file-destination-v1";
const STORE_NAME = "handles";
const DEFAULT_HANDLE_KEY = "default-export-directory";

export type FileSystemPermission = "granted" | "denied" | "prompt";

export interface WritableFileLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?: Promise<void> | (() => Promise<void>);
}

export interface FileHandleLike {
  createWritable(): Promise<WritableFileLike>;
}

/**
 * The File System Access API types are not present in every TypeScript DOM
 * library used to build this app. Keep the small surface we need local so the
 * rest of the UI does not depend on browser-specific global declarations.
 */
export interface DirectoryHandleLike {
  readonly name: string;
  queryPermission?: (options: { mode: "readwrite" }) => Promise<FileSystemPermission>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<FileSystemPermission>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
}

const browserWindow = () => (typeof window === "undefined" ? null : window as DirectoryPickerWindow);

export const supportsDirectoryPicker = () => Boolean(browserWindow()?.showDirectoryPicker);

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

export const loadDefaultDirectoryHandle = async (): Promise<DirectoryHandleLike | null> => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DEFAULT_HANDLE_KEY);
      request.onsuccess = () => { database.close(); resolve((request.result as DirectoryHandleLike | undefined) || null); };
      request.onerror = () => { database.close(); resolve(null); };
    } catch {
      database.close();
      resolve(null);
    }
  });
};

const saveDefaultDirectoryHandle = async (handle: DirectoryHandleLike) => {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(handle, DEFAULT_HANDLE_KEY);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); resolve(); };
    } catch {
      database.close();
      resolve();
    }
  });
};

export const clearDefaultDirectoryHandle = async () => {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(DEFAULT_HANDLE_KEY);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); resolve(); };
    } catch {
      database.close();
      resolve();
    }
  });
};

export const pickDefaultDirectoryHandle = async (): Promise<DirectoryHandleLike> => {
  const picker = browserWindow()?.showDirectoryPicker;
  if (!picker) throw new Error("当前浏览器不支持选择默认文件夹");
  const handle = await picker({ mode: "readwrite" });
  await saveDefaultDirectoryHandle(handle);
  return handle;
};

const ensureWritePermission = async (handle: DirectoryHandleLike) => {
  const options = { mode: "readwrite" } as const;
  let permission: FileSystemPermission = handle.queryPermission ? await handle.queryPermission(options) : "granted";
  if (permission !== "granted" && handle.requestPermission) permission = await handle.requestPermission(options);
  if (permission !== "granted") throw new Error("默认文件夹权限已失效，请在设置中重新选择");
};

export const writeFileToDirectory = async (handle: DirectoryHandleLike, filename: string, content: BlobPart, type: string) => {
  await ensureWritePermission(handle);
  const file = await handle.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(new Blob([content], { type }));
    await writable.close();
  } catch (error) {
    if (typeof writable.abort === "function") await writable.abort();
    throw error;
  }
};

export const writeTextFileToDirectory = writeFileToDirectory;
