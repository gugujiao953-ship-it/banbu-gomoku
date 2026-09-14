# 100 - AI 棋力诊断结论与 P0 接续任务书（2026-09-05）

> 本文档是会话交接件：上一会话完成 v1.1.7 修复版发布与宣传站部署后，诊断了群反馈「人机定式走不好、简单题解不开」，**P0 修复未实施**，由下一会话接续。持久记忆同款摘要见 memory/ai-strength-p0-handoff.md（新会话自动可读）。

## 一、诊断结论（证据齐全，可直接复验）

1. **引擎身份**：Rapfi（gomocalc 移植版，Gomocup 2024/2025 冠军引擎同源）。Worker：`public/rapfi/rapfi-worker.js`。
2. **永远只用 fallback 变体**：worker ≈265 行 `const preferred = "fallback"`；`full/` 从未被加载，且 full/ 没有 .data（NOTICE 自述设计为在线拉网络，与"本地运行不第三方下载"的隐私承诺冲突而闲置）。
3. **NNUE 权重仅 92KB**：`public/rapfi/fallback/rapfi.data` = 94,776 字节（玩具级；冠军级网络为几 MB～几十 MB）。**这是棋力不足的最大单一因素。**
4. **无开局簿/定式库**：worker 协议面只有 `START / INFO RULE / TIMEOUT_TURN / MAX_DEPTH / YXNBEST / YXSTOP`，全局无 book 代码 → 「定式都走不好」的直接原因。
5. **做题线不用 Rapfi**：`src/puzzle-ai.ts` 用自研 α-β（`src/renju-ai/engine`，≈7 层/900ms）；VCF 上限 5 次进攻/450ms/3 万节点 → 「简单题解不开」来源。
6. **强度档位**：`src/App.tsx` `AI_STRENGTH_PROFILES`（≈153 行）：初级 600ms/中级 1200/高级 1800/大师 3000，单线程 WASM；人机默认「高级」。

## 二、P0 任务书（下一会话实施）

1. **换全尺寸 NNUE 网络**：从 dhbloo/rapfi / gomocalc 官方渠道取网络文件。**默认内置中档 5–15MB**（APK 7.1MB → 约 12–22MB），大网络 20–45MB 作可选增强（设置里"完整网络包"）。
2. **加载顺序**：优先 `full/`（现代构建），fallback 仅旧 WebView；full 需把 .data 随包（不走在线下载，守隐私承诺）。
3. **PWA 缓存约束**：网络文件**不得进 precache**（dist 20MB 门禁在 `scripts/check-dist-size.mjs`，现 9.6MB）——改运行时缓存或拆分"代码门禁/资产门禁"。
4. **兼容约束**：Android 8 / WebView 83 内存目标 → 两档制，低端机走内置中档。
5. **许可**：Rapfi 为 GPL-3.0，NOTICE.txt 已写明随分发提供对应源码与许可；换网络后同步更新 NOTICE 与许可声明。
6. 验收：真机人机对局 + 群友棋友实测；AI 强度基准（docs/ai-strength-benchmark-*.md 系列口径）发布前后各跑一次。

P1（P0 后）：内置开局簿（用 RenLib 定式谱/大谱生成 book，协议加 YXBOOK 或应用层查谱）；做题陪练/解题主线接 Rapfi 或放开自研引擎预算；VCF 预算放宽（>5 手、>450ms）。

## 三、当前发布状态（无需重做）

- v1.1.7 修复版已发布：应用内版本号=1.1.7（diagnostics/App.tsx 三处）、做题规则与思考速度选中态=实心绿底白字、思考速度默认"快"且置左（提交 553459e、eab48af；tag v1.1.7=833adc5 私有/60fd221 公开）。
- 最新 APK SHA-256 = `4FBEBCAA0AE8605867083D6D5C5C3B75666902BEB1883AC5F80A0A4E2C5E026A`（旧 5AA87FC9 作废）；公开 Release 资产已替换；本地归档 artifacts/releases/1.1.7/ 同步。
- 公开仓库 banbu-gomoku main=e3ffc60 **整树对齐 src v1.1.7**（326 文件，审计无密钥/无内部目录）；Pages 站点已上线（含 #release 更新区 + 百度 f7x2/蓝奏 66jr 下载入口）。
- QA：vitest src 66 文件全绿、run-qa browser 20/20；`android-web-cache-migration.test.ts` 已改为版本派生校验，**勿再硬编码版本号**。

## 四、会话操作坑

- git/gh 推送走代理 `http://127.0.0.1:7897`；gh 用 HTTPS_PROXY env。
- Mimosa 钩子：禁止 bash 写源码（用 Write/Edit）；禁止命令串含字面 `src/` 的检出——公开仓库同步用整树 `git checkout FETCH_HEAD -- .`。
- 5173 为并发会话 dev server，自测开独立端口；Vite 绑 localhost/[::1]；`run-qa.mjs browser` 自动带 `?qa=1`，单跑 QA 脚本须自行注入 `banbu-first-run-welcome-v1`。
- Android versionCode 已用到 10，下一版 11。
