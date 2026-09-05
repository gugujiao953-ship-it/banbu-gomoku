# 第 43 次模型沟通：真实 LIB 注释保真、导入与落子性能对比

时间：2026-08-27
发送方：GLM
工作树：`D:\Projects\经济学知识\15_半步五子棋打谱`
分支：`codex/features`
当前基线提交：`03ee9fe feat: import lz4 dp gomoku databases`

## 一、本轮目标

用户反馈：真实棋谱导入后，部分位置只有节点没有注释，希望达到 renjutool.top 的大型 LIB 保真和流畅体验。本轮执行：

- 真实 `D:\五子棋` LIB 注释/节点文字统计。
- 小型、百万级、千万级 LIB 浏览器导入与导航。
- compact textRefs/texts/marks 保存链检查。
- 高级 SGF 导入、导出、重导回归。
- 与公开 renjutool.top 的架构和性能思路对比。

## 二、注释问题的定位结论

真实 `雨.lib` 的独立解析统计：

```text
nodeCount：694,910
edgeCount：694,909
branchCount：131,393
普通 comment refs：50
boardText refs：693,585
text pool：1,574
marks：0
```

抽样文本示例：

```text
node 1：boardText="#"
node 5：boardText="a"
node 6：boardText="c"
node 7：boardText="a"
```

结论：

- RenLib 中的 `comment` 与 `boardText` 是两种不同字段。
- 雨谱中的绝大多数 `a/c/#` 等内容属于节点文字/变化标签，不是普通 C 风格注释。
- 当前解析器已将两者分别放入 compact `textRefs` 与 `texts`，不是在 IndexedDB 或 lazy rehydrate 阶段丢失。
- `createLazyDocument()` 能正确恢复 `comment`、`boardText`、`renLibMark`、`startPosition`。
- 现有 UI 将 `boardText` 用作变化点文字，将 `comment` 用作注释面板；因此用户看到“只有节点没有注释”时，实际可能是原文件本身保存为节点标签而不是普通注释。
- RenLib 原始节点标记目前只保留为 `renLibMark` 布尔值；它不是 SGF 的坐标级 CR/TR/MA/LB 标记，不能凭空伪造。

## 三、真实大谱浏览结果

### 雨.lib

```text
节点数：694,910
导入总耗时：约 3.8s
解析耗时：约 1.94s
前进 P50：16.6ms
前进 P95：28.1ms
前进最大：40.3ms
后退 P50：16.1ms
后退 P95：56.3ms
后退最大：684.4ms
DOM：约 541
consoleErrors：[]
```

### 瑞星棋谱（适合新手+标注详细）.lib

```text
节点数：17,098,900
导入总耗时：约 60.9s
解析耗时：约 40.9s
前进 P50：17.2ms
前进 P95：32.1ms
前进最大：36.1ms
后退 P50：16.1ms
后退 P95：32.0ms
后退最大：396.5ms
最大长任务：约 7.7s
DOM：约 597
consoleErrors：[]
```

该 17M 节点文件在浏览器 Worker 中成功导入、保存、打开分支并刷新恢复；节点数、分支数和标题保持正确。未发现 compact text pool 在存储边界丢失。

## 四、本轮新增性能优化

`src/compact-index.ts`：

- 对非数字生成 ID 建立一次 `Map<string, number>`。
- `compactNodeIndex()` 不再对 `index.ids` 重复执行 O(n) `indexOf()`。
- 大型路径使用数字 base36 ID 直接解码，其他 ID 使用 Map。
- 保持原有 lazy Proxy、compact typed arrays 和 `Object.keys` 大谱保护。

雨谱优化前后观察：

```text
前进导航 P95：约 105ms → 28.1ms
```

17M 标注详细谱本轮导航 P95 约 32ms，说明直接数字索引对导入后的快速落子/导航路径有明显帮助。

## 五、高级导入回归

GPT 合并后的高级导入回归：

```json
{
  "pass": true,
  "collectionDocuments": 2,
  "setup": true,
  "passMove": true,
  "exportRoundTrip": true,
  "duplicateImport": true
}
```

覆盖：

- SGF `AB/AW/AE/PL` 设置局面。
- SGF 空着/过手。
- 多顶层游戏树拆分为独立棋谱。
- UTF-16 LE/BE。
- 非 15 路尺寸明确支持/校验。
- JSON moves 与坐标基准。
- 导出后重新导入。
- 重复导入去重。

普通编辑器命令栏回归：

```json
{
  "pass": true,
  "whitePlacement": true,
  "saveReload": true,
  "deleteSubtreeSaveReload": true,
  "exportMs": { "sgf": 317, "renju": 129 }
}
```

## 六、公开 renjutool.top 对比

公开资源观察到的架构：

```text
ReadLib Worker
  → RenLibDoc_wasm.js / RenLib.wasm
  → MoveNode / MoveList 紧凑关系
  → IndexedDB / LZ4 / TypedArray 页缓冲
  → CheckerBoard 独立 Canvas 局部绘制
```

它的快速体验主要来自：

- RenLib 解析在 Worker/WASM。
- 节点不转换成百万个普通对象和 children 数组。
- 棋盘由独立 Canvas 控件绘制，落子只做局部更新。
- 引擎、图片、PDF、VCF 等重模块按需加载。

本项目当前已经具备：

```text
Worker 解析
compact typed-array index
lazy document
IndexedDB 分块
草稿 overlay
派生版本
数字 ID 直接查询优化
```

当前主要差距：

```text
没有 RenLib WASM 解析后端
棋盘仍为 React + SVG
大型导入/分块写入仍有明显长任务
```

当前不建议直接复制公开代码或资源；适合逐步吸收 Worker/WASM、数字索引和独立棋盘渲染思想。

## 七、当前发现的性能遗留

- 17M 节点详细谱导入总耗时约 61s，其中解析约 41s。
- 浏览器仍观察到约 7.7s 最大长任务，主要发生在大规模解析/IndexedDB 写入阶段。
- 导航 P95 已降到约 32ms，但个别后退操作仍有 396–684ms 长尾。
- Node 离线审计大文件会触及约 4GB 堆上限；浏览器 Worker 才是最大文件的权威路径。
- 这属于性能/工具边界，不是本轮发现的注释丢失。

后续性能批次建议：

1. 将大谱 IndexedDB 分块写入进一步拆为可让出主线程的批次。
2. 增加数字 `nodeIndex` 直接查询 Board View Model。
3. 实验 Canvas 棋盘，同时保留无障碍 DOM 热区。
4. 评估自有 RenLib WASM parser，保留 TypeScript fallback。

## 八、最终门禁

```text
npm test -- --run：64/64 通过
npm run build：通过，dist 0.54MB
```

同时通过：

```text
advanced-import-blackbox.mjs
editor-command-bar.mjs
large-lib-blackbox.mjs（雨.lib）
large-lib-blackbox.mjs（17M 瑞星详细谱）
```

## 九、诚实结论

> 本轮没有发现 compact textRefs、IndexedDB 或 lazy rehydrate 丢失真实注释的证据；真实雨谱的普通注释和节点文字均已进入索引，17M 标注详细谱也能在浏览器中导入、分支和刷新恢复。新增数字索引优化后，雨谱前进导航 P95 从约 105ms 降至 28ms，17M 谱导航 P95 约 32ms。当前仍有大谱首次导入长任务和少量导航长尾，下一阶段应优先做分块写入让步、直接 nodeIndex View Model、Canvas 实验和自有 WASM parser，而不是把已有字段误合并成注释。