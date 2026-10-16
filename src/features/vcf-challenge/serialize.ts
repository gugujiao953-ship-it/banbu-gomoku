// serialize.ts — 做题记录里的局面序列化（预览图与"点进去重做"共用这一层）。
// 格式：坐标名连写，如黑子串 "H8I8J8"、白子串 "G7G8"、解答串 "D14E8"；两串用 "/" 分隔。
import { VCF_SIZE } from "./engine";
import { attackerOnlyLine, buildSolutionLine, solveAppLine } from "./solution-line";
import type { Player, Position } from "../../types";
import type { ChallengeProblem } from "./problems";
import type { VcfHistoryEntry } from "./rating";

export const coordName = (row: number, col: number) => `${String.fromCharCode(65 + col)}${VCF_SIZE - row}`;

export const runOf = (list: Position[]) => list.map((p) => coordName(p.row, p.col)).join("");

export const parseRuns = (run: string): Position[] =>
  (run.match(/[A-O]\d{1,2}/g) ?? [])
    .map((t) => ({ row: VCF_SIZE - Number(t.slice(1)), col: t.charCodeAt(0) - 65 }))
    .filter((p) => p.row >= 0 && p.row < VCF_SIZE && p.col >= 0 && p.col < VCF_SIZE);

/** 题目 → 记录里要存的两串（局面 + 攻方参考解答）。 */
export const problemToRuns = (p: ChallengeProblem): { stones: string; sol: string } => ({
  stones: `${runOf(p.black)}/${runOf(p.white)}`,
  sol: runOf(p.solution.filter((m) => m.player === p.attacker)),
});

/** 从记录还原题目（老记录缺字段则 null）。记录里只有攻方的冲四序列，所以全部标为攻方手。 */
export const problemFromEntry = (h: VcfHistoryEntry): ChallengeProblem | null => {
  if (!h.id || !h.attacker || !h.stones) return null;
  const [b, w] = h.stones.split("/");
  const black = parseRuns(b ?? "");
  const white = parseRuns(w ?? "");
  if (!black.length && !white.length) return null;
  const attacker: Player = h.attacker;
  const sol = parseRuns(h.sol ?? "");
  /* 记录里存的「解答」只有**攻方**的冲四（见 problemToRuns 的过滤），直接全标成攻方会让答案
     少了对方的挡子、颜色也不交替（用户 10-05：「给答案时除了第一个子其他都是同色的」）。
     所以这里同样走 buildSolutionLine 把挡子补回来；推不成（坏题，见 problems.ts 的坏题闸）
     用 solveAppLine 在应用守方语义下现解一条完整线；再不行才退回只标攻方手。
     走查按每层 800ms 预算 × 手数，深题会明显卡点击——上限取静态池天花板（13 手），
     更深的坏记录直接退回只列攻方手（界面有说明，不会假装是完整答案）。 */
  const walkCap = Math.min(h.depth, 13);
  const built = buildSolutionLine(black, white, attacker, sol)
    ?? (sol.length && walkCap >= 1 ? solveAppLine(black, white, attacker, walkCap) : null);
  return {
    id: h.id,
    attacker,
    depth: h.depth,
    tier: h.tier,
    black,
    white,
    solution: built ? built.line : attackerOnlyLine(sol, attacker),
    ending: built?.ending,
    singleSide: !built,
    source: "material",
  };
};
