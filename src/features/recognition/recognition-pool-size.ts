/** 给主线程与界面留余量后的线程上限。手机 8 核最多开到 6。 */
export const MAX_RECOGNITION_WORKERS = 6;

/**
 * 识谱线程池大小（用户 09-14：「把手机的处理器和内存用起来」）：
 * 先按核心数留一个核心给主线程（界面还在画、序号匹配还在主线程跑），
 * 再按设备内存收敛——每个线程要持有一份 RGBA 像素与在本地重建的灰度图
 * （8 字节/像素），所以图像越大、机型内存越小，能开的线程越少。低内存机型
 * 宁可少开几个，也不能把 WebView 顶到被系统回收。
 *
 * 2026-10-07 起格级扫描/逐格读号也在 worker 里跑（多核开关打开、且这批识别
 * 带 boardScanner 时）：那些线程还要各持一份 ORT 运行时（wasm 堆约 14MB）与
 * 两个 fp16 模型（约 3.6MB），所以 `withModelSessions` 打开时每线程多算 ~20MB——
 * 否则低内存机型会按「只有像素」开出太多线程、被系统回收。
 *
 * 永远至少返回 1：即使只有一个线程，识别也已经离开主线程，导入时界面不冻结。
 */
export const planRecognitionPool = (options: { cores: number; memoryGb: number; pixelCount: number; withModelSessions?: boolean }): number => {
  const { cores, memoryGb, pixelCount } = options;
  const byCores = Math.max(1, Math.min(cores - 1, MAX_RECOGNITION_WORKERS));
  const modelMb = options.withModelSessions ? 20 : 0;
  const perWorkerMb = (pixelCount * 8) / (1024 * 1024) + 8 + modelMb;
  // 内存预算 —— **2026-10-15 真机实测后收回保守档**。
  //
  // 经过：用户要「预算给高一点」，我按他给的档位实现成 `min(720MB, 内存GB × 60)`
  // （4G→240/6G→360/8G→480/10G→600/12G→720）。随后用户报**复原时闪退，且是以前没有过的**。
  // 真机 logcat 崩溃缓冲区是硬证据：
  //   signal 5 (SIGTRAP) / Abort message: "[FATAL:crashpad] Render process (31513)'s crash
  //   wasn't handled by all associated webviews, triggering application crash."
  //   连续两次（02:42:54、02:43:44），进程是 cn.renjunote.mobile
  // ⇒ **WebView 渲染进程自己崩了**（渲染进程里同时挂着 N 份 ORT wasm 堆，内存耗尽 abort），
  //   应用跟着被带走。这条正是当年写 160MB 上限时担心的「被系统/自己顶爆」。
  //
  // 所以现在：**上限回到 160MB**（典型 720×1600 画布 → 每线程 36.8MB → **4 条**），
  // 也就是改动之前、连续几周没崩过的配置。用户的档位公式保留在下面（`tieredBudgetMb`），
  // 但默认不启用：要在真机上重新试时，改这一个常量 + 盯 `adb logcat -b crash`。
  // ⚠ 与设备无关的教训：**预算按「内存 GB」估是不够的**——deviceMemory 封顶 8、按 2 的幂取整，
  //   12GB 机也只报 8；真正的约束是「渲染进程里能同时挂几份 wasm 堆」，那跟机型/系统版本有关，
  //   只能在真机上二分。要再提高并行度，先做的是**减少每线程的 wasm 堆**（例如把图像改成
  //   SharedArrayBuffer 共享、或让模型分片走主线程），而不是继续抬 MB 数。
  const RECOGNITION_BUDGET_CAP_MB = 160;
  const tieredBudgetMb = memoryGb >= 4 ? Math.min(720, memoryGb * 60) : Math.min(160, Math.max(48, memoryGb * 24));
  void tieredBudgetMb;
  const budgetMb = Math.min(RECOGNITION_BUDGET_CAP_MB, Math.max(48, memoryGb * 24));
  const byMemory = Math.max(1, Math.floor(budgetMb / perWorkerMb));
  return Math.max(1, Math.min(byCores, byMemory));
};
