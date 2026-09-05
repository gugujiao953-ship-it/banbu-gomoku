import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

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

export interface NativeDirectoryHandleLike {
  readonly kind: "native";
  readonly name: string;
  readonly directory: Directory;
  readonly path: string;
}

export type ExportDirectoryHandle = DirectoryHandleLike | NativeDirectoryHandleLike;

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
}

const browserWindow = () => (typeof window === "undefined" ? null : window as DirectoryPickerWindow);

export const supportsDirectoryPicker = () => Boolean(browserWindow()?.showDirectoryPicker);
export const supportsNativeExportDirectory = () => Capacitor.isNativePlatform();
export const isNativeDirectoryHandle = (handle: ExportDirectoryHandle | null | undefined): handle is NativeDirectoryHandleLike => Boolean(handle && "kind" in handle && handle.kind === "native");

export const nativeExportDirectoryHandle = (): NativeDirectoryHandleLike => ({
  kind: "native",
  name: "手机文档 / 半步五子棋打谱 / 导出",
  directory: Directory.Documents,
  path: "半步五子棋打谱/导出",
});

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

export const loadDefaultDirectoryHandle = async (): Promise<ExportDirectoryHandle | null> => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DEFAULT_HANDLE_KEY);
      request.onsuccess = () => { database.close(); resolve((request.result as ExportDirectoryHandle | undefined) || null); };
      request.onerror = () => { database.close(); resolve(null); };
    } catch {
      database.close();
      resolve(null);
    }
  });
};

const saveDefaultDirectoryHandle = async (handle: ExportDirectoryHandle) => {
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

export const pickDefaultDirectoryHandle = async (): Promise<ExportDirectoryHandle> => {
  if (supportsNativeExportDirectory()) {
    const permission = await Filesystem.checkPermissions();
    const granted = permission.publicStorage === "granted" ? permission : await Filesystem.requestPermissions();
    if (granted.publicStorage !== "granted") throw new Error("未获得手机文档目录权限，请允许后重试");
    const handle = nativeExportDirectoryHandle();
    await saveDefaultDirectoryHandle(handle);
    return handle;
  }
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

const blobToBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
};

export const writeFileToDirectory = async (handle: ExportDirectoryHandle, filename: string, content: BlobPart, type: string) => {
  if (isNativeDirectoryHandle(handle)) {
    await Filesystem.writeFile({
      path: `${handle.path}/${filename}`,
      data: await blobToBase64(new Blob([content], { type })),
      directory: handle.directory,
      recursive: true,
    });
    return;
  }
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
