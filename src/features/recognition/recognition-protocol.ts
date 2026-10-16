import type {
  CellClass,
  CellQuery,
  CellScanQuery,
  CombFit,
  CombQuery,
  DigitRead,
  GridWindowQuality,
  GridWindowQuery,
  IntersectionFeatures,
  MeshQuery,
  MoveNumberCandidate,
} from "../../image-recognition";

/** 一批纯计算任务。全部是「图像 + 参数 → 结果」的映射，批次之间无依赖、
 * 单条之间无依赖——这正是能分片到多核的前提。 */
export type RecognitionJob =
  | { kind: "scoreWindows"; queries: readonly GridWindowQuery[] }
  | { kind: "meshSupports"; queries: readonly MeshQuery[] }
  | { kind: "fitCombs"; queries: readonly CombQuery[] }
  | { kind: "cellFeatures"; queries: readonly CellQuery[] }
  // 模型推理两件（2026-10-07）：多核加速开关打开时，225 格扫描与逐格读号切成
  // 4×线程数 片并行——单线程 5 秒级降到 1 秒级。worker 持有图像，只收坐标与裁格半径。
  | { kind: "scanCells"; queries: readonly CellScanQuery[]; half: number }
  | { kind: "readDigits"; queries: readonly CellScanQuery[]; half: number }
  // 手数序号逐子匹配（2026-10-10，模板段并行）：这是复原路径的**最大单项**
  // （密盘实测占整条链路 ~97%，其中评分约 2/3）。它过去只能留在主线程，因为
  // 模板渲染用 `document.createElement("canvas")`；现在渲染改为
  // 「有 document 用 HTMLCanvas、否则用 OffscreenCanvas」，于是 worker 里也能渲染
  // （实测 worker 的 OffscreenCanvas 与主线程 HTMLCanvas 渲染**逐位相同**：142/142 用例）。
  //
  // 分片语义：每条 query 是一颗子（坐标 + 颜色 + 值域上限 + 已锁定的字体族）。
  // **必须带 forceFamily 且 worker 侧走 skipVote**：字体族投票是本函数唯一的跨子状态
  // （实测第 4–37 颗子锁定），锁定后逐子纯函数；worker 无法也不该参与投票。
  // 调用方负责保证「只有锁定后的子」被派下来（锁定前的那几颗在主线程串行跑）。
  | { kind: "matchMoveNumbers"; queries: readonly MoveNumberQuery[] }
  /** worker 侧模板渲染指纹（2026-10-10）：模板段并行的运行时准入自检，见加速器注释。 */
  | { kind: "renderFingerprint" };

/** 一颗子的序号匹配请求（配合 `moveNumberFamilyVote` 已锁定）。 */
export interface MoveNumberQuery {
  row: number;
  col: number;
  x: number;
  y: number;
  player: "black" | "white";
  maxNumber: number;
  /** 已锁定的字体族下标（0 = 本应用自己的字体栈）。 */
  forceFamily: number;
  /** 该子所在的纹理间距（逐子可能略有不同，与主线程同口径传入）。 */
  spacing: number;
}

export type RecognitionJobResult =
  | { kind: "scoreWindows"; value: Array<GridWindowQuality | null> }
  | { kind: "meshSupports"; value: number[] }
  | { kind: "fitCombs"; value: CombFit[][] }
  | { kind: "cellFeatures"; value: IntersectionFeatures[] }
  | { kind: "scanCells"; value: Array<CellClass | null> }
  | { kind: "readDigits"; value: Array<DigitRead | null> }
  | { kind: "matchMoveNumbers"; value: MoveNumberCandidate[][] }
  | { kind: "renderFingerprint"; value: string | null };

export type RecognitionWorkerRequestPayload =
  | {
    type: "image";
    data: Uint8ClampedArray;
    width: number;
    height: number;
    /** 页面基准 URL（绝对）：worker 里 `import.meta.env.BASE_URL` 是相对的、会以
     *  worker 脚本自身位置（/assets/）解析，模型与 ort 的地址必须由主线程给全。 */
    pageBase?: string;
  }
  | { type: "job"; job: RecognitionJob };

export type RecognitionWorkerRequest = RecognitionWorkerRequestPayload & { id: number };

export type RecognitionWorkerReply =
  | { id: number; type: "ready" }
  | { id: number; type: "done"; result: RecognitionJobResult }
  | { id: number; type: "error"; message: string };
