# 096｜GPT 对 GLM2 总报告的验收与缺陷修复

日期：2026-09-02

## 1. 验收结论

`qa-artifacts/glm-2026-09-02-deep/总报告.md` 的产品缺陷证据大部分可采信，但原报告未通过格式与机器汇总验收。原始证据保留不覆盖，以下问题作为正式口径纠正：

- 新产品缺陷应为 `P2 × 6`，不是 `P2 × 5`。
- 未达到 095 任务书深度或未执行的任务为 T01、T03、T04、T09、T13、T15、T16、T17、T18、T22、T23，共 11 项，不是 3 项。
- T02、T07、T10、T14d、T19、T19b、T20 等 `task-result.json` 存在计数不守恒、fatal 后仍 PASS、检查失败但总状态 PASS 等问题；按照 095 第 9 节应视为原始机器汇总无效或测试基础设施异常，不能直接汇总为合规 PASS。
- T21 首次检查记录过 `controller=null`，应表述为“Service Worker/离线链路部分通过，离线 shell 后续受控；RenLib WASM 离线请求失败”，不能写成所有 controller 检查均通过。

## 2. 本轮处理的六项 P2

### BUG-GLM2-UI-01｜已修复

设置页棋子列表补齐 `gold` 与 `diamond`，现在与快捷中心及 `StoneTheme` 联合类型一致，均为 16 项。

### BUG-GLM2-AI-01｜已修复

开始 AI 对局不再调用 `setShowForbidden(false)`。AI 对局是否执行禁手由 `AiGameState.forbiddenEnabled` 和规则控制，不再改写用户全局“禁手辅助”显示偏好。

### BUG-GLM2-PZL-01｜已修复

把当前局面保存为题目时写入 `boardSize`。新增 19 路题目回归测试，确认重新创建题目文档后仍为 19 路，且第 16 列棋子坐标保留。

### BUG-GLM2-PWA-01｜已修复构建配置

Workbox 预缓存扩展到 `.wasm` 与 `.data`。生产构建生成 149 项 precache，已确认包含：

- `renlib/RenLib.wasm`
- `rapfi/fallback/rapfi-single.wasm`
- `rapfi/fallback/rapfi.data`

真实设备安装后的首次升级与完全断网行为仍需后续真机验证。

### BUG-GLM2-PWA-02｜已修复构建产物

增加 Rapfi 静态资源写出后兼容处理，生产 `dist/rapfi` 已不含 `&&=`、`||=`、`??=`。不修改第三方源资源，只处理最终构建输出。

### BUG-GLM2-CSS-01｜已增强降级层

保留现代 CSS，同时扩展 `legacy-webview.css` 中的显式回退，覆盖统一状态栏、棋谱选择器、标注卡片、禁用态变量和手册入口等关键区域。旧 WebView 真机像素表现仍不得在未安装验证前宣称完全通过。

## 3. 验证结果

- 针对性 Vitest：3 文件、14 项通过。
- TypeScript：`npx tsc --noEmit --pretty false` 通过。
- 全量 Vitest 首轮：58 文件，308/309 通过；唯一失败是回退 CSS 注释包含现代语法关键字，触发静态门禁，属于本轮新增测试问题。
- 修正注释后全量 Vitest：58 文件、309 项全部通过。
- `npm run build`：通过，`dist` 6.49MB，小于 20MB；PWA precache 149 项。
- 构建产物扫描：Rapfi 逻辑赋值语法 0 处；RenLib/Rapfi WASM 与 fallback data 均已预缓存。

## 4. 当前结论

六项已知 P2 已完成源码或构建层修复并通过静态、单元和生产构建复核。原 GLM2 报告不能按原统计直接验收，应以本文件的纠正口径为准。

本轮没有运行 Android/Gradle 打包、Capacitor 同步、APK 安装或发布；不得宣称当前源码已安装到手机。WebView 83 与 PWA 升级/离线最终结论仍需真机专项验证。
