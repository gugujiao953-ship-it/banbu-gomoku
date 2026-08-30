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
  { id: "ai-rules", script: "scripts/verify-ai-rules.mjs", purpose: "AI 规则与草稿层级" },
  { id: "editor-command-bar", script: "qa/editor-command-bar.mjs", purpose: "编辑命令栏" },
  { id: "export-content", script: "qa/export-content-verify.mjs", purpose: "SGF/JSON 导出内容" },
  { id: "mobile-visual", script: "qa/mobile-visual.mjs", purpose: "移动端视觉与交互" },
  { id: "visual-ui", script: "qa/visual-ui-regression.mjs", purpose: "多视口 UI 与可访问交互" },
  { id: "error-boundary-diagnostics", script: "qa/error-boundary-diagnostics.mjs", purpose: "崩溃恢复与诊断导出" },
  { id: "renlib-dev-assets", script: "qa/renlib-dev-assets.mjs", purpose: "dev 模式 RenLib JS/WASM 资产服务" },
]);

export const formalRegressionSummary = Object.freeze({
  unit: "src/**/*.test.*",
  browser: formalBrowserRegressions.map(({ id, script, purpose }) => ({ id, script, purpose })),
  build: ["tsc -b", "vite build", "scripts/check-dist-size.mjs"],
});
