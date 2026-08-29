import { describe, expect, it } from "vitest";
import { emptyBoard, evaluateRenjuMove, forbiddenPoints, winningLinesAt } from "./game";
import type { Cell, Position } from "./types";

type StoneSetup = {
  black?: Position[];
  white?: Position[];
  size?: number;
};

type GoldenCase = StoneSetup & {
  name: string;
  move: Position;
  expected: Partial<ReturnType<typeof evaluateRenjuMove>>;
};

const positions = (row: number, cols: number[]): Position[] => cols.map((col) => ({ row, col }));
const vertical = (col: number, rows: number[]): Position[] => rows.map((row) => ({ row, col }));
const diagonal = (startRow: number, startCol: number, offsets: number[], dc = 1): Position[] => (
  offsets.map((offset) => ({ row: startRow + offset, col: startCol + offset * dc }))
);

const makeBoard = ({ black = [], white = [], size = 15 }: StoneSetup): Cell[][] => {
  const board = emptyBoard(size);
  black.forEach(({ row, col }) => { board[row][col] = "black"; });
  white.forEach(({ row, col }) => { board[row][col] = "white"; });
  return board;
};

const goldenCases: GoldenCase[] = [
  {
    name: "横向恰五合法",
    black: positions(7, [3, 4, 5, 6]),
    move: { row: 7, col: 7 },
    expected: { legal: true, exactFive: true, reason: null },
  },
  {
    name: "纵向恰五合法",
    black: vertical(7, [3, 4, 5, 6]),
    move: { row: 7, col: 7 },
    expected: { legal: true, exactFive: true, reason: null },
  },
  {
    name: "主对角线恰五合法",
    black: diagonal(3, 3, [0, 1, 2, 3]),
    move: { row: 7, col: 7 },
    expected: { legal: true, exactFive: true, reason: null },
  },
  {
    name: "副对角线恰五合法",
    black: diagonal(3, 11, [0, 1, 2, 3], -1),
    move: { row: 7, col: 7 },
    expected: { legal: true, exactFive: true, reason: null },
  },
  {
    name: "横向长连禁手",
    black: positions(7, [2, 3, 4, 5, 6]),
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "overline", exactFive: false, reason: "长连禁手" },
  },
  {
    name: "纵向长连禁手",
    black: vertical(7, [2, 3, 4, 5, 6]),
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "overline", exactFive: false, reason: "长连禁手" },
  },
  {
    name: "主对角线长连禁手",
    black: diagonal(2, 2, [0, 1, 2, 3, 4]),
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "overline", exactFive: false, reason: "长连禁手" },
  },
  {
    name: "副对角线长连禁手",
    black: diagonal(2, 12, [0, 1, 2, 3, 4], -1),
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "overline", exactFive: false, reason: "长连禁手" },
  },
  {
    name: "单个活四不属于四四",
    black: positions(7, [5, 6, 8]),
    move: { row: 7, col: 7 },
    expected: { legal: true, fourCount: 1, reason: null },
  },
  {
    name: "横竖异向四四禁手",
    black: [
      ...positions(7, [5, 6, 8]),
      ...vertical(7, [5, 6, 8]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "double-four", fourCount: 2, reason: "四四禁手" },
  },
  {
    name: "横线与斜线异向四四禁手",
    black: [
      ...positions(7, [5, 6, 8]),
      { row: 5, col: 5 }, { row: 6, col: 6 }, { row: 8, col: 8 },
    ],
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "double-four", fourCount: 2, reason: "四四禁手" },
  },
  {
    name: "同一横线两个独立冲四仍是四四",
    black: positions(7, [3, 5, 6, 9]),
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "double-four", fourCount: 2, reason: "四四禁手" },
  },
  {
    name: "直三交叉形成三三禁手",
    black: [
      ...positions(7, [6, 8]),
      ...vertical(7, [6, 8]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "double-three", openThreeCount: 2, reason: "三三禁手" },
  },
  {
    name: "两个跳三交叉形成三三禁手",
    black: [
      ...positions(7, [5, 8]),
      ...vertical(7, [5, 8]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "double-three", openThreeCount: 2, reason: "三三禁手" },
  },
  {
    name: "白子封住一端后是假活三",
    black: [
      ...positions(7, [6, 8]),
      ...vertical(7, [6, 8]),
    ],
    white: [{ row: 7, col: 5 }],
    move: { row: 7, col: 7 },
    expected: { legal: true, openThreeCount: 1, reason: null },
  },
  {
    name: "棋盘边缘没有双端成四空间",
    size: 9,
    black: [{ row: 1, col: 0 }, { row: 1, col: 2 }, { row: 0, col: 1 }, { row: 2, col: 1 }],
    move: { row: 1, col: 1 },
    expected: { legal: true, openThreeCount: 0, reason: null },
  },
  {
    name: "成活四的延伸点若同时长连则不算活三",
    black: [
      ...positions(7, [5, 8]),
      ...vertical(6, [4, 5, 6, 8, 9]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: true, openThreeCount: 0, reason: null },
  },
  {
    name: "成活四的延伸点若同时四四则不算活三",
    black: [
      ...positions(7, [5, 8]),
      ...vertical(6, [5, 6, 8]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: true, openThreeCount: 0, reason: null },
  },
  {
    name: "成活四的延伸点若同时三三则不算活三",
    black: [
      ...positions(7, [5, 8]),
      { row: 6, col: 5 }, { row: 6, col: 6 }, { row: 6, col: 7 },
      { row: 8, col: 6 }, { row: 8, col: 7 },
    ],
    move: { row: 7, col: 7 },
    expected: { legal: true, openThreeCount: 1, reason: null },
  },
  {
    name: "恰五优先于同手产生的四形",
    black: [
      ...positions(7, [3, 4, 5, 6]),
      ...vertical(7, [5, 6, 8]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: true, exactFive: true, reason: null },
  },
  {
    name: "同手既有恰五又有长连时仍按长连禁手",
    black: [
      ...positions(7, [3, 4, 5, 6]),
      ...vertical(7, [2, 3, 4, 5, 6]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: "overline", exactFive: true, reason: "长连禁手" },
  },
  {
    name: "已有棋子的位置不能再次落子",
    black: [{ row: 7, col: 7 }],
    move: { row: 7, col: 7 },
    expected: { legal: false, forbidden: null, exactFive: false, reason: "该位置已有棋子" },
  },
  {
    name: "右端贴边的恰五合法",
    black: positions(7, [10, 11, 12, 13]),
    move: { row: 7, col: 14 },
    expected: { legal: true, exactFive: true, reason: null },
  },
  {
    name: "横线右端贴边长连禁手",
    black: positions(7, [10, 11, 12, 13, 14]),
    move: { row: 7, col: 9 },
    expected: { legal: false, forbidden: "overline", exactFive: false, reason: "长连禁手" },
  },
  {
    name: "竖线下端贴边长连禁手",
    black: vertical(14, [9, 10, 11, 12, 13]),
    move: { row: 14, col: 14 },
    expected: { legal: false, forbidden: "overline", exactFive: false, reason: "长连禁手" },
  },
  {
    name: "对角线角部贴边长连禁手",
    black: diagonal(10, 10, [0, 1, 2, 3, 4]),
    move: { row: 9, col: 9 },
    expected: { legal: false, forbidden: "overline", exactFive: false, reason: "长连禁手" },
  },
  {
    name: "单独跳三算活三",
    black: positions(7, [5, 8]),
    move: { row: 7, col: 7 },
    expected: { legal: true, openThreeCount: 1, reason: null },
  },
  {
    name: "白子封住跳三远端后不算活三",
    black: positions(7, [5, 8]),
    white: [{ row: 7, col: 9 }],
    move: { row: 7, col: 7 },
    expected: { legal: true, openThreeCount: 0, reason: null },
  },
  {
    name: "白子紧邻封端后连三不算活三",
    black: positions(7, [5, 6, 9]),
    white: [{ row: 7, col: 8 }],
    move: { row: 7, col: 7 },
    expected: { legal: true, openThreeCount: 0, reason: null },
  },
  {
    name: "左端贴边的连三不算活三",
    black: positions(7, [0, 1]),
    move: { row: 7, col: 2 },
    expected: { legal: true, openThreeCount: 0, reason: null },
  },
  {
    name: "同手四三合法不构成禁手",
    black: [
      ...positions(7, [5, 6]),
      ...vertical(7, [4, 5, 6]),
    ],
    move: { row: 7, col: 7 },
    expected: { legal: true, fourCount: 1, openThreeCount: 1, reason: null },
  },
];

describe("renju golden positions", () => {
  it.each(goldenCases)("$name", ({ move, expected, ...setup }) => {
    expect(evaluateRenjuMove(makeBoard(setup), move)).toMatchObject(expected);
  });
});

describe("renju rule API stability", () => {
  it("invalidates cached evaluations when a reused board is mutated", () => {
    const board = makeBoard({ black: positions(7, [6, 8]) });
    const move = { row: 7, col: 7 };
    expect(evaluateRenjuMove(board, move)).toMatchObject({ legal: true, openThreeCount: 1 });

    vertical(7, [6, 8]).forEach(({ row, col }) => { board[row][col] = "black"; });
    expect(evaluateRenjuMove(board, move)).toMatchObject({
      legal: false,
      forbidden: "double-three",
      openThreeCount: 2,
    });
  });

  it("returns forbidden candidates but never returns occupied points", () => {
    const board = makeBoard({ black: positions(7, [2, 3, 4, 5, 6]) });
    const points = forbiddenPoints(board);
    expect(points).toContainEqual({ row: 7, col: 7, reason: "长连禁手" });
    expect(points.some((point) => board[point.row][point.col] !== null)).toBe(false);
  });

  it("classifies forbidden candidates by their rule violation", () => {
    const doubleThree = makeBoard({ black: [...positions(7, [6, 8]), ...vertical(7, [6, 8])] });
    expect(forbiddenPoints(doubleThree)).toContainEqual({ row: 7, col: 7, reason: "三三禁手" });

    const doubleFour = makeBoard({ black: [...positions(7, [5, 6, 8]), ...vertical(7, [5, 6, 8])] });
    expect(forbiddenPoints(doubleFour)).toContainEqual({ row: 7, col: 7, reason: "四四禁手" });
  });

  it("reports exact winning stones and preserves black/white rule differences", () => {
    const blackBoard = makeBoard({ black: positions(8, [3, 4, 5, 6, 7, 8]) });
    expect(winningLinesAt(blackBoard, { row: 8, col: 7 }, "renju")).toHaveLength(0);
    expect(winningLinesAt(blackBoard, { row: 8, col: 7 }, "freestyle")[0]).toHaveLength(6);

    const whiteBoard = makeBoard({ white: diagonal(4, 4, [0, 1, 2, 3, 4, 5]) });
    expect(winningLinesAt(whiteBoard, { row: 7, col: 7 }, "renju")[0]).toHaveLength(6);

    const exactBlack = makeBoard({ black: vertical(9, [4, 5, 6, 7, 8]) });
    expect(winningLinesAt(exactBlack, { row: 7, col: 9 }, "renju")[0]).toEqual(vertical(9, [4, 5, 6, 7, 8]));
  });
});
