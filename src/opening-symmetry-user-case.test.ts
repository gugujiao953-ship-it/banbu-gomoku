import { describe, expect, it } from "vitest";
import { emptyBoard, forbiddenPoints } from "./game";
import { isDistinctFifthCandidate, positionSymmetries, symmetricCounterpart } from "./opening-rules";
import type { Cell, Position } from "./types";

/**
 * 用户 2026-09-16 手机实测局面（截图逐像素量出，非目测）：
 *   黑1 天元(7,7)、白2(6,7)、黑3(7,6)、白4(8,6)
 * 黑1↔黑3 的中点与白2↔白4 的中点**重合于 (6.5,7)** ⇒ 本局局面关于 (6.5,7) 中心对称。
 * 于是互为 180° 像的两个打点会给出完全一样的局面，第二个必须被拒。
 * 用户在这一局摆了 9 个打点，(7,5) 与 (7,8) 正好是这么一对——程序当时放行了第二个。
 */
const userBoard = (): Cell[][] => {
  const board = emptyBoard(15);
  board[7][7] = "black";
  board[6][7] = "white";
  board[7][6] = "black";
  board[8][6] = "white";
  return board;
};

// 截图里量出的 9 个打点（行序）
const PLACED: Position[] = [
  { row: 6, col: 4 }, { row: 6, col: 5 }, { row: 6, col: 6 },
  { row: 7, col: 4 }, { row: 7, col: 5 }, { row: 7, col: 8 },
  { row: 9, col: 4 }, { row: 9, col: 5 }, { row: 9, col: 6 },
];

describe("用户实测局面：打点同形判定（对齐五林客户端口径）", () => {
  it("局面关于 (6.5,7) 中心对称，对称变换就是 (row,col) → (14-row, 13-col)", () => {
    const symmetries = positionSymmetries(userBoard());
    expect(symmetries).toHaveLength(1);
    for (const point of [{ row: 3, col: 3 }, { row: 6, col: 4 }, { row: 12, col: 9 }]) {
      const mapped = symmetries[0](point);
      expect({ row: Math.round(mapped.row), col: Math.round(mapped.col) })
        .toEqual({ row: 14 - point.row, col: 13 - point.col });
    }
  });

  it("(7,5) 与 (7,8) 是同形的一对：先摆 (7,5)，(7,8) 必须被拒（用户报的那一对）", () => {
    const board = userBoard();
    expect(isDistinctFifthCandidate(board, [{ row: 7, col: 5 }], { row: 7, col: 8 })).toBe(false);
    expect(symmetricCounterpart(board, [{ row: 7, col: 5 }], { row: 7, col: 8 })).toEqual({ row: 7, col: 5 });
    // 反过来也一样
    expect(isDistinctFifthCandidate(board, [{ row: 7, col: 8 }], { row: 7, col: 5 })).toBe(false);
  });

  it("截图里那 9 个打点按行序摆：只有 (7,8) 被拒（与 (7,5) 同形），其余 8 个合法", () => {
    const board = userBoard();
    const placed: Position[] = [];
    const rejected: Position[] = [];
    for (const point of PLACED) {
      if (isDistinctFifthCandidate(board, placed, point)) placed.push(point);
      else rejected.push(point);
    }
    expect(rejected).toEqual([{ row: 7, col: 8 }]);
    expect(placed).toHaveLength(8);
    console.log(`9 个打点中，按新口径被拒：${rejected.map((p) => `(${p.row},${p.col})`).join("、")}（其余 ${placed.length} 个合法）`);
  });

  it("用户抱怨的「右边一堆点都打不了」已解除：右侧只有 4 个点与已摆打点同形", () => {
    const board = userBoard();
    const placed = PLACED.filter((point) => point.row !== 7 || point.col !== 8);
    const rejected: Position[] = [];
    const allowed: Position[] = [];
    for (let col = 8; col <= 10; col += 1) {
      for (let row = 5; row <= 9; row += 1) {
        const point = { row, col };
        if (board[row][col]) continue;
        if (placed.some((p) => p.row === row && p.col === col)) continue;
        (isDistinctFifthCandidate(board, placed, point) ? allowed : rejected).push(point);
      }
    }
    // 被拒的正好是「180° 像落在已摆打点上」的那几个点（含把 (7,8) 自己算回来的情形）
    expect(rejected.map((p) => `${p.row},${p.col}`)).toEqual(["5,8", "7,8", "8,8", "5,9", "7,9", "8,9"]);
    expect(allowed.length).toBe(9);
    console.log(`右侧 8-10 列：可打点 ${allowed.length} 个，与已摆打点同形的 ${rejected.length} 个`);
  });

  it("原先那局（局面自身不对称）按新口径全部放行 —— 与五林客户端一致", () => {
    // 黑1(7,7) 白2(6,8) 黑3(5,6) 白4(6,7)：四子之间不存在任何轴对称/中心对称关系。
    const board = emptyBoard(15);
    board[7][7] = "black";
    board[6][8] = "white";
    board[5][6] = "black";
    board[6][7] = "white";
    expect(positionSymmetries(board)).toHaveLength(0);
    for (const point of [{ row: 8, col: 6 }, { row: 6, col: 3 }, { row: 10, col: 10 }]) {
      expect(isDistinctFifthCandidate(board, [{ row: 6, col: 6 }], point), `${point.row},${point.col}`).toBe(true);
    }
  });

  it("与禁手判定互不干扰（打点为黑方，禁手点仍在同一盘面正常算出）", () => {
    const forbidden = forbiddenPoints(userBoard());
    expect(Array.isArray(forbidden)).toBe(true);
  });
});
