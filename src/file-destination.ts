import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

const DATABASE_NAME = "banbu-file-destination-v1";
const STORE_NAME = "handles";
const DEFAULT_HANDLE_KEY = "default-export-directory";

/** Documents/<folder> is where exports land before the user picks their own folder. */
export const DEFAULT_NATIVE_EXPORT_FOLDER = "半步五子棋打谱/导出";

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

/** Android's public Downloads folder, written through MediaStore (API 29+). */
export interface DownloadsDirectoryHandleLike {
  readonly kind: "downloads";
  readonly name: string;
  /** Folder inside Downloads, e.g. "半步五子棋打谱/导出". */
  readonly folder: string;
}

/** A folder the user picked through the Android system document picker (SAF). */
export interface SafDirectoryHandleLike {
  readonly kind: "saf";
  readonly name: string;
  readonly uri: string;
  /** Where the folder sits, as far as SAF will tell us (e.g. "Documents/棋谱").
   *  Android deliberately hides absolute paths, so this is the tree document id
   *  with the volume prefix stripped — enough for the user to recognise it. */
  readonly location?: string;
}

export type ExportDirectoryHandle = DirectoryHandleLike | NativeDirectoryHandleLike | SafDirectoryHandleLike | DownloadsDirectoryHandleLike;

interface ExportDirectoryPluginApi {
  chooseDirectory(options?: { initialUri?: string }): Promise<{ uri: string; name: string; location?: string }>;
  checkDirectory(options: { uri: string }): Promise<{ granted: boolean; name?: string; location?: string }>;
  releaseDirectory(options: { uri: string }): Promise<void>;
  writeFile(options: { uri: string; filename: string; mimeType: string; data: string }): Promise<void>;
  checkDownloads(): Promise<{ available: boolean }>;
  writeFileToDownloads(options: { folder: string; filename: string; mimeType: string; data: string }): Promise<void>;
}

// The native plugin only exists inside the Android build; on the web the
// registration returns a stub whose calls reject, so every use is guarded.
const exportDirectoryPlugin = Capacitor.isNativePlatform()
  ? Capacitor.registerPlugin<ExportDirectoryPluginApi>("ExportDirectory")
  : null;

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
}

const browserWindow = () => (typeof window === "undefined" ? null : window as DirectoryPickerWindow);

export const supportsDirectoryPicker = () => Boolean(browserWindow()?.showDirectoryPicker);
export const supportsNativeExportDirectory = () => Capacitor.isNativePlatform();
/** True when the Android build can open the system folder picker (SAF). */
export const supportsNativeDirectoryPicker = () => Boolean(exportDirectoryPlugin && Capacitor.isPluginAvailable("ExportDirectory"));
export const isNativeDirectoryHandle = (handle: ExportDirectoryHandle | null | undefined): handle is NativeDirectoryHandleLike => Boolean(handle && "kind" in handle && handle.kind === "native");
export const isSafDirectoryHandle = (handle: ExportDirectoryHandle | null | undefined): handle is SafDirectoryHandleLike => Boolean(handle && "kind" in handle && handle.kind === "saf");
export const isDownloadsDirectoryHandle = (handle: ExportDirectoryHandle | null | undefined): handle is DownloadsDirectoryHandleLike => Boolean(handle && "kind" in handle && handle.kind === "downloads");

export const nativeExportDirectoryHandle = (): NativeDirectoryHandleLike => ({
  kind: "native",
  name: `手机文档 / ${DEFAULT_NATIVE_EXPORT_FOLDER}`,
  directory: Directory.Documents,
  path: DEFAULT_NATIVE_EXPORT_FOLDER,
});

export const downloadsExportDirectoryHandle = (): DownloadsDirectoryHandleLike => ({
  kind: "downloads",
  name: `手机下载 / ${DEFAULT_NATIVE_EXPORT_FOLDER}`,
  folder: DEFAULT_NATIVE_EXPORT_FOLDER,
});

// 默认位置的可用性只探一次（同一进程内设备能力不会变）：探测失败一律当作不可用，
// 交给「文档」兜底，绝不因为探测异常让导出没地方写。
let downloadsAvailability: Promise<boolean> | null = null;
const downloadsDirectoryAvailable = (): Promise<boolean> => {
  if (!downloadsAvailability) {
    downloadsAvailability = (async () => {
      try {
        const status = await exportDirectoryPlugin?.checkDownloads();
        return status?.available === true;
      } catch {
        return false;
      }
    })();
  }
  return downloadsAvailability;
};

/** 安卓端默认导出位置：优先公共「下载」目录，设备/系统不支持时退回「文档」
 *  （用户 09-14：默认放下载夹，没有这个文件夹的再退回文档）。用户自己选过文件夹
 *  就走用户选的，与本函数无关。 */
export const defaultNativeExportHandle = async (): Promise<ExportDirectoryHandle> =>
  (await downloadsDirectoryAvailable()) ? downloadsExportDirectoryHandle() : nativeExportDirectoryHandle();

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
  const stored = await new Promise<ExportDirectoryHandle | null>((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DEFAULT_HANDLE_KEY);
      request.onsuccess = () => {
        database.close();
        resolve((request.result as ExportDirectoryHandle | undefined) || null);
      };
      request.onerror = () => { database.close(); resolve(null); };
    } catch {
      database.close();
      resolve(null);
    }
  });
  if (!stored || !isSafDirectoryHandle(stored)) return stored;
  // A picked folder survives restarts only while its SAF grant does; a revoked
  // grant must fall back to the default location instead of failing on export.
  try {
    const status = await exportDirectoryPlugin?.checkDirectory({ uri: stored.uri });
    if (!status?.granted) return null;
    return { ...stored, ...(status.name ? { name: status.name } : {}), ...(status.location ? { location: status.location } : {}) };
  } catch {
    return null;
  }
};

/** 一行说明「文件会写到哪儿」：SAF 用系统给的目录描述，安卓默认位置用固定文案。
 *  纯函数，供设置面板显示与单测断言（用户 09-14：选完文件夹后路径行不跟着变，
 *  因为它以前是写死的默认位置文案）。 */
export const exportLocationLabel = (handle: ExportDirectoryHandle | null): string | null => {
  if (!handle) return null;
  if (isSafDirectoryHandle(handle)) return handle.location || handle.name;
  if (isDownloadsDirectoryHandle(handle)) return `下载 / ${handle.folder.split("/").join(" / ")}`;
  if (isNativeDirectoryHandle(handle)) return `文档 / ${handle.path.split("/").join(" / ")}`;
  return handle.name || null;
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
  const stored = await loadDefaultDirectoryHandle();
  if (stored && isSafDirectoryHandle(stored)) {
    try {
      await exportDirectoryPlugin?.releaseDirectory({ uri: stored.uri });
    } catch {
      // The grant is dropped only to keep the system permission list tidy.
    }
  }
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

export const pickDefaultDirectoryHandle = async (options?: { initialUri?: string }): Promise<ExportDirectoryHandle> => {
  if (supportsNativeDirectoryPicker()) {
    // 重选时把当前文件夹交给系统选择器当起始位置（Android 11+ 生效）——否则
    // 每次都从「文档」起步，用户得重新翻一遍目录（用户 09-14 反馈）。
    const picked = await exportDirectoryPlugin!.chooseDirectory(options?.initialUri ? { initialUri: options.initialUri } : undefined);
    const handle: SafDirectoryHandleLike = { kind: "saf", name: picked.name, uri: picked.uri, ...(picked.location ? { location: picked.location } : {}) };
    await saveDefaultDirectoryHandle(handle);
    return handle;
  }
  if (supportsNativeExportDirectory()) {
    // Older builds without the picker plugin still export into the fixed
    // Documents folder, so keep the permission-only path as a fallback.
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
  if (isSafDirectoryHandle(handle)) {
    if (!exportDirectoryPlugin) throw new Error("当前安装包不支持写入所选文件夹，请更新后重试");
    await exportDirectoryPlugin.writeFile({
      uri: handle.uri,
      filename,
      mimeType: type,
      data: await blobToBase64(new Blob([content], { type })),
    });
    return;
  }
  if (isDownloadsDirectoryHandle(handle)) {
    // 走 MediaStore 写公共下载目录（API 29+ 免权限）。探测说可用但真写失败时不在
    // 这里悄悄换地方——上层会给出明确提示并回退浏览器下载，避免提示的路径与实际
    // 落盘位置不一致。
    if (!exportDirectoryPlugin) throw new Error("当前安装包不支持写入下载目录，请更新后重试");
    await exportDirectoryPlugin.writeFileToDownloads({
      folder: handle.folder,
      filename,
      mimeType: type,
      data: await blobToBase64(new Blob([content], { type })),
    });
    return;
  }
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
