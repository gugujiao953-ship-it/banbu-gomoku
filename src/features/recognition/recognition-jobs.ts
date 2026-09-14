import type { RecognitionAccelerator } from "../../image-recognition";
import type { RecognitionJob, RecognitionJobResult } from "./recognition-protocol";

/** job → 结果的唯一实现。worker 侧传自己的直算执行器、主线程回落时传主线程的，
 * 同一份代码、同一条数学，所以并行与串行的返回值逐位相同。 */
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
  }
};
