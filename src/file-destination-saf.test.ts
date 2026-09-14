import { beforeEach, describe, expect, it, vi } from "vitest";

const { pluginMock } = vi.hoisted(() => ({
  pluginMock: {
    chooseDirectory: vi.fn(),
    checkDirectory: vi.fn(),
    releaseDirectory: vi.fn(),
    writeFile: vi.fn(),
  },
}));

// The SAF path only exists inside the Android build, so the platform itself has
// to be faked before the module under test is imported.
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
    registerPlugin: () => pluginMock,
  },
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Documents: "DOCUMENTS" },
  Filesystem: { writeFile: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn() },
}));

import { exportLocationLabel, loadDefaultDirectoryHandle, nativeExportDirectoryHandle, pickDefaultDirectoryHandle, supportsNativeDirectoryPicker, writeFileToDirectory, type DirectoryHandleLike, type SafDirectoryHandleLike } from "./file-destination";

const SAF_URI = "content://com.android.externalstorage.documents/tree/primary%3A%E6%A3%8B%E8%B0%B1";

/** Minimal IndexedDB stand-in: only get() on the handle store is exercised. */
const stubHandleDatabase = (stored: unknown) => {
  const values = new Map<string, unknown>([["default-export-directory", stored]]);
  const database = {
    objectStoreNames: { contains: () => true },
    close: () => undefined,
    transaction: () => ({
      objectStore: () => ({
        get: (key: string) => {
          const request: { result?: unknown; onsuccess?: () => void } = {};
          request.result = values.get(key);
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
        put: () => undefined,
        delete: () => undefined,
      }),
    }),
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: { result?: unknown; onsuccess?: () => void } = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
};

describe("SAF export folder", () => {
  beforeEach(() => {
    pluginMock.chooseDirectory.mockReset();
    pluginMock.checkDirectory.mockReset();
    pluginMock.releaseDirectory.mockReset();
    pluginMock.writeFile.mockReset();
  });

  it("opens the system folder picker and returns the chosen folder", async () => {
    pluginMock.chooseDirectory.mockResolvedValue({ uri: SAF_URI, name: "棋谱" });
    try {
      expect(supportsNativeDirectoryPicker()).toBe(true);
      const handle = await pickDefaultDirectoryHandle();
      expect(handle).toMatchObject({ kind: "saf", name: "棋谱", uri: SAF_URI });
      expect(pluginMock.chooseDirectory).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("writes into the chosen folder through the plugin", async () => {
    pluginMock.writeFile.mockResolvedValue(undefined);
    try {
      const handle: SafDirectoryHandleLike = { kind: "saf", name: "棋谱", uri: SAF_URI };
      await writeFileToDirectory(handle, "测试.sgf", "(;GM[4])", "application/x-go-sgf;charset=utf-8");
      expect(pluginMock.writeFile).toHaveBeenCalledWith(expect.objectContaining({
        uri: SAF_URI,
        filename: "测试.sgf",
        mimeType: "application/x-go-sgf;charset=utf-8",
      }));
      const call = pluginMock.writeFile.mock.calls[0]?.[0];
      const bytes = Uint8Array.from(atob(call.data as string), (char) => char.charCodeAt(0));
      expect(new TextDecoder().decode(bytes)).toBe("(;GM[4])");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forwards the current folder as the picker's starting point", async () => {
    pluginMock.chooseDirectory.mockResolvedValue({ uri: SAF_URI, name: "棋谱", location: "Documents/棋谱" });
    try {
      const handle = await pickDefaultDirectoryHandle({ initialUri: SAF_URI });
      expect(pluginMock.chooseDirectory).toHaveBeenCalledWith({ initialUri: SAF_URI });
      expect(handle).toMatchObject({ kind: "saf", name: "棋谱", location: "Documents/棋谱" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("labels where exports land for every kind of destination", () => {
    // 设置面板的路径行：选过文件夹必须显示系统给的目录描述，否则用户以为没生效
    // （原实现那行是写死的默认位置文案，2026-09-14 用户反馈）。
    expect(exportLocationLabel({ kind: "saf", name: "棋谱", uri: SAF_URI, location: "Documents/棋谱" })).toBe("Documents/棋谱");
    expect(exportLocationLabel({ kind: "saf", name: "棋谱", uri: SAF_URI })).toBe("棋谱");
    expect(exportLocationLabel(nativeExportDirectoryHandle())).toBe("文档 / 半步五子棋打谱 / 导出");
    expect(exportLocationLabel({ name: "浏览器文件夹" } as DirectoryHandleLike)).toBe("浏览器文件夹");
    expect(exportLocationLabel(null)).toBeNull();
  });

  it("keeps a remembered folder while its grant is still valid", async () => {
    stubHandleDatabase({ kind: "saf", name: "旧名字", uri: SAF_URI });
    pluginMock.checkDirectory.mockResolvedValue({ granted: true, name: "棋谱" });
    try {
      await expect(loadDefaultDirectoryHandle()).resolves.toMatchObject({ kind: "saf", name: "棋谱", uri: SAF_URI });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops a remembered folder whose grant was revoked", async () => {
    stubHandleDatabase({ kind: "saf", name: "棋谱", uri: SAF_URI });
    pluginMock.checkDirectory.mockResolvedValue({ granted: false });
    try {
      await expect(loadDefaultDirectoryHandle()).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
