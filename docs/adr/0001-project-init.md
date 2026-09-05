# 0001 - 半步五子棋打谱项目架构

**Status:** proposed
**Date:** 2026-08-24
**Spec:** README.md、PRODUCT_NOTES.md
**Deciders:** gugujiao953-ship-it

## Context

项目需要优先适配安卓手机，同时保留网页版和未来桌面端复用能力。核心能力包括棋谱变化树、专业格式导入导出、同棋盘打谱/做题切换、题库管理和不会阻塞触控界面的本地计算。

## Decision

- 使用 React 19、TypeScript 和 Vite 实现共享界面、棋谱模型、格式解析与规则模块。
- 使用 PWA / Workbox 交付离线网页版，使用 Capacitor 8 封装 Android 应用；不在平台壳中复制业务逻辑。
- 使用 Web Worker 隔离陪练与 VCF 搜索；切换题目或停止思考时终止旧 Worker，避免过期结果回写。
- 棋谱采用变化树模型，JSON 作为完整跨端格式，SGF / LIB / POS 等作为外部交换格式。
- 爱五子棋、开宝、RenLib / SGF 和 SlowRenju 仅用于交互、格式与公开算法结构研究；不把第三方参与或授权写成既成事实，也不复制 SlowRenju 的源码、权重、棋形表或二进制。

## Consequences

- 网页与 Android 可以共享大部分代码和测试，迭代成本较低。
- Capacitor 应用仍依赖 WebView 性能；大型棋谱库未来可能需要从 localStorage 迁移到 IndexedDB。
- Worker 终止能可靠取消任务，但当前陪练强度低于完整原生引擎。
- 内置来源题集公开再分发前仍需持续核对授权与署名范围。

## Alternatives Considered

- 分别维护原生 Android 与网页实现：平台体验上限更高，但会重复棋谱、格式和规则逻辑。
- 直接嵌入 SlowRenju / APK 原生库：强度更高，但存在 GPL 对应源码、内存预算、线程取消和来源可核验问题，因此当前不采用。
