# 079｜扩展 Android 旧版 WebView 兼容与真机验收

## 问题

红米 K20（Android 11，系统 WebView 83.0.4103.106）安装 v1.1.5 后出现白屏。红米 11T 可以正常使用，因此优先排查 WebView 能力差异。

## 根因

v1.1.5 的生产 JavaScript 使用了 Chromium 83 无法解析的现代语法。页面入口在脚本解析阶段就失败，React 没有机会渲染，所以表现为白屏。升级后，旧 PWA Service Worker 仍会从 CacheStorage 提供 v1.1.5 的入口和脚本；Chromium 83 对 Capacitor 本地 `sw.js` 更新返回未知错误，因此单纯覆盖 APK 也无法恢复。紧凑棋谱索引还存在运行时 `structuredClone` 依赖，旧 WebView 在打开相关棋谱时也可能失败。

## 修复

- Vite 增加 `@vitejs/plugin-legacy`，目标覆盖 Chrome 83 与 Android 8+；构建同时产出现代模块版和 `nomodule` legacy 版，旧 WebView 自动回退。
- 紧凑索引改用本地的棋盘初始局面复制函数，不再调用 `structuredClone`。
- Android v1.1.6 首次启动时只删除 `app_webview` 内旧 Service Worker 与 CacheStorage 目录，保留 Local Storage、IndexedDB、棋谱、草稿和设置；以后原生包不再注册 PWA Service Worker。
- Web 版本改为仅在非 Capacitor 原生环境注册 `sw.js`，继续保留网页/PWA 离线能力。
- 保留项目原有 Android 最低 API，不降低现代 Android 的能力或视觉效果。
- 正式包关闭 WebView 远程调试；调试开关只用于本轮定位，未进入发布包。

## Redmi K20 真机验收

- 应用正常启动，不再白屏。
- 落子动效可见，CSS `stone-enter` 正常计算。
- 雨幕主题可用，CSS `rain-fall` 持续运行。
- “界面动效”关闭后 `data-motion=off` 且动效关闭；重新打开并刷新后仍保持 `on`。
- 未清除设备已有应用数据，未影响原有草稿。

## 交付计划

版本升级为 `1.1.6` / Android `versionCode=8`，完成最终 release APK、签名和 SHA-256 校验后，再创建 GitHub Release 并上传安装包及校验文件。

发布前追加体验改进：关于页联网检查 GitHub 最新正式版本、棋谱树缩放下限扩展到 30%，以及字号设置改为全局界面文字统一生效。以上项目需要随最终 APK 一并在 Redmi K20 验收。
