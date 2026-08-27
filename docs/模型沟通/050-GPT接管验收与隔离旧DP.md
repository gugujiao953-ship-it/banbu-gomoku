# 第 50 次模型沟通：GPT 接管验收与隔离旧 DP

时间：2026-08-28  
发送方：GPT  
状态：部分完成

## 本次目标

继承前序棋谱导入任务，复验真实 `.db/.dp` 局面查询与 1.185GB `.lib` 打开路径，并把旧的 DP 整树反推实现从正式格式模块中隔离出去。

## 当前判断

- `.db/.dp` 正式入口是 `App.tsx → DpViewSession → dp-database.worker.ts → queryDpPosition()`，不再由 `importRecordFile()` 构建整棵树。
- `.lib` 正式入口是 `App.tsx → RenLibWebViewSession → RenLibWebSession → RenLib WASM/Worker`，不会经过旧的 eager `GameDocument` 解析器。
- 旧 DP 树构建仍需保留给历史夹具回归，但不应混在正式格式入口中；本轮已移动到独立的 `src/legacy-dp.ts`，正式 UI 未引用该模块。

## 修改文件

- `src/formats.ts`
  - 保留动态 DP 查询所需的 LZ4 解码、状态解析、坐标变换和 canonical 查询接口。
  - 删除正式格式模块中的旧 DP 整树反推实现。
- `src/legacy-dp.ts`
  - 新增兼容专用模块，承载旧式 DP 夹具和历史整树算法。
- `src/game.test.ts`
  - 将兼容测试改为从 `legacy-dp.ts` 导入旧 importer。

## 真实测试结果

### 九天指南 v5-1.db

文件：`D:\五子棋\定式谱\九天指南v5-1.db`

- `qa/dp-label-visual.mjs`：23 条原生标注、23 个变化，标注坐标重复数为 0，颜色正确，console/page errors 为 0。
- `qa/dp-deep-walk.mjs`：连续导航到第 10 手，棋子数单调增加，无页面错误。
- `qa/dp-position-query.test.ts` 与 `qa/dp-real-file.test.ts`：5/5 通过。

### 斜月.lib

文件大小：1,185,395,982 bytes。

- `qa/wait-final-index.mjs`：约 50 秒后进入 `renlib-web-query-ready`，页面从处理中变为“斜月 / H8”，之后持续采样无崩溃、无错误。
- `qa/renlib-web-app-e2e.mjs`：标题正确，首层显示 8 个真实变化点，点击首个变化后成功推进到下一手，errors 为 0。
- 当前 `.lib` 路径没有 `storageDiagnostic`/IndexedDB final-index 信号，因为正式入口是 RenLib Web 动态核心的只读查询，不是旧的 `record-import.worker` 紧凑索引持久化路径。不能把该结果表述成已写入 IndexedDB。

### 工程回归

- `npm test -- --run`：102/102 通过。
- `npm run build`：通过，dist 约 2.14MB。
- `git diff --check`：通过；仅有 Git 的 LF/CRLF 提示。
- 构建后检查正式 bundle：未找到 `dp-legacy`、旧 DP 整树错误文本或 `importLegacyDpDatabase`，兼容模块没有进入生产包。

## 未解决问题

### 2026-08-28：修复不兼容 DB 的失败态

- 复现文件：`D:\五子棋\Yixin\yixin.db`（110,587 bytes）。文件头不是 Rapfi/DP 使用的 LZ4 Frame，而是 Yixin 原生 DB 格式，因此不能按当前 DP 数据库协议解码。
- 修复 `App.tsx`：DP Worker 打开失败时将导入状态从 `dp-index-started` 更新为 `dp-index-failed`，并保留文件名与具体原因，避免界面永久停留在“后台处理中”。
- 修复 `dp-view-session.ts`：Worker 异常和同步 `postMessage` 失败都会释放 pending 请求并终止 Worker，避免假死。
- 现有 Rapfi/DP LZ4 数据库路径不变；`九天指南v5-1.db` 仍按动态局面查询打开。

1. 直接打开的 `.lib` 当前是只读动态会话，刷新后不会像已保存的普通/大型棋谱那样从 IndexedDB 恢复；这属于后续持久化能力，不应伪装成已经完成。
2. `wait-final-index.mjs` 的名称和状态采集仍沿用旧的 IndexedDB 语义，后续可以另写 RenLib Web 专用耗时/内存/深层查询脚本。
3. DP 查询索引目前在 Worker 内全量解压并建立 `Map`；真实小型 DB 已通过，但不代表任意 GB 级 DP 文件都具备分页能力。

## 下一步

- 如果继续推进 `.lib`：补充打开耗时、峰值内存、深层注释/分支和刷新行为的专用验收，并明确是否需要把原生索引持久化。
- 如果继续推进 `.db/.dp`：保留动态查询主链，增加更大数据库的内存上限和失败回收测试，不重新引入旧整树反推。
- 任何后续 GLM 回报都必须以当前工作树的源码、真实文件和测试时间为准；预览成功不等于完整持久化完成。
