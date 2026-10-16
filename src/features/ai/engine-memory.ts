/**
 * 引擎内存档的**纯决策**（2026-10-11 从 `App.tsx` 提出来）。
 *
 * ## 为什么要单独一个模块
 *
 * 用户报「电脑网页版人机对战总是显示『AI 引擎未能分配内存…一直报错』」，
 * 根因是**一个"设了状态但没人读"的 bug**：
 *
 * ```
 * // 失败时把降级值记下来
 * gameMemoryRetryRef.current = 256;
 * // 然后重试 ⇒ 但发出去的还是原高档值，因为那条 postMessage 没读这个 ref
 * maxMemoryMb: engineMemoryMbFor(engineChoice, settings.analysisMaxMemoryMb)
 * ```
 *
 * 后果：每一手都走一遍"失败 → 记 256 → 重试（仍高档）→ 再失败 → 换兜底"，
 * 于是用户看到"一直报错"，而该降的档位**永远降不下去**。
 *
 * 这类 bug 类型系统抓不到、代码读起来也完全正常，原来的测试也照不出来
 * （它们只验"要不要重试"，不验"重试时用了什么值"）。所以把这条决策收成
 * 这个模块的纯函数 + 单测：**"这次发多少内存"只有一个正确写法**。
 *
 * 放在这里的另一个好处是能脱离 `App.tsx` 单测 —— 那个文件一万多行、
 * import 进来会拖一堆副作用，为一个内存计算去引它不划算。
 */

/** 引擎档位（与 `App.tsx` 的同名类型一致；那边是本地声明，这里自带一份等价定义，
 *  避免这个纯计算模块反倒去依赖一万行的 App）。 */
export type EngineMemoryChoice = "light" | "strong" | "tuned" | "kata" | "ikatago";

/** 降级用的常量：内存分配失败后退到这一档（对局与分析共用同一个语义）。 */
export const MEMORY_RETRY_MB = 256;

/** 内存档的下限与默认值（与设置滑杆一致：64 起、默认 128）。 */
export const MIN_MEMORY_MB = 64;
export const DEFAULT_MEMORY_MB = 128;

/**
 * 用户档位 → 实际下发给引擎的内存（MB）。`undefined` = 不下发
 * （worker 按设备自动分档）。
 *
 * 三条口径：
 *  · **兜底档（`light`）与旗舰档（`kata`）不接内存档**：前者是内置轻量引擎、
 *    后者内存由 `kata.cfg` 的 `nnCacheSizePowerOfTwo` 自管 ——
 *    `INFO MAX_MEMORY` 是 Rapfi 专属命令，发给它们没有意义；
 *  · **上限按设备内存钳制**（2GB→256、4GB→512、8GB→1024、更高→2048）：
 *    2048 在低内存机上会分配失败、引擎直接退出；
 *  · 坏值（NaN/负数/0）回落到默认 128，低于下限的抬到 64。
 */
export const engineMemoryMbFor = (choice: EngineMemoryChoice, sliderMb: number): number | undefined => {
  if (choice === "light" || choice === "kata") return undefined;
  const ram = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cap = ram <= 2 ? 256 : ram <= 4 ? 512 : ram <= 8 ? 1024 : 2048;
  const wanted = Math.round(sliderMb);
  return Math.min(Number.isFinite(wanted) && wanted > 0 ? Math.max(MIN_MEMORY_MB, wanted) : DEFAULT_MEMORY_MB, cap);
};

/**
 * **这次 analyze 到底该发多少内存**。
 *
 * ⚠ **降级值优先于用户档位** —— 这一条就是上面那个 bug 的回归锁：
 * 调用方必须把"已降级到多少"传进来，不许自己去读用户档位。
 * 两个调用点（对局 `requestStrongAiMove` / 分析 `startThink`）都走这个函数。
 */
export const resolveAnalyzeMemoryMb = (
  choice: EngineMemoryChoice,
  sliderMb: number,
  retryMb: number | null,
): number | undefined => retryMb ?? engineMemoryMbFor(choice, sliderMb);

/**
 * 该不该走"降一档再试一次"（而不是直接换兜底引擎）。
 *
 * · 已经降过一次（`retryMb !== null`）⇒ **不再降**（否则会无限重试）；
 * · 兜底/旗舰档没有内存档 ⇒ 不降（它们不吃 `MAX_MEMORY`）；
 * · 只有"实实在在高于降级档"才值得降 —— 判据用**钳制之后的实际值**，
 *   不是滑杆原值（一台 2GB 的机器上滑杆写着 2048、实际只会发 256，
 *   那种情况降级没有意义）。
 */
export const shouldRetryWithLowerMemory = (
  choice: EngineMemoryChoice,
  sliderMb: number,
  retryMb: number | null,
): boolean => {
  if (retryMb !== null) return false;
  const used = engineMemoryMbFor(choice, sliderMb) ?? 0;
  return used > MEMORY_RETRY_MB;
};
