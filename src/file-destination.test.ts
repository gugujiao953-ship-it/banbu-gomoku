import { describe, expect, it, vi } from "vitest";
import { pickDefaultDirectoryHandle, supportsDirectoryPicker, writeTextFileToDirectory, type DirectoryHandleLike } from "./file-destination";

describe("file destination", () => {
  it("writes text into a selected directory handle", async () => {
    let written: Blob | null = null;
    const handle: DirectoryHandleLike = {
      name: "棋谱导出",
      queryPermission: vi.fn().mockResolvedValue("granted"),
      getFileHandle: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn(async (value: Blob) => { written = value; }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    await writeTextFileToDirectory(handle, "测试.sgf", "(;GM[4])", "application/x-go-sgf;charset=utf-8");

    if (!written) throw new Error("文件没有被写入");
    expect(await new Response(written).text()).toBe("(;GM[4])");
    expect(handle.getFileHandle).toHaveBeenCalledWith("测试.sgf", { create: true });
  });

  it("asks for permission again when the saved permission is no longer granted", async () => {
    const handle: DirectoryHandleLike = {
      name: "棋谱导出",
      queryPermission: vi.fn().mockResolvedValue("prompt"),
      requestPermission: vi.fn().mockResolvedValue("denied"),
      getFileHandle: vi.fn(),
    };

    await expect(writeTextFileToDirectory(handle, "测试.txt", "内容", "text/plain")).rejects.toThrow("权限已失效");
    expect(handle.requestPermission).toHaveBeenCalled();
    expect(handle.getFileHandle).not.toHaveBeenCalled();
  });

  it("uses the browser directory picker when available", async () => {
    const handle: DirectoryHandleLike = { name: "默认位置", getFileHandle: vi.fn() };
    const picker = vi.fn().mockResolvedValue(handle);
    vi.stubGlobal("window", { showDirectoryPicker: picker });
    try {
      expect(supportsDirectoryPicker()).toBe(true);
      expect(await pickDefaultDirectoryHandle()).toBe(handle);
      expect(picker).toHaveBeenCalledWith({ mode: "readwrite" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
