// 已废弃（superseded）：正式 AI 强度基准请使用 scripts/benchmark-ai.mjs
// （Rapfi 档位口径，见 docs/模型沟通/056-GPT正式AI强度基准方案与初测.md）。
// 本文件保留 2026-08-29 并发 GLM 会话的 VCF 专项基准原始实现：
// VCF-only 引擎（searchVcf + verifyVcfProof）在 700ms/70000 节点、maxSteps=15
// 下对三手胜4-高级题 30 题 0/30（结果见同目录 vcf-strength-report-2026-08-29.json），
// 与 056 的 VCF 专项结论一致。运行方式：
//   AI_BENCHMARK_FULL=1 npx vitest run qa/archive/vcf-strength-benchmark.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { importKaibaoPuzzleJson } from "../../src/puzzles";
import { benchmarkAdvancedThreeMovePuzzles } from "../../src/ai-benchmark";

describe.skipIf(!process.env.AI_BENCHMARK_FULL)("AI 强度基准（三手胜4-高级题，VCF 专项）", () => {
  it("跑完整题集并写出报告", { timeout: 900000 }, () => {
    const file = new URL("../../public/puzzles/kaibao/三手胜4-高级题.json", import.meta.url);
    const collection = importKaibaoPuzzleJson(readFileSync(file, "utf8"), "三手胜4-高级题").collection;
    const maxSteps = Number(process.env.AI_BENCHMARK_MAX_STEPS || 15);
    const budget = Number(process.env.AI_BENCHMARK_BUDGET || 700);
    const nodes = Number(process.env.AI_BENCHMARK_NODES || 70000);
    const report = benchmarkAdvancedThreeMovePuzzles(collection.puzzles, {
      collectionTitle: collection.title,
      rule: "renju",
      maxSteps,
      timeBudgetMs: budget,
      nodeBudget: nodes,
    });
    const passed = report.filter((item) => item.passed).length;
    writeFileSync(
      new URL("./vcf-strength-report-2026-08-29.json", import.meta.url),
      JSON.stringify(
        {
          collection: collection.title,
          total: report.length,
          passed,
          passRate: report.length ? passed / report.length : 0,
          maxSteps,
          timeBudgetMs: budget,
          nodeBudget: nodes,
          environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpuModel: process.env.PROCESSOR_IDENTIFIER || "",
          },
          report,
        },
        null,
        2,
      ),
    );
    console.log(`BENCHMARK total=${report.length} passed=${passed} rate=${(report.length ? passed / report.length : 0).toFixed(4)} maxSteps=${maxSteps} budget=${budget}ms nodes=${nodes}`);
    for (const item of report.filter((r) => !r.passed)) {
      console.log(`FAIL ${item.puzzleId} ${item.title} status=${item.status} steps=${item.steps} nodes=${item.nodes} ms=${Math.round(item.elapsedMs)} | ${item.reason}`);
    }
  });
});
