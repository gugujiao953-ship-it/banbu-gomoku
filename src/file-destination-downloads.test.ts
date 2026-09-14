import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pluginMock } = vi.hoisted(() => ({
  pluginMock: {
    chooseDirectory: vi.fn(),
    checkDirectory: vi.fn(),
    releaseDirectory: vi.fn(),
    writeFile: vi.fn(),
    checkDownloads: vi.fn(),
    writeFileToDownloads: vi.fn(),
  },
}));

// Same platform faking as the SAF suite: the native branch only exists inside the
// Android build, so @capacitor/core has to be replaced before importing.
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

// 默认位置的可用性探测在模块里按进程缓存，所以每个用例都重新 import 拿干净状态。
const loadModule = async () => {
  vi.resetModules();
  return import("./file-destination");
};

describe("安卓默认导出位置：下载优先、文档兜底", () => {
  beforeEach(() => {
    for (const fn of Object.values(pluginMock)) fn.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("公共下载目录可用时，默认写到下载目录的子文件夹", async () => {
    pluginMock.checkDownloads.mockResolvedValue({ available: true });
    const destination = await loadModule();
    const handle = await destination.defaultNativeExportHandle();
    expect(handle).toMatchObject({ kind: "downloads", folder: "半步五子棋打谱/导出" });
    expect(destination.exportLocationLabel(handle)).toBe("下载 / 半步五子棋打谱 / 导出");

    pluginMock.writeFileToDownloads.mockResolvedValue(undefined);
    await destination.writeFileToDirectory(handle, "测试.sgf", "(;GM[4])", "application/x-go-sgf;charset=utf-8");
    expect(pluginMock.writeFileToDownloads).toHaveBeenCalledWith(expect.objectContaining({
      folder: "半步五子棋打谱/导出",
      filename: "测试.sgf",
      mimeType: "application/x-go-sgf;charset=utf-8",
    }));
    const call = pluginMock.writeFileToDownloads.mock.calls[0]?.[0] as { data: string } | undefined;
    const bytes = Uint8Array.from(atob(call?.data ?? ""), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("(;GM[4])");
  });

  it("设备没有公共下载目录时退回文档默认位置", async () => {
    pluginMock.checkDownloads.mockResolvedValue({ available: false });
    const destination = await loadModule();
    const handle = await destination.defaultNativeExportHandle();
    expect(handle).toMatchObject({ kind: "native", path: "半步五子棋打谱/导出", directory: "DOCUMENTS" });
    expect(destination.exportLocationLabel(handle)).toBe("文档 / 半步五子棋打谱 / 导出");
  });

  it("探测失败（老安装包没有这个方法）也退回文档，不把异常抛给导出流程", async () => {
    pluginMock.checkDownloads.mockRejectedValue(new Error("not implemented"));
    const destination = await loadModule();
    await expect(destination.defaultNativeExportHandle()).resolves.toMatchObject({ kind: "native" });
  });
});
