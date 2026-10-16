// engine.ts — VCF 挑战规则核心。
// 用户 2026-10-04 定的硬规则：攻方每一手必须"带四或以上"（冲四/活四/成五）才能落子，
// 守方对冲四强制唯一防守；破四防不住 / 黑方防点即禁手 ⇒ 攻方胜。
import { VCF_BLACK, VCF_WHITE, vcfFivePoints } from "../vcf/vcf-generator";
import type { Player } from "../../types";
import { evaluateRenjuMove } from "../../game";

export const VCF_SIZE = 15;
export type VcfBoard = Int8Array; // 225 格：1=黑 2=白 0=空
export const vidx = (row: number, col: number) => row * VCF_SIZE + col;
export const inVcfBoard = (row: number, col: number) => row >= 0 && row < VCF_SIZE && col >= 0 && col < VCF_SIZE;
export const codeOf = (p: Player) => (p === "black" ? VCF_BLACK : VCF_WHITE);
export const playerOf = (c: number): Player => (c === VCF_BLACK ? "black" : "white");
export const otherPlayerCode = (c: number) => (c === VCF_BLACK ? VCF_WHITE : VCF_BLACK);

const toCellGrid = (board: VcfBoard): Array<Array<Player | null>> => {
  const grid: Array<Array<Player | null>> = [];
  for (let r = 0; r < VCF_SIZE; r += 1) {
    const row: Array<Player | null> = [];
    for (let c = 0; c < VCF_SIZE; c += 1) {
      const v = board[vidx(r, c)];
      row.push(v === VCF_BLACK ? "black" : v === VCF_WHITE ? "white" : null);
    }
    grid.push(row);
  }
  return grid;
};

/** 落子处是否已成五（黑按连珠口径恰五算胜，白五连及以上都算）。 */
const isFiveAt = (board: VcfBoard, row: number, col: number, player: number, exactFiveForBlack: boolean): boolean => {
  const dirs: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let len = 1;
    for (let i = 1; ; i += 1) {
      const rr = row + dr * i, cc = col + dc * i;
      if (!inVcfBoard(rr, cc) || board[vidx(rr, cc)] !== player) break;
      len += 1;
    }
    for (let i = 1; ; i += 1) {
      const rr = row - dr * i, cc = col - dc * i;
      if (!inVcfBoard(rr, cc) || board[vidx(rr, cc)] !== player) break;
      len += 1;
    }
    if (exactFiveForBlack ? len === 5 : len >= 5) return true;
  }
  return false;
};

export interface AttackVerdict {
  /** false = 落子被规则拒绝（盘面不变） */
  ok: boolean;
  /** win = 攻方已胜（成五 / 活四守方无解 / 守方防点即禁手）；continue = 守方强制防守后继续 */
  outcome: "win" | "continue";
  /** continue 时守方唯一防点（225 索引） */
  block?: number;
  /** 给用户的提示文案 */
  message: string;
}

/**
 * 攻方落子判定（调用方在合法空点上调用）：
 *  1. 黑方禁手直接拒绝；
 *  2. 成五 ⇒ 胜；
 *  3. 落子后攻方五连完成点为 0 ⇒ 拒绝（"没带四"）；
 *  4. ≥2 个完成点 ⇒ 活四/双四，守方一手防不完 ⇒ 胜；
 *  5. 恰 1 个完成点 ⇒ 冲四，守方强制堵该点；该点对黑守方是禁手 ⇒ 无解 ⇒ 胜。
 *  6. 守方反四（防守后守方自己带四）：下一步判定里自然处理——攻方必须"带四且挡住反四"，
 *     否则该手以"守方反四先行"拒绝，实在无解就用「放弃」。
 */
/** 与五子棋冒险「illegal」文案对齐的禁手提示。 */
const forbiddenMessage = (kind: "overline" | "double-four" | "double-three") =>
  kind === "overline" ? "黑方不能形成长连（六连以上）"
    : kind === "double-four" ? "黑方不能形成四四"
      : "黑方不能形成三三";

export function classifyAttack(board: VcfBoard, row: number, col: number, attacker: Player): AttackVerdict {
  if (attacker === "black") {
    const ev = evaluateRenjuMove(toCellGrid(board), { row, col });
    if (ev.forbidden) return { ok: false, outcome: "continue", message: forbiddenMessage(ev.forbidden) };
  }
  const player = codeOf(attacker);
  const next = board.slice() as VcfBoard;
  next[vidx(row, col)] = player;
  if (isFiveAt(next, row, col, player, attacker === "black")) {
    return { ok: true, outcome: "win", message: "五连！挑战成功" };
  }
  // 守方反四优先：若守方下一手就能成五，这手必须带四且挡住它，否则等于输
  const defender: Player = attacker === "black" ? "white" : "black";
  if (vcfFivePoints(next, codeOf(defender), "renju").length > 0) {
    return { ok: false, outcome: "continue", message: "守方有反四——这一手必须带四并挡住它" };
  }
  const winPoints = vcfFivePoints(next, player, "renju");
  if (winPoints.length === 0) {
    return { ok: false, outcome: "continue", message: "请形成四" };
  }
  if (winPoints.length >= 2) {
    return { ok: true, outcome: "win", message: "活四/双四，守方无解，挑战成功" };
  }
  const block = winPoints[0];
  if (defender === "black") {
    const ev = evaluateRenjuMove(toCellGrid(next), { row: Math.floor(block / VCF_SIZE), col: block % VCF_SIZE });
    if (ev.forbidden) return { ok: true, outcome: "win", message: "无法防守的冲四，挑战成功" };
  }
  return { ok: true, outcome: "continue", block, message: "冲四" };
}

/** 守方落子后，检查守方是否出现反四（返回守方五连完成点；空 = 无反四）。 */
export function defenderCounterFour(board: VcfBoard, defender: Player): number[] {
  return vcfFivePoints(board, codeOf(defender), "renju");
}
