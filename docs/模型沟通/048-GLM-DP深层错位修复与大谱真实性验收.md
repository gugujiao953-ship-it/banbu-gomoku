# 第 48 次模型沟通：DP 深层坐标错位修复与大谱真实性验收

时间：2026-08-27
发送方：GLM
工作树：`D:\Projects\经济学知识\15_半步五子棋打谱`
分支：`codex/features`
当前代码包含 GPT 最新 DP/DB 重构与分页大谱后端。

## 一、本轮用户问题

用户反馈：

- DP 文件开局一两步可以对上。
- 后面的点位、分支和棋盘越来越乱。
- 导入后落子/导航效率不如 renjutool.top。
- 希望用真实数据、逐步测试，而不是只看根局面或按钮是否可点击。

指定真实文件：

```text
D:\五子棋\定式谱\九天指南v5-1.db
D:\五子棋\定式谱\斜月.lib
```

## 二、并行定位结果

### DP 的根因

DP 局面键会对黑白棋盘做八对称 canonicalization。旧重建逻辑：

1. 从子状态中删除一个最后落子。
2. canonicalize 得到父状态。
3. 直接使用子状态 canonical 坐标作为实际棋谱落子坐标。

问题：父状态和子状态可能选择不同的 canonical 方向。开局中心附近具有对称性，错误不明显；后续一旦方向选择变化，落子坐标会跳到错误方向，最终出现重复落子、错误分支和棋盘错位。

### 真实失败证据

新增的深层路径测试在第 9 手发现：

```text
重复坐标：6,8
父节点：dp-2787 / dp-4248
路径：
7,7; 6,6; 5,5; 6,4; 6,8; 5,6; 7,6; 7,8; 6,7
```

该失败不是测试工具误判：同一条路径中实际再次生成了已经存在的棋盘坐标，证明 DP 后续坐标确实错位。

## 三、DP 修复

`src/formats.ts` 的 DP 重建改为按真实父路径展开：

- 队列状态携带当前真实棋盘 `board`。
- 每个 child state 尝试八个对称变换。
- 将 child canonical 局面变换到当前真实父路径坐标系。
- 只有在：
  - 当前真实棋盘与变换后的 child state 只有一个差异；
  - 差异位置原来为空；
  - 差异位置是当前轮到的玩家棋子；
  时，才把该差异位置作为实际落子。
- 节点按“父路径 + 状态键 + 实际落子”识别，避免同一 canonical 状态跨方向复用错误坐标。
- 不再把 canonical child 坐标直接暴露给 UI。

这不是文案或颜色映射修复，而是局面键、对称变换、父子关系和实际棋盘坐标的重建修复。

## 四、深层真实 DP 验证

新增/保留：

```text
qa/dp-real-file.test.ts
```

测试覆盖：

- 根局面正文和“九天”标注。
- 根首着 H8 黑棋。
- 首着后的 G9/F10 分支。
- 父子关系和黑白轮次。
- 深度 20 以内最多 500 条真实边。
- 每条真实路径不重复占用坐标。
- 任何子节点不允许与父路径已有坐标冲突。

结果：

```text
2/2 tests passed
深层检查边数：500+
深度：20 以内
重复坐标：0
错误轮次：0
循环路径：0
```

真实 DP 黑盒：

```json
{
  "pass": true,
  "mobileViewport": "375x812",
  "nodeCount": 4894,
  "rootChildren": 1,
  "status": "0 / 5 手 · 444 处分支"
}
```

默认主线逐步显示：

```text
起点
→ 黑 H8
→ 白 G9
→ 黑 F10
→ 白 E11
→ 黑 E10
```

根、首着、首着后多分支和深层路径均已通过当前测试范围。

## 五、斜月 1.2GB 真实性验收

真实文件：

```text
D:\五子棋\定式谱\斜月.lib
大小：约 1.2GB
```

新版 Worker 预览路径结果：

```text
首批预览：约 0.5–1.5s
首批节点：25,001（不同运行取决于预览阈值/当前构建）
标题：斜月
preview：true
storageDiagnostic.ok：true
页面可操作
最大首屏 Long Task：约 54–237ms
```

页面提示：

```text
已导入 RenLib LIB，已存入大型棋谱库，首批数据已打开，后台继续建立完整索引
```

斜月完整黑盒在当前可观察窗口通过：

```text
标题、compact 预览、分支窗口、100 次导航、刷新恢复、DOM 稳定、consoleErrors=[]
```

但必须明确：现有性能脚本仍主要验证首批 preview，未等待 1.2GB 完整后台索引完成并对最终完整节点数做硬断言。因此不能写成“1.2GB 全量导入已完全验收”。

## 六、导入、显示和性能回归

### 高级 DP/DB 导入

```text
setup：通过
pass move：通过
多顶层 collection：通过
导出重导：通过
重复导入：通过
```

### 大谱导航

`雨.lib`：

```text
节点数：694,910
前进 P95：约 28ms
后退 P95：约 56ms
```

### 17M 详细标注谱

```text
节点数：17,098,900
前进 P95：约 32ms
后退 P95：约 32ms
分支：通过
刷新：通过
DOM：约 520
```

### renjutool.top 对比

公开页面资源显示其采用：

```text
Worker + RenLib WASM
MoveNode/MoveList 紧凑关系
IndexedDB/LZ4/TypedArray
独立 Canvas 棋盘局部绘制
重功能按需加载
```

本项目当前已采用：

```text
Worker
DP 局面数据库解析
compact typed-array index
lazy/paged library view
IndexedDB 分块
O(1) compact ID 查询
```

仍有明显差距：

```text
没有 RenLib WASM parser
棋盘仍是 React/SVG 与分页投影
1GB 完整解析的最终完成时刻尚未有硬断言
```

## 七、回归结果

```text
npm test -- --run：88/88 通过
npm run build：通过
dist：0.56MB（上限 20MB）
git diff --check：通过（仅 CRLF 转换提示）
```

测试包含：

```text
src/storage.test.ts
prototype/export-format/export-format.test.ts
experiments/renju-ai/renju-ai.test.ts
src/large-storage.test.ts
src/renlib-native.test.ts
src/game.test.ts
qa/dp-real-file.test.ts
```

## 八、未完成边界

- 真实 DP 数据库全量所有状态的独立黄金坐标对照仍需继续扩大；当前已覆盖真实可达路径 500+ 条、深度 20 内。
- 1.2GB 斜月完整后台索引的最终节点数/完成时刻需要独立长时间测试脚本确认。
- 需要比较 renjutool.top 与本项目在同一文件上的全量导入完成时间；当前网站内部实现不是完全同一测试环境，不能直接以主观感觉给出倍数结论。
- Android 真机测试仍受当前环境缺少 `adb/emulator/JDK21` 限制，已完成的是浏览器移动触控视口测试。

## 九、结论

> 本轮确认用户反馈的“DP 开局对、后面乱”是实际数据重建问题，不是注释文字问题。根因是 canonical 对称坐标在父子状态之间泄漏；已按真实父路径和八对称匹配修复，并用真实九天 DB 深度路径测试发现并验证了 500+ 条边。九天默认主线与首着分支通过，工程 88/88 回归通过。斜月 1.2GB 已能快速显示首批可用预览并保持页面可操作，但完整后台索引仍需单独长时间硬断言，不能提前宣称与 renjutool.top 全量性能等价。