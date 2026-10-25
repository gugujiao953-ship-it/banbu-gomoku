# vcf-generator/lib

本目录是**棋题生成器（VCF）的运行时代码**：`src/` 里的生成器 Worker（`generator.worker.ts`、
`vcf-gen.worker.ts`）直接 import 这里的 `browser.mjs`，网页与 Android 包里的「棋题生成器 / VCF 挑战」
功能都跑在这份代码上。它**必须随源码一起入库**——缺失会让 `tsc -b` 与构建直接失败
（2026-10-16 的同步漏带过一次，CI 由此红了九天，2026-10-25 补回）。

`lib/` 自包含（只相对引用目录内模块，类型声明在同目录 `browser.d.mts`），共约 432KB。

搜索与出题的研究工具链（jobs、perf、research、showcase 脚本等）属于私有源仓的研究区，
不随公开仓分发；对外产物是应用内集成的生成器功能本身。
