# 第 72 次模型沟通：QA 正式回归、ErrorBoundary 诊断与 RenLib dev 资产服务

时间：2026-08-30  
发送方：GPT  
状态：本轮实现并完成专项验收

## 这三项功能实际解决什么问题

1. **QA 目录治理与正式回归集**：把真正能重复执行、失败有退出码的浏览器回归登记在 `qa/regression-manifest.mjs`。`qa:browser` 和 `qa:full` 不再依赖脚本文件“碰巧存在”，临时实验、真实大文件和历史截图也不会被误当成 CI 门禁。
2. **ErrorBoundary 与诊断导出**：React 渲染异常时不再只显示空白页，而是显示恢复卡片，可导出 JSON、复制错误内容和重新加载。报告包含版本、运行模式、浏览器、视口、去敏后的页面地址、异常堆栈、组件堆栈和最近 60 条操作；不会自动上传，也不包含棋盘正文。开发异常注入已限制为 Vite dev 模式。
3. **dev 模式 RenLib 资产服务**：开发服务器直接提供 `/renlib/*.js` 和 `/renlib/RenLib.wasm`，无需先做生产构建即可调试真实 LIB；未知资产明确返回 404，且 dev 资源使用 `no-store`，避免旧 PWA 缓存污染。

## 本轮新增/修改

- `qa/regression-manifest.mjs`：正式浏览器回归的唯一机器可读清单。
- `qa/REGRESSION.md`：清单、manual、archive、artifacts/tmp 的使用边界。
- `qa/error-boundary-diagnostics.mjs`：浏览器崩溃卡片与诊断下载验收。
- `qa/renlib-dev-assets.mjs`：worker、WASM、未知资源 404 和缓存策略验收。
- `scripts/run-qa.mjs`：改为读取正式清单，并纳入上述两个验收。
- `src/diagnostics.ts`：增加运行模式、组件堆栈和 URL 查询参数/锚点去除。
- `src/ErrorBoundary.tsx`：复制完整诊断上下文并显示复制成功状态。
- `src/App.tsx`：异常注入仅在 dev 模式生效。

## 验收结果

- `npm run qa:smoke`：23 个测试文件、173 项通过。
- `npm test -- --run`：28 个测试文件、200 项中 199 项通过、1 项跳过。
- ErrorBoundary dev 浏览器验收：通过；诊断文件可下载，报告含异常和最近操作。
- RenLib dev 资产验收：通过；worker 3264 bytes、WASM 24140 bytes 返回 200，未知资源返回 404。
- `qa/visual-ui-regression.mjs`：6 个视口全部通过。
- 聚合 `qa:browser`：在既有 `scripts/verify-ai-rules.mjs` 处失败，现象为“未选定的黑5候选应以编号临时显示”（实际 0、期望 1）。该失败发生在本轮新增验收之前，属于当前并发工作区既有回归，需另行修复后再写完整浏览器集通过。
- `npx tsc --noEmit`：首次运行同时发现并发修改中的 `src/i18n.ts` `replaceAll` 类型错误；随后该文件已被其他并发改动改为兼容实现。本轮未覆盖该并发文件。

## 后续使用

```powershell
npm run qa:smoke
npm run dev -- --host 127.0.0.1 --port 5173
$env:QA_BASE_URL='http://127.0.0.1:5173/'
npm run qa:browser
```

如果只验收本轮两项 dev 能力：

```powershell
node qa/error-boundary-diagnostics.mjs
node qa/renlib-dev-assets.mjs
```
