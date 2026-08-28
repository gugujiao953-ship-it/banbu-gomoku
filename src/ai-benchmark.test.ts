import { describe, expect, it } from "vitest";
import { benchmarkAdvancedThreeMovePuzzles, selectAdvancedThreeMovePuzzles } from "./ai-benchmark";
import type { Puzzle } from "./puzzles";

const point = (row: number, col: number, player: "black" | "white") => ({ row, col, player });
const advancedPuzzle = (id: string): Puzzle => ({
  id,
  title: "三手胜4-高级题",
  prompt: "黑先，测试连续冲四",
  difficulty: 4,
  player: "black",
  stones: [
    point(7, 4, "black"), point(6, 4, "white"), point(7, 5, "black"), point(6, 5, "white"),
    point(7, 6, "black"), point(6, 6, "white"), point(8, 7, "black"), point(8, 6, "white"),
  ],
});

describe("AI advanced three-move benchmark", () => {
  it("selects only the native advanced three-move set", () => {
    const puzzles = [advancedPuzzle("advanced"), { ...advancedPuzzle("other"), title: "三手胜3-中级题" }];
    expect(selectAdvancedThreeMovePuzzles(puzzles).map((puzzle) => puzzle.id)).toEqual(["advanced"]);
  });

  it("requires a verified proof within fifteen plies", () => {
    const [result] = benchmarkAdvancedThreeMovePuzzles([advancedPuzzle("advanced")], { timeBudgetMs: 5000, nodeBudget: 300000 });
    expect(result.passed).toBe(true);
    expect(result.steps).toBeLessThanOrEqual(15);
    expect(result.reason).toContain("已验证");
  });
});
