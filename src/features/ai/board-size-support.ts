import { MIN_BOARD_SIZE } from "../../game";
import type { RuleSet } from "../../types";

/**
 * Rapfi 的盘面尺寸是运行时参数，真正卡住它的是构建期的 BOARD_SIZE。实测
 * （scripts/.tmp-boardsize-boundary.mjs，两个构建各扫一遍）：5–22 路生效
 * ——越界坐标会被 "ERROR Coord is not valid or empty." 拒绝，22 路也能在
 * 板内找出五连；23 路起引擎直接回 "ERROR Unsupported board size!"，此后
 * 所有坐标都判非法。所以上限写死在这里，不能只靠 UI 兜；下限沿用应用自己
 * 的 MIN_BOARD_SIZE（引擎对更小的盘没测过，也就没有产品意义）。
 */
export const ENGINE_MAX_BOARD_SIZE = 22;

/** mix9svq 冠军权重的覆盖范围：数据包里只有这几个文件——
 * mix9svqfreestyle_bsmix / mix9svqstandard_bs15 / mix9svqrenju_bs15_{black,white}。
 * 引擎按 (规则, 路数) 挑权重，挑不到就整个禁用评估器。实测矩阵
 * （scripts/.tmp-boardsize-matrix.mjs）：
 *   15 路             → 三种规则都有专属权重（exact）
 *   13–22 路 + 自由    → 吃 bsmix 混合尺寸权重（mixed）
 *   其余（5–11 路、非 15 路的有禁手/标准）→ "Evaluator mix9svq disabled"，退回手工评估（none）
 */
export const MIXED_WEIGHT_MIN_BOARD_SIZE = 13;

export type ChampionWeightCoverage = "exact" | "mixed" | "none";

export const engineSupportsBoardSize = (boardSize: number): boolean =>
  Number.isInteger(boardSize) && boardSize >= MIN_BOARD_SIZE && boardSize <= ENGINE_MAX_BOARD_SIZE;

/** KataGo 旗舰引擎（KataGomo 分支）的编译上限：二进制只接受 15 路以内的棋盘
 *（`version` 输出自报 "Compiled to allow boards of size up to 15"）。超上限时
 *  worker 连合法 GTP 坐标都拼不出，所以旗舰档必须在选型阶段就让位给 Rapfi
 *（见 App 的 effectiveEngineChoice），而不是等引擎报错。 */
export const KATA_MAX_BOARD_SIZE = 15;
export const kataSupportsBoardSize = (boardSize: number): boolean =>
  Number.isInteger(boardSize) && boardSize >= MIN_BOARD_SIZE && boardSize <= KATA_MAX_BOARD_SIZE;

/** 旗舰档是否该让位给 Rapfi（纯函数，可测）。
 *
 * `kataAvailable` 是原生探测结果，**三态**：true 可用 / false 明确不可用 /
 * undefined 还没探到。只有「明确不可用」或「盘面超上限」才降级；`undefined`
 * 必须保持 kata——探测是异步的（启动后有 1.2/3/7/15 秒退避重试），旧实现把
 * 未探到当不可用，于是启动后那段时间里用户选的 katago 被静默换成 rapfi：
 * katago 进程其实已吃下 850MB，分析请求却发 rapfi 的 engine 值、rapfi 起不来
 * → 每下一手都报「引擎未启动」（用户 09-26 报）。
 * 探测未完成时交给 worker 的启动链出真实结果（它有报错与有界重试）。 */
export const kataFallsBackToRapfi = (kataAvailable: boolean | undefined, boardSize?: number): boolean =>
  kataAvailable === false || (boardSize !== undefined && !kataSupportsBoardSize(boardSize));

export const championWeightCoverage = (boardSize: number, rule: RuleSet): ChampionWeightCoverage => {
  if (!engineSupportsBoardSize(boardSize)) return "none";
  if (boardSize === 15) return "exact";
  if (rule === "freestyle" && boardSize >= MIXED_WEIGHT_MIN_BOARD_SIZE) return "mixed";
  return "none";
};

const RULE_LABELS: Record<RuleSet, string> = {
  renju: "连珠（有禁手）",
  standard: "标准（恰五）",
  freestyle: "自由",
};

/**
 * 非 15 路开启分析时的棋力说明；15 路（有专属权重）返回 null 表示无需提示。
 * 文案按实测的权重覆盖分档，不夸大也不隐瞒：13–22 路自由仍吃 bsmix，
 * 其余组合是真的退回手工评估。
 */
export const boardSizeStrengthNotice = (boardSize: number, rule: RuleSet): string | null => {
  if (!engineSupportsBoardSize(boardSize)) {
    return `当前棋盘 ${boardSize} 路，超出引擎上限（${ENGINE_MAX_BOARD_SIZE} 路），电脑不参与分析。`;
  }
  const coverage = championWeightCoverage(boardSize, rule);
  if (coverage === "exact") return null;
  if (coverage === "mixed") {
    return `${boardSize} 路没有专属冠军权重，电脑改用混合尺寸权重（bsmix），棋力与 15 路不完全等同。`;
  }
  return `${boardSize} 路 + ${RULE_LABELS[rule]} 没有对应的冠军权重，电脑退回手工评估，棋力明显低于 15 路。`;
};
