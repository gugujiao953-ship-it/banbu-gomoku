// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadApk, type ApkArtifact } from "./apk-download";
import { downloadAndInstallUpdate, downloadVerifiedApkInBrowser } from "./install-update";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Filesystem: {} }));
vi.mock("@capacitor/share", () => ({ Share: {} }));
vi.mock("./apk-download", () => ({ APK_MIME_TYPE: "application/vnd.android.package-archive", downloadApk: vi.fn() }));

const artifact: ApkArtifact = { bytes: new Uint8Array([80, 75, 3, 4, 0, 255]), filename: "verified.apk", sha256: "validated" };
let savedBlob: Blob | null;
let clicked: HTMLAnchorElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  savedBlob = null;
  clicked = null;
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn((blob: Blob) => { savedBlob = blob; return "blob:verified-apk"; }),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked = this; });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const blobBytes = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});

describe("verified APK browser handoff", () => {
  it("downloads the verified artifact without reopening a failed source", async () => {
    vi.mocked(downloadApk).mockResolvedValue(artifact);
    const open = vi.spyOn(window, "open");
    const base64 = vi.spyOn(window, "btoa");
    const result = await downloadAndInstallUpdate({ urls: ["https://failed.example/app.apk", "https://working.example/app.apk"], filename: artifact.filename });
    expect(result.outcome.status).toBe("browser");
    expect(clicked?.href).toBe("blob:verified-apk");
    expect(clicked?.download).toBe(artifact.filename);
    expect(savedBlob?.type).toBe("application/vnd.android.package-archive");
    expect(await blobBytes(savedBlob!)).toEqual(artifact.bytes);
    expect(open).not.toHaveBeenCalled();
    expect(base64).not.toHaveBeenCalled();
  });

  it("does not hand off an artifact when cancellation wins after download", async () => {
    const controller = new AbortController();
    vi.mocked(downloadApk).mockImplementation(async () => { controller.abort(); return artifact; });
    await expect(downloadAndInstallUpdate({ urls: ["https://example.com/app.apk"], filename: artifact.filename, signal: controller.signal })).rejects.toThrow("已取消下载");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toBeNull();
  });

  it("keeps the blob URL alive while the browser starts its download", () => {
    vi.useFakeTimers();
    downloadVerifiedApkInBrowser(artifact);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:verified-apk");
  });

  it("reports a failed browser handoff and releases its blob URL", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => downloadVerifiedApkInBrowser(artifact)).toThrow("保存安装包失败");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:verified-apk");
  });
});
