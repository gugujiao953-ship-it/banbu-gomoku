# 065｜VFX-12 至 VFX-20 第二批轻量 UI 与视觉门禁

日期：2026-08-29

## 本轮完成

- VFX-12：新增 `src/ui/feedback/AppToast.tsx`。保留旧 `.toast` 类名兼容已有 QA，按现有中文提示自动归类成功、信息、提醒、错误、加载五类；使用图标、文字、关闭按钮和 `aria-live` 双重表达；普通提示 2.6 秒自动消失，重要错误/提醒延长到 5.2 秒；仍保持单 Toast，不引入组件库。
- VFX-13：增强 `BottomSheet` 的 Esc 关闭、打开后聚焦、Tab 焦点循环、关闭后恢复原触发元素焦点和安全区内边距；草稿保护弹窗改为复用同一组件，避免两套 overlay 行为漂移。
- VFX-16：补充棋盘坐标、星位、最后一步、胜线、禁手、候选点、AI 推荐、RenLib 标注和用户标注的描边、层级、文字描边与非缩放线宽规则，保持棋盘算法与 SVG 节点数量不变。
- VFX-17：补齐左右 safe-area、横屏低高度棋盘限制、平板容器宽度和 Bottom Sheet/Toast/Coach Mark 的手势区避让；未复制页面结构，旋转不触碰棋谱 React 状态。
- VFX-18：新增 `src/ui/states/StateIllustration.tsx` 轻量内联 SVG，覆盖棋谱空文件夹、题库空文件夹和搜索无结果；组件同时提供 loading/error 变体供后续状态接入，不产生网络请求。
- VFX-19：新增 `src/ui/coach/CoachMark.tsx` 和 `banbu-coach-marks-v1` 本地状态。棋盘工具、棋谱库搜索、设置分组分别首次提示；支持“知道了”“稍后”“不再提示”，单次只显示一个。移动端提示卡不拦截底下的关键操作按钮。
- VFX-20：新增 `qa/visual-ui-regression.mjs` 与 `npm run qa:visual`，覆盖 390×844、360×800、844×390 横屏、768×1024 平板、深色、reduced-motion；检查横向溢出、底栏可见、焦点进入/恢复、动画无限/超时、Long Task 和页面错误。截图与 JSON 报告写入 `artifacts/visual-regression/`，不进入生产包。`scripts/run-qa.mjs browser` 已纳入该门禁。

## 验收

- `npm run build`：通过；dist 4.83MB，低于 20MB 门禁。
- `npm test -- --run`：23 个测试文件通过、1 个跳过；188 项通过、1 项跳过。
- `npm run qa:visual`：6 组视觉用例全部通过；无页面错误、无横向溢出、焦点管理通过、Long Task 均低于 250ms。
- `npm run qa:browser`：高级导入、百万节点分块恢复、草稿保护、编辑栏、导出内容、移动端视觉和新视觉门禁全部通过。
- `git diff --check`：通过；仅保留既有 CRLF 转换提示。

## 轻量性说明

没有引入动画库、UI 框架、远程图片或音频资源；新增视觉只使用 CSS 和内联 SVG。Coach Mark 使用低频定时器，不使用常驻 `requestAnimationFrame`。VFX-04～10、音效和导入进度实现均保持原样，仅做兼容接入。
