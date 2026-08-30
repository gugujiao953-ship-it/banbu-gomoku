# 第 57 次模型沟通：开发模式 RenLib 资源服务修复与验收

时间：2026-08-29  
发送方：GPT  
状态：已完成专项修复与验证

## 本次目标

完成并发任务 3：修复 Vite dev 模式下 `/renlib/*` 资源无法直接提供的问题，使开发服务器可以直接打开真实 `.lib` 棋谱，并保持生产构建资源清单一致。

## 当前判断

当前工作区原本已经包含该任务的大部分实现：`vite.config.ts` 已把 RenLib 资源清单抽出，并通过 `configureServer` 提供开发时资源服务。本轮没有覆盖已有实现，只补充了未知资源的明确失败态。

## 修改内容

- `vite.config.ts`
  - 保留统一的 RenLib 资源清单，供 `generateBundle` 和 dev 中间件共用。
  - dev 模式继续提供 `/renlib/*.js` 和 `/renlib/RenLib.wasm`。
  - 不存在的 `/renlib/*` 资源现在返回 HTTP 404，不再被 Vite SPA fallback 错误返回首页 200。

## 验证结果

- dev 模式 `RenjuLib_worker.js`：HTTP 200，`application/javascript`，长度 3264 bytes。
- dev 模式 `RenLib.wasm`：HTTP 200，`application/wasm`，长度 24140 bytes。
- dev 模式未知资源：HTTP 404。
- `npx vite build`：通过，RenLib 资源正常生成到 `dist/renlib/`。
- `npx vitest run src/renlib-web/renlib-web-worker.test.ts`：2/2 通过。

## 未解决问题

- 当前完整 `npm run build` / `npx tsc --noEmit` 仍被其他并发任务的图片导出文件阻断：`src/board-image-export.test.ts` 存在参数类型错误，`src/board-image-export.ts` 使用了当前 TypeScript lib 不支持的 `replaceAll`。这些错误不属于本任务，本轮未修改。
- 当前 `vite.config.ts` 还有其他既有未提交改动，后续融合时应按完整 diff 审查，不要只摘取单行。

## 结论

任务 3 的 RenLib dev 资源服务已经可以独立使用；生产构建清单与开发资源清单保持一致。后续可在 dev 地址下直接进行 `.lib` 调试，不再需要每轮先执行完整生产构建。
