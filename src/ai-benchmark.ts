import { boardAt } from "./game";
import { createPuzzleDocument, type Puzzle } from "./puzzles";
import { searchVcf, verifyVcfProof } from "./vcf";
import type { RuleSet } from "./types";

export interface AiBenchmarkOptions {
  collectionTitle?: string;
  rule?: RuleSet;
  maxSteps?: number;
  profile?: AiBenchmarkProfileName;
  timeBudgetMs?: number;
  nodeBudget?: number;
}

export const AI_BENCHMARK_PROFILES = {
  quick: { label: "轻量", timeBudgetMs: 220, nodeBudget: 24000 },
  standard: { label: "标准", timeBudgetMs: 700, nodeBudget: 70000 },
  strong: { label: "强力", timeBudgetMs: 1500, nodeBudget: 160000 },
  expert: { label: "专家", timeBudgetMs: 3000, nodeBudget: 350000 },
} as const;

export type AiBenchmarkProfileName = keyof typeof AI_BENCHMARK_PROFILES;

export const STANDARD_BENCHMARK_COLLECTIONS = [
  "三手胜1-入门题",
  "三手胜2-初级题",
  "三手胜3-中级题",
  "三手胜4-高级题",
] as const;

export type StandardBenchmarkCollectionTitle = typeof STANDARD_BENCHMARK_COLLECTIONS[number];

export interface AiBenchmarkCaseResult {
  puzzleId: string;
  title: string;
  passed: boolean;
  status: "win" | "not-found" | "budget" | "invalid-proof";
  steps: number;
  nodes: number;
  elapsedMs: number;
  reason: string;
}

export interface AiBenchmarkGroupResult {
  collectionTitle: string;
  profile: AiBenchmarkProfileName;
  profileLabel: string;
  repeats: number;
  total: number;
  passed: number;
  passRate: number;
  budget: number;
  notFound: number;
  invalidProof: number;
  averageElapsedMs: number;
  medianElapsedMs: number;
  p95ElapsedMs: number;
  averageNodes: number;
  maxNodes: number;
  failedPuzzleIds: string[];
  flakyPuzzleIds: string[];
  cases: AiBenchmarkCaseResult[];
}

export interface AiBenchmarkLevelResult {
  level: "未达入门" | "战术入门" | "战术初级" | "战术中级" | "战术高级";
  thresholds: Record<StandardBenchmarkCollectionTitle, number>;
  passRates: Partial<Record<StandardBenchmarkCollectionTitle, number>>;
}

/** The native set is named exactly like this in the supplied puzzle library.
 * Keeping the selector explicit prevents an unrelated imported collection from
 * silently becoming the strength gate. */
export const selectAdvancedThreeMovePuzzles = (puzzles: Puzzle[], collectionTitle = "") => /三手胜.*高级/.test(collectionTitle)
  ? puzzles
  : puzzles.filter((puzzle) => /三手胜.*高级/.test(puzzle.title));

export const selectStandardBenchmarkPuzzles = (puzzles: Puzzle[], collectionTitle: string): Puzzle[] => {
  const title = STANDARD_BENCHMARK_COLLECTIONS.find((item) => item === collectionTitle);
  if (title) {
    const explicitlyTagged = puzzles.filter((puzzle) => puzzle.title === title);
    if (explicitlyTagged.length) return explicitlyTagged;
    if (puzzles.every((puzzle) => /^第\s*\d+\s*题$/.test(puzzle.title))) return puzzles;
    return [];
  }
  return puzzles.filter((puzzle) => STANDARD_BENCHMARK_COLLECTIONS.some((item) => puzzle.title === item));
};

const percentile = (values: number[], percentileRank: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileRank) - 1);
  return sorted[Math.max(0, index)];
};

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const benchmarkOnePuzzle = (puzzle: Puzzle, options: AiBenchmarkOptions = {}): AiBenchmarkCaseResult => {
  const rule = options.rule || "renju";
  const maxSteps = Math.max(1, options.maxSteps || 15);
  const maxAttackMoves = Math.max(1, Math.floor((maxSteps + 1) / 2));
  const profile = options.profile ? AI_BENCHMARK_PROFILES[options.profile] : undefined;
  const session = createPuzzleDocument(puzzle);
  const board = boardAt(session.document, session.initialNodeId);
  const result = searchVcf(board, puzzle.player, {
    rule,
    maxAttackMoves,
    timeBudgetMs: options.timeBudgetMs || profile?.timeBudgetMs || AI_BENCHMARK_PROFILES.standard.timeBudgetMs,
    nodeBudget: options.nodeBudget || profile?.nodeBudget || AI_BENCHMARK_PROFILES.standard.nodeBudget,
  });
  const verified = result.status === "win" ? verifyVcfProof(board, result.proof, puzzle.player, rule) : { valid: false, error: "没有完成强制胜证明" };
  const steps = result.principalVariation.length;
  const passed = result.status === "win" && verified.valid && steps <= maxSteps;
  return {
    puzzleId: puzzle.id,
    title: puzzle.title,
    passed,
    status: result.status === "win" && !verified.valid ? "invalid-proof" : result.status,
    steps,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
    reason: passed ? `已验证，主变化 ${steps} 步` : verified.error || `主变化超过 ${maxSteps} 步或未找到证明`,
  };
};

/**
 * Strength gate for the local tactical engine. A puzzle passes only when VCF
 * finds a principal variation of at most maxSteps plies and the full proof tree
 * survives an independent legal-defense verification. A single lucky line is
 * therefore never counted as a solved advanced problem.
 */
export function benchmarkAdvancedThreeMovePuzzles(puzzles: Puzzle[], options: AiBenchmarkOptions = {}): AiBenchmarkCaseResult[] {
  return selectAdvancedThreeMovePuzzles(puzzles, options.collectionTitle).map((puzzle) => {
    return benchmarkOnePuzzle(puzzle, options);
  });
}

export function benchmarkPuzzleCollection(puzzles: Puzzle[], options: AiBenchmarkOptions & { collectionTitle: string; repeats?: number }): AiBenchmarkGroupResult {
  const selected = selectStandardBenchmarkPuzzles(puzzles, options.collectionTitle);
  const profile = options.profile || "standard";
  const repeats = Math.max(1, Math.floor(options.repeats || 1));
  const allCases: AiBenchmarkCaseResult[] = [];
  const outcomes = new Map<string, boolean[]>();
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const puzzle of selected) {
      const result = benchmarkOnePuzzle(puzzle, { ...options, profile });
      allCases.push(result);
      outcomes.set(puzzle.id, [...(outcomes.get(puzzle.id) || []), result.passed]);
    }
  }
  const passedCases = allCases.filter((item) => item.passed);
  const elapsed = allCases.map((item) => item.elapsedMs);
  const nodes = allCases.map((item) => item.nodes);
  const firstRunCases = allCases.slice(0, selected.length);
  return {
    collectionTitle: options.collectionTitle,
    profile,
    profileLabel: AI_BENCHMARK_PROFILES[profile].label,
    repeats,
    total: allCases.length,
    passed: passedCases.length,
    passRate: allCases.length ? passedCases.length / allCases.length : 0,
    budget: allCases.filter((item) => item.status === "budget").length,
    notFound: allCases.filter((item) => item.status === "not-found").length,
    invalidProof: allCases.filter((item) => item.status === "invalid-proof").length,
    averageElapsedMs: average(elapsed),
    medianElapsedMs: percentile(elapsed, 0.5),
    p95ElapsedMs: percentile(elapsed, 0.95),
    averageNodes: average(nodes),
    maxNodes: nodes.length ? Math.max(...nodes) : 0,
    failedPuzzleIds: [...new Set(firstRunCases.filter((item) => !item.passed).map((item) => item.puzzleId))],
    flakyPuzzleIds: [...outcomes.entries()].filter(([, runs]) => new Set(runs).size > 1).map(([id]) => id),
    cases: allCases,
  };
}

export function recommendAiBenchmarkLevel(groups: AiBenchmarkGroupResult[]): AiBenchmarkLevelResult {
  const thresholds = {
    "三手胜1-入门题": 0.9,
    "三手胜2-初级题": 0.85,
    "三手胜3-中级题": 0.75,
    "三手胜4-高级题": 0.65,
  } satisfies Record<StandardBenchmarkCollectionTitle, number>;
  const passRates = Object.fromEntries(groups.filter((group) => group.profile === "standard").map((group) => [group.collectionTitle, group.passRate])) as AiBenchmarkLevelResult["passRates"];
  const meets = (titles: StandardBenchmarkCollectionTitle[]) => titles.every((title) => (passRates[title] || 0) >= thresholds[title]);
  const level = meets([...STANDARD_BENCHMARK_COLLECTIONS]) ? "战术高级"
    : meets(STANDARD_BENCHMARK_COLLECTIONS.slice(0, 3)) ? "战术中级"
      : meets(STANDARD_BENCHMARK_COLLECTIONS.slice(0, 2)) ? "战术初级"
        : meets(STANDARD_BENCHMARK_COLLECTIONS.slice(0, 1)) ? "战术入门" : "未达入门";
  return { level, thresholds, passRates };
}
