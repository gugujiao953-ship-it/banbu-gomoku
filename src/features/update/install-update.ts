/**
 * 「下载新版安装包并交给系统安装」的编排层。
 *
 * 职责边界：
 *   · apk-download.ts   负责把字节安全地拉下来（多源、分片、长度 + SHA-256 校验）
 *   · 本文件            负责把字节送进系统（原生插件 → 分享 → 浏览器 三级降级）
 *   · UI                只关心「进度 / 成功 / 失败原因」三件事
 *
 * 安装策略（用户 2026-09-15 拍板）：**不申请 REQUEST_INSTALL_PACKAGES**。
 * 插件只负责把 APK 交给系统安装器，未知来源授权由系统自己弹——加权限反而会在
 * 安全软件与商店审核上多出无谓的负担。
 */

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { APK_MIME_TYPE, downloadApk, type ApkArtifact, type ApkDownloadProgress } from "./apk-download";

export type ApkInstallOutcome =
  /** 已唤起系统安装器，用户接下来只需在系统界面上确认。 */
  | { status: "installing"; path?: string }
  /** 原生装不了：文件已交给系统（分享/打开方式），用户需自行点安装。 */
  | { status: "handed-off"; path?: string }
  /** 已把通过校验的安装包交给浏览器下载。 */
  | { status: "browser" }
  /** 用户主动取消下载。 */
  | { status: "cancelled" };

export interface UpdateInstallResult {
  artifact: ApkArtifact;
  outcome: ApkInstallOutcome;
}

/**
 * Web fallback: hand the bytes that already passed validation to the browser.
 * Re-opening `options.urls[0]` here used to discard the verified artifact and
 * could send the user back to a failed accelerator/proxy, causing a second
 * unverified download.
 */
export const downloadVerifiedApkInBrowser = (artifact: ApkArtifact): void => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("当前平台无法保存安装包，请使用浏览器直接下载入口");
  const bytes = artifact.bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(artifact.bytes.buffer, artifact.bytes.byteOffset, artifact.bytes.byteLength)
    : artifact.bytes.slice();
  const url = URL.createObjectURL(new Blob([bytes], { type: APK_MIME_TYPE }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.filename;
    anchor.rel = "noopener";
    anchor.click();
    // Keep the object URL alive through the browser's asynchronous download
    // handoff; revoking in the same task races Chromium/WebView.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    try { URL.revokeObjectURL(url); } catch { /* best effort */ }
    throw new Error("保存安装包失败，请使用浏览器直接下载入口");
  }
};

interface ApkInstallPluginApi {
  install(options: { filename: string; data: string }): Promise<{ launched: boolean; path?: string; bytes?: number }>;
  clearCache(): Promise<{ cleared: boolean }>;
}

// 原生插件只在 Android 包里存在；网页版注册会失败，所以每次用前都要判可用性。
const apkInstallPlugin = Capacitor.isNativePlatform()
  ? Capacitor.registerPlugin<ApkInstallPluginApi>("ApkInstall")
  : null;

export const supportsNativeApkInstall = () =>
  Boolean(apkInstallPlugin && Capacitor.isPluginAvailable("ApkInstall"));

const blobToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
};

const cancelled = (error: unknown) => {
  const value = error as { name?: string; message?: string };
  return value?.name === "AbortError" || /cancel|取消|dismiss/i.test(value?.message || "");
};

/**
 * 把已校验的字节交给系统。
 * 顺序：原生安装器 → Capacitor 分享 → 浏览器下载。每一步失败都继续降级，
 * 只有全部不可用才抛错——用户点了更新就必须有结果，不能静默什么都不发生。
 */
const handOffApk = async (artifact: ApkArtifact): Promise<ApkInstallOutcome> => {
  if (!Capacitor.isNativePlatform()) return { status: "browser" };
  const base64 = blobToBase64(artifact.bytes);

  if (supportsNativeApkInstall() && apkInstallPlugin) {
    try {
      const result = await apkInstallPlugin.install({ filename: artifact.filename, data: base64 });
      if (result?.launched) return { status: "installing", path: result.path };
    } catch (error) {
      console.info("[apk-install] 原生安装器不可用，退回分享方式", error);
    }
  }

  if (Capacitor.isNativePlatform()) {
    // 退回「分享文件」：用户可以在系统分享面板里选文件管理器或其它能装 APK 的应用。
    // 写进 Cache 目录（FileProvider 已覆盖），装完/取消后清掉。
    const path = `updates/${artifact.filename}`;
    try {
      const written = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
      await Share.share({ title: "安装新版半步五子棋", url: written.uri, dialogTitle: "选择安装方式" });
      return { status: "handed-off", path: written.uri };
    } catch (error) {
      if (cancelled(error)) return { status: "cancelled" };
      console.info("[apk-install] 分享方式也不可用，退回浏览器下载", error);
    } finally {
      try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* 缓存清理尽力而为 */ }
    }
  }

  return { status: "browser" };
};

export interface DownloadAndInstallOptions {
  urls: string[];
  filename: string;
  expectedSize?: number;
  expectedSha256?: string;
  /** 下载完成前的进度回调（0..1 之外的值由调用方自行钳制）。 */
  onProgress?: (progress: ApkDownloadProgress) => void;
  signal?: AbortSignal;
}

/**
 * 下载 + 校验 + 交接。失败时抛出可展示的中文原因（含所有候选源的失败摘要）。
 */
export const downloadAndInstallUpdate = async (options: DownloadAndInstallOptions): Promise<UpdateInstallResult> => {
  const artifact = await downloadApk({
    urls: options.urls,
    filename: options.filename,
    expectedSize: options.expectedSize,
    expectedSha256: options.expectedSha256,
    onProgress: options.onProgress,
    signal: options.signal,
  });
  if (options.signal?.aborted) throw new Error("已取消下载");
  const outcome = await handOffApk(artifact);
  if (outcome.status === "browser") {
    if (options.signal?.aborted) throw new Error("已取消下载");
    // 网页版 / 原生全不可用：把**已校验的字节**交给浏览器。
    // 不再重新打开候选 URL；第一个候选可能是刚刚失败的加速代理，而且重拉会绕过
    // 本次长度/SHA-256 校验。
    downloadVerifiedApkInBrowser(artifact);
  }
  return { artifact, outcome };
};

/** 安装或放弃后清理安装包缓存（Android 侧外部 files 目录）。 */
export const clearDownloadedApk = async () => {
  if (!supportsNativeApkInstall() || !apkInstallPlugin) return;
  try { await apkInstallPlugin.clearCache(); } catch { /* 清理失败不影响用户 */ }
};
