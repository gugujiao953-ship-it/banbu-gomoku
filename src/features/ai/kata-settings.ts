/**
 * KataGo 旗舰引擎的**专属设置**（与 rapfi 那套完全分开，切到旗舰才可见/生效）。
 *
 * 为什么走「改写 kata.cfg」这条路：`numSearchThreads`（搜索线程）与
 * `nnCacheSizePowerOfTwo`（搜索缓存）都只在**进程启动时**读配置——GTP 没有
 * 运行时改它们的命令（真机核实过 kata-set-param 只认 maxTime/maxVisits 那几个）。
 * 所以设置变更 = 改写引擎工作目录里的 kata.cfg + 重启引擎进程；重启由 App 注册的
 * handler 负责（先取消在算的请求再停进程，避免在飞请求走进「引擎退出」错误分支）。
 *
 * 两个前提，都在真机/源码里核实过：
 *  1. 插件 prepare() 只在「资产不完整」时重新拷贝——改过的 kata.cfg 不会被覆盖；
 *  2. 原生进程从工作目录按相对路径读 kata.cfg，写进同一路径即生效。
 *
 * **线程键的语义（2026-09-28 改）**：滑杆从此只写 `numSearchThreads`
 * （= 搜索线程，决定同时有多少个 NN 请求在飞、批大小的填充率）。
 * 本包引擎已打补丁解锁这个键（上游源码 setup.cpp:456 曾把它硬编码为 1，
 * 导致 cfg 里写什么都无效、滑杆形同虚设 —— 见 速度根因诊断-2026-09-28.md）。
 * `backendNumThreads`（ORT intra-op 线程）**不再由滑杆写**：实测 4 优于 8
 * （95.6 vs 86.4 访问/秒），固定值写死在 kata.cfg 里，暴露给用户只会更慢。
 *
 * 基线（第一次读到内容时的快照）存 localStorage，「恢复默认」用它还原。
 */
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

export interface KataSettings {
  /** 搜索线程数（cfg: numSearchThreads）—— 真机实测的吞吐主旋钮。 */
  threads: number;
  /** 搜索缓存规模（cfg: nnCacheSizePowerOfTwo，2 的幂）。 */
  cachePower: number;
}

export const KATA_DEFAULT_SETTINGS: KataSettings = { threads: 16, cachePower: 18 };

/**
 * 线程档。真机实测（60s 持续分析、作者网、KZM 测试机）：
 *   4 线程 ≈ 66、8 ≈ 83、16 ≈ 93、24 ≈ 102 访问/秒；
 * 热衰减 16 档最小（-13%），24 档 -20%、32 档反而掉到 62（过载）。
 * 默认取 16：吞吐接近最优、长跑最稳。低端机可下调到 4/8 省电降温。
 */
export const KATA_THREAD_CHOICES = [4, 8, 16, 24] as const;

/** 缓存档（nnCacheSizePowerOfTwo，约 100 字节/项）：2^16≈6MB、2^18≈26MB、2^20≈100MB、
 *  2^22≈400MB、2^24≈1.6GB。上限原为 2^20——用户 10-01 指出「rapfi 的内存滑杆都有 2G，
 *  这怎么才 100M」：两者是不同引擎的不同内存项（rapfi 是内存上限滑杆，这里是 NN 评估
 *  缓存），但 100M 上限确实保守，扩到大机友好的 1.6G；实际占用随缓存填充增长，
 *  低内存机器建议默认档（引擎曾因内存压力被系统回收，见 NativeKataGoPlugin 注释）。
 *  再往上的 3.2G 档**评估后不加**（2026-10-01）：缓存调优历次实测都在噪声内、不是速度
 *  旋钮，而 3.2G 吃内存会让系统极易杀引擎——纯风险零收益（用户同日确认「算了」）。 */
export const KATA_CACHE_CHOICES = [
  { power: 16, label: "小 6M" },
  { power: 18, label: "默认 26M" },
  { power: 20, label: "大 100M" },
  { power: 22, label: "特大 400M" },
  { power: 24, label: "超大 1.6G" },
] as const;

const SETTINGS_KEY = "banbu-kata-settings-v1";
const BASELINE_KEY = "banbu-kata-cfg-baseline-v1";
/** 引擎工作目录（与 NativeKataGoPlugin 的 WORK_DIR_NAME 一致），相对 Directory.Data（= filesDir）。 */
export const KATA_CFG_PATH = "native-katago/kata.cfg";

type Listener = () => void;
const listeners = new Set<Listener>();
let restartHandler: (() => void) | null = null;

const clampThreads = (value: unknown): number => {
  const n = Math.round(Number(value));
  return (KATA_THREAD_CHOICES as readonly number[]).includes(n) ? n : KATA_DEFAULT_SETTINGS.threads;
};
const clampCache = (value: unknown): number => {
  const n = Math.round(Number(value));
  return (KATA_CACHE_CHOICES as readonly { power: number }[]).some((option) => option.power === n)
    ? n
    : KATA_DEFAULT_SETTINGS.cachePower;
};

export const loadKataSettings = (): KataSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...KATA_DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<KataSettings>;
    return { threads: clampThreads(parsed.threads), cachePower: clampCache(parsed.cachePower) };
  } catch {
    return { ...KATA_DEFAULT_SETTINGS };
  }
};

export const isKataDefaultSettings = (settings: KataSettings): boolean =>
  settings.threads === KATA_DEFAULT_SETTINGS.threads && settings.cachePower === KATA_DEFAULT_SETTINGS.cachePower;

/** 订阅设置变化（设置页/分析栏/快捷中心/人机面板共用一份状态）。 */
export const subscribeKataSettings = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** App 注册「设置已变，请重启旗舰引擎」的处理（先取消在算请求，再停进程）。 */
export const setKataRestartHandler = (handler: (() => void) | null): void => {
  restartHandler = handler;
};

/** 请求重启旗舰引擎。给「不进 cfg 的设置变更」用（例如引擎档位切换：它写的是
 *  engine.choice，改完同样必须重启进程才生效）。 */
export const restartKataEngine = (): void => { restartHandler?.(); };

/** 纯函数（可测）：把设置写进 kata.cfg 文本；缺键则补在文件末尾。
 *  只写 numSearchThreads（搜索线程，本包引擎已解锁该键——上游曾硬编码为 1，
 *  cfg 写什么都无效）与缓存两项。
 *  `backendNumThreads`（ORT intra-op 线程）**刻意不写**：实测固定 4 最快
 *  （95.6 vs 8 线程的 86.4 访问/秒），让滑杆去动它只会变慢。 */
export const rewriteKataCfg = (text: string, settings: KataSettings): string => {
  const setKey = (source: string, key: string, value: number) => (
    new RegExp(`^${key}\\s*=.*$`, "m").test(source)
      ? source.replace(new RegExp(`^${key}\\s*=.*$`, "m"), `${key} = ${value}`)
      : `${source.trimEnd()}\n${key} = ${value}\n`
  );
  const withThreads = setKey(text, "numSearchThreads", settings.threads);
  return setKey(withThreads, "nnCacheSizePowerOfTwo", settings.cachePower);
};

const writeCfg = async (content: string): Promise<boolean> => {
  try {
    await Filesystem.writeFile({ path: KATA_CFG_PATH, directory: Directory.Data, data: content, encoding: Encoding.UTF8 });
    return true;
  } catch {
    return false;
  }
};

const readCfg = async (): Promise<string | null> => {
  try {
    const result = await Filesystem.readFile({ path: KATA_CFG_PATH, directory: Directory.Data, encoding: Encoding.UTF8 });
    return typeof result.data === "string" && result.data ? result.data : null;
  } catch {
    return null;
  }
};

/** 应用设置：改写 cfg → 通知重启。返回 false 表示本环境写不了（网页版等）。
 *  cfg 内容没变的调用（重复点同一档、恢复成当前值）不触发重启——旗舰重启要
 *  重新加载模型，用户 09-26 反馈「每次切线程/缓存都重新加载」，空变化跳过。 */
export const applyKataSettings = async (settings: KataSettings): Promise<boolean> => {
  let current = await readCfg();
  if (current === null) {
    // 刚启用旗舰就进设置改参数时，目录可能还没铺好：先催一次 prepare 再读。
    const { prepareNativeKataGo } = await import("./native-engine");
    if (await prepareNativeKataGo()) current = await readCfg();
  }
  if (current === null) return false;
  try {
    if (!localStorage.getItem(BASELINE_KEY)) localStorage.setItem(BASELINE_KEY, current);
  } catch { /* best-effort */ }
  const next = rewriteKataCfg(current, settings);
  const changed = next !== current;
  const ok = await writeCfg(next);
  if (!ok) return false;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* best-effort */ }
  for (const listener of listeners) listener();
  if (changed) restartHandler?.();
  return true;
};

/** 恢复默认：把基线 cfg 写回去（首次读取时快照；没有基线就按默认值改写）。
 *  内容没变（本来就是默认）就不重启，逻辑与 applyKataSettings 一致。 */
export const resetKataSettings = async (): Promise<boolean> => {
  let baseline: string | null = null;
  try { baseline = localStorage.getItem(BASELINE_KEY); } catch { /* best-effort */ }
  if (!baseline) {
    // 没有基线快照：按默认值改写（applyKataSettings 内部自带「没变不重启」）
    return applyKataSettings({ ...KATA_DEFAULT_SETTINGS });
  }
  const current = await readCfg();
  const changed = current !== baseline;
  const ok = await writeCfg(baseline);
  if (!ok) return false;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(KATA_DEFAULT_SETTINGS)); } catch { /* best-effort */ }
  for (const listener of listeners) listener();
  if (changed) restartHandler?.();
  return true;
};
