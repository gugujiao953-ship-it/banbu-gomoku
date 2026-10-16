/**
 * 引擎线程档位（安卓原生引擎生效）。
 *
 * 用户 2026-09-15 问「五子棋计算器里面有 1-12 核，我们这是多少的」——所以档位要按设备
 * **实际**核心数生成，并且把核心数写进文案，而不是给一组写死的 4/8。
 *
 * 有意不做超发（不像某些网页引擎让你选到 12 而设备只有 8 核）：worker 侧
 * `threadCountFor()` 会把请求夹到 `navigator.hardwareConcurrency`，写死档位只会让用户
 * 选了一个看起来更高、实际被夹回去的值。「全核」用 -1 表示**跟随设备**，换设备也成立。
 */
export const engineCores = (): number => {
  const reported = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
  return Number.isFinite(reported) && reported > 0 ? Math.max(1, Math.round(reported)) : 4;
};

export const autoEngineThreads = (cores: number): number => Math.max(1, Math.round(cores / 2));

export type EngineThreadOption = readonly [string, string];

/** 选项值：0 = 自动（一半核心）、-2 = 大核（只铺大核）、-1 = 全核（跟随设备）、正数 = 指定线程数。 */
export const engineThreadOptions = (cores: number = engineCores(), bigCores: number = cores): EngineThreadOption[] => {
  if (cores <= 1) return [["0", "自动"]];
  // 小于核心数的常见档位；等于核心数的那档交给「全核」，避免同一数字两个选项。
  const presets = [1, 2, 4, 6, 8].filter((count) => count < cores);
  return [
    ["0", `自动（一半核心 = ${autoEngineThreads(cores)}）`],
    ...presets.map((count) => (count === 1 ? ["1", "1 线程（省电）"] : [String(count), `${count} 线程`]) as EngineThreadOption),
    ...bigCoreOption(cores, bigCores),
    ["-1", `全核（${cores} 核）`],
  ];
};

/** 大小核机器才有意义的那一档（bigCores 由原生插件读 cpufreq 得出；同构机器不出现）。 */
const bigCoreOption = (cores: number, bigCores: number): EngineThreadOption[] =>
  Number.isFinite(bigCores) && bigCores > 0 && bigCores < cores ? [["-2", `大核（${bigCores} 核）`]] : [];

/** 行文案里带上本机核心数，用户一眼能看到「我们这是多少」。
 *
 * 大小核也要说清楚（手机多是 4 大 + 4 小）：Lazy SMP 的每一层迭代会被最慢的线程拖住，
 * 所以「全核」可能反而比「按大核数」慢——引擎不知道核心类型，只能靠这里的提示让用户
 * 先按大核数试。bigCores 由原生插件读 cpufreq 得出（读不到就等于核心数 = 同构）。
 * 09-17 起不再只是「提示」：大小核机器上会直接多一个「大核（N 核）」档可点（值 -2）。 */
export const engineThreadHint = (nativeReady: boolean, cores: number = engineCores(), bigCores: number = cores): string => {
  if (!nativeReady) {
    return `网页版 wasm 多线程的线程数（需在「多线程引擎」里开启）：自动 = 一半核心；全核最热，笔记本风扇会明显转`;
  }
  const topology = bigCores < cores ? `本机 ${cores} 核（${bigCores} 大核 + ${cores - bigCores} 小核）` : `本机 ${cores} 核`;
  const advice = bigCores < cores
    ? `：原生引擎用几个线程（原生是真线程、不需要跨源隔离）。大小核机器上「全核」会把线程铺到小核，迭代可能被小核拖慢——**先试「大核（${bigCores} 核）」那一档，再对比全核**；要省电降温选 1 线程`
    : `：原生引擎用几个线程（原生是真线程、不需要跨源隔离）。自动 = 一半核心，全核最快也最热，要省电降温选 1 线程`;
  return `${topology}${advice}`;
};

/** 紧凑档位（分析栏第二行用）：那一行要同时放「多线程 / 线程数 / 内存」三格，
 *  「自动（一半核心 = 6）」这种写法会把整行撑到换行。设置页与快捷中心空间充裕，仍用完整写法。 */
export const engineThreadOptionsCompact = (cores: number = engineCores(), bigCores: number = cores): EngineThreadOption[] => {
  if (cores <= 1) return [["0", "自动"]];
  const presets = [1, 2, 4, 6, 8].filter((count) => count < cores);
  return [
    ["0", "自动"],
    ...presets.map((count) => (count === 1 ? ["1", "1 线程"] : [String(count), `${count} 线程`]) as EngineThreadOption),
    ...bigCoreOption(cores, bigCores),
    ["-1", `全核（${cores} 核）`],
  ];
};