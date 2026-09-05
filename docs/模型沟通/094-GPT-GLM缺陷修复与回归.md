# 094｜GLM 六项缺陷修复与回归

日期：2026-09-01  
工作区：`D:\Projects\五子棋2`（非 Git）  
依据：`qa-artifacts/glm-2026-09-01/总报告.md`

## 结论

GLM 报告列出的 6 项缺陷均已完成源码修复，并通过单元、浏览器交互、视觉、生产 Web 构建和产物扫描复核。本轮没有执行 Android/Gradle 打包、Capacitor 同步、APK 安装或发布，因此旧 WebView 的最终结论仍需以后用新源码生成的 APK 做真机复核；当前真机若仍为 1.1.6(8) 旧安装包，不能视为已经包含本轮修复。

原报告的缺陷统计文字有一处算术错误：实际为 **P1×1、P2×3、P3×2**，不是“P1×1、P2×2、P3×3”。

## 修复明细

### BUG-0901｜永久删除缺少二次确认

- “彻底删除”在改变回收站或大型棋谱数据前调用确认。
- “清空回收站”在任何删除操作前显示条目数量并确认。
- 单项文案明确“无法撤销”，清空文案明确“无法恢复”。
- 取消确认时不删除条目、不改变回收站。

文件：`src/recycle-bin.ts`、`src/recycle-bin.test.ts`、`src/App.tsx`。

### BUG-0103｜空草稿旧 localStorage 键未清除

- `saveDraftToLocal` 遇到无操作且无元数据的草稿时，删除 `renju-note-draft-v2:<documentId>`，不再保存空对象覆盖旧状态。
- 打谱撤销至空时立即同步存储，刷新后不会复活已撤销操作。

文件：`src/storage.ts`、`src/storage.test.ts`、`src/App.tsx`。

### BUG-0101｜编辑重做无入口

- 在打谱“走棋”栏接入 `redoDraft`，按钮位于“撤销”旁。
- 没有可重做操作时禁用；撤销后启用；重做后恢复撤销能力和当前节点。
- 该按钮是“编辑重做”，不是自动播放。
- 产品约束保持不变：**打谱没有播放按钮，读谱保留播放按钮**。
- 360px 下起点、上一手、下一手、终点、分支树、撤销、重做、放弃共 8 个按钮保持单行，无横向溢出。

文件：`src/App.tsx`。

### BUG-0102｜粘贴子树后撤销产生悬挂书签

- `add-subtree` 草稿操作携带克隆书签快照。
- 粘贴时合并克隆书签；撤销时移除；重做时仅恢复一份，不重复。
- 放弃草稿以及“放弃并切换”会移除草稿粘贴产生的书签；保存草稿后书签正常保留。

文件：`src/draft-operations.ts`、`src/features/record-tree/bookmarks.ts`、`src/features/record-tree/bookmarks.test.ts`、`src/App.tsx`。

### BUG-1201｜Rapfi 使用 WebView 83 不支持的逻辑赋值

- `public/rapfi/fallback/rapfi-single.js` 中 5 处 `||=` 已改为等价旧语法。
- 新增源码和构建产物扫描，确保 Rapfi 回退文件不再出现 `||=`。

文件：`public/rapfi/fallback/rapfi-single.js`、`src/legacy-assets.test.ts`。

### BUG-1202｜WebView 83 丢弃现代 CSS

- 启动时检测 `:is()`、`:where()`、`:has()`、`color-mix()`、`dvh`、`inset`、`:focus-visible`；缺少任一能力即在根节点加入 `legacy-webview`。
- 降级层使用 WebView 83 可解析的普通选择器、`vh`、普通颜色与四边定位。
- 补齐应用高度、底部 Sheet、棋谱选择器、题库选择器、棋谱树、标注/手册弹窗、快捷抽屉、首次欢迎层、绝对定位状态元素、焦点轮廓、批量选中、按钮文字和禁用态等关键回退。
- `vite.config.ts` 的 CSS 目标设为 `chrome83`；JS 同时保留现代与 legacy 构建。

文件：`src/webview-compat.ts`、`src/webview-compat.test.ts`、`src/legacy-webview.css`、`src/legacy-assets.test.ts`、`src/main.tsx`、`vite.config.ts`、`src/App.tsx`。

## 自动化与真实浏览器结果

| 验证 | 结果 |
|---|---|
| `npx tsc --noEmit --pretty false` | 通过，0 错误 |
| `npx vitest run --maxWorkers=2` | 57 个测试文件、306 项测试全部通过 |
| `node qa/bugfix-regression-2026-09-01.mjs` | 通过；确认弹窗、空草稿、重做单行、书签撤销/重做、legacy 类与文字颜色均通过 |
| `qa/editor-command-bar.mjs` | 通过；375×812 落子、保存刷新、删除保存刷新、SGF/JSON 导出正常 |
| `qa/record-tree-workspace.mjs` | 通过；原子粘贴、书签迁移/编辑/搜索/跳转、重复分支拒绝和 6 组视口视觉检查正常 |
| `qa/research-library-workflow.mjs` | 通过；确认播放仅在读谱、打谱/读谱走棋栏单行、资料安全入口等正常 |
| `qa/settings-page-regression.mjs` | 通过；360/390/412 无溢出，22 个主题、14 个棋盘、16 个棋子选项可枚举 |
| `qa/visual-ui-regression.mjs` | 6/6 场景通过；360/390 手机、844 横屏、768 平板、深色、减少动效均无横向溢出 |
| `npm run build` | 通过；PWA 145 项预缓存，`dist` 6.45MB（上限 20MB） |
| `dist/rapfi/fallback/rapfi-single.js` 扫描 | 通过；0 处 `||=` |

生产构建仍有“大于 500kB chunk”的性能提示，不影响本次构建成功，也不是这 6 项缺陷中的功能阻断。

## 浏览器证据

- `qa-artifacts/glm-2026-09-01/fixes/record-redo-360.png`
- `qa-artifacts/glm-2026-09-01/fixes/legacy-webview-360.png`
- `qa-artifacts/glm-2026-09-01/fixes/bugfix-regression.json`

其中 JSON 记录：空草稿键数组为空、8 个走棋按钮顶部坐标一致、两种删除确认文案完整、粘贴书签撤销后移除且重做只恢复一份、兼容类已启用、按钮文字为不透明 `rgb(41, 38, 32)`、控制台错误为 0。

## 测试脚本同步

- 新增 `qa/bugfix-regression-2026-09-01.mjs`，将六项缺陷中的用户可见路径固化为回归。
- 修正资料安全入口定位：从“棋谱库”进入，不再错误地从设置页寻找。
- `qa/editor-command-bar.mjs` 的干净存储夹具现在写入首次欢迎完成标记，避免欢迎层遮挡导致误报。

## 尚未覆盖的条件

- Android WebView 83 真机没有在本轮执行，因为当前边界禁止打包、同步和安装。
- 真实 LIB/DP/DB 大样本与系统文件选择器限制仍沿用 093 报告中的条件说明；这些不是本轮六项修复新增的失败。
- 后续若允许打包，必须用新构建安装后再复核 Rapfi Worker 是否启动、所有主题下按钮文字、弹窗遮罩范围与资料安全确认；不得拿旧 APK 的表现代替新源码结论。
