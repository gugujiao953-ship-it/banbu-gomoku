/**
 * The only browser scripts executed by qa:browser and qa:full.
 *
 * Keep exploratory scripts, real-file stress tests and screenshots out of this
 * list. They may live in qa/ for now, but they are not release gates unless
 * they are explicitly registered here and have a deterministic exit code.
 */
export const formalBrowserRegressions = Object.freeze([
  { id: "advanced-import", script: "qa/advanced-import-blackbox.mjs", purpose: "高级导入与重复导入" },
  { id: "chunk-order", script: "qa/chunk-order-blackbox.mjs", purpose: "百万节点分块顺序" },
  { id: "draft-storage", script: "qa/draft-storage-guard.mjs", purpose: "草稿存储保护" },
  { id: "recent-imports", script: "qa/recent-imports.mjs", purpose: "最近导入与一键重开" },
  { id: "onboarding-session-recent", script: "qa/onboarding-session-recent.mjs", purpose: "首次欢迎、会话恢复与最近棋题" },
  { id: "ai-rules", script: "scripts/verify-ai-rules.mjs", purpose: "AI 规则与草稿层级" },
  { id: "ai-opacity-rules-cancel", script: "qa/ai-opacity-rules-cancel.mjs", purpose: "棋子透明度、规则说明与无限思考取消" },
  { id: "editor-command-bar", script: "qa/editor-command-bar.mjs", purpose: "编辑命令栏" },
  { id: "annotation-mode", script: "qa/annotation-mode.mjs", purpose: "常驻标注布局、分支点优先编辑、再次点击移除与移动端首屏" },
  { id: "export-content", script: "qa/export-content-verify.mjs", purpose: "SGF/JSON 导出内容" },
  { id: "mobile-visual", script: "qa/mobile-visual.mjs", purpose: "移动端视觉与交互" },
  { id: "mobile-core-workspace", script: "qa/mobile-core-workspace.mjs", purpose: "移动端核心工作区、文件夹与 legacy WebView 滚动" },
  { id: "puzzle-selector-layout", script: "qa/puzzle-selector-layout.mjs", purpose: "做题规则、选择器覆盖与青花瓷多视口" },
  { id: "settings-page", script: "qa/settings-page-regression.mjs", purpose: "设置页拆分、字号与 Sheet 交互" },
  { id: "research-library-workflow", script: "qa/research-library-workflow.mjs", purpose: "自动演示、范围导出、连续查找与资料管理" },
  { id: "record-tree-workspace", script: "qa/record-tree-workspace.mjs", purpose: "统一状态区、棋谱树分支操作、复制粘贴与书签" },
  { id: "visual-ui", script: "qa/visual-ui-regression.mjs", purpose: "多视口 UI 与可访问交互" },
  { id: "error-boundary-diagnostics", script: "qa/error-boundary-diagnostics.mjs", purpose: "崩溃恢复与诊断导出" },
  { id: "renlib-dev-assets", script: "qa/renlib-dev-assets.mjs", purpose: "dev 模式 RenLib JS/WASM 资产服务" },
  { id: "back-navigation", script: "qa/back-navigation.mjs", purpose: "返回键全局语义：弹层逐层关闭、非首页先回首页、根页双击退出提示" },
]);

export const formalRegressionSummary = Object.freeze({
  unit: "src/**/*.test.*",
  browser: formalBrowserRegressions.map(({ id, script, purpose }) => ({ id, script, purpose })),
  build: ["tsc -b", "vite build", "scripts/check-dist-size.mjs"],
});
