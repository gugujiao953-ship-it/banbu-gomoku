import { classifyAttack, vidx, VCF_SIZE, type VcfBoard } from "./engine";
import { solveVcf } from "../vcf/vcf-generator";
import type { Player, Position } from "../../types";

export interface SolutionStep extends Position { player: Player }

/** 结局类型：连五 / 活四（双四）/ 抓禁手（守方挡点本身是黑方禁手，挡不了）。 */
export type SolutionEnding = "five" | "openFour" | "forbidden";

export interface BuiltSolution {
  /** 攻守交替的完整解答线（手序即真实手序） */
  line: SolutionStep[];
  /** 攻方手数（判档、算题分用这个，不是 line.length） */
  depth: number;
  ending: SolutionEnding;
}

/**
 * 把题源里的「正解坐标串」规范成**攻守交替的完整解答线**。
 *
 * 为什么必须做这一步（用户 2026-10-05：「给答案时，除了第一个子，其他的都是同色的，
 * 我看了半天还以为答案出错了」）：
 *   题源里的正解串**形状不统一**——实测批次题抽检 36 道里有 20 道只写了攻方的冲四点
 *   （「正解：F7 → G8 → H9 → H6」，全是攻方四），另外 16 道是攻守交替的。所以**不能按奇偶配色**：
 *   一半的题会把攻方的第 2、3 手涂成对方的颜色，答案看起来就是错的。
 *
 * 做法：像真下棋一样**从初始局面逐步推**，每一步都问引擎「这一点现在合不合法」：
 *   · 轮到攻方：这一点能形成四（`classifyAttack().ok`）→ 判为攻方手；
 *   · 轮到守方：正解里写了这一点、且它正是上一手四的唯一挡点 → 判为守方手；
 *     正解里没写（只写了攻方手）→ 用算出来的挡点**补一手**，让答案始终是一条完整的攻守交替线，
 *     手序也就是真实手序（第 1 手冲四、第 2 手对方挡、第 3 手再冲四……）。
 *  推不下去（既不是攻方的四、也不是守方的挡点）→ 返回 null：**宁可丢这道题，也不给一条错的答案**。
 */
export const buildSolutionLine = (
  black: Position[],
  white: Position[],
  attacker: Player,
  coords: Position[],
): BuiltSolution | null => {
  if (!coords.length) return null;
  const attackerNum = attacker === "black" ? 1 : 2;
  const defender: Player = attacker === "black" ? "white" : "black";
  const board = new Int8Array(VCF_SIZE * VCF_SIZE) as VcfBoard;
  for (const s of black) board[vidx(s.row, s.col)] = 1;
  for (const s of white) board[vidx(s.row, s.col)] = 2;

  const line: SolutionStep[] = [];
  let ending: SolutionEnding | null = null;
  let cursor = 0;
  for (let guard = 0; guard < 80 && cursor < coords.length; guard += 1) {
    const atk = coords[cursor];
    if (board[vidx(atk.row, atk.col)] !== 0) return null;          // 这一点已经有子 → 串不可信
    const verdict = classifyAttack(board, atk.row, atk.col, attacker);
    if (!verdict.ok) return null;                                   // 攻方这一手不成四 → 串不可信
    board[vidx(atk.row, atk.col)] = attackerNum;
    line.push({ row: atk.row, col: atk.col, player: attacker });
    cursor += 1;
    if (verdict.outcome === "win") {
      /* 三条收尾路径的判据都在引擎的 message 里：抓禁手（守方挡点是黑方禁手）/ 活四双四 / 连五。 */
      ending = verdict.message.includes("禁手") ? "forbidden" : verdict.message.includes("活四") ? "openFour" : "five";
      break;
    }
    const block = verdict.block;
    if (block === undefined) return null;
    const blockRow = Math.floor(block / VCF_SIZE), blockCol = block % VCF_SIZE;
    // 正解里若写了守方这一手，必须是这个唯一挡点；没写就由我们补上
    const listed = coords[cursor];
    if (listed && listed.row === blockRow && listed.col === blockCol) cursor += 1;
    board[block] = defender === "black" ? 1 : 2;
    line.push({ row: blockRow, col: blockCol, player: defender });
  }
  if (!line.length || !ending) return null;                          // 走不到终局 → 不是一道完整的题
  return { line, depth: line.filter((m) => m.player === attacker).length, ending };
};

/** 推不成完整线时的退路：把整条串**如实地**标成攻方手（它本来就是攻方的连续冲四），
 *  由界面写明"只列攻方冲四"。以前这里是按奇偶交替配色，等于给一半的题编出了对方的挡子，
 *  答案看起来就是错的（用户 10-06 报的正是这个）。 */
export const attackerOnlyLine = (coords: Position[], attacker: Player): SolutionStep[] =>
  coords.map((c) => ({ ...c, player: attacker }));

/** 一条解线是不是"只有攻方"（判据：所有手同一个颜色）——界面据此加一句说明。 */
export const isSingleSideLine = (line: SolutionStep[]) => line.length > 0 && line.every((m) => m.player === line[0].player);

/**
 * 坏题修复：在**应用守方语义**下现解一条完整胜线（buildSolutionLine 推不成题源正解时的退路）。
 *
 *  为什么不能直接用 solveVcf 的线当答案（用户 10-06 报「答案全是攻方一色」牵出的第二个坑）：
 *  求解器的守方比挑战**强**——它会考虑「反击四」，而挑战里守方永远是自动堵唯一挡点
 *  （onCellClick 与 buildSolutionLine 同一模型）。求解器的线里守方若走了反击四，这条线
 *  在挑战里根本复现不出来。
 *
 *  做法：把求解器当**先知**逐步走。它的胜证要求所有守方应手都输（含堵四），所以每一步在
 *  「实际盘面」上问它「还有没有 ≤ remaining 的胜」，取它线里的第一攻手落子，守方按应用
 *  规则自动堵（classifyAttack 的 block），循环到赢。产出的线每一手都和挑战运行时逐子一致，
 *  最后仍用 buildSolutionLine 规范化（重放验证 + 拿结局类型）。
 */
export const solveAppLine = (
  black: Position[],
  white: Position[],
  attacker: Player,
  maxDepth: number,
  perLevelMs = 800,
): BuiltSolution | null => {
  const start = new Int8Array(VCF_SIZE * VCF_SIZE) as VcfBoard;
  for (const s of black) start[vidx(s.row, s.col)] = 1;
  for (const s of white) start[vidx(s.row, s.col)] = 2;
  const attackerNum = attacker === "black" ? 1 : 2;
  const defenderNum = attacker === "black" ? 2 : 1;
  const board = start.slice() as VcfBoard;
  const wins: Position[] = [];
  for (let remaining = maxDepth; remaining >= 1 && wins.length < maxDepth; remaining -= 1) {
    const sol = solveVcf(board, { attacker: attackerNum, rules: "renju", maxDepth: remaining, timeBudget: perLevelMs });
    if (!sol.win) return null;
    const mv = sol.line.find((m) => m.player === attackerNum);
    if (!mv) return null;
    const verdict = classifyAttack(board, mv.row, mv.col, attacker);
    if (!verdict.ok) return null;                       // 理论上不会发生：求解器只出带四/成五的手
    wins.push({ row: mv.row, col: mv.col });
    board[vidx(mv.row, mv.col)] = attackerNum;
    if (verdict.outcome === "win") return buildSolutionLine(black, white, attacker, wins);
    const block = verdict.block;
    if (block === undefined) return null;
    board[block] = defenderNum;
  }
  return null;
};
