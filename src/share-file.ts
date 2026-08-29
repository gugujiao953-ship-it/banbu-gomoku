import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export type FileShareResult = "shared" | "cancelled" | "unavailable";

const cancelledShare = (error: unknown) => {
  const value = error as { name?: string; message?: string };
  return value?.name === "AbortError" || /cancel|取消|dismiss/i.test(value?.message || "");
};

const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
  reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
  reader.readAsDataURL(blob);
});

export const sharePngFile = async (file: File, title: string, text: string): Promise<FileShareResult> => {
  if (typeof navigator.share === "function") {
    const data: ShareData = { title, text, files: [file] };
    if (!navigator.canShare || navigator.canShare(data)) {
      try {
        await navigator.share(data);
        return "shared";
      } catch (error) {
        if (cancelledShare(error)) return "cancelled";
      }
    }
  }

  if (!Capacitor.isNativePlatform()) return "unavailable";
  const path = `share/${Date.now()}-${file.name}`;
  try {
    const data = await blobToBase64(file);
    const written = await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    await Share.share({ title, text, url: written.uri, dialogTitle: "分享当前局面" });
    return "shared";
  } catch (error) {
    if (cancelledShare(error)) return "cancelled";
    return "unavailable";
  } finally {
    try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* cache cleanup is best effort */ }
  }
};
