# 第 59 次模型沟通：QA 目录治理与正式回归集

时间：2026-08-29
发送方：GPT
状态：已完成

## 本次目标

完成产品评审 P0-6：整理 `qa/tmp-*`，修复或隔离 `mobile-visual.mjs` 已知超时，明确确定性正式回归集、真实大文件本地回归集和历史诊断归档。

## 已完成

1. 新增 `qa/README.md`，把 QA 分为三层：
   - 正式确定性回归：`npm run qa:smoke`、`npm run qa:browser`、`npm run qa:full`。
   - 真实文件/参考站手工回归：`qa/manual/`。
   - 历史截图和一次性诊断：`qa/archive/`。
2. 新增 `scripts/run-qa.mjs`，固定正式浏览器回归清单，检查网页可用性，任一用例非零即停止。
3. 将可复用的临时验收脚本提升为稳定名称：
   - `qa/manual/dual-site-oracle.mjs`
   - `qa/manual/image-recognition-sgf.mjs`
   - `qa/manual/image-recognition-lib.mjs`
   - `qa/manual/lib-oracle-baiqi.mjs`
   - `qa/manual/lib-oracle-xieyue.mjs`
4. 将纯截图取证脚本归档为 `qa/archive/xieyue-proof-screenshots.mjs`。
5. 为上述手工验收脚本补充通用环境变量和非零失败门禁；准确率、失配、重放失败或浏览器错误不再只打印日志。
6. 修复 `qa/mobile-visual.mjs` 的陈旧流程假设：
   - 显式处理未保存草稿保护弹窗。
   - 以模式 `aria-checked` 和集合数量等待真实状态，不再等固定第八个元素。
   - 适配切题后底部面板自动回到“应战”。
   - 消除重复文件输入、重复“我的题库”按钮的严格定位冲突。
   - 导航改为 `commit + 应用标志`，避免开发服务器资源导致 `domcontentloaded` 假超时。
7. 同步修复正式集中的两个陈旧脚本：
   - `advanced-import-blackbox.mjs` 适配当前手数展示和“直接导出”入口。
   - `chunk-order-blackbox.mjs` 补上百万节点不一致时的非零退出码。
8. 更新 052、053、当前项目状态、产品评审计划和模型沟通规则中的脚本路径与 QA 约定。

## 测试结果

- `npm run qa:smoke`：14 个测试文件、142 项测试全部通过。
- `QA_BASE_URL=http://127.0.0.1:5205/ npm run qa:browser`：6 个正式浏览器脚本全部通过。
  - 高级 SGF 导入、设置局面、过手、导出往返和重复导入通过。
  - 1,000,001 节点紧凑索引保存/恢复，5 个跨块采样全部一致。
  - 草稿存储保护、编辑命令栏、SGF/JSON 导出内容全部通过。
  - `mobile-visual.mjs`：360×800 与 412×915 均通过，8 个题集数量正确，无横向溢出和浏览器错误。
- `npm run build`：通过，`dist` 4.62MB，低于 20MB 门禁。
- `git diff --check`：通过；仅输出仓库既有的 LF/CRLF 转换提示。
- 全部新增/修改的 Node QA 脚本通过 `node --check`。

## 未运行与边界

- 本轮没有重跑 89MB、1.185GB LIB、真实 DP/DB 双站和图片识谱长测；它们依赖本地大文件、oracle 或参考站，已明确放入 `qa/manual/`，不进入默认 CI/正式确定性回归。
- 并发 AI 基准任务拥有的 `qa/tmp-ai-benchmark-*` 未移动、未改写，避免破坏其他任务产物；应由其所有者完成后再决定提升、归档或删除。

## 修改文件

- `qa/README.md`
- `qa/manual/*.mjs`
- `qa/archive/xieyue-proof-screenshots.mjs`
- `qa/mobile-visual.mjs`
- `qa/advanced-import-blackbox.mjs`
- `qa/chunk-order-blackbox.mjs`
- `scripts/run-qa.mjs`
- `package.json`
- `docs/模型沟通/README.md`
- `docs/模型沟通/当前项目状态.md`
- `docs/模型沟通/052-GLM导入分支完整性修复与双站对照.md`
- `docs/模型沟通/053-GLM图片识谱重做与验收.md`
- `docs/产品评审与改进计划-2026-08-29.md`

## 下一步建议

1. 合并十路并发产出后运行 `npm run qa:full`。
2. 涉及格式、DP/DB、LIB 或图片识谱的改动，再按 `qa/README.md` 选择对应 `qa/manual/` 长测并记录真实文件、耗时、检查数和失配数。
3. 并发实验结束后清理剩余 `qa/tmp-*`，避免再次混入默认测试发现范围。
