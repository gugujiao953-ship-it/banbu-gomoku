import { describe, expect, it } from "vitest";
import { coordinateName } from "./game";
import { exportPuzzleCollectionJson, importKaibaoPuzzleJson } from "./puzzles";
import type { PuzzleCollection } from "./puzzles";

/**
 * 「本机题集 → 题集 JSON 文件」的往返对拍。
 *
 * 这条链路是题集搬家的命门：在本应用里整理、导出成 JSON、换设备或换工具再读回来。
 * 只要导出与导入的口径有一处不对（坐标上下颠倒、尺寸没写、白先被当成黑先、难度丢失），
 * 用户会在**另一台设备**上才发现——所以必须在这里逐项钉死。
 */
const collection: PuzzleCollection = {
  id: "roundtrip",
  title: "往返测试题集",
  source: "本机整理",
  license: "自制",
  puzzles: [
    {
      id: "a",
      title: "黑先三手胜",
      prompt: "黑先，击败陪练",
      difficulty: 3,
      // 白先题常以白子收尾，所以预置子的颜色不能靠奇偶推；导出用分色写法正是为此。
      stones: [{ row: 7, col: 7, player: "black" }, { row: 6, col: 8, player: "white" }, { row: 8, col: 6, player: "black" }],
      player: "white",
      boardSize: 15,
      rule: "renju",
    },
    {
      id: "b",
      title: "六路题",
      prompt: "",
      difficulty: 1,
      stones: [{ row: 5, col: 1, player: "black" }, { row: 3, col: 2, player: "white" }],
      player: "black",
      boardSize: 6,
      rule: "freestyle",
    },
  ],
};

describe("题集导出的往返", () => {
  const exported = exportPuzzleCollectionJson(collection);

  it("导出的 JSON 能被导入器读回，题数与标题一致", () => {
    const report = importKaibaoPuzzleJson(exported, "往返测试题集");
    expect(report.collection.puzzles).toHaveLength(2);
    expect(report.collection.title).toBe("往返测试题集");
  });

  it("逐项对拍：棋子位置与颜色、行棋方、棋盘尺寸、规则、难度", () => {
    const back = importKaibaoPuzzleJson(exported, "往返测试题集").collection;
    for (const [index, original] of collection.puzzles.entries()) {
      const restored = back.puzzles[index];
      expect(restored.boardSize, `第 ${index + 1} 题棋盘尺寸`).toBe(original.boardSize);
      expect(restored.player, `第 ${index + 1} 题行棋方`).toBe(original.player);
      expect(restored.rule, `第 ${index + 1} 题规则`).toBe(original.rule);
      expect(restored.difficulty, `第 ${index + 1} 题难度`).toBe(original.difficulty);
      expect(restored.title).toBe(original.title);
      const key = (stone: { row: number; col: number; player: string }) => `${stone.row},${stone.col},${stone.player}`;
      expect(restored.stones.map(key).sort(), `第 ${index + 1} 题棋子`).toEqual(original.stones.map(key).sort());
    }
  });

  it("坐标写法与棋盘尺寸自洽（坐标标签是 1..size 的合法值）", () => {
    const payload = JSON.parse(exported) as { puzzles: Array<{ size: number; blackStones: string; whiteStones: string }> };
    for (const puzzle of payload.puzzles) {
      for (const label of `${puzzle.blackStones} ${puzzle.whiteStones}`.match(/[A-Z]\d+/g) ?? []) {
        const row = Number(label.slice(1));
        expect(row, `${label} 超出 ${puzzle.size} 路`).toBeGreaterThanOrEqual(1);
        expect(row, `${label} 超出 ${puzzle.size} 路`).toBeLessThanOrEqual(puzzle.size);
      }
    }
    // 与本应用显示棋盘的坐标函数同源：round-trip 的落点必须能被 coordinateName 复现。
    expect(coordinateName({ row: 5, col: 1 }, 6)).toBe("B1");
  });

  it("导出的文件就是题库 JSON 的形状（导出→再导入必须一模一样）", () => {
    const payload = JSON.parse(exported) as Record<string, unknown>;
    expect(Array.isArray(payload.puzzles)).toBe(true);
    expect((payload.defaultSettings as { title: string }).title).toBe("往返测试题集");
  });
});
