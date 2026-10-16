import type { RecognitionAccelerator } from "../../image-recognition";
import type { RecognitionJob, RecognitionJobResult } from "./recognition-protocol";

/** job → 结果的唯一实现。worker 侧传自己的直算执行器、主线程回落时传主线程的，
 * 同一份代码、同一条数学，所以并行与串行的返回值逐位相同。
 * 2026-10-07：模型推理两件（scanCells/readDigits）也走同一形状——worker 里的
 * localAccelerator 持有图像、直接调 `model-inference.ts`（每 worker 一份 ORT 会话）。
 * 注意两件模型的返回值保留**逐格 null 占位**（模型缺失/某格失败），不能过滤——
 * 派发方按偏移回填结果，过滤会让整条队列错位。 */
export const runRecognitionJob = async (
  accelerator: RecognitionAccelerator,
  job: RecognitionJob,
): Promise<RecognitionJobResult> => {
  switch (job.kind) {
    case "scoreWindows":
      return { kind: "scoreWindows", value: await accelerator.scoreWindows(job.queries) };
    case "meshSupports":
      return { kind: "meshSupports", value: await accelerator.meshSupports(job.queries) };
    case "fitCombs":
      return { kind: "fitCombs", value: await accelerator.fitCombs(job.queries) };
    case "cellFeatures":
      return { kind: "cellFeatures", value: await accelerator.cellFeatures(job.queries) };
    case "scanCells":
      return { kind: "scanCells", value: await accelerator.scanCells(job.queries, job.half) };
    case "readDigits":
      return { kind: "readDigits", value: await accelerator.readDigits(job.queries, job.half) };
    // 手数序号逐子匹配（2026-10-10）：模板段并行。worker 侧用 OffscreenCanvas 渲染模板，
    // 与主线程 HTMLCanvas 实测逐位相同；worker 侧走 skipVote（不参与族投票），
    // 所以结果与「主线程锁定该族后串行跑」逐位一致。
    case "matchMoveNumbers":
      return { kind: "matchMoveNumbers", value: await accelerator.matchMoveNumbers(job.queries) };
    case "renderFingerprint":
      return { kind: "renderFingerprint", value: await accelerator.renderFingerprint() };
  }
};
