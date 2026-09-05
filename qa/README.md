# QA 回归说明

`qa/` 只保留可重复执行的正式浏览器回归与专项工具。需要本机大文件、oracle 或参考站的用例放在 `qa/manual/`；只用于历史取证、截图和问题探索的脚本放在 `qa/archive/`。

正式浏览器回归的机器可读清单见 [`regression-manifest.mjs`](./regression-manifest.mjs)，说明与目录治理规则见 [`REGRESSION.md`](./REGRESSION.md)。未登记的根目录脚本不会因为文件名存在就自动成为正式门禁。

## 正式回归集

### 快速单元回归

```powershell
npm run qa:smoke
```

只运行 `src/` 下的确定性 Vitest 测试，不会误带 `qa/tmp-*.test.ts`、真实 DP 文件或并发实验脚本。

### 浏览器回归

先启动当前源码对应的网页，再运行：

```powershell
npm run dev -- --port 5173
$env:QA_BASE_URL='http://127.0.0.1:5173/'
npm run qa:browser
```

正式浏览器集由 `qa/regression-manifest.mjs` 登记并由 `scripts/run-qa.mjs` 执行，当前覆盖高级导入、百万节点分块顺序、草稿存储保护、最近导入一键重开、AI 规则与草稿层级、编辑命令栏、导出内容、视觉回归、ErrorBoundary 诊断导出和 RenLib dev 资产服务。任一脚本失败都会返回非零退出码并立即停止。

### 完整确定性回归

```powershell
$env:QA_BASE_URL='http://127.0.0.1:5173/'
npm run qa:full
```

顺序为：单元测试 → 浏览器正式集 → 生产构建。网页服务需由调用者提前启动，确保测试的是明确的当前版本。

## 真实文件与参考站回归

这些脚本不进默认回归，也不应放进 CI。它们需要本地棋谱、`tmp/oracle/` 产物，部分还需要 renjutool 参考站：

- `manual/dual-site-oracle.mjs`：DP/DB 与参考站、oracle、本项目三方对照。
- `manual/image-recognition-sgf.mjs`：构造 SGF 截图的图片识谱矩阵。
- `manual/image-recognition-lib.mjs`：真实瑞星 LIB 图片识谱。
- `manual/lib-oracle-baiqi.mjs`：白启疏星 LIB 分支对照。
- `manual/lib-oracle-xieyue.mjs`：1GB 以上斜月 LIB 的分支、标签、注释对照。
- 根目录现有 `dp-*`、`large-lib-*`、`paged-*`、`renlib-*` 等脚本：按参数运行的格式或大型文件专项；未列入统一入口前均视为手工专项。

通用变量为 `QA_BASE_URL`。稳定脚本还支持按需设置 `LIB_FILE`、`DB_FILE`、`ORACLE_FILE`、`REF_BASE`、`MAX_PATHS`。示例：

```powershell
$env:QA_BASE_URL='http://127.0.0.1:5182/'
$env:LIB_FILE='D:\五子棋\定式谱\斜月.lib'
$env:ORACLE_FILE='tmp/oracle/lib-oracle-walk-xieyue.json'
node qa/manual/lib-oracle-xieyue.mjs
```

大文件回归报告必须记录：测试文件名与大小、源码提交、网页地址、运行命令、耗时、检查局面数、失配数、浏览器错误和退出码。只有退出码为 0 且失配为 0，才能写“通过”。

## 临时与归档规则

- 正在进行的并发实验可暂用 `qa/tmp-*`，完成后必须选择：提升为稳定名称、移到 `qa/archive/`，或删除。
- `qa/archive/` 不属于回归门禁，不保证长期可运行。
- JSON 报告、截图和生成数据应写入 `artifacts/` 或 `tmp/`，不要继续堆在 `qa/`。
- 新增正式脚本必须可重复执行、失败返回非零退出码，并在本文件或统一运行器中登记依赖。

当前保留的 `qa/tmp-ai-benchmark-*` 属于仍在并发执行的 AI 基准任务，本次目录治理不移动、不改写。

