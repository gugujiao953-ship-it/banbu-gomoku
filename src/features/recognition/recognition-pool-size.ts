/** 给主线程与界面留余量后的线程上限。手机 8 核最多开到 6。 */
export const MAX_RECOGNITION_WORKERS = 6;

/**
 * 识谱线程池大小（用户 09-14：「把手机的处理器和内存用起来」）：
 * 先按核心数留一个核心给主线程（界面还在画、序号匹配还在主线程跑），
 * 再按设备内存收敛——每个线程要持有一份 RGBA 像素与在本地重建的灰度图
 * （8 字节/像素），所以图像越大、机型内存越小，能开的线程越少。低内存机型
 * 宁可少开几个，也不能把 WebView 顶到被系统回收。
 *
 * 永远至少返回 1：即使只有一个线程，识别也已经离开主线程，导入时界面不冻结。
 */
export const planRecognitionPool = (options: { cores: number; memoryGb: number; pixelCount: number }): number => {
  const { cores, memoryGb, pixelCount } = options;
  const byCores = Math.max(1, Math.min(cores - 1, MAX_RECOGNITION_WORKERS));
  const perWorkerMb = (pixelCount * 8) / (1024 * 1024) + 8;
  const budgetMb = Math.min(160, Math.max(48, memoryGb * 24));
  const byMemory = Math.max(1, Math.floor(budgetMb / perWorkerMb));
  return Math.max(1, Math.min(byCores, byMemory));
};
