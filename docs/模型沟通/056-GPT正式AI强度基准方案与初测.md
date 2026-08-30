# 056-GPT：正式 AI 强度基准方案与初测

日期：2026-08-29  
对应任务：P0-1「正式 AI 强度基准」

## 结论先行

本次没有修改正式 AI 搜索算法，只建立了可重复的战术强度基准。本次基准引擎为 local-vcf-proof，衡量的是 VCF 强制胜证明能力，不应直接宣传为完整普通局面棋力、赛事段位或模型级别。

## 复核纠正

用户指出旧版高级题曾经可以通过 18 道以上，这一反馈已用同一网页、同一高级题库和 Rapfi fallback 复测确认。原先把 local-vcf-proof 的 0/120 结果当作 AI 强度结论是不正确的：它只是 VCF 证明专项，而且搜索预算/证明树口径与网页人机不同。

修正后的正式 AI 强度基准以 Rapfi fallback WASM 为准。2026-08-29 对完整三手胜4-高级题 30 题使用中文“标准”档（1800ms、最大深度 64）复测，结果为 19/30，63.3%，与历史“18 道以上”的结论一致。Rapfi 报告见 docs/ai-strength-benchmark-advanced-2026-08-29.md。

此前的 0/120 结果属于 VCF 专项误用，不再作为网页 AI 强度结论。VCF 结论仍然保留为：现有 VCF 搜索在 700ms / 70000 nodes 下无法完成这些题目的独立证明。

## 强度区分方案

### 题库分层

正式等级只使用同类型的四组三手胜题库：

1. 三手胜1-入门题
2. 三手胜2-初级题
3. 三手胜3-中级题
4. 三手胜4-高级题

坂田吾朗追诘胜与天狗道场2020的题型、深度和先手条件不同，暂不混入标准等级，作为后续深度挑战集。

### 通过条件

一题只有同时满足以下条件才算通过：

- VCF 搜索返回完整胜利证明；
- 主变化不超过 15 个半步；
- verifyVcfProof 独立重放并覆盖全部合法防点；
- 没有因时间或节点预算耗尽而中止。

因此，单次找到一条看似合理的胜着不会被当作通过。

### Rapfi AI 强度档位

| 档位 | 时间预算 | 节点预算 | 用途 |
|---|---:|---:|---|
| 轻量 | 600 ms | 32 | 快速对弈 |
| 标准 | 1,800 ms | 64 | 默认可信基准 |
| 强力 | 3,000 ms | 64 | 更长思考 |
| 专家 | 5,000 ms | 80 | 深度诊断 |

正式强度比较使用中文档位；题库难度仍单独显示为入门、初级、中级、高级，不能把题库难度和 AI 档位混为一谈。

### 内部等级阈值

| 等级 | 入门题 | 初级题 | 中级题 | 高级题 |
|---|---:|---:|---:|---:|
| 战术入门 | ≥90% | - | - | - |
| 战术初级 | ≥90% | ≥85% | - | - |
| 战术中级 | ≥90% | ≥85% | ≥75% | - |
| 战术高级 | ≥90% | ≥85% | ≥75% | ≥65% |

这只是项目内部的战术能力标签，不是外部公认棋力评级。

## 已实现内容

- src/ai-benchmark.ts：固定四档预算、四级题库选择、单题状态、耗时和节点统计、重复运行与 flaky 题目统计、标准档位推荐等级；并保留原 benchmarkAdvancedThreeMovePuzzles API。
- scripts/benchmark-ai.mjs：支持 AI_BENCHMARK_PROFILES、AI_BENCHMARK_REPEATS、AI_BENCHMARK_LIMIT，输出 JSON 并生成 Markdown 报告。
- src/ai-benchmark.test.ts：覆盖预算档位、题库选择、等级阈值和 15 半步独立验证。

## 实测结果

VCF 专项报告：docs/ai-benchmark-2026-08-29.md

Rapfi 正式 AI 强度报告：docs/ai-strength-benchmark-advanced-2026-08-29.md

| 题库 | 通过 | 预算耗尽 | 未找到 | 通过率 |
|---|---:|---:|---:|---:|
| 三手胜1-入门题 | 0/30 | 30 | 0 | 0% |
| 三手胜2-初级题 | 0/30 | 26 | 4 | 0% |
| 三手胜3-中级题 | 0/30 | 22 | 8 | 0% |
| 三手胜4-高级题 | 0/30 | 26 | 4 | 0% |

预算曲线小样本报告：docs/ai-benchmark-curve-2026-08-29.md。首题在 quick、standard、strong、expert 四档均耗尽预算，说明当前瓶颈更可能是搜索空间或剪枝效率，而不是单纯把时间预算从 700ms 增加到 3000ms 就能解决。

## 复现命令

正式标准基准：

    $env:AI_BENCHMARK_PROFILES="standard"
    $env:AI_BENCHMARK_REPEATS="1"
    npx --no-install tsx scripts/benchmark-ai.mjs

小样本预算曲线：

    $env:AI_BENCHMARK_LIMIT="2"
    $env:AI_BENCHMARK_PROFILES="quick,standard,strong,expert"
    npx --no-install tsx scripts/benchmark-ai.mjs

## 后续建议

下一步应优先分析 imported-1 等首批题目的 VCF 候选分支数量和剪枝效率，补充普通局面 Rapfi 评测，再决定是否调整预算或搜索算法。当前不应把本报告的 0% 直接写入产品对外的 AI 段位文案。
