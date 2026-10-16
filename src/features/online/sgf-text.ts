import type { GameMetadata, Position } from "../../types";

/** SGF 文本拼装的最小公共件：多个来源适配器共用一套转义/坐标口径，
 *  免得两个源写出的同一局棋在导入端表现不一致。 */
export const sgfEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");

/** 内部 (row, col)（row 自上而下、0 起）→ SGF 的 (列, 行) 字母（都自下而上、0 起）。 */
export const sgfPoint = ({ row, col }: Position) => `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`;

export const sgfProperties = (properties: Array<[string, string]>) =>
  properties.filter(([, value]) => value !== "").map(([key, value]) => `${key}[${sgfEscape(value)}]`).join("");

/** `1 : 0` 这类列表结果 → SGF 的 RE 值；认不出来就原样保留。 */
export const sgfResultValue = (result: string) => {
  const compact = result.replace(/\s+/g, "");
  if (compact === "1:0") return "B+";
  if (compact === "0:1") return "W+";
  if (compact === "0.5:0.5" || compact === "0:0") return "0";
  return result.trim();
};

export const safeFilenamePart = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** 从 1 开始的落子序列（黑先、交替）→ SGF 的着法段。 */
export const sgfMoves = (moves: Position[]) => moves.map((move, index) => `${index % 2 === 0 ? "B" : "W"}[${sgfPoint(move)}]`).join("");

export const buildSgfFromMoves = (header: Array<[string, string]>, moves: Position[]) => `(;${sgfProperties(header)}${sgfMoves(moves)})`;

/** 棋谱信息里那些「来源能给就给」的字段，统一在这里兜住顺序。 */
export type SgfHeaderInput = Partial<GameMetadata> & { black: string; white: string; moves?: Position[] };
