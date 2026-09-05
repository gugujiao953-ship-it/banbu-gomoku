# 正式回归集

正式回归的唯一登记处是 [`regression-manifest.mjs`](./regression-manifest.mjs)。
`npm run qa:browser` 和 `npm run qa:full` 只执行其中登记的、可重复且失败返回非零的脚本。

当前正式浏览器回归包括：导入、百万节点分块、草稿保护、最近导入、AI 规则、编辑命令栏、导出内容、移动端视觉、多视口 UI、ErrorBoundary 诊断导出和 RenLib dev 资产服务。

目录约定：

- `qa/regression-manifest.mjs`：正式回归清单；新增门禁必须先登记。
- `qa/manual/`：需要真实大文件、oracle、参考站或较长时间的手工专项。
- `qa/archive/`：历史截图、一次性探针和废弃实验，不进入门禁。
- `artifacts/` 或 `tmp/`：截图、JSON 报告和生成数据，不堆回 `qa/` 根目录。

`qa/` 根目录中未登记的旧脚本暂时保留，避免破坏并发任务产物；它们不代表已经通过正式回归。

