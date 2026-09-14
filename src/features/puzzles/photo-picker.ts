/**
 * 图片选择（识谱用）：默认打开系统相册，同时保留切换其他文件夹的能力。
 *
 * 背景：WebView 的 `<input type="file">` 无法指定起始目录（浏览器刻意不暴露），
 * Android 上用户每次都要从「最近」里一层层翻到相册，极其繁琐。原生侧用系统
 * 相册选择器（API 33+ ACTION_PICK_IMAGES）打开时默认停在图片集合，且系统 UI
 * 本身允许切到其他图库/文件夹——正好满足「默认相册、但可换路径」。
 *
 * 无原生插件时（网页端、旧环境）回退到原生 <input type="file">，行为不变。
 */

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, { pickImage?: () => Promise<{ dataUrl?: string; name?: string; mimeType?: string }> }>;
}

const bridge = (): CapacitorBridge | null =>
  (globalThis as { Capacitor?: CapacitorBridge }).Capacitor ?? null;

/** 当前环境是否可用「相册优先」的原生选择器。 */
export const supportsNativePhotoPicker = (): boolean => {
  const cap = bridge();
  if (!cap?.isNativePlatform?.()) return false;
  return typeof cap.Plugins?.PhotoPicker?.pickImage === "function";
};

/** 把 dataURL 还原成 File，交给既有的识谱流程（不改变下游接口）。 */
const dataUrlToFile = (dataUrl: string, name: string, mimeType: string): File | null => {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], name, { type: mimeType });
  } catch {
    return null;
  }
};

/**
 * 打开图片选择器。
 * @returns 选中的文件；用户取消或环境不支持时返回 null（调用方保持原状）。
 */
export const pickBoardImageFile = async (): Promise<File | null> => {
  const picker = bridge()?.Plugins?.PhotoPicker;
  if (!supportsNativePhotoPicker() || !picker?.pickImage) return null;
  try {
    const result = await picker.pickImage();
    if (!result?.dataUrl) return null;
    const mimeType = result.mimeType || "image/jpeg";
    return dataUrlToFile(result.dataUrl, result.name || "棋谱照片", mimeType);
  } catch {
    // 用户取消在原生侧是 reject，属正常路径——返回 null 让调用方不做任何事。
    return null;
  }
};
