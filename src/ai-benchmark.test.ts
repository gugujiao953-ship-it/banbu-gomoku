import { describe, expect, it } from "vitest";
import {
  AI_BENCHMARK_PROFILES,
  benchmarkAdvancedThreeMovePuzzles,
  recommendAiBenchmarkLevel,
  selectAdvancedThreeMovePuzzles,
  selectStandardBenchmarkPuzzles,
} from "./ai-benchmark";
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
  it("exposes fixed budget profiles for reproducible comparisons", () => {
    expect(AI_BENCHMARK_PROFILES.standard).toEqual({ label: "标准", timeBudgetMs: 700, nodeBudget: 70000 });
    expect(AI_BENCHMARK_PROFILES.expert.nodeBudget).toBeGreaterThan(AI_BENCHMARK_PROFILES.strong.nodeBudget);
  });

  it("selects the requested standard collection without mixing difficulty sets", () => {
    const puzzles = [
      { ...advancedPuzzle("advanced"), title: "三手胜4-高级题" },
      { ...advancedPuzzle("middle"), title: "三手胜3-中级题" },
    ];
    expect(selectStandardBenchmarkPuzzles(puzzles, "三手胜4-高级题").map((puzzle) => puzzle.id)).toEqual(["advanced"]);
  });

  it("assigns the internal level only from standard pass-rate thresholds", () => {
    const base = (collectionTitle: string, passRate: number) => ({
      collectionTitle,
      profile: "standard" as const,
      profileLabel: "标准",
      repeats: 1,
      total: 30,
      passed: Math.round(passRate * 30),
      passRate,
      budget: 0,
      notFound: 0,
      invalidProof: 0,
      averageElapsedMs: 1,
      medianElapsedMs: 1,
      p95ElapsedMs: 1,
      averageNodes: 1,
      maxNodes: 1,
      failedPuzzleIds: [],
      flakyPuzzleIds: [],
      cases: [],
    });
    const groups = [
      base("三手胜1-入门题", 0.95),
      base("三手胜2-初级题", 0.9),
      base("三手胜3-中级题", 0.8),
      base("三手胜4-高级题", 0.7),
      { ...base("三手胜4-高级题", 0.1), profile: "expert" as const },
    ];
    expect(recommendAiBenchmarkLevel(groups).level).toBe("战术高级");
  });

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
