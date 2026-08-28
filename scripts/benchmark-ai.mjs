import { readFile } from "node:fs/promises";
import { importKaibaoPuzzleJson } from "../src/puzzles.ts";
import { benchmarkAdvancedThreeMovePuzzles } from "../src/ai-benchmark.ts";

const file = new URL("../public/puzzles/kaibao/三手胜4-高级题.json", import.meta.url);
const collection = importKaibaoPuzzleJson(await readFile(file, "utf8"), "三手胜4-高级题").collection;
const puzzles = process.env.AI_BENCHMARK_LIMIT ? collection.puzzles.slice(0, Number(process.env.AI_BENCHMARK_LIMIT)) : collection.puzzles;
const report = benchmarkAdvancedThreeMovePuzzles(puzzles, { collectionTitle: collection.title, rule: process.env.AI_BENCHMARK_RULE || "renju", maxSteps: 10, timeBudgetMs: Number(process.env.AI_BENCHMARK_BUDGET || 700), nodeBudget: Number(process.env.AI_BENCHMARK_NODES || 70000) });
const passed = report.filter((item) => item.passed).length;
console.log(JSON.stringify({ collection: collection.title, total: report.length, passed, passRate: report.length ? passed / report.length : 0, maxSteps: 10, report }, null, 2));
if (!report.length || passed !== report.length) process.exitCode = 1;
