/// <reference lib="webworker" />

/**
 * 识谱 worker：持有一份采样图（RGBA；灰度用主线程同一份代码在本地重建），
 * 收到一批纯计算任务后算完回传。它不做任何判定——谁最优、怎么取舍仍在主线程
 * 按原顺序跑，worker 只负责「算」。
 *
 * 注意：这个 worker 故意不碰 moveNumber 相关代码（需要 canvas + 字体栈解析），
 * 序号匹配留在主线程，理由见 image-recognition.ts 的多核说明。
 * 2026-10-07 起它也跑 model-inference 的两件模型任务（格级扫描/读号）——那些只需要
 * OffscreenCanvas 与 ORT，worker 里都有。
 */
import { createSampledImage, localAccelerator, type SampledImage } from "../../image-recognition";
import { setInferencePageBase } from "../record/model-inference";
import { runRecognitionJob } from "./recognition-jobs";
import type { RecognitionWorkerReply, RecognitionWorkerRequest } from "./recognition-protocol";

let accelerator: ReturnType<typeof localAccelerator> | null = null;

const reply = (message: RecognitionWorkerReply) => {
  (self as unknown as { postMessage: (value: RecognitionWorkerReply) => void }).postMessage(message);
};

self.onmessage = (event: MessageEvent<RecognitionWorkerRequest>) => {
  const request = event.data;
  if (request.type === "image") {
    try {
      // 页面基准先记下来：模型与 ort 的地址要以**页面**为基准解析，不能用 worker
      // 自己的 location（生产构建里 BASE_URL 是相对的，会解析成 /assets/models/）。
      if (request.pageBase) setInferencePageBase(request.pageBase);
      const image: SampledImage = createSampledImage(request.data, request.width, request.height);
      accelerator = localAccelerator(image);
      reply({ id: request.id, type: "ready" });
    } catch (error) {
      reply({ id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const active = accelerator;
  if (!active) {
    reply({ id: request.id, type: "error", message: "识别 worker 尚未收到图像" });
    return;
  }
  void runRecognitionJob(active, request.job).then(
    (result) => reply({ id: request.id, type: "done", result }),
    (error: unknown) => reply({ id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) }),
  );
};
