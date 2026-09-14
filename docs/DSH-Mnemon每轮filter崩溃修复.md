# DSH 每轮 "Cannot read properties of undefined (reading 'filter')" 崩溃修复记录

日期：2026-09-11
症状：**每次对话/每个 turn 结束后**，GUI 消息流出现"本轮运行失败 Cannot read properties of undefined (reading 'filter')"。回复本身正常生成，但 turn 以 error 结束。

## 根因

**dsh-mnemon 0.1.1 与 DSH 0.1.2-rc.1 的 Session API 不兼容**：

- dsh-mnemon 0.1.1 按 DSH 0.1.0-rc.6 的 API 构建，代码里 5 处访问 `this.agent.session.events`（**属性**）。
- DSH 0.1.2 的 `Session` 类（`@deepseek-ai/dsh-session`）**删除了 `events` 属性**，改为 `snapshotEvents()` **方法**（见 `dsh-session/lib/types/index.d.ts`）。
- 因此 `agent.session.events` 为 `undefined`。

崩溃链：
1. LLM 回复生成完毕，agent-loop 派发 `agent/turn-stopping` 事件（`dsh-agent-loop/lib/index.js:570`）。
2. dsh-mnemon 的 `scheduleIdleReview()` 钩子执行 `completedToolActivity(this.agent.session.events, turn)`。
3. `events.filter(...)` 对 `undefined` 调用 → `TypeError: Cannot read properties of undefined (reading 'filter')`。
4. 异常被 agent-loop 的 catch 捕获，`turn/end` 的 reason 记为 `{kind:"error", error:{message:"Cannot read properties of undefined (reading 'filter')", code:"UNKNOWN"}}`。
5. GUI 显示"本轮运行失败"，但回复早已生成，所以对话看起来正常。

## 修复内容

### 1. 补丁：`~/.dsh/profiles/web/node_modules/dsh-mnemon/lib/index.js`

5 处 `this.agent.session.events` → `this.agent.session.snapshotEvents()`：
- 4289 `memoryToolCalls(this.agent.session.events)`
- 4308 `this.memoryActivity.snapshot(this.agent.session.events)`
- 4312 `assistantMessageText(this.agent.session.events, messageId)`
- 4345 `completedToolActivity(this.agent.session.events, turn)`（turn-stopping 崩溃点）
- 4352 `this.agent.session.events.some(...)`（idle review 回调）

注意事项：
- 该文件是 pnpm store 的 **hardlink**，直接编辑会污染 store。先 `Remove-Item` + 从备份 `Copy-Item` 解除 hardlink，再改。
- 文件是 ESM 打包代码，用无 BOM UTF-8 读写。
- 备份：`D:\Projects\五子棋2\.dsh-fix-backup-20260911\index.js.orig`

### 2. 环境事实澄清（未改动）

`~/.dsh/profiles/web/node_modules/` 下三个中文壳目录 `(记忆)dsh-mnemon`、`(浏览器)dsh-browser`、`(搜索增强)dsh-web-search-pro` 是**有意创建的加载链**（各插件的 cordis.patch.yml 的 `name:` 字段指向它们，壳 `export * from "<真实包>"` re-export）。**不要删除**，否则插件加载断链。用 UTF-8 读这些 yml 是正常中文（PowerShell 5.1 Get-Content 按 GBK 解码会显示成"璁板繂"假乱码）。

### 3. 生效方式

重启 DSH 宿主（web 服务）：
```
# 停掉 3080 上的旧进程后运行（start-dsh.ps1 检测到服务健康时不会重启，需先杀进程）
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess -Force
powershell -File D:\dsh\start-dsh.ps1
```
补丁在下次启动加载 dsh-mnemon 时生效。

## 验证

- 重启后发一条消息，若消息流不再出现"本轮运行失败"即修复。
- `node --check` 对补丁文件语法检查通过。
- 若升级 dsh-mnemon（npm 最新 0.5.7 针对 DSH 0.1.5-rc.1 构建，**不要**在当前 0.1.2 宿主上装），补丁会被覆盖，需重新打。

## 同类历史问题

- 之前 profile 里 `@deepseek-ai/dsh-tools` 双副本曾导致 `reading 'prepare'`（见 `D:\dsh\start-dsh.ps1` 注释），已用 junction 方案修复。模式相同：**profile 插件按旧版 DSH API 构建，宿主升级后字段/方法变更 → undefined 属性访问崩溃**。
