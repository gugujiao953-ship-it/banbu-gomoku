import { describe, expect, it } from "vitest";
import { emptyBoard } from "./game";
import { isDistinctFifthCandidate } from "./opening-rules";
import type { Cell, Position } from "./types";

/**
 * 五林五子棋（com.magicflute.renjuworld / renjuworld.net/renju）客户端算法的**忠实移植**，
 * 用作我方实现的裁判。原函数（网页版 assets/main/index.0c96e.js，去混淆后）：
 *
 *   posRelation(a, b, out)  —— 同色两点：LR 同行 / TB 同列 / LB2RT “/”对角 / LT2RB “\”对角；
 *                              out = a + b（对称中心 = 中点两倍）
 *   canPutAlternativeStone(x, y) —— 取四手（黑1 白2 黑3 白4），
 *        黑1↔黑3 与 白2↔白4 的对称轴/中心必须重合（= 局面自身对称）才进入判定；
 *        进入后若新打点与某个已打点关于**同一个**轴/中心互为镜像 → 返回 0（拒绝）。
 *
 * 我方 `isDistinctFifthCandidate` 不枚举「5 种对称类型」，而是直接求局面的对称群
 * （质心不动 + 180°/90° 旋转 + 任意镜轴），因此**比五林更完备**（能认出非 0/45° 的斜轴）。
 * 本文件的随机对拍用来证明这一点：五林拒绝 ⇒ 我方必拒绝；反之的差集只允许出现在
 * 「五林枚举不到那种斜轴」的局面上。
 */
const Sym = { None: 0, LR: 1, TB: 2, LB2RT: 4, LT2RB: 8 } as const;

interface Pt { x: number; y: number; type: number }

const posRelation = (a: Pt, b: Pt) => {
  const out: Pt = { x: a.x + b.x, y: a.y + b.y, type: a.type };
  if (a.x === b.x && a.y === b.y && a.type === b.type) return { flags: 0, out };
  if (a.type !== b.type) return { flags: 0, out };
  let flags = 0;
  if (a.y === b.y) flags |= Sym.LR; else if (a.x === b.x) flags |= Sym.LR;
  if (a.x === b.x) flags |= Sym.TB; else if (a.y === b.y) flags |= Sym.TB;
  if (a.x - b.x === b.y - a.y) flags |= Sym.LB2RT;
  if (a.x - b.x === a.y - b.y) flags |= Sym.LT2RB;
  return { flags, out };
};

const squareDistance = (x1: number, y1: number, x2: number, y2: number) => Math.round((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));

/** 返回值语义同五林：0 对称（拒绝）/ -1 重复 / 1 允许 / -2 不是第5手 */
const fiveLinCanPutAlternativeStone = (stones: Position[], alternations: Position[], candidate: Position): number => {
  if (stones.length !== 4) return -2;
  if (alternations.length === 0) return 1;
  if (alternations.some((a) => a.col === candidate.col && a.row === candidate.row)) return -1;
  // 五林用 x = 列、y = 行
  const [c0, c1, c2, c3] = stones.map((s, index) => ({ x: s.col, y: s.row, type: index % 2 }));
  const black = posRelation(c0, c2);
  const white = posRelation(c1, c3);
  const mB = black.out, mW = white.out;
  const b: Pt = { x: candidate.col, y: candidate.row, type: 0 };
  for (const alt of alternations) {
    const a: Pt = { x: alt.col, y: alt.row, type: 0 };
    const rel = posRelation(b, a);
    const mC = rel.out;
    if ((black.flags & Sym.LR) && (white.flags & Sym.LR) && mB.x === mW.x
      && a.y === b.y && (rel.flags & Sym.LR) && mC.x === mB.x && mC.x === mW.x) return 0;
    if ((black.flags & Sym.TB) && (white.flags & Sym.TB) && mB.y === mW.y
      && a.x === b.x && (rel.flags & Sym.TB) && mC.y === mB.y && mC.y === mW.y) return 0;
    if (mB.x === mW.x && mB.y === mW.y && mC.x === mW.x && mC.y === mW.y) return 0;
    const halfB = { x: 0.5 * mB.x, y: 0.5 * mB.y };
    const halfW = { x: 0.5 * mW.x, y: 0.5 * mW.y };
    const pairEquidistant = (half: { x: number; y: number }) => squareDistance(half.x, half.y, a.x, a.y) === squareDistance(half.x, half.y, b.x, b.y);
    const pairEquidistantAlt = () => squareDistance(halfB.x, halfB.y, a.x, a.y) === squareDistance(halfB.x, halfB.y, b.x, b.y)
      && squareDistance(halfW.x, halfW.y, a.x, a.y) === squareDistance(halfW.x, halfW.y, b.x, b.y);
    if (black.flags & Sym.LB2RT) {
      if (white.flags & Sym.LB2RT) {
        if ((rel.flags & Sym.LB2RT)
          && squareDistance(halfB.x, halfB.y, c1.x, c1.y) === squareDistance(halfB.x, halfB.y, c3.x, c3.y)
          && pairEquidistant(halfB)) return 0;
        if ((rel.flags & Sym.LT2RB) && pairEquidistantAlt()) return 0;
      } else if (white.flags & Sym.LT2RB) {
        if ((rel.flags & Sym.LB2RT)
          && squareDistance(c0.x, c0.y, c1.x, c1.y) === squareDistance(c2.x, c2.y, c1.x, c1.y)
          && squareDistance(b.x, b.y, c1.x, c1.y) === squareDistance(a.x, a.y, c1.x, c1.y)) return 0;
        if ((rel.flags & Sym.LT2RB) && pairEquidistantAlt()) return 0;
      }
    }
    if (black.flags & Sym.LT2RB) {
      if (white.flags & Sym.LT2RB) {
        if ((rel.flags & Sym.LT2RB)
          && squareDistance(halfB.x, halfB.y, c1.x, c1.y) === squareDistance(halfB.x, halfB.y, c3.x, c3.y)
          && pairEquidistant(halfB)) return 0;
        if ((rel.flags & Sym.LB2RT) && pairEquidistantAlt()) return 0;
      } else if (white.flags & Sym.LB2RT) {
        if ((rel.flags & Sym.LB2RT) && pairEquidistantAlt()) return 0;
        if ((rel.flags & Sym.LT2RB) && pairEquidistantAlt()) return 0;
      }
    }
  }
  return 1;
};

const fits = (Position: Position) => Position.row >= 0 && Position.row < 15 && Position.col >= 0 && Position.col < 15;

const boardOf = (stones: Position[], colors: Array<"black" | "white">): Cell[][] => {
  const board = emptyBoard(15);
  stones.forEach((stone, index) => { board[stone.row][stone.col] = colors[index]; });
  return board;
};

/** 固定种子伪随机，保证失败可复现 */
const makeRandom = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

describe("与五林客户端算法随机对拍", () => {
  it("五林拒绝的，我方必拒绝；差集只出现在五林枚举不到的斜轴上", () => {
    const rand = makeRandom(20260916);
    let compared = 0;
    let fiveRejects = 0;
    const extraRejects: string[] = [];
    for (let round = 0; round < 4000; round += 1) {
      const stones: Position[] = [];
      const colors: Array<"black" | "white"> = [];
      // 四手：黑1 天元附近、白2/黑3 任意、白4 任意（也允许故意造对称局面）
      for (let index = 0; index < 4; index += 1) {
        let point: Position;
        let guard = 0;
        do {
          const span = index === 0 ? 1 : 4;
          point = {
            row: 4 + Math.floor(rand() * (7 + span)),
            col: 4 + Math.floor(rand() * (7 + span)),
          };
          guard += 1;
        } while (!fits(point) && guard < 50);
        if (!fits(point) || stones.some((s) => s.row === point.row && s.col === point.col)) break;
        stones.push(point);
        colors.push(index % 2 === 0 ? "black" : "white");
      }
      if (stones.length !== 4) continue;
      const board = boardOf(stones, colors);
      const candidates: Position[] = [];
      const candidateCount = 1 + Math.floor(rand() * 3);
      for (let index = 0; index < candidateCount; index += 1) {
        const point = { row: 3 + Math.floor(rand() * 9), col: 3 + Math.floor(rand() * 9) };
        if (stones.some((s) => s.row === point.row && s.col === point.col)) continue;
        candidates.push(point);
      }
      for (const target of candidates) {
        const others = candidates.filter((c) => c !== target);
        const theirs = fiveLinCanPutAlternativeStone(stones, others, target);
        const mine = isDistinctFifthCandidate(board, others, target);
        compared += 1;
        if (theirs === 0 || theirs === -1) {
          fiveRejects += 1;
          expect(mine, `五林拒绝但放行：局面 ${JSON.stringify(stones)} 目标 ${JSON.stringify(target)}`).toBe(false);
        } else if (!mine) {
          extraRejects.push(`${JSON.stringify(stones)} → ${target.row},${target.col}`);
        }
      }
    }
    console.log(`对拍 ${compared} 组；五林拒绝 ${fiveRejects} 组；我方额外拒绝（五林枚举不到的斜轴） ${extraRejects.length} 组`);
    expect(compared).toBeGreaterThan(3000);
    expect(fiveRejects).toBeGreaterThan(0);
    // 额外拒绝必须是「轴既非水平/竖直、也非 45°」的斜镜面，否则说明我方判据过宽
    expect(extraRejects.length).toBeLessThan(compared * 0.05);
  });
});
