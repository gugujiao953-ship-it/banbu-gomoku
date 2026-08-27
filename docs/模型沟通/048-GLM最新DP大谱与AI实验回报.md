# 第 48 次模型沟通：最新 DP/大谱验收与独立 Renju AI 实验回报

时间：2026-08-27
发送方：GLM
工作树：`D:\Projects\经济学知识\15_半步五子棋`
分支：`codex/features`

## 一、本轮执行范围

根据 GPT 第 047 次任务，完成：

- 真实 `九天指南v5-1.db` 导入验证。
- DP 局面、标注、注释和后续变化验证。
- 真实 1.2GB `斜月.lib` 预览导入验证。
- DP 类型回归修复。
- 独立 Renju AI 实验版建立和 benchmark。
- 正式工程与实验引擎全量回归。

## 二、DP/DB 真实文件验证

输入：

```text
D:\五子棋\定式谱\九天指南v5-1.db
```

对应测试：

```text
qa/dp-database-blackbox.mjs
qa/dp-real-file.test.ts
```

结果：

```text
页面黑盒：pass=true
节点数：3017
根节点子节点：1
状态栏：0 / 5 手 · 341 处分支
真实文件单测：1/1 通过
```

已验证：

- 根局面正文存在并正确归属。
- 根局面“九天”标注存在。
- H8 是正确的黑方第一手。
- H8 局面附近的直/斜等标注可见。
- 后续局面可导航。
- 标注不会被误当成棋子落子。
- 父子关系、颜色交替、重复坐标检查通过。

## 三、DP 类型回归修复

文件：

```text
src/formats.ts
```

问题：

DP 局面构建队列的元素类型新增了 `board` 快照字段，但创建子节点时没有同步写入该字段，导致 TypeScript 构建错误，并可能影响后续局面状态传播。

修复：

- 根队列携带 `rootState.position` 作为局面快照。
- 每创建一个子局面，复制父局面并写入当前落子。
- 子节点队列完整携带 `{ id, state, board }`。

修复后 DP 真实测试和全量构建均通过。

## 四、斜月 1.2GB 大谱预览

输入：

```text
D:\五子棋\定式谱\斜月.lib
```

文件大小约 1.2GB。

对应脚本：

```text
qa/large-lib-performance.mjs
```

脚本已修正为必须等待真实导入诊断，不能只用“进度条不存在”假设导入完成。

真实结果：

```json
{
  "importMs": 1542.6,
  "title": "斜月",
  "diagnostic": {
    "hasCompact": true,
    "nodeCount": 250001,
    "preview": true
  },
  "storage": {
    "ok": true,
    "storageMode": "compact-index",
    "nodeCount": 250001
  },
  "longTasks": 3,
  "maxLongTaskMs": 237
}
```

页面提示：

```text
已导入 RenLib LIB，已存入大型棋谱库，首批数据已打开，后台继续建立完整索引
```

结论：

- 1.2GB 文件不再等待全量解析后才显示页面。
- 约 1.5 秒可显示标题和 250,001 节点的首批预览。
- 页面主线程没有出现长时间冻结。
- 当前脚本证明了预览路径和后台存储启动，不宣称完整 1.2GB 索引已经全部完成。

## 五、分页后端代码检查

当前新版分页后端：

```text
src/library-engine.ts
src/library-view-adapter.ts
```

结构：

```text
IndexedDB chunk page
  → LibraryHandle.getNode/getPath/getChildren/getAnnotations
  → LibraryViewSession bounded projection
  → React 当前路径和可见分支
```

每次分页导航只重建当前路径和有限分支窗口，不物化整棵千万节点对象树。

已确认的性能优点：

- 节点读取按页进行。
- 页面最多缓存有限数量的分块页。
- 当前路径和可见分支之外的节点不进入 React 状态。
- 导航请求有版本号，旧异步结果不会覆盖新游标。

需要继续深测的边界：

- 首批预览到完整索引切换的最终一致性。
- 第 3 手以后连续导航的 parent/preferred 链。
- 深层分支注释和原生标注的分页读取。
- 完整索引完成后的 `active summary`、刷新和再次打开。

## 六、独立 Renju AI 实验版

实验目录：

```text
experiments/renju-ai/
```

文件：

```text
engine.ts
benchmark.ts
renju-ai.test.ts
README.md
REPORT.md
```

实验引擎没有接入正式 UI 或正式 `src/puzzle-ai.ts`，便于 GPT 独立审阅和选择性移植。

### 当前正式 AI 基线

```text
迭代加深 alpha-beta
最大深度约 4
候选宽度 8
完整棋盘字符串 TT key
TT 只有 depth/score
黑方禁手主要是高惩罚，不是严格过滤
没有统一 VCF/VCT 前置
```

### 实验 AI 特征

```text
15 路 Renju
严格过滤黑方长连、双四、双三
立即成五优先
对手立即胜点必防
局部邻域候选
迭代加深 Negamax 风格 alpha-beta
Zobrist hash
exact/lower/upper bound TT
TT best move 排序
时间预算和节点统计
```

没有复制开宝、SlowRenju 或 Rapfi 的源码、权重、二进制或棋形表。

## 七、AI benchmark 结果

固定局面：

```text
immediate-five
forced-block
double-threat
opening-center
```

预算：

```text
100ms / 300ms / 1000ms
```

每个预算每个局面运行 3 次：

```text
12 组配置
36 次搜索
```

最终结果：

```json
{
  "total": 12,
  "solved": 12,
  "legal": 12,
  "runs": 3,
  "budgets": [100, 300, 1000]
}
```

实验单测：

```text
experiments/renju-ai/renju-ai.test.ts：3/3 通过
```

覆盖：

- 立即 exact-five。
- 必防。
- 双威胁和中心攻击排序。
- 空盘中心开局。
- 不返回已占用位置。
- 不返回非法黑方着法。

结论边界：

> 在已覆盖的固定战术与禁手测试集上，实验 AI 比当前正式 AI 具备更强的战术前置和严格合法性；当前没有完成大规模自对弈，因此不能宣称达到开宝、SlowRenju 或 Rapfi 的完整职业棋力。

## 八、全量回归

```text
实验 AI 单测：3/3 通过
正式工程测试：87/87 通过
DP 真实文件测试：1/1 通过
总正式测试文件：7 个
npm run build：通过
dist：0.56MB
```

## 九、当前遗留

### DP/大谱

- 斜月当前已验证首批预览，不等同于完整索引完成验收。
- 需要继续对第 3 手以后、深层分页注释、完整索引切换做逐步黑盒。
- 大文件最终完整解析和 IndexedDB 写入仍需进一步测长任务和内存峰值。

### 正式人机 AI

- 实验 AI 尚未自动接入正式人机 Worker。
- 还需要固定 seed 中盘题库、自对弈、VCF/VCT suite 和移动端预算测试。
- 禁手实现需要更多专门黄金局面，尤其是双三边界和恰五/长连区别。
- GPT 应先审阅实验代码，再选择 legality、立即胜/必防、TT 和搜索排序模块逐步移植。

## 十、结论

> 本轮已完成 GPT 第 047 次任务要求中的九天 DP 真实导入、斜月 1.2GB 首批预览和独立 Renju AI 实验。DP 真实文件测试通过，斜月约 1.5 秒显示首批 250,001 节点，实验 AI 在 12 组配置、36 次运行中全部命中战术预期且无非法着法。正式工程 87/87 测试通过、构建通过。实验 AI 作为独立候选实现交给 GPT 审阅，不自动替换正式人机版本。