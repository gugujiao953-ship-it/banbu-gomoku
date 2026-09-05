# 第 46 次模型沟通：复用现有 UI，重构 RenLib 大谱后端

时间：2026-08-27  
发送方：GPT / Codex  
状态：核心链路已实施

## 一、方案总原则

用户已经明确：

```text
UI 继续使用当前这套
可以针对后端数据结构做必要适配
解析、存储、大谱访问等后端能力，改成目标网站那种方式
整体目标是大谱、注释、分支和稳定性接近 renjutool.top
```

因此不做完整 UI 重写，也不把 Canvas 作为本次前置条件。当前的 React 页面、底部面板、棋盘操作、导航按钮、搜索入口和编辑交互都保留。

本次重构的重点是把 UI 下面的棋谱数据来源替换掉：

```text
当前：文件 → GameDocument / CompactIndex → React UI
目标：文件 → RenLib Engine → 分页 LibraryHandle → 当前 UI 适配层
```

UI 看到的仍然是当前页面，但它不再依赖“完整节点树已经全部加载到内存”这一前提。

## 二、为什么必须重构后端

当前实现已经有 Worker、TypedArray 和 IndexedDB，但核心模型仍然是一次性构建完整变化树：

1. `RenLibArrayBuilder` 先用 JavaScript 普通数组保存所有节点；
2. `toIndex()` 再复制成多组 TypedArray；
3. Worker 传输时仍然需要携带完整索引和文本池；
4. 保存大谱时，超过百万节点会进行大量连续 IndexedDB 写入；
5. 重新打开时使用 `getAll()` 取回全部分块，再拼成完整索引；
6. UI 通过 `GameDocument`、`boardAt()` 和 `pathToNode()` 计算当前局面。

这条链路可以让部分大谱导入成功，但无法从根本上支持“文件大小不设应用级上限”。把 200MB 改成 500MB 或 1GB，只会把失败点向后移动。

当前硬限制位于 [src/App.tsx](D:/Projects/经济学知识/15_半步五子棋打谱/src/App.tsx:50)，大谱存储和恢复位于 [src/large-storage.ts](D:/Projects/经济学知识/15_半步五子棋打谱/src/large-storage.ts:121)。

## 三、目标后端架构

```text
┌──────────────────────────────┐
│ 当前 React UI                 │
│ 棋盘 / 注释 / 分支 / 搜索      │
└──────────────┬───────────────┘
               │ UI Adapter
┌──────────────▼───────────────┐
│ Library Engine                │
│ open / getNode / getPath      │
│ getChildren / getAnnotations  │
│ search / getPositionSnapshot  │
└──────────────┬───────────────┘
               │ Worker RPC
┌──────────────▼───────────────┐
│ RenLib Import Worker          │
│ WASM 主解析器                 │
│ TypeScript 后备解析器         │
│ 进度 / 取消 / 恢复 / 错误      │
└──────────────┬───────────────┘
               │ page stream
┌──────────────▼───────────────┐
│ Paged Library Store           │
│ 节点页 / 文本页 / 标记页       │
│ IndexedDB 或 OPFS             │
└──────────────────────────────┘
```

### 1. RenLib Engine

新增一个独立的 RenLib 后端接口，不让 UI 直接访问 `GameDocument.nodes`：

```ts
interface LibraryHandle {
  id: string;
  metadata: LibraryMetadata;
  nodeCount: number;
  rootIndex: number;

  getNode(index: number): Promise<RenLibNode>;
  getPath(index: number): Promise<number[]>;
  getChildren(index: number, offset: number, limit: number): Promise<number[]>;
  getPosition(index: number): Promise<PositionSnapshot>;
  getAnnotations(index: number): Promise<NativeAnnotation[]>;
  search(query: string): Promise<number[]>;
}
```

小型 SGF 或用户新建棋谱仍然可以使用现有 `GameDocument`。大型 LIB 使用 `LibraryHandle`，两者通过适配层提供相同的 UI 能力。

### 2. 原生 RenLib 数据模型

当前的 `comment` 和 `boardText` 字段不足以表达目标网站的原生结构。新模型至少需要保留：

```ts
interface NativeAnnotation {
  kind: "one-line-comment" | "multi-line-comment" | "board-text" | "mark" | "unknown";
  text?: string;
  rawBytes?: Uint8Array;
  sourceOffset?: number;
  encoding?: string;
}

interface RenLibNode {
  index: number;
  parentIndex: number;
  firstChildIndex: number;
  nextSiblingIndex: number;
  moveCode: number;
  flags: number;
  extendedFlags: number;
  annotations: NativeAnnotation[];
}
```

数据层不得把 `ccc` 转成 `c`，不得把 boardText 丢进普通 comment，也不得静默丢弃未知扩展。显示时可以做语义映射，但原文和原始控制字节必须继续存在。

### 3. RenLib 解析器

参考目标网站公开的 [`RenjuLib_worker.js`](https://www.renjutool.top/ReadLib/script/RenjuLib_worker.js)、[`RenLibDoc_wasm.js`](https://www.renjutool.top/ReadLib/script/RenLibDoc_wasm.js)、[`MoveNode.js`](https://www.renjutool.top/ReadLib/script/MoveNode.js) 和 [`MoveList.js`](https://www.renjutool.top/ReadLib/script/MoveList.js) 的行为。

建议采用双解析器：

```text
WASM RenLib Parser
  主路径，负责正式大谱和原生兼容性

TypeScript RenLib Parser
  后备路径、测试路径、小文件路径
```

两个解析器必须输出同一份 `RenLibNode` 和 `NativeAnnotation` 结构，通过真实 LIB 文件进行逐节点比对。

目标网站本身也不是数学意义上的无限制：它的 Worker 仍然可能把文件读成 ArrayBuffer，WASM 也有内存边界。因此本项目的最终目标应定义为“无应用硬编码 200MB 上限、可按设备能力处理、达到浏览器边界时可恢复地失败”，而不是承诺绝对无限。

## 四、分页存储设计

### 1. 节点页

不再构造百万节点对象，而是使用固定大小页，例如每页 32K 或 64K 节点：

```ts
interface NodePage {
  pageId: string;
  startIndex: number;
  endIndex: number;
  parent: Int32Array;
  firstChild: Int32Array;
  nextSibling: Int32Array;
  childCount: Uint32Array;
  moveCode: Uint16Array;
  flags: Uint32Array;
  annotationRefs: Uint32Array;
}
```

### 2. 文本页

注释和节点文字不再与节点对象混在一起：

```ts
interface AnnotationPage {
  pageId: string;
  offsets: Uint32Array;
  lengths: Uint32Array;
  kinds: Uint8Array;
  encodedText: Uint8Array;
}
```

打开当前节点时，只加载当前路径、当前分支窗口和当前节点注释，不加载整个谱库。

### 3. 存储后端

建议提供两种实现：

```text
IndexedDB Page Store
  默认方案，保存元数据、节点页和注释页

OPFS File Store
  超大谱库方案，保存连续二进制页文件
```

IndexedDB 只保存 manifest、页索引和草稿信息；大块二进制数据优先使用页化记录或 OPFS。所有写入都必须具备进度、取消、失败重试和校验能力。

不能继续使用“保存时一个大事务写完全部字段、读取时 `getAll()` 全部恢复”的方式。

## 五、现有 UI 如何适配

### 1. UI 继续保留

以下部分原则上不重写：

- 当前棋盘视觉风格；
- React 页面布局；
- 底部工具栏和 BottomSheet；
- 前进、后退、首手、末手按钮；
- 变化面板；
- 搜索面板；
- 标记、保存、导出和草稿交互。

### 2. 新增 UI Adapter

新增 `library-view-adapter.ts`，把 `LibraryHandle` 转成当前 UI 需要的最小数据：

```ts
interface LibraryViewModel {
  currentNode: UiNode;
  currentPath: UiNode[];
  currentBoard: Cell[];
  branchWindow: UiNode[];
  annotations: UiAnnotation[];
}
```

`App.tsx` 不再直接通过 `document.nodes[id]` 读取大谱节点，而是订阅 `LibraryViewModel`。

### 3. 注释面板适配

当前“节点注释”和“局面文字”可以保留两个入口，但对于原谱内容要在同一个可发现的位置显示：

```text
原谱注释
  单行注释
  多行注释
  局面文字 / 变化标签
  原生标记
  未识别扩展

我的编辑
  用户新增注释
  用户新增标记
```

这样既保留现有 UI 结构，又不会因为字段属于 `boardText` 就让用户误以为注释丢失。

### 4. 棋盘适配

本次不强制将 SVG 改成 Canvas。先保留当前棋盘组件，只做三项适配：

- 通过 `getPosition()` 获取当前局面；
- 通过 `getChildren()` 获取当前分支窗口；
- 通过 `getAnnotations()` 获取当前节点和变化点文字。

如果后续实测表明 SVG 仍是主要性能瓶颈，再针对棋子层或变化点层做局部 Canvas 化，不影响整个 UI 的布局和交互。

## 六、编辑与草稿策略

大型 LIB 的原始数据应视为只读基线：

```text
原始 LIB 分页数据
        +
用户草稿操作
        ↓
Projected Library View
```

用户新增分支、修改注释、设置主线时，只保存操作日志或局部覆盖：

```ts
type DraftOperation =
  | { type: "update-annotation"; nodeIndex: number; annotation: NativeAnnotation }
  | { type: "add-variation"; parentIndex: number; moveCode: number }
  | { type: "delete-subtree"; nodeIndex: number }
  | { type: "set-preferred-child"; nodeIndex: number; childIndex: number };
```

这样编辑一个超大谱时不需要复制整棵树。导出时再把原始页和草稿合并成 SGF、RENJU JSON 或兼容的 LIB/目标格式。

## 七、模块改造范围

```text
src/types.ts
  增加 NativeAnnotation、RenLibNode、LibraryHandle、Page 类型

src/formats.ts
  拆成 SGF、JSON、POS、DB 和 RenLib 适配器

src/record-import.worker.ts
  改成分页导入 Worker，支持 progress / cancel / resume

src/renlib/
  新增 WASM 解析器、TS 后备解析器和兼容测试

src/library-engine/
  新增 LibraryHandle、路径解析、分支窗口、搜索服务

src/library-store/
  替换当前全量 compact-index 存储

src/large-storage.ts
  改成 manifest + page store，不再 getAll 全谱

src/compact-index.ts
  逐步退出大型 LIB 主链路，可保留给小谱或兼容层

src/App.tsx
  保留页面与交互，只改为消费 LibraryViewModel

src/Board.tsx 或当前 Board 组件
  保留视觉实现，替换数据读取接口

src/AnnotationPanel.tsx
  兼容原有面板，增加原谱注释聚合显示

qa/
  增加逐节点内容对照、分页恢复和草稿叠加测试
```

## 八、实施阶段

### 阶段 0：建立基准

固定真实 LIB 文件，并记录目标网站与本项目在相同节点上的：

- 节点关系；
- 单行注释；
- 多行注释；
- boardText；
- 标记和扩展字段；
- 分支数量；
- 当前局面；
- 节点显示位置。

### 阶段 1：新后端并行接入

不删除旧链路，先实现 `LibraryHandle` 和新的 Worker 协议。新旧解析器同时读取真实文件，比较节点和注释结果。

### 阶段 2：分页存储

实现节点页、文本页、manifest、断点续导和按需加载。完成后让 UI 能从新后端打开并浏览谱库。

### 阶段 3：现有 UI 适配

将棋盘、注释面板、分支面板和搜索面板改为通过 `LibraryViewModel` 工作。页面布局、按钮和交互保持不变。

### 阶段 4：编辑和导出

接入草稿操作日志，实现大谱上的新增分支、注释修改、主线调整、撤销和导出。

### 阶段 5：删除硬限制与旧主链路

只有分页导入、分页读取、取消恢复、注释保真和刷新恢复都通过后，才删除 200MB 限制以及大型 LIB 的旧 `GameDocument` 路径。

## 九、验收标准

### 内容保真

- 随机抽取至少 1000 个真实节点；
- 与目标网站逐节点比较；
- 单行、多行注释和 boardText 分别一致；
- 原始标记和未知扩展不静默丢弃；
- UI 中确实能看到这些内容，而不只是 IndexedDB 中存在。

### 大谱能力

- 不存在固定 200MB 应用级拒绝；
- 桌面端可以处理 GB 级文件，具体上限由设备能力决定；
- 手机端导入期间页面仍能响应；
- 导入可显示进度、暂停、取消和恢复；
- 失败不会留下半个不可打开的棋谱。

### UI 稳定性

- 现有棋盘操作保持可用；
- 前进、后退、分支切换不跳节点；
- 注释面板和棋盘显示来自同一节点；
- 刷新后恢复相同节点和相同注释；
- 不出现棋子消失、空白棋盘、错误分支和异常跳转；
- 不以 `consoleErrors=[]` 作为唯一通过条件。

### 性能目标

- 导入阶段有明确进度，不出现无反馈长时间冻结；
- 正常导航不依赖完整谱树重建；
- 当前路径和分支窗口采用按需读取；
- 重点监控最大 Long Task，而不只看平均耗时；
- 1700 万节点文件必须完成连续导航、注释查看、刷新恢复和草稿操作回归。

## 十、最终取舍

本方案的取舍是：

```text
保留现有 UI 和交互资产
重做大型 RenLib 的数据、解析、存储和访问方式
允许 UI 为新数据模型做适配
SGF / 小谱继续兼容现有 GameDocument
大型 LIB 使用独立的 LibraryHandle
```

这能最大限度保留当前产品已经做好的界面，同时把真正影响大谱体验的部分替换成目标网站式的后端架构。

最关键的改造不是 Canvas，也不是把限制数字调大，而是：

> 用原生 RenLib 节点模型保存所有内容，用分页存储访问大谱，用 UI Adapter 把分页后端适配到当前页面。

完成这三点后，当前 UI 仍然可以继续使用，但大文件、原生注释和稳定性不再受当前完整对象树架构限制。

## 十一、2026-08-27 实施结果

本轮已完成与用户当前问题直接相关的核心链路：

- 删除 LIB 200MB 与批次总字节硬限制，批量文件数也不再截断为 50 份；
- RenLib 读取保留单行注释、多行注释、boardText、节点标记、原始 flags 和扩展 flags；
- 原生注释已进入现有注释指示、预览和面板，不再只存在解析层；
- 解析器数值列改为 64K 节点 TypedArray 页，不再用装箱数字数组累积全树；
- RenLib 节点 ID 改为“根 ID + 数字前缀”按需生成，不再为千万节点提前分配千万条字符串；
- 超过百万节点的索引以 250K 页分事务写入 IndexedDB，不再用单个超大事务；
- 新增 `LibraryHandle` 异步节点、路径、分支和注释读取，并带 LRU 页缓存；
- 新增 `LibraryViewSession`，现有 React UI 只获取当前路径、当前分支和三层预览，每次导航都重建有界窗口；
- 分页视图已接入起点、上一手、下一手、终点、分支切换和刷新恢复；
- 分页基线有自动保存防护，不会把 UI 局部窗口误覆盖为完整棋谱。

当前分页基线以稳定浏览和内容保真为主，不原地编辑。WASM 主解析器、OPFS、可取消/断点续导和分页基线草稿派生仍属后续增强，不应宣称为已通过本文第九节的 1700 万节点实谱验收。
