/**
 * 系统栏（状态栏 / 导航栏）控制：**全屏模式**与图标深浅。
 *
 * 两种模式（原生侧 `SystemBarsPlugin` 是唯一实现）：
 * - 全屏**关**（默认）：什么都不接管，系统自己给状态栏/导航栏留位，网页层从它们下面开始画
 *   —— 顶栏完整可见可点（用户 2026-10-14：「就之前那样挺好的」）。
 * - 全屏**开**：内容顶到屏幕物理顶部 + **隐藏状态栏**，并由原生把 `WindowInsets` 的
 *   真实内缩写成 CSS 变量 `--safe-area-top/bottom`（安卓 WebView 的 `env(safe-area-inset-*)`
 *   恒为 0，靠它补不出安全区，那正是上一轮把顶栏压进摄像头那一行的原因）。
 *
 * 插件按本项目惯例**鸭子类型**取（见 `features/ai/native-engine.ts` 同款写法），
 * 网页版 / 测试环境拿不到就是空操作。
 */

interface SystemBarsPlugin { setStyle?: (data: { enabled: boolean; dark: boolean }) => Promise<unknown> }

const bridge = () => (globalThis as {
  Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean; Plugins?: Record<string, SystemBarsPlugin> };
}).Capacitor;

const plugin = (): SystemBarsPlugin | null => {
  const cap = bridge();
  if (!cap) return null;
  if (cap.isNativePlatform && !cap.isNativePlatform()) return null;
  return cap.Plugins?.SystemBars ?? null;
};

let lastApplied: { enabled: boolean; dark: boolean } | null = null;

/** 只在值真的变了时才发（主题切换、开关来回拨都会反复调这里）。 */
export const applySystemBars = (enabled: boolean, dark: boolean): void => {
  if (lastApplied && lastApplied.enabled === enabled && lastApplied.dark === dark) return;
  const target = plugin();
  if (!target?.setStyle) return;
  lastApplied = { enabled, dark };
  void target.setStyle({ enabled, dark }).catch(() => { lastApplied = null; });
};

/** 测试用：清掉"上一次设了什么"的记忆。 */
export const resetSystemBarsCache = (): void => { lastApplied = null; };
