import {
  localAccelerator,
  type CellQuery,
  type CombQuery,
  type GridWindowQuery,
  type MeshQuery,
  type RecognitionAccelerator,
  type SampledImage,
} from "../../image-recognition";
import RecognitionWorker from "./recognition-worker?worker";
import { runRecognitionJob } from "./recognition-jobs";
import { planRecognitionPool } from "./recognition-pool-size";
import type {
  RecognitionJob,
  RecognitionJobResult,
  RecognitionWorkerReply,
  RecognitionWorkerRequestPayload,
} from "./recognition-protocol";

/** 每个线程领的分片数：比线程数多几倍，先算完的线程接着领下一片，避免某个
 * 分片偏重时整批被它拖住。分片是连续区间，所以合并顺序天然就是原顺序。 */
const CHUNKS_PER_WORKER = 4;
/** 单个分片的超时。卡死的线程绝不能让导入一直转圈（历史教训：识别永挂），
 * 超时即降级——停池、剩下全在主线程直算。 */
const SLICE_TIMEOUT_MS = 20000;

interface PendingRequest {
  resolve: (reply: RecognitionWorkerReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 多核识谱执行器：把批次切成连续分片派给线程池，按原位拼回结果。
 * 返回 null 表示「这台设备/这次环境用不了多核」（老 WebView、线程构造被拒、
 * 图像上传失败），调用方回落单线程直算。运行中任何分片失败/超时都会降级：
 * 停掉线程池，未算完的分片在主线程补算，结果顺序与内容不变。
 */
export const createParallelAccelerator = async (image: SampledImage): Promise<RecognitionAccelerator | null> => {
  if (typeof Worker === "undefined") return null;
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  // WebKit 不实现 navigator.deviceMemory（Chromium 专有），缺失时以前兜底 4GB——
  // 那会把池子按「低内存机」卡在 3 个线程。现代 iPhone/iPad 普遍 4-8GB，按 5GB 估计：
  // 既不按 4GB 过度保守，也不放开到 8GB 让内存闸门失效（每个线程要持一份像素+灰度图）。
  const memoryGb = (typeof navigator === "undefined" ? 5 : (navigator as Navigator & { deviceMemory?: number }).deviceMemory) ?? 5;
  const poolSize = planRecognitionPool({ cores, memoryGb, pixelCount: image.width * image.height });
  const local = localAccelerator(image);
  const pending = new Map<number, PendingRequest>();
  const workers: Worker[] = [];
  let nextId = 1;
  let degraded = false;
  let disposed = false;

  const degrade = (error: unknown) => {
    if (!degraded) console.warn("[banbu-image-accelerator] 多核分片失败，改用单线程继续识别", error);
    degraded = true;
  };

  const stopWorkers = () => {
    for (const worker of workers.splice(0)) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("识别线程池已停止"));
    }
    pending.clear();
  };

  const send = (worker: Worker, payload: RecognitionWorkerRequestPayload): Promise<RecognitionWorkerReply> => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`识别分片超时（${SLICE_TIMEOUT_MS}ms）`));
    }, SLICE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ ...payload, id });
  });

  const sendJob = async (worker: Worker, job: RecognitionJob): Promise<RecognitionJobResult> => {
    const reply = await send(worker, { type: "job", job });
    if (reply.type === "error") throw new Error(reply.message);
    if (reply.type !== "done") throw new Error("识别线程应答异常");
    return reply.result;
  };

  // 每个线程一个「远程执行器」：形状与主线程直算完全一致，所以上层派发逻辑
  // （runRecognitionJob）只有一份，本地与远程走同一段代码。
  const remote = (worker: Worker): RecognitionAccelerator => ({
    scoreWindows: async (queries: readonly GridWindowQuery[]) => {
      const result = await sendJob(worker, { kind: "scoreWindows", queries });
      if (result.kind !== "scoreWindows") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    meshSupports: async (queries: readonly MeshQuery[]) => {
      const result = await sendJob(worker, { kind: "meshSupports", queries });
      if (result.kind !== "meshSupports") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    fitCombs: async (queries: readonly CombQuery[]) => {
      const result = await sendJob(worker, { kind: "fitCombs", queries });
      if (result.kind !== "fitCombs") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    cellFeatures: async (queries: readonly CellQuery[]) => {
      const result = await sendJob(worker, { kind: "cellFeatures", queries });
      if (result.kind !== "cellFeatures") throw new Error("识别线程应答类型不匹配");
      return result.value;
    },
    dispose: () => { /* 线程由池统一收 */ },
  });

  try {
    for (let index = 0; index < poolSize; index += 1) {
      const worker = new RecognitionWorker();
      worker.onmessage = (event: MessageEvent<RecognitionWorkerReply>) => {
        const reply = event.data;
        const entry = pending.get(reply.id);
        if (!entry) return;
        pending.delete(reply.id);
        clearTimeout(entry.timer);
        if (reply.type === "error") entry.reject(new Error(reply.message));
        else entry.resolve(reply);
      };
      worker.onerror = (event) => {
        degrade(event instanceof ErrorEvent ? event.message : "识别线程异常退出");
        stopWorkers();
      };
      worker.onmessageerror = () => {
        degrade("识别线程消息无法反序列化");
        stopWorkers();
      };
      workers.push(worker);
    }
    // 图像只上传一次，之后每个分片只带着坐标参数来回；灰度在 worker 内用同一份
    // 代码重建，省掉一半拷贝。
    const imageMessage = { type: "image" as const, data: image.data, width: image.width, height: image.height };
    const readies = await Promise.all(workers.map((worker) => send(worker, imageMessage)));
    if (readies.some((reply) => reply.type !== "ready")) throw new Error("识别线程未能装载图像");
    if ((globalThis as typeof globalThis & { __BANBU_IMAGE_RECOGNITION_DEBUG__?: boolean }).__BANBU_IMAGE_RECOGNITION_DEBUG__) {
      console.info("[banbu-image-accelerator]", JSON.stringify({ poolSize, cores, memoryGb, width: image.width, height: image.height }));
    }
  } catch (error) {
    degrade(error);
    stopWorkers();
    return null;
  }

  const remotes = workers.map(remote);

  const dispatch = async <TQuery, TResult>(
    queries: readonly TQuery[],
    makeJob: (slice: readonly TQuery[]) => RecognitionJob,
    readValue: (result: RecognitionJobResult) => TResult[],
  ): Promise<TResult[]> => {
    if (degraded || !remotes.length || disposed) return readValue(await runRecognitionJob(local, makeJob(queries)));
    const chunkTarget = Math.max(1, Math.min(queries.length, remotes.length * CHUNKS_PER_WORKER));
    const chunkSize = Math.max(1, Math.ceil(queries.length / chunkTarget));
    const chunks: Array<{ start: number; slice: readonly TQuery[] }> = [];
    for (let start = 0; start < queries.length; start += chunkSize) {
      chunks.push({ start, slice: queries.slice(start, start + chunkSize) });
    }
    const results = new Array<TResult>(queries.length);
    const computed = new Array<boolean>(chunks.length).fill(false);
    let cursor = 0;
    await Promise.all(remotes.map(async (accelerator) => {
      for (;;) {
        if (degraded || disposed) return;
        const index = cursor;
        if (index >= chunks.length) return;
        cursor += 1;
        const chunk = chunks[index];
        try {
          readValue(await runRecognitionJob(accelerator, makeJob(chunk.slice)))
            .forEach((value, offset) => { results[chunk.start + offset] = value; });
          computed[index] = true;
        } catch (error) {
          degrade(error);
          return;
        }
      }
    }));
    // 降级/停止时没算完的分片在主线程补算：结果仍是原顺序、原数值。
    for (let index = 0; index < chunks.length; index += 1) {
      if (computed[index]) continue;
      const chunk = chunks[index];
      readValue(await runRecognitionJob(local, makeJob(chunk.slice)))
        .forEach((value, offset) => { results[chunk.start + offset] = value; });
    }
    return results;
  };

  return {
    scoreWindows: (queries: readonly GridWindowQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "scoreWindows", queries: slice }),
      (result) => (result.kind === "scoreWindows" ? result.value : []),
    ),
    meshSupports: (queries: readonly MeshQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "meshSupports", queries: slice }),
      (result) => (result.kind === "meshSupports" ? result.value : []),
    ),
    fitCombs: (queries: readonly CombQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "fitCombs", queries: slice }),
      (result) => (result.kind === "fitCombs" ? result.value : []),
    ),
    cellFeatures: (queries: readonly CellQuery[]) => dispatch(
      queries,
      (slice) => ({ kind: "cellFeatures", queries: slice }),
      (result) => (result.kind === "cellFeatures" ? result.value : []),
    ),
    dispose: () => {
      disposed = true;
      stopWorkers();
    },
  };
};
