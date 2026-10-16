import { describe, expect, it } from "vitest";
import { forbiddenAt, forbiddenPointsOn } from "./renju-forbid";

/** "E14" → 15 路棋盘坐标（列字母 + 从下往上的行号；行 1 在最下）。 */
const at = (label: string) => ({ col: label.charCodeAt(0) - 65, row: 15 - Number(label.slice(1)) });
const emptyBoard = () => Array.from({ length: 15 }, () => Array<number>(15).fill(0));
const put = (board: number[][], label: string, color: 1 | -1) => { const { row, col } = at(label); board[row][col] = color; };
const fromList = (black: string[], white: string[]) => {
  const board = emptyBoard();
  black.forEach((label) => put(board, label, 1));
  white.forEach((label) => put(board, label, -1));
  return board;
};

describe("禁手判定（移植自 MIT 的 realjustice/renju_forbid）", () => {
  it("单个活三不算禁手（G8-I8 中间落子只是三段横线一个活三）", () => {
    // 竖方向被白 H7/H9 堵死，只剩横向一个活三 → 合法。
    const board = fromList(["G8", "I8"], ["H7", "H9"]);
    const { row, col } = at("H8");
    expect(forbiddenAt(board, row, col)).toBeNull();
  });

  it("三三：横竖各一个活三 → G7 是三三禁手", () => {
    // 横 E7 F7 + 落 G7 成三；竖 G5 G6 + 落 G7 成三（两端都空）
    const board = fromList(["E7", "F7", "G5", "G6"], []);
    const { row, col } = at("G7");
    expect(forbiddenAt(board, row, col)).toBe("double-three");
  });

  it("长连：黑 C7-F7 四连，F7 之后再落 G7 成六连 → 长连禁手", () => {
    const board = fromList(["C7", "D7", "E7", "F7", "G7"], []);
    const { row, col } = at("H7");   // 落 H7 后 C7..H7 六连
    expect(forbiddenAt(board, row, col)).toBe("overline");
  });

  it("五连优先：落子成恰好五连时不算禁手", () => {
    const board = fromList(["C7", "D7", "E7", "F7"], []);
    const { row, col } = at("G7");
    expect(forbiddenAt(board, row, col)).toBeNull();
  });

  it("四四：两个方向各一个四 → 四四禁手", () => {
    // 横：C7 D7 E7 + 落 F7 成四；竖：F5 F6 + 落 F7 成四（配合 F8 是否有子不影响四的判定）
    const board = fromList(["C7", "D7", "E7", "F5", "F6", "F8"], []);
    const { row, col } = at("F7");
    expect(forbiddenAt(board, row, col)).toBe("double-four");
  });

  it("用户 2026-10-06 那份局面：F11 / G9 / H9 / H4 四个点都判禁手", () => {
    // 来自用户给的 SGF（AB 25 子 / AW 9 子），坐标照导入结果逐个搬过来。
    const black = ["E14", "F14", "D12", "F12", "E11", "H11", "G10", "H10", "F8", "G8", "K8", "C7", "D7", "K7", "M7", "E6", "F6", "J6", "G5", "H5", "J4", "K4", "K3", "L3"];
    const white = ["G14", "D13", "G13", "B12", "J12", "C9", "L6", "E5", "J2"];
    const board = fromList(black, white);
    for (const label of ["F11", "G9", "H9", "H4"]) {
      const { row, col } = at(label);
      expect(forbiddenAt(board, row, col), `${label} 应判禁手`).not.toBeNull();
    }
    // 顺带打印整盘判出来的禁手点，便于和 五林 / 摆棋小工具 对照
    console.log("本局面判出的禁手点：", forbiddenPointsOn(board).map((point) => `${String.fromCharCode(65 + point.col)}${15 - point.row}(${point.kind})`).join(" "));
  });
});
