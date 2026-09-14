import type {
  CellQuery,
  CombFit,
  CombQuery,
  GridWindowQuality,
  GridWindowQuery,
  IntersectionFeatures,
  MeshQuery,
} from "../../image-recognition";

/** 一批纯计算任务。全部是「图像 + 参数 → 结果」的映射，批次之间无依赖、
 * 单条之间无依赖——这正是能分片到多核的前提。 */
export type RecognitionJob =
  | { kind: "scoreWindows"; queries: readonly GridWindowQuery[] }
  | { kind: "meshSupports"; queries: readonly MeshQuery[] }
  | { kind: "fitCombs"; queries: readonly CombQuery[] }
  | { kind: "cellFeatures"; queries: readonly CellQuery[] };

export type RecognitionJobResult =
  | { kind: "scoreWindows"; value: Array<GridWindowQuality | null> }
  | { kind: "meshSupports"; value: number[] }
  | { kind: "fitCombs"; value: CombFit[][] }
  | { kind: "cellFeatures"; value: IntersectionFeatures[] };

export type RecognitionWorkerRequestPayload =
  | { type: "image"; data: Uint8ClampedArray; width: number; height: number }
  | { type: "job"; job: RecognitionJob };

export type RecognitionWorkerRequest = RecognitionWorkerRequestPayload & { id: number };

export type RecognitionWorkerReply =
  | { id: number; type: "ready" }
  | { id: number; type: "done"; result: RecognitionJobResult }
  | { id: number; type: "error"; message: string };
