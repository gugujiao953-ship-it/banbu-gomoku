/**
 * 识谱预览图降采样（用户 09-23：图片识谱「每次进去都卡一下、对比也卡」）。
 *
 * 根因：对齐屏和核对屏直接把**原图**（手机相册常见 12MP，4000×3000）塞进 <img>，
 * WebView 要解码整张大图、拖动/闪烁时反复重绘整个大位图——卡顿都花在这。
 * 而这两处屏幕只负责**显示**，识别器吃的一直是原始 File（`recognizeBoardImage(file, …)`），
 * 预览缩小到 2048px 对识别精度零影响。
 *
 * 所以：选图后异步生成一张 ≤2048px 的预览（canvas 重采样 + JPEG），对齐屏/核对屏
 * 都用预览；识别仍读原文件。网格几何全部按「原图像素 / 原图宽高」的**比例**换算，
 * 与 <img> 的自然尺寸无关，所以换预览图不需要动任何坐标数学。
 *
 * 缓存：按 File 记忆（上限 2 份，超出淘汰最旧并回收 URL）——「返回对齐 → 再识别」
 * 不会重复解码；同一张图反复进出也只解一次。URL 的生命周期归本模块管
 * （淘汰时回收），调用方**不要**自己 revoke 预览 URL。
 */

export const IMAGE_PREVIEW_MAX = 2048;

export interface ImagePreview {
  url: string;
  width: number;
  height: number;
  /** false = 原图本来就 ≤ 上限，直接用原图（零重编码）。 */
  downscaled: boolean;
}

const cache = new Map<File, Promise<ImagePreview>>();
const CACHE_LIMIT = 2;

const evictOldest = () => {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as File | undefined;
    if (!oldest) break;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    // 淘汰发生在异步链上：等 promise 落地后才能拿到 URL 去回收。
    void entry?.then((preview) => { try { URL.revokeObjectURL(preview.url); } catch { /* 已回收 */ } }, () => undefined);
  }
};

const decode = (file: File): Promise<{ source: CanvasImageSource | HTMLImageElement; width: number; height: number; release(): void }> =>
  new Promise((resolveDecode, reject) => {
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file).then((bitmap) => {
        resolveDecode({ source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() });
      }, reject);
      return;
    }
    // 老 WebView 没有 createImageBitmap：走 <img> 解码。
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolveDecode({ source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片解码失败")); };
    image.src = url;
  });

const buildPreview = async (file: File): Promise<ImagePreview> => {
  const decoded = await decode(file);
  try {
    const scale = Math.max(decoded.width, decoded.height) / IMAGE_PREVIEW_MAX;
    if (scale <= 1) {
      // 原图不大：直接用原图，零重编码（截图类小图走这条路，画质无损）。
      return { url: URL.createObjectURL(file), width: decoded.width, height: decoded.height, downscaled: false };
    }
    const width = Math.round(decoded.width / scale);
    const height = Math.round(decoded.height / scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 不可用");
    // 先铺白底：截图一般是白纸棋盘，透明白在 JPEG 里会变黑底。
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "medium";
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolveBlob) => canvas.toBlob(resolveBlob, "image/jpeg", 0.92));
    if (!blob) throw new Error("预览编码失败");
    return { url: URL.createObjectURL(blob), width, height, downscaled: true };
  } finally {
    decoded.release();
  }
};

/** 取一张图的预览（带缓存；同一张图反复进出只解码一次）。 */
export const getImagePreview = (file: File): Promise<ImagePreview> => {
  const hit = cache.get(file);
  if (hit) {
    // 触发一次缓存刷新（Map 按插入序淘汰，重新 set = 标记为最近使用）。
    cache.delete(file);
    cache.set(file, hit);
    return hit;
  }
  const created = buildPreview(file).catch((error: unknown) => {
    // A transient decode failure must be retryable. Only remove this attempt:
    // an evicted file may already have a newer request stored under its key.
    if (cache.get(file) === created) cache.delete(file);
    throw error;
  });
  cache.set(file, created);
  evictOldest();
  return created;
};
