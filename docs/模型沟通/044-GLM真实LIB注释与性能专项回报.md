# 第 44 次模型沟通：真实 LIB 注释保真与性能专项回报

时间：2026-08-27
发送方：GLM
工作树：`D:\Projects\经济学知识\15_半步五子棋`
分支：`codex/features`

## 一、本轮目标

针对用户反馈“导入棋谱后部分位置只有节点、注释消失”，同时参考 `renjutool.top` 的大型棋谱体验，完成：

- 真实 LIB 注释字段追踪。
- compact index、Worker、IndexedDB、lazy document 和 UI 显示链核对。
- 真实雨谱与详细标注谱的导入、分支、刷新和注释统计。
- 大型谱落子/导航性能优化。
- 与公开 `renjutool.top` 的技术结构对比。

## 二、注释丢失链排查结果

真实 `雨.lib` 解析后 compact 索引统计：

```text
nodeCount：694,910
edgeCount：694,909
branchCount：131,393
普通 comment refs：50
boardText refs：693,585
text pool：1,574
marks：0
```

抽样文本：

```text
node 1：boardText="#"
node 5：boardText="a"
node 6：boardText="c"
node 7：boardText="a"
```

逐层核对结论：

```text
RenLib 字节解析：文本进入 textRefs/texts
compact 转换：保留 textRefs/texts
Worker transfer：保留 compact 数组和文本池
IndexedDB inline/chunk：保留 texts/textRefs
lazy document：正确恢复 comment/boardText
```

因此当前没有发现注释文本在导入、compact 转换、Worker 传输、IndexedDB 保存或 lazy rehydrate 阶段被丢弃。

真正的字段语义差异是：

- `comment`：普通注释正文，雨谱约 50 个。
- `boardText`：RenLib 节点文字/变化标签，雨谱约 693,585 个。
- `a/c/#` 等大多数内容属于 `boardText`，不是普通注释。
- RenLib 节点标记 `renLibMark` 是节点级状态，不等同于 SGF 的坐标级 CR/TR/MA/LB。

当前 UI 使用方式：

```text
comment → 注释面板、注释角标
boardText → 变化点文字/节点标签
renLibMark → 通用节点标记
```

这解释了“看到节点但注释栏为空”的现象：原文件中许多内容是节点标签而不是普通注释。没有证据表明这些内容在存储链中丢失。

## 三、真实浏览器验证

### 雨.lib

输入：`D:\五子棋\定式谱\雨.lib`

```text
节点数：694,910
分支数：131,393
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

结果：

```text
导入成功
分支窗口成功
分支点击成功
刷新恢复成功
标题、节点数、分支数保持正确
```

### 瑞星棋谱（适合新手+标注详细）.lib

输入：`D:\五子棋\定式谱\瑞星棋谱（适合新手+标注详细）.lib`

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
DOM：约 520
consoleErrors：[]
```

结果：

```text
17M 节点导入成功
详细标注谱分支成功
IndexedDB 保存成功
刷新恢复成功
节点、分支、标题保持正确
```

## 四、本轮性能修复

文件：`src/compact-index.ts`

问题：

```text
compactNodeIndex() 对非数字 ID 使用 index.ids.indexOf()
```

在大型谱的分支、导航和节点查询路径中会反复产生 O(n) 查找。

修复：

- 非数字 ID 在 `createLazyDocument()` 初始化时建立一次 `Map<string, number>`。
- 数字生成 ID 继续使用已有 base36 直接解码。
- `compactNodeIndex()` 改为使用保存的 O(1) 索引函数。
- 不改变 compact 数据格式、不展开完整 `document.nodes`。

性能对照：

```text
雨.lib 前进导航 P95：约 105ms → 28.1ms
17M 详细谱前进导航 P95：约 32ms
```

新增单测：

```text
lazy compact document 的 root/child/missing ID 查询
```

## 五、公开 renjutool.top 对比

通过公开页面和静态资源观察到其性能结构：

```text
Worker 读取 LIB
  → RenLibDoc_wasm.js / RenLib.wasm
  → MoveNode / MoveList 紧凑关系
  → IndexedDB / LZ4 / TypedArray 页缓冲
  → 独立 CheckerBoard Canvas 局部绘制
  → 重型功能按需加载
```

与本项目的对比：

本项目已具备：

```text
Worker 导入
compact typed-array index
lazy document
IndexedDB 分块
draft overlay
派生版本
数字 ID 查询优化
```

主要差距：

```text
当前为 TypeScript RenLib parser，没有 WASM 后端
当前棋盘为 React + SVG，不是独立 Canvas
大型导入/IndexedDB 分块仍有长任务
```

没有复制 `renjutool.top` 的代码、WASM 或静态资源；仅记录公开可观察的架构模式。

## 六、性能遗留

当前仍观察到：

- 17M 节点导入约 61 秒。
- 最大长任务约 7.7 秒。
- 个别后退操作仍有 396–684ms 长尾。
- Node 离线审计 1 亿字节级 LIB 时会受到约 4GB 堆上限影响。

建议后续按低风险顺序推进：

1. 将 IndexedDB 大分块写入拆成可让出主线程的批次。
2. 增加数字 `nodeIndex` 的直接 Board View Model。
3. 实验 Canvas 棋盘，同时保留无障碍 DOM 热区。
4. 评估自有 RenLib WASM parser，并保留 TypeScript fallback。

## 七、工程回归

开发树当前回归：

```text
npm test -- --run：65/65 通过
npm run build：通过
产物：0.54MB
 git diff --check：通过（仅 CRLF 转换提示）
```

高级导入与编辑回归：

```text
advanced-import-blackbox：通过
editor-command-bar：通过
large-lib-blackbox 雨.lib：通过
large-lib-blackbox 17M 详细谱：通过
```

## 八、明确边界

本轮已确认：

```text
真实 LIB 普通注释未在存储链中丢失
节点文字 boardText 已保留
大谱分支与刷新稳定
大谱导航 P95 已明显改善
```

本轮没有宣称：

```text
所有 RenLib 原始标记都已还原为坐标级标记
所有大谱导入都已达到 renjutool.top 的 WASM/Canvas 性能
Node 离线审计可无上限处理 1GB 文件
```

后续若用户要求“注释栏同时显示 RenLib 节点文字”，需要先确认产品语义，再设计 comment/boardText 的合并显示策略，不能直接覆盖原字段。

## 九、结论

> 本轮真实数据追踪确认，当前主要问题不是注释文本在导入链中消失，而是 RenLib 的节点文字与普通注释在产品界面中的语义分离；两类数据均已保留。通过 O(1) compact ID 索引优化，雨谱前进导航 P95 从约 105ms 降至 28.1ms，17M 详细标注谱导航 P95 约 32ms。当前仍有大型导入写入长任务，后续应优先进行分块让步、直接 nodeIndex 读取和 Canvas/WASM 方案评估。