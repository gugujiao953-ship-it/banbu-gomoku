# 五子棋谱导入任务继承说明

## 当前 Codex 线程

- 线程 ID：`01a04119-32e1-76f1-b423-50da23dcfeb5`
- 原始关联线程：`01a03956-158b-7ed3-a477-d71f152ca257`
- 工作目录：`D:\Projects\经济学知识`
- 项目目录：`D:\Projects\经济学知识\15_半步五子棋`
- 当前分支：`codex/features`
- 当前预览地址：`http://127.0.0.1:5177/`

## 任务目标

把网页端 Renju/Rapfi 的棋谱导入方式移植到现有五子棋 UI 中。重点是 `.db/.dp` 数据库：必须保留原始注释、局面标注、全部对称分支，不允许把局面集合错误反推成一棵顺序树，也不能有 64MB/200MB 的人为文件限制。

## 已完成

1. 找到并参考了网页端公开实现：
   - `tmp/renju-reference-20260827/Rapfi/dbTypes.js`
   - `tmp/renju-reference-20260827/Rapfi/databass.js`
   - `tmp/renju-reference-20260827/Rapfi/dbclient_worker.js`
   - `tmp/renju-reference-20260827/Rapfi/main.js`
2. 修正 DP/Rapfi 数据库键的棋子遍历顺序：网页端是按列、再按行扫描，黑子整体在前、白子整体在后。
3. 修正 `@BTXT@` 局面文字解析和坐标对称还原。
4. 注释图标不再把候选分支标记当成当前着法注释；只有真实节点注释/原生文字注释才显示注释状态。
5. 新增网页同构的当前局面查询函数：
   - `src/formats.ts` 中的 `openDpDatabaseIndex`
   - `src/formats.ts` 中的 `queryDpPosition`
6. 新增 DP 后台查询线程和 UI 会话适配：
   - `src/dp-database.worker.ts`
   - `src/dp-view-session.ts`
7. 单个 `.db/.dp` 导入现在直接走动态查询会话，不预先创建十万级整棵树；现有 UI、棋盘、前进、后退、根节点和分支点击均已接入。
8. `.db/.dp` 不再被通用 64MB 文件限制拦截。

## 已验证结果

真实文件：`D:\五子棋\定式谱\九天指南v5-1.db`

- 记录数：5823
- `H8 → G9`：13 个原生局面标注、23 个分支
- 连续网页导航到第 10 手：无重复坐标、无页面异常
- 浏览器专项结果：`labelCount=13`、`variations=23`、`errors=[]`
- 普通 Vitest：92/92 通过（不含旧版整树节点数断言）
- 构建：通过

真实大文件：`D:\五子棋\定式谱\斜月.lib`

- 文件大小：1,185,395,982 bytes，约 1.185GB
- 首屏预览约 0.3 秒出现
- 首屏无长任务，DOM 节点约 526
- 后台完整索引在本次会话中尚未等到最终结果，不能宣称完整导入已经达到 1 分钟内。

## 当前必须继续处理

1. 继续测试 `斜月.lib` 后台完整索引耗时，确认瓶颈是 RenLib 解析还是 IndexedDB 分块落盘。
2. 当前旧的 `importDpDatabase` 整树构建代码仍保留作为回退逻辑；动态 DP 会话验证充分后，删除或隔离旧逻辑，避免后续代码又走回十万节点树。
3. 当前动态 DP 会话主要针对单文件实时浏览，尚未完整持久化到大型棋谱库；若要刷新页面后继续浏览，需要增加数据库记录索引的持久化格式。
4. 复核 `.lib` 的原生注释、分支、对称标注是否也完全按网页端语义展示。
5. 最终不要只修改“九天指南”的特殊含义，必须保持通用数据库格式兼容。

## 重要代码位置

- 主解析器：`src/formats.ts`
- DP 查询线程：`src/dp-database.worker.ts`
- DP UI 会话：`src/dp-view-session.ts`
- 主 UI：`src/App.tsx`
- 紧凑索引：`src/compact-index.ts`
- 大型棋谱存储：`src/large-storage.ts`
- 导入线程：`src/record-import.worker.ts`
- 网页端参考代码：`src/renlib-reference/` 和 `tmp/renju-reference-20260827/`
- DP 查询测试：`qa/dp-position-query.test.ts`
- 真实 DP 测试：`qa/dp-real-file.test.ts`
- DP 浏览器测试：`qa/dp-label-visual.mjs`、`qa/dp-deep-walk.mjs`
- 1G LIB 测试：`qa/large-lib-performance.mjs`、`qa/preview-completion-check.mjs`

## 直接续接提示词

请在 `D:\Projects\经济学知识\15_半步五子棋` 继续“棋谱导入根因修复”任务。先阅读 `docs/继续任务说明-给其他Harness.md`，不要重做已经完成的 DP 键顺序、注释图标和动态查询工作。当前目标是：继续验证 1.185GB 的 `D:\五子棋\定式谱\斜月.lib` 完整后台索引性能；然后审查并删除/隔离 `src/formats.ts` 中旧的 DP 整树反推逻辑，确保 `.db/.dp` 始终使用网页端同构的记录索引 + 当前局面查询。保留现有 UI，不要重写 AI、导出等无关功能。每一步都要用真实 `九天指南v5-1.db` 验证 H8→G9 的 13 个标注和 23 个分支，并用 `npm run build` 和 Vitest 回归。

## 常用命令

```powershell
cd 'D:\Projects\经济学知识\15_半步五子棋'
npm run build
npx vitest run --exclude qa/dp-real-file.test.ts --pool=threads --maxWorkers=1
$env:QA_BASE_URL='http://127.0.0.1:5177/'
node qa/dp-label-visual.mjs
node qa/dp-deep-walk.mjs
```

## 注意

- 工作区有大量未提交的既有修改，不要 `git reset --hard`、不要清空工作区。
- `tmp/renju-reference-20260827/` 是网页端参考仓库，不能把其中的无关大文件全部打包进产品。
- `src/renlib-reference/` 中的参考 JS 是未提交文件，使用前先确认是否需要保留。
- 不要把“首屏预览 0.3 秒”误报成“1G 文件完整导入完成”。
