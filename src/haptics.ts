import type { SoundCue } from "./audio-engine";

/**
 * 触觉反馈（用户 09-17 要求，默认关闭）。
 *
 * 接线点是 App 里唯一的 `playSound`——落子、导航、警告、胜负全都经过它，所以震动
 * 节奏直接按音效 cue 一一对应，不必在几十处落子分支里各插一行（那些分支还会继续增加）。
 *
 * ⚠ 2026-09-28 真机实测推翻了这个文件的原始前提。原先只写 `navigator.vibrate`，注释里
 * 的判断是「安卓 WebView 原生支持，不需要新增 Capacitor 插件」——**错的**：WebView 把震动
 * 委托给宿主应用的 `WebChromeClient.onVibrate()`，而 Capacitor 的 BridgeWebChromeClient
 * 没有实现它（整个 com/getcapacitor 里 grep onVibrate 零命中），应用里也没有任何补过的地方。
 * 于是这条 API 在应用内永远是静默无操作，部分版本甚至返回 true，连"失败"都看不出来——
 * 用户看到的就是「开关开了、什么感觉都没有」。另外清单里此前连
 * `android.permission.VIBRATE` 都没有，走原生也会被 SecurityException 挡。
 *
 * 现在的通道优先级：**原生插件 NativeHaptics（应用内唯一真能震的）→ navigator.vibrate（网页版）**。
 * 桌面浏览器与 iOS Safari 没有 vibrate，静默降级成「什么都不发生」，绝不因为震动不可用
 * 而中断落子主流程。
 *
 * 节奏刻意都很短（6–22ms）：打谱是连续操作，长震动会变成干扰而不是反馈。
 */
export const HAPTIC_PATTERNS: Readonly<Record<SoundCue, number | number[]>> = {
  // 落子：轻点一下，黑白同感——用震动区分黑白没有意义（用户分不出 12ms 与 14ms）。
  "move-black": 12,
  "move-white": 12,
  // 导航：比落子更轻，连续按也不会累。
  navigate: 6,
  // 成功：两下轻快的「哒-哒」。
  success: [14, 40, 22],
  // 警告（含禁手）：短促双震，摸起来就知道"这一下没落下去"。
  warning: [10, 60, 10],
  // 错误/败着：三下更重的震。
  error: [22, 70, 22, 70, 22],
};

/** 安卓侧那套桥（HapticsPlugin.java）。桥是注入进来的，注册可能晚于首帧，
 * 因此每次调用现取、不做一次性缓存（与 native-engine / pip 那套同样的处理）。 */
type NativeHapticsApi = {
  vibrate: (options: { pattern?: number[]; duration?: number }) => Promise<unknown>;
  supported?: () => Promise<{ hasVibrator?: boolean }>;
};

const nativeHapticsApi = (): NativeHapticsApi | null => {
  const holder = (globalThis as {
    Capacitor?: { Plugins?: Record<string, Partial<NativeHapticsApi> | undefined> };
  }).Capacitor;
  const api = holder?.Plugins?.NativeHaptics;
  return api && typeof api.vibrate === "function" ? (api as NativeHapticsApi) : null;
};

/** 当前可用的触觉通道。真机排查时在 chrome://inspect 里读 `__banbuHaptics` 就能分清
 * 「插件没注册上」「设备没马达」「开关没开」这三种"没震动"。 */
export const hapticsRoute = (): { native: boolean; web: boolean } => ({
  native: Boolean(nativeHapticsApi()),
  web: typeof navigator !== "undefined" && typeof navigator.vibrate === "function",
});

const reportRoute = () => {
  const route = hapticsRoute();
  (globalThis as { __banbuHaptics?: { native: boolean; web: boolean } }).__banbuHaptics = route;
  return route;
};

export const hapticsSupported = (): boolean => {
  const route = reportRoute();
  return route.native || route.web;
};

const asPattern = (cue: SoundCue): number[] => {
  const pattern = HAPTIC_PATTERNS[cue];
  return Array.isArray(pattern) ? pattern : [pattern];
};

/** 走一条毫秒级震动（拖拽吸附这类不进音效 cue 的场合用）。关闭或没有通道时返回 false，绝不抛错。 */
export const playHapticMs = (ms: number, enabled: boolean): boolean => {
  if (!enabled || !(ms > 0)) return false;
  const api = nativeHapticsApi();
  if (api) {
    // playSound 的调用点全在同步回调里（落子、警告），这里只发不等；
    // 失败（无马达/系统拒绝）静默降级，绝不让一次震动打断主流程。
    void api.vibrate({ duration: Math.round(ms) }).catch(() => undefined);
    return true;
  }
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(ms) !== false;
  } catch {
    return false;
  }
};

/** 播一条触觉反馈。关闭、平台不支持、或被系统拒绝时都返回 false，且绝不抛错。 */
export const playHapticCue = (cue: SoundCue, enabled: boolean): boolean => {
  if (!enabled) return false;
  const api = nativeHapticsApi();
  if (api) {
    reportRoute();
    void api.vibrate({ pattern: asPattern(cue) }).catch(() => undefined);
    return true;
  }
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    reportRoute();
    return false;
  }
  try {
    return navigator.vibrate(HAPTIC_PATTERNS[cue]) !== false;
  } catch {
    return false;
  }
};
