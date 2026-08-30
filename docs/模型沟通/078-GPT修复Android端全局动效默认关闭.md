# 第 78 次模型沟通：修复 Android 端全局动效默认关闭

时间：2026-08-30
发送方：GPT
状态：已修复，准备发布 v1.1.5

## 用户反馈

Android 端所有动效都没有显示，包括人机思考、主题动态背景、导入解析进度、落子、导航和界面过渡。

## 根因

`src/motion-settings.ts` 在本地没有保存动效设置时返回 `false`。应用启动后会把根元素设置为 `data-motion="off"`，而全局 CSS 规则会关闭所有 `animation`、`transition` 和滚动行为。因此问题不是单个主题、AI 或导入模块失效，而是共用动效开关在发布包中默认关闭。

## 修复

- `src/motion-settings.ts`
  - 存储键从 `banbu-motion-enabled-v1` 升级为 `banbu-motion-enabled-v2`。
  - 新安装默认开启动效。
  - 已安装旧版本的设备不再沿用 v1 的错误关闭状态。
  - 用户手动关闭后仍可保存为关闭状态。
- `src/motion-settings.test.ts`
  - 增加新安装默认开启、旧 v1 键不影响新版本和异常存储回退测试。
- `qa/motion-sound-settings.mjs`
  - 增加浏览器验证：默认开启动效、根节点为 `data-motion="on"`，手动关闭后仍能持久化。
- `package.json`、`package-lock.json`、`android/app/build.gradle`
  - 版本升级为 v1.1.5，Android versionCode 升为 7，便于覆盖升级 v1.1.4。
- `RELEASE_NOTES.md`
  - 增加 v1.1.5 动效修复说明。

## 验证

- 定向单测：2 个测试文件，6/6 通过。
- 类型检查：`npx --no-install tsc --noEmit` 通过。
- 浏览器专项：`qa/motion-sound-settings.mjs` 通过；默认 `data-motion="on"`，关闭后保存为 `false`，页面错误 0。
- 生产构建：通过，dist 约 4.91MB。
- Android release：v1.1.5 构建、签名和包元数据校验通过。

## 交付边界

- 本轮已生成新的 v1.1.5 APK，但尚未连接真实 Android 设备做安装和主题/AI/导入逐项实机冒烟。
- Android 系统级“移除动画/减少动态效果”仍属于无障碍设置；如果用户主动开启该系统选项，系统 `prefers-reduced-motion` 规则仍会关闭 CSS 动效，这是预期行为。
- 当前完整测试仍存在一个既有 VCF 搜索测试预算回归：实际返回 `budget`，测试期望 `win`；与本次动效修复无关。

## 下一步

安装 v1.1.5 后重点检查：

1. 设置页“界面动效”是否默认开启。
2. 切换雨幕、竹林、雪落等主题后背景是否动态移动。
3. 人机思考时的状态动画是否显示。
4. 导入大棋谱时旋转、骨架和进度条是否动态显示。
5. 如仍静止，检查 Android 系统是否开启了“移除动画”或“减少动态效果”。
