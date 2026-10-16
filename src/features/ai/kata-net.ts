/**
 * 旗舰引擎的**按规则换网**（用户 2026-10-12：「那我们的小网在有禁手的时候会有影响吗」
 * → 查下来有影响的是无禁手那一侧，见下）。
 *
 * ## 背景：一个档位原来只有一张网
 *
 * 自带档（ONNX 小网）随包分发的是 b10c128 蒸馏网，从前只有**连珠（有禁手）**那一份
 * （官方 Gomocup 包 `pbrain-katagomo_r15.zip` 里的 `default_model.bin.gz`，网名
 * `gom_distill-b10c128nbt_renjudistill-*`）。而 worker 每局还会发
 * `kata-set-rule basicrule renju|standard|freestyle` —— 规则换了，网没换。
 *
 * 后果不是"不能下"，是**黑方棋力被压一截**：r15 网训练在"黑双三/双四/长连非法"的世界里，
 * 它的价值头把黑方双三进攻看成走不通、策略头也不爱往那些点排。自由规则下双三双四恰是
 * 黑方最凶的杀法，于是 AI 执黑时进攻评价偏保守、可能漏掉最快胜法（白方两种规则下都没有
 * 禁手，受影响小得多）。
 *
 * ## 现在：两张网，按规则挑
 *
 * 新增 f15 那份（同架构、同为 3.2MB，转换流水线逐字节复现过，见改造表 R171）：
 *   · **连珠（renju）→ r15**（`distill-fp16.onnx`）
 *   · **freestyle / standard → f15**（`distill-freestyle-fp16.onnx`）
 * standard 与 freestyle 只差"长连是否算胜"（见 `rapfi-worker.js` 的 `kataRuleName`），
 * 这里共用 f15 是刻意的近似；真要精确得再补一份 s15（+3.2MB），需要时再加。
 *
 * ## 为什么必须重启进程
 *
 * 网是**启动参数** `-model <file>`，KataGo 没有运行期换网的 GTP 命令。所以规则类别一变，
 * 唯一办法是：写规则贴纸（原生侧决定下一次 spawn 用哪张）→ **停进程**。
 * 走的是与「线程/缓存设置变更」「档位切换」完全同一条链路：只停不启，
 * 等用户下一次真的要分析时才按新网加载 —— 停是毫秒级的，加载的等待挪到真正要用的时候。
 *
 * 代价与边界都如实说：切规则类别（有禁 ↔ 无禁）会让当前在算的分析中止、下次重新加载
 * 一次模型（几十秒级的首启，之后同一规则内不再发生）。同一规则内来回切换**不触发任何
 * 东西**（`appliedRule` 没变就直接返回）。
 */
import type { RuleSet } from "../../types";
import { nativeKataRule, probeNativeKataGo, setNativeKataRule } from "./native-engine";
import { restartKataEngine } from "./kata-settings";

/** 网的两个类别（与原生 `engine.rule` 贴纸的两个取值一一对应）。 */
export type KataNetRule = "renju" | "freestyle";

/** 规则 → 该用哪张网（**纯函数，可测**）。
 *  只有连珠要 r15；freestyle 与 standard 都落 f15（理由见文件头那段）。 */
export const kataNetRuleForRule = (rule: RuleSet): KataNetRule => (rule === "renju" ? "renju" : "freestyle");

/** 本次会话里**当前已生效**的网类别（原生侧贴纸的镜像）。
 *  `null` = 还没问过原生侧（首次用到时才去探测，避免每次分析都多一次 bridge 往返）。 */
let appliedRule: KataNetRule | null = null;

/** 测试用：清掉会话内缓存（生产的调用方不需要它）。 */
export const resetKataNetStateForTest = (): void => { appliedRule = null; };

/**
 * 让引擎的网与当前规则一致。**没变什么都不做**；变了才写贴纸 + 停进程。
 *
 * 返回 `true` = 这次触发了一次重启（调用方一般不需要区分，给单测与诊断用）。
 *
 * ⚠ 首次调用会 `await probeNativeKataGo()`：**必须问过原生侧**才知道设备上贴纸当前是哪一张。
 *   若拿默认值（"renju"）硬比，就会出现「上次会话最后看的是无禁手文档 → 贴纸是 freestyle
 *   → 这次开连珠文档却被当成没变、沿用 f15 网」这类静默错配。探测本身有缓存，只付一次。
 *   返回 null（网页版 / 没有原生插件）⇒ 不涉及换网，直接放过。
 */
export const ensureKataNetForRule = async (rule: RuleSet): Promise<boolean> => {
  const want = kataNetRuleForRule(rule);
  if (appliedRule === null) {
    const probe = await probeNativeKataGo();
    if (!probe) return false;
    // 以原生 check() 报回的贴纸为准；探到的值顺手同步给 native-engine 的同步读法。
    appliedRule = nativeKataRule().rule === "freestyle" ? "freestyle" : "renju";
  }
  if (appliedRule === want) return false;
  if (!(await setNativeKataRule(want))) return false;
  appliedRule = want;
  restartKataEngine();
  return true;
};
