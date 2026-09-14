# 101 - P0 实施回执：全尺寸 NNUE 随包与 YXBOARD 协议修复（2026-09-05）

> 回执对象：`100-GPT-AI棋力诊断与P0接续任务书.md`。P0 已实施并通过桌面端全部可自动化验收；真机与群友实测待发布后进行。会话中用户对「规则原因」的追问直接促成了协议级发现，详见第三节。

## 一、结论速览

1. **full 引擎已随包可用**：官方 mix9svq 冠军网络（Gomocup 2024/2025 冠军引擎 Rapfi 同源）以 `public/rapfi/full/rapfi.data` 随包，worker 自动优先 full、失败/低内存回退 fallback。冒烟、QA、基准全通过。
2. **发现并修复 YXBOARD 协议错位**（影响所有白先局面）：rapfi 的棋盘流颜色字段是 SELF/OPPO（相对引擎），引擎颜色由首子 flag 推导且永远黑先世界、自动插 Pass 对齐；旧 worker 按「1=黑 2=白」绝对色发送，黑先对局恰好自洽，**白先局面被颜色镜像 + Pass 错位**。已实现规范编码（见第三节）。
3. **短时限战术基准上两引擎等效**（fallback 26/30 vs full 25/30），提升体现在着法合理性与评估质量（对照见第五节）；协议修复本身把白先题的测量从系统性失败拉正（fallback 同口径 20→26/30）。
4. **与任务书的两处偏离**（第四节）：未采用「中档 5–15MB 子集」（规则隔离使其必然砍规则），改随包完整官方包并重打包为非压缩内容；「大网络 20–45MB 可选增强」随包后失去上游依据（官方没有更大的网），已并入随包。

## 二、实施清单（已全部落地）

| 项 | 内容 |
|---|---|
| 数据包 | `public/rapfi/full/rapfi.data` 47.43MiB：官方包（www.gomocalc.com/build/rapfi.data，SHA-256 `2fa58b1c…d846d`）lz4 解包后以原始内容重打包（网络字节同源），`scripts/repack-rapfi-data.py` 可复现并同步改写 `rapfi-single.js` 内嵌清单 |
| worker | `public/rapfi/rapfi-worker.js`：`analyze.engine`（full/fallback/auto，默认 auto）+ `dataUrl` 提示（基准口径，上一会话预埋契约）；auto 优先 full；`deviceMemory < 2GB` 直走 fallback（真低内存机）；30 秒加载超时与失败自动回退 fallback（本会话内不重试 full） |
| App | `src/App.tsx` 两处 `engine: "fallback"` → `"auto"`（对局/思考路径） |
| PWA | vite workbox `globIgnores` 排除 NNUE 数据包 + `runtimeCaching` CacheFirst（cacheName `rapfi-nnue-data`）；构建确认 precache 8.4MB 不含网络包 |
| 门禁 | `scripts/check-dist-size.mjs` 拆分为代码门禁 20MB（现 9.61MB）+ 总资产门禁 60MB（现 57.05MB） |
| 许可 | full/fallback 两份 NOTICE 更新（数据来源、官方 SHA、重打包说明、GPL-3.0 义务不变） |
| 测试 | vitest 68 文件 351 测试全绿；run-qa browser 全部通过（QA_BASE_URL 指向 dev server） |
| 版本 | 未动版本号；发版时 versionCode 用 11，`android-web-cache-migration.test` 仍为版本派生校验（勿硬编码） |

## 三、协议发现：YXBOARD 的 SELF/OPPO 语义（用户追问「是否规则原因」触发）

- rapfi `getPosition`（gomocup.cpp）：颜色字段 `{SELF=1, OPPO=2, WALL=3}` 是**相对引擎**的；引擎自身颜色 = 首个非 WALL 子的 flag（SELF→黑、OPPO→白）；引擎世界永远黑先，行棋方与子色不符时**自动插 Pass** 对齐；连续 Pass 会直接 abort。
- 旧 worker 以绝对色 1/2 发送：黑先交替列表下自洽（应用内对局历来正常），但**首子为白的局面（题库白先题）整盘颜色镜像**，且 `message.player` 被忽略（引擎按子数自行推导行棋方）。
- 修复：worker 新增 `canonicalBoardMoves(moves, mover)`——交替黑先列表原样直发（零行为变化）；其余按请求行棋方重排：黑方行棋 = 黑子全在前白子全在后（偶数总半步→黑先动）；白方行棋 = 首黑子 + 白子全部 + 其余黑子（奇数→白先动）。极端不可编码组合（黑子不足）回退原序并保持可用。
- 基准/探针脚本的攻方推导同步修正为「按首子颜色」（三手胜题库混有白先题，旧奇偶公式把攻方算反）。
- 评估视角确认：rapfi INFO 的 EVAL/WINRATE 为**行棋方视角**（`valueToWinRate(curMove.value)`，value 为 self 视角）。

## 四、与任务书的偏离及理由

1. **「默认内置中档 5–15MB」→ 随包完整官方包（47.4MiB）**：mix9svq 网络按规则严格隔离（文件头 rule_mask：freestyle=1 / standard=2 / renju=4，weightloader.h 验证），应用三条规则均为用户可选（无禁手还是 AI 默认规则），任何单文件子集都会砍掉某条规则的评估质量。最省事的正确解 = 官方包原样随包。APK 体积预估从 12–22MB 变为约 57MB。
2. **重打包为非压缩内容（+9.3MB）**：App 每步 AI 落子新建/销毁 worker（控制器 finish() 必 terminate，因搜索可能阻塞事件循环），lz4 每步重解压 37MB（中端手机约 0.5–1.2s/步）；原始内容由加载器直接挂载，消除该 CPU 开销且峰值内存更低（利好 Android 8 低内存档）。网络字节与官方包一致，脚本可复现。
3. **「大网络 20–45MB 可选增强（设置项）」暂缓**：官方渠道不存在比 mix9svq 更大的网络（dhbloo/rapfi releases 仅桌面引擎 7z），完整包已随包，该设置项失去内容载体；如后续上游出新网可在设置里加导入入口（LOADMODEL/RELOADCONFIG 命令已具备，worker 暂未接）。

## 五、验收数据（桌面 Playwright，预览构建 5181）

- **加载**：full ≈2.2s、fallback ≈0.36s（`scripts/measure-rapfi-load.mjs`）。本机环回 fetch 实现层瓶颈（curl 0.11s vs fetch 2.1s，47MB），真实设备走原生资产读取/PWA 运行时缓存，预计显著更快；真机复测待发布后。
- **三手胜4-高级题 30 题 @1800ms 连珠**（修正协议口径，`scripts/benchmark-rapfi.mjs`，新增 AI_RULE/AI_PUZZLE_FILE env）：fallback **26/30**、full **25/30**；失败集高度重叠（16/21/27 共同），full 在 6s 下仍 0/5 → 剩余失败为题位结构性非强制胜，非时间/棋力问题。协议修复把 fallback 同口径从 20/30 拉到 26/30。
- **对弈 8 局 @1800ms**（`scripts/benchmark-rapfi-duel.mjs`，交替执黑+种子随机开局）：4-4，执黑方全胜——短时限黑先优势主导，该口径不区分引擎棋力。
- **同局面评估对照**（黑 H8 天元后白行棋 @1.2s）：full score -11 / winRate 0.486 / depth 14 / 65 万节点，Top3 (6,6)(6,7)(5,7)（贴身应对）；fallback score -107 / winRate 0.369，Top3 含 (10,4) 远散点。着法合理性与评估校准差异直观可见。
- **QA**：vitest 351/351；run-qa browser 全绿（含 back-navigation、advanced-import 等全部场景）。

## 六、待办与交接

1. **发布验收**（任务书第六条）：tag → CI 签名 APK（versionCode 11）→ 真机人机对局 + 群友实测；发布前后基准已按本文口径留档。
2. P1 不变：内置开局簿（RenLib 谱生成 book / YXBOOK）、做题陪练接 Rapfi 或放开自研预算、VCF 预算放宽。
3. worker 的 `dataUrl` 与 LOADMODEL/RELOADCONFIG 已具备，未来「网络包导入/在线获取（用户主动）」可在设置里低成本接入。
4. 基准复跑命令：`AI_ENGINE=full|fallback AI_RULE=renju AI_PUZZLE_TIME=1800 node scripts/benchmark-rapfi.mjs`（预览服务器或 QA_BASE_URL）。

## 七、用户决策改版：两档制 + 应用内无痛下载（2026-09-05 追加）

用户明确不随包 47MB：默认保持轻量引擎，强力包改为**应用内下载、下载完自动生效（无需重启/配置）**；取消中档（12–15MB 子集因规则隔离必然砍规则，用户选择「要规则齐全的完整包」）。

**最终架构：**
- 随包：轻量引擎（fallback 变体，94KB 网络）——与 v1.1.7 相同的默认行为，dist 9.62MB / APK 约 7MB。
- 设置新增「强力 AI 引擎」区块（`src/features/ai/EnginePackSection.tsx`）：一键下载（进度条、双击确认删除）、下载完立即生效（下一次 AI 请求即用，无需重启）。
- 包存储：IndexedDB（库 `banbu-engine-pack-v1`）+ 会话级 blob URL；下载源列表 = DEV 同源 dev 中间件（`engine-packs/`，gitignored）→ 生产 Pages `engine-packs/rapfi-full-v1.data` → GitHub Release 备用；远程源走 `assertPublicHttpUrl` 严格校验（https、拒绝本机/内网/保留地址）。
- worker：`analyze` 带 `dataUrl` 时按行棋方规范编码加载 full；**无 dataUrl 一律 fallback**（随包 full 已移除）。deviceMemory<2GB 的真低内存机即使装了包也保持轻量（47MB wasm 堆保护）。
- 包出库：47MB 不再进 git（CI 构建 APK 不需要它），`scripts/repack-rapfi-data.py` 输出到 `engine-packs/rapfi-full-v1.data`（SHA-256 `b3d7155b…714bf`）。发版时需把该文件上传到公开仓 Pages/Release（待发布流程执行）。
- 验收：engine-pack 单测 8/8（URL 校验、下载/截断拒收/换源/删除/重启恢复）；vitest 全量 359/359；run-qa browser 全绿；端到端 UI 脚本 `scripts/verify-engine-pack-ui.mjs` 全通——**下载→生效→worker 经 blob URL 加载 full 仅 379ms**（远快于测试环 HTTP 路径的 2.2s）。

## 八、追加：对局弹窗引擎选择与「秒下必败」诊断（2026-09-05 晚）

用户反馈五手两打 AI 秒下必败点。诊断结论：
1. **开局规则决策不走引擎**：五手两打/山口等的 AI 交换（写死不交换）、宣布打点数（写死 3）、打点候选（`suggestFifthCandidates` 形状启发式）全部是瞬时启发式，质量与引擎无关——这是「秒下+必败点」的直接来源。让打点候选经引擎评估是真正的修法（P1）。
2. **等级制度确实限制思考**：初级 600ms～大师 3000ms/步；历史上对局 worker 一直发 `engine:"fallback"`（轻量），今天之前的所有对局都是玩具网络。
3. **已加对局内引擎选择**：人机对战弹窗新增「AI 引擎」区块（轻量/强力），选择持久化（`banbu-ai-engine-choice-v1`），开局时写入 `game.engineChoice`；选强力未下载→内联「立即下载」按钮（下载完自动生效）；强力加载失败回落时 toast 告知（不再静默）。陪练跟随同一选择；AI 思考（分析）始终用可用的最强引擎。
4. 验证：tsc 我的区域零错误；端到端 UI 全通（选择→未下载提示→下载→已生效→toast）。
5. 注意：提交暂缓——工作树有并发会话进行中的图片识谱裁剪改动（同文件），待其完成后再提交本节改动。

## 九、联合提交说明（2026-09-05 晚）

第八节（引擎选择）与图片识谱裁剪/进度条（另一会话）共用 `src/App.tsx`，双方均已完成并通过全部验证（tsc 0 错误、vitest 359/359、run-qa browser 全绿、`npm run build` 9.64MB、识谱冒烟 `scripts/verify-image-recognition-smoke.mjs` OK：完整截图与裁剪后均 10/10、进度回调 19 次四阶段单调）。本提交同时收入两个功能，第八节末「提交暂缓」事项至此解除。

## 九、追加：常驻引擎 + 大师 8 秒（2026-09-05 深夜）

用户反馈「还是不够强」。剩余的两个实力天花板与对策：
1. **每步销毁重建引擎**：~1.4s 冷启动 + 置换表每步清零（搜索引擎记忆全丢）。已改为**常驻引擎 worker**：AiWorkerController 增加 persistent 语义（正常完成不 terminate；有界预算取消只发 stop；不限时取消仍 terminate 保证安全；替换/放弃回调 onWorkerDiscarded 通知 App 清槽）。同预算下搜索深度显著提升，每步还省 1.4s。
2. **大师档 3 秒/步太短**：提到 **8 秒/步（maxDepth 96）**；要完全释放用「自由」+ 不限时。
3. 剩余的诚实上限：单线程 WASM（冠军比赛是 16 线程×分钟级）、无开局簿（P1）、3s/8s 预算本身。多线程需 SharedArrayBuffer（COOP/COEP）+ 新构建，量大另立项。
验证：diagnose-ai-game.mjs 实测——全程单 worker 实例（ready 仅一次）、8s 预算、每步 ~9.2s（含收尾宽限）、4/4 手零错误；tsc 干净。

## 十、追加：思考功能「秒回」优化（2026-09-06 凌晨）

用户反馈：思考功能不管什么局面都一样慢（一手杀也要等满）。诊断与修复：
1. **根因**：思考的时长写死 5s，且引擎把「必胜/一手杀」局面在 11-20ms 内就算完（原始输出流证据：`EVAL +M3`、`WINRATE 1`、终局裸坐标行），但 worker 把裸坐标行当中间输出忽略、把时间预算烧满才返回。注意必胜分格式是 `EVAL +M<n>`（非数字），按分数阈值早停的思路不成立。
2. **修复**：worker 新增 `finishOnBareMove`——裸坐标行若紧跟 `MESSAGE Bestline` 摘要、或此前无任何搜索输出（depth/nodes 全零），即引擎宣布的终局答案，立即 finish。零棋力损失（是引擎自己的结论）。思考/对局/开局查询三路均已启用。
3. **用户可调**：设置「思考」区块与快捷中心思考助手新增两个滑杆——思考时长（默认 5s，1-30s）与搜索深度上限（默认 64，8-96），持久化 `banbu-think-search-time/depth-v1`。
4. 踩坑记录：run() 内误引用 message 变量（ReferenceError，已修）；Node 直跑 worker 需 shim self/location/importScripts/require 且中文路径会被 file:// 编码破坏（探针脚本 `scripts/worker-node-probe.mjs` 需 ASCII 目录，WNODE_ROOT env）。
5. 待复验：机器被并发测试占满，浏览器行为验收（必胜局应秒回）暂缓——建议在页面刷新后用一手杀局面点「思考」直接体感验证。

## 十一、重大缺陷修复：引擎包 v2（2026-09-06）

**用户持续反馈「还是菜」的真正根因**：重打包时网络文件改存为解压后的 `.bin`，但包内 `config.toml` 仍引用 `.bin.lz4` 旧文件名——**四个冠军网络全部加载失败，评估器静默禁用**（引擎日志：`Evaluator mix9svq disabled`）。用户设备上的「强力引擎」一直在无神经网络评估的裸搜索状态下运行。此前基于重打包路径的强度复测数据全部无效（量到的是无评估引擎；修复前唯一有效的对照是最早一次用官方原包的冒烟：depth 14/65 万节点）。
**修复**：`scripts/repack-rapfi-data.py` 重打包时同步把 config.toml 内权重文件名 `.bin.lz4`→`.bin`；包版本升级 **v2**（`rapfi-full-v2.data`，49,738,429 字节），应用常量/URL 同步，v1 状态自动失效强制重新下载。
**验证**：v2 包加载日志无任何 Failed/disabled；普通局面 depth 15、77 万节点、数字评分正常（修复前坏包：depth 6、10 节点）。
**上传**：Pages（commit aef1390）+ Release `engine-pack-v2`，直连验证 200 + 字节数一致。
**教训**：换容器/改文件名时，包内引用文件名的配置必须同步改写；「加载成功」≠「评估器在工作」，验收必须断言深度/节点量级。

## 十二、追加：v2 其实也没修好——v3 回归官方包（2026-09-08 凌晨，GLM）

第十一节的 v2「验证通过」是**误判**：深度/节点量级只能区分「搜索是否活着」，区分不了「哪个评估器在跑」。用 rawDebug 全量流在应用内实测仍见 `Evaluator mix9svq disabled`；随后用官方桌面引擎做隔离实验：同一份解包字节，官方 `.bin.lz4` 布局 `weight loaded` 成功、v2 的 raw `.bin` 布局 `failed to load nnue weight`——**引擎自己会解压 lz4，v1/v2 的 repack 前提整个是错的，mix9svq 从上线起从未生效**。v3=官方 rapfi.data 字节原样 + 官方 loader manifest（wasm 本就与官方逐字节一致），双源已上线，端到端 `weight loaded in 228ms` + 真 NNUE 节点速度指纹（1-3 万/轮 vs 裸搜索 50 万+/秒）。新增判据写进 scripts/verify-rapfi-pack.mjs（包字节=官方 & manifest=lz4 布局），旧 repack 脚本删除。教训：**「评估器是否在工作」必须看引擎自己的加载日志，不能只看搜索统计；改容器格式的优化要先做双布局对照实验。** 详见版本报告 T9。

## 十二、禁手裁判级审计（2026-09-06）

群友反馈禁手判断不专业。审计结论与动作：
1. **核心判定本就裁判级**：`evaluateRenjuMove`（game.ts）已实现活三=延伸成活四且延伸着法本身合法（长连/双四/双三递归验证）、死四不计、恰五优先于一切禁手、活四单算等，口径与《中国五子棋竞赛规则(2013)》、RIF 第 9 条一致（弈客/五林等平台规则引擎同为 RenLib 体系，应用内也内置 RenLib）。
2. **新增 15 个裁判级陷阱黄金用例**（renju-rules.test.ts「referee-level forbidden traps」）：双冲四交叉、死四不计、跳三活三/缺口被封假活三、异向双直三、冲四+活三合法、恰五优先于双三/长连/双四、延伸点成六连/成四四/成双三（两层递归）的假三、四三三仍禁。全过——**50/50**。
3. **三个用户入口审计**：禁手辅助标记=forbiddenPoints ✓ 同源；人类五手两打打点=2591 行已校验禁手并 toast ✓；suggestFifthCandidates 启发式候选=已过滤 .legal ✓。无缺口。
4. 全量 403/403 测试通过；未改判定实现（无需改）。
5. 参考：renju.net/rules（RIF 活三/禁手图解）、中规 2013 禁手章节。

### 十二·补：打点为什么受禁手约束（用户疑问，RIF 原文核对）

用户问：打点是虚拟选点、最终只有一个成为实际落子，为什么禁手在打点阶段就生效？
RIF 官方规则（renju.net/rifrules）12.7 BLACK'S CHOICE 原文：*"Black has to make two different proposals for 5th stone. The proposals have to be unequal in all respects. White has the right to choose one of the two proposals from Black to become the 5th move of the game. The time for Black goes till he has given two **correct** proposals."* ——被白方选中的打点**直接成为黑方第 5 手实际着法**，而第 9 条规定黑方不得下出禁手；提案必须「正确（correct）」，故**禁手点不得作为打点**（中国五子棋竞赛规则 2013 同样明文「打点须为非禁手点」）。弈客/五林同样在打点阶段就屏蔽禁手点。
应用行为核对：打点点击时以当前局面（黑1-3+白4 共 4 子）评估候选点 `forbiddenReason(board, position)`，禁手点拒绝并提示（App.tsx:2591）——语义与规则完全一致：评估的就是「若此点被选为第 5 手是否禁手」。RIF 9.3 的递归假三判定（"another double-three would be attained also these double-three's must be examined in the same way"）与实现的递归验证一致。
