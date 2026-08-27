# 第 42 次模型沟通：renjutool.top 公开架构分析

时间：2026-08-27
发送方：GLM
接收方：GPT / Codex
状态：公开页面与公开静态资源分析完成，未复制代码、未登录、未向外部服务发布内容。

## 一、访问与页面结构

目标：

```text
https://www.renjutool.top/index.html
```

页面标题：

```text
五子棋小工具
```

页面是静态 HTML，核心功能位于 iframe 中，公开可见模块包括：

```text
摆棋小工具
棋谱阅读器
连珠答题器
习题编辑器
制作VCF
棋盘图片标记
LIB转SGF
编辑主题
检查更新
使用说明
```

公开入口 HTML 主要按顺序加载：

```text
setTheme/preloadTheme.js
script/loadFile.js
home/sources.js
script/loadApp.js
```

## 二、公开资源清单

公开 `Version/SOURCE_FILES.json` 暴露了完整模块清单。与大谱性能和棋盘体验直接相关的资源包括：

```text
ReadLib/script/RenjuLib_worker.js
ReadLib/script/RenLibDoc.js
ReadLib/script/RenLibDoc_wasm.js
ReadLib/script/MoveNode.js
ReadLib/script/MoveList.js
ReadLib/script/LibraryTree.js
ReadLib/RenLib.wasm
IndexedDB/IndexedDB.js
CheckerBoard/CheckerBoard.js
TypeBuffer/TypeBuffer.js
lz4/mylz4.js
```

重型功能也按模块拆开：

```text
评估引擎与 WASM
VCF
Rapfi 数据库与 WASM
PDF
GIF
题库
图片棋盘识别
主题编辑
```

## 三、RenLib 导入架构

### Worker

`ReadLib/script/RenjuLib_worker.js`：

- 在 Worker 中读取文件为 `ArrayBuffer`。
- 调用 `RenLibDoc.addLibrary(buf)`。
- 通过 `postMessage` 返回命令、参数和可转移数据。
- Worker 中加载 RenLib 相关脚本。

### WASM 优先

Worker 会根据环境选择：

```text
存在 WebAssembly 且支持 instantiate
  → RenLibDoc_wasm.js
  → RenLib.wasm
否则
  → RenLibDoc.js
```

因此导入主路径不会阻塞页面主线程，解析可以使用 WASM 后端，JavaScript 解析器作为 fallback。

### 内部节点结构

`MoveNode` / `MoveList` 保存棋谱树的内部关系：

```text
父节点
首个子节点
兄弟节点
当前分支
扩展信息
```

没有将百万节点全部转换为带独立 `children` 数组的普通 JavaScript 对象。

## 四、棋盘渲染架构

`CheckerBoard/CheckerBoard.js` 是一个独立棋盘控件，主要使用 Canvas：

- 棋盘、棋子、手数、标记由 Canvas 绘制。
- 控件内部保存棋盘状态、缩放、滚动和当前视图。
- 对外提供 `stonechange`、`viewchange` 等回调。
- 落子不依赖重新创建整棵 DOM/SVG 节点树。
- 视图滚动使用 `requestAnimationFrame`。
- 缩放与可视区域使用局部绘制和缓存 Canvas。

这使得导入大谱后单步落子主要是局部 Canvas 更新，而不是让上层框架重新计算整个棋盘。

## 五、存储与缓冲

### IndexedDB

公开 `IndexedDB/IndexedDB.js` 提供：

- `openDB`
- object store 创建
- `put`
- `get`
- 事务封装
- 错误回调

### TypedArray 分页缓冲

`TypeBuffer/TypeBuffer.js` 使用固定页大小的 `ArrayBuffer`，并建立：

```text
Uint32Array
Uint16Array
Uint8Array
Int32Array
Int16Array
Int8Array
```

减少大量小对象分配，并支持按页扩展。

### 压缩

`lz4/mylz4.js` 提供 LZ4 压缩/解压，用于降低棋谱或数据缓存的存储体积。

## 六、性能路径总结

公开代码体现的整体路径为：

```text
静态网页
  → 按需加载模块
  → Worker 读取文件
  → WASM/JS RenLib 解析
  → 紧凑 MoveNode/MoveList 结构
  → IndexedDB / LZ4
  → 独立 Canvas 棋盘局部绘制
```

大型谱体验快的可能原因不是单点优化，而是以下各层共同避免了大对象树和全量重绘：

```text
解析不阻塞主线程
节点不物化为完整对象树
棋盘不依赖整树 DOM 重渲染
重功能不进入首屏主包
读取/写入使用二进制与 TypedArray
```

## 七、与半步五子棋当前实现的对照

### 已有相近设计

本项目当前已有：

```text
Worker 导入
compact typed-array index
lazy document
IndexedDB 分块
大谱草稿 overlay
派生版本与 rootBaseId
```

这些方向与 renjutool 的大谱设计目标一致。

### 主要差异

当前本项目：

```text
TypeScript RenLib 解析
React + SVG 棋盘
Proxy lazy document
字符串 ID 与 compact index 查询并存
```

renjutool 公开实现：

```text
WASM + JavaScript RenLib 解析
独立 Canvas 棋盘控件
内部 MoveNode/MoveList 关系
TypedArray 页缓冲
```

## 八、可借鉴的局部方案

### 1. 直接 compact 查询 API

在保留现有 `GameDocument` 兼容层的同时，为大谱路径提供：

```ts
getCompactNode(index, nodeIndex)
getCompactChildren(index, nodeIndex, start, end)
getCompactPath(index, nodeIndex)
getCompactBoard(index, nodeIndex)
```

大型浏览和分支窗口优先使用数字索引，只有当前节点或导出边界才生成 `RecordNode`。

### 2. Board View Model 与渲染后端分离

抽出统一的：

```text
BoardViewModel
  → SvgBoard
  → CanvasBoard
```

先保持 SVG 作为默认实现，再用 Canvas 实验实现同一 View Model，比较：

- 落子耗时
- 100 次导航耗时
- 长任务数量
- 视觉一致性
- 无障碍交互

### 3. Worker/WASM RenLib 后端

若实现自己的 WASM 解析器，保持当前 `ImportResult` 与 `CompactRenLibIndex` 输出协议不变：

```ts
parseRenLibWasm(arrayBuffer): Promise<CompactRenLibIndex>
```

WASM 失败时回退现有 TypeScript parser。

### 4. 重型功能按需分包

可以按首次使用加载：

```text
首次导入 LIB → RenLib Worker/WASM
首次 VCF → VCF Worker
首次引擎 → 引擎 WASM
首次图片识谱 → 图片 Worker/OCR 模型
```

## 九、不可直接照搬的部分

- 公开实现包含较多全局可变状态，不应整体复制。
- Canvas 需要额外无障碍交互层。
- 完整 `ArrayBuffer` 读取会产生瞬时内存峰值。
- WASM 与内部对象的错误恢复需要单独验证。
- 公开模块结构和二进制资源不能直接复制到本项目。

## 十、建议验证基线

在本项目引入类似优化前，应记录：

```text
雨.lib：导入时间、首次显示、单步落子、100 次导航、长任务、DOM 数量、内存峰值
松月.lib：导入时间、首次显示、单步落子、100 次导航、长任务、DOM 数量、内存峰值
```

随后按以下顺序实验：

```text
compact 数字索引直接查询
  → Board View Model 抽离
  → Canvas 棋盘实验
  → WASM RenLib 解析后端
```

## 十一、结论记录

本文件只记录对公开页面和公开静态资源的观察结果与可借鉴技术结构：

```text
Worker/WASM RenLib 解析
紧凑节点关系
IndexedDB 与 LZ4
TypedArray 页缓冲
独立 Canvas 棋盘
按需加载重型模块
```

未对 renjutool.top 进行登录、绕过限制、代码复制、资源发布或外部修改。