/**
 * 大模型调试通道（用户 2026-10-09 提议：「能不能加入支持代码调试的功能啊，以后你点击按钮什么的，
 * 要做什么操作什么的，就用后台代码操作就行了…搞一个专门适配大模型调试的模式功能」）。
 *
 * 为什么需要它：改真机上的问题要反复"点按钮 → 截图 → 读状态"，而 adb tap 的坐标基于设备像素，
 * 很容易点偏（实测在 K20 上点了三四次都没点中）；截图又只能看到画面、看不到 DOM/computed style。
 * 于是调试变成人肉试错 —— 这次排查 K20 主题问题就卡在这上面。
 *
 * 做法：在页面里挂一个 `window.__bb`（banbu debug bridge）：
 *   · `__bb.state()`      —— 一次性拿到关键状态（主题、各层 display、关键 CSS 变量、是否 legacy…）
 *   · `__bb.click(text)`  —— 按**可见文字**点按钮（不用猜坐标）
 *   · `__bb.clickSel(sel)`—— 按选择器点
 *   · `__bb.setTheme(id)` —— 直接切主题（等价于点设置里的那一项，但一步到位）
 *   · `__bb.eval(code)`   —— 逃生口：任意表达式求值
 *   · `__bb.log()`        —— 回放最近的控制台错误（真机上 console 不进 logcat）
 *
 * ⚠ 安全边界：**默认不挂载**。只有满足下面任一条件才激活：
 *       ① `localStorage['banbu-debug-bridge'] === 'on'`（用户/调试者显式打开，可在设置里切）
 *       ② URL 带 `?debug=1`（网页版/内部调试）
 *       ③ 原生端 debug 构建（`import.meta.env.DEV`）
 *   发布包里普通用户不触发，桥不会存在 —— 不给"页面内的任意代码执行"开后门。
 *
 * ⚠ 与 Chrome DevTools 协议的关系：那条路（`WebView.setWebContentsDebuggingEnabled` + CDP）
 *   更强，但要改原生代码且只在 debug 包开；本桥**不依赖原生改动**，release 包也能用，
 *   所以两条都留着：原生 CDP 用于深调，本桥用于日常"点一下、读一眼"。
 *
 * ⚠ 2026-10-11：`setTheme` 现在**会检查棋魂解锁**（见那里的注释）——
 *   这条原本是一条"看起来像正常功能、实际绕开收费"的旁路
 *   （`?debug=1` 在正式网页包里就有效，收藏一个链接即可白拿付费主题）。
 */

// 只为主题解锁校验引这两个（`debug-bridge` 原本零依赖，见文件头）：
// 它们都是纯数据/纯存储读取，不会反向引到本模块，所以不构成循环。
import { soulUnlockForTarget } from "./features/progress/soul-unlocks";
import { loadSoulUnlocks } from "./features/progress/soul-shop";

export const DEBUG_BRIDGE_KEY = "banbu-debug-bridge";

export interface DebugBridgeApi {
  state: () => Record<string, unknown>;
  click: (text: string, index?: number) => { ok: boolean; hit?: string; error?: string };
  clickSel: (selector: string) => { ok: boolean; hit?: string; error?: string };
  setTheme: (id: string) => { ok: boolean; error?: string };
  eval: (code: string) => { ok: boolean; value?: unknown; error?: string };
  log: () => string[];
  help: () => string[];
}

const errors: string[] = [];
let installed = false;

/** 该不该挂调试桥（三条激活条件，见文件头）。 */
/**
 * 该不该挂调试桥。四个激活条件，全部**不依赖持久化状态**（这一点是踩出来的）：
 *   ① URL 带 `?debug=1`                        —— 网页版/手动调试
 *   ② `window.__bbDebugBuild === true`         —— 原生（debug 包或带调试的 release 包）在
 *      onCreate 时注入的**一次性全局标记**；
 *   ③ `localStorage['banbu-debug-bridge'] === 'on'` —— 手工打开（网页端调试时用）
 *   ④ dev 构建（`import.meta.env.DEV`）
 *
 * ⚠ 为什么 ② 要取代原来的"原生写 localStorage"：localStorage **持久化在设备上**，
 *   装过一次带调试的包之后，再装干净包它仍然在 ⇒ 干净包也会挂调试桥
 *   （2026-10-09 实测：正式包屏幕底下冒出 DIAG 条）。全局变量随页面进程存在、重启即失效，
 *   永远不会跨版本残留 —— 这正是"临时调试能力"该有的生命周期。
 *   ③ 保留是给网页端用的（那里没有原生可注入标记）。
 */
export const shouldInstallDebugBridge = (): boolean => {
  try {
    if (typeof window === "undefined") return false;
    if (window.location.search.includes("debug=1")) return true;
    if ((window as unknown as { __bbDebugBuild?: boolean }).__bbDebugBuild === true) return true;
    if (localStorage.getItem(DEBUG_BRIDGE_KEY) === "on") return true;
    if (import.meta.env?.DEV) return true;
  } catch { /* 隐私模式等：静默不挂 */ }
  return false;
};

/** 取一个元素的"可读标识"（调试时用来确认点到了谁）。 */
const describe = (el: Element | null): string => {
  if (!el) return "(null)";
  const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 18);
  const cls = (el.className || "").toString().split(/\s+/).slice(0, 2).join(".");
  return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}>${text ? "「" + text + "」" : ""}`;
};

/** 按可见文字找一个可点的元素：先精确匹配，再包含匹配；跳过不可见/被禁用的。 */
const findByText = (text: string, index = 0): Element | null => {
  const wanted = text.trim();
  const all = [...document.querySelectorAll("button, [role=button], a, summary, label, .workspace-action, .dock-panel button")] as HTMLElement[];
  const visible = all.filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0" && !(el as HTMLButtonElement).disabled;
  });
  const norm = (s: string) => s.replace(/\s+/g, "");
  const exact = visible.filter((el) => norm(el.textContent || "") === norm(wanted));
  const partial = visible.filter((el) => norm(el.textContent || "").includes(norm(wanted)));
  const pool = exact.length ? exact : partial;
  return pool[index] ?? null;
};

/** 屏幕诊断条：把关键状态直接画在屏幕底部（真机没有 devtools；WebView 的 console 也不进 logcat，
 *  截图是唯一可靠的观察手段）。**只在调试开关打开时挂**，正式包不出现。
 *  排查 K20 主题问题时它就是靠这个查到 `is/colorMix/dvh: false` 与 `scene: block` 的。 */
export const installDiagOverlay = (): void => {
  if (typeof window === "undefined") return;
  const render = () => {
    try {
      const probe = (p: string, v: string) => { try { return CSS.supports(p, v) as unknown as boolean; } catch { return "throw"; } };
      const g = (sel: string, prop: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop as never] : "无";
      };
      const info = {
        legacy: document.documentElement.classList.contains("legacy-webview"),
        theme: document.documentElement.dataset.theme,
        support: `is=${probe("selector(:is(*))", "")} has=${probe("selector(:has(*))", "")} mix=${probe("color", "color-mix(in srgb, #000 50%, #fff)")} dvh=${probe("height", "100dvh")}`,
        scene: g(".theme-scene", "display"),
        ride: `${g(".ts-ride", "display")} ${g(".ts-ride", "width")}×${g(".ts-ride", "height")}`,
        navBg: g(".bottom-nav", "backgroundColor"),
      };
      let bar = document.querySelector("[data-tempdiag]") as HTMLElement | null;
      if (!bar) {
        bar = document.createElement("pre");
        bar.setAttribute("data-tempdiag", "");
        bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;margin:0;padding:5px;"
          + "background:#000;color:#0f0;font:11px/1.35 monospace;white-space:pre-wrap;word-break:break-all;pointer-events:none";
        (document.body || document.documentElement).appendChild(bar);
      }
      bar.textContent = "DIAG " + JSON.stringify(info);
    } catch { /* 诊断自己出错就算了，绝不影响应用 */ }
  };
  render();
  window.setInterval(render, 1500);
};

export const installDebugBridge = (): DebugBridgeApi | null => {
  if (installed || typeof window === "undefined") return null;
  installed = true;

  /* 顺手把控制台错误收进环形缓冲：真机上 console 不进 logcat，出错只能靠这个看回来。 */
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    try { errors.push(args.map((a) => String(a)).join(" ").slice(0, 300)); if (errors.length > 40) errors.shift(); } catch { /* ignore */ }
    origError(...(args as []));
  };
  window.addEventListener("error", (e) => {
    try { errors.push("onerror: " + (e.message || "") + " @ " + (e.filename || "").split("/").pop() + ":" + e.lineno); if (errors.length > 40) errors.shift(); } catch { /* ignore */ }
  });

  const api: DebugBridgeApi = {
    state: () => {
      const g = (sel: string, prop: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop as never] : null;
      };
      const root = getComputedStyle(document.documentElement);
      const supports = (p: string, v: string) => { try { return CSS.supports(p, v); } catch { return "throw"; } };
      return {
        theme: document.documentElement.dataset.theme,
        themeMotion: document.documentElement.dataset.themeMotion,
        motion: document.documentElement.dataset.motion,
        legacy: document.documentElement.classList.contains("legacy-webview"),
        native: document.documentElement.dataset.native,
        supports: {
          is: supports("selector(:is(*))", ""),
          has: supports("selector(:has(*))", ""),
          colorMix: supports("color", "color-mix(in srgb, #000 50%, #fff)"),
          dvh: supports("height", "100dvh"),
        },
        layers: {
          scene: g(".theme-scene", "display"),
          far: g(".ts-far", "backgroundImage"),
          mid: g(".ts-mid", "display"),
          near: g(".ts-near", "display"),
          parts: g(".ts-parts", "display"),
          partsCount: document.querySelectorAll(".ts-parts i").length,
          partsAnim: g(".ts-parts i", "animationName"),
          ride: g(".ts-ride", "display"),
        },
        css: {
          paper: root.getPropertyValue("--paper").trim(),
          surface: root.getPropertyValue("--surface").trim(),
          actionOpacity: root.getPropertyValue("--action-opacity").trim(),
          navBg: g(".bottom-nav", "backgroundColor"),
        },
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      };
    },
    click: (text, index = 0) => {
      const el = findByText(text, index);
      if (!el) return { ok: false, error: `找不到可见且可点的「${text}」` };
      const desc = describe(el);
      (el as HTMLElement).click();
      return { ok: true, hit: desc };
    },
    clickSel: (selector) => {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, error: `选择器无命中：${selector}` };
      const desc = describe(el);
      (el as HTMLElement).click();
      return { ok: true, hit: desc };
    },
    /**
     * 切主题偏好（写完刷新生效）。
     *
     * ⚠ 2026-10-11：这里**只允许切「本来就能用」的主题**。
     *
     * 上一版是无条件 `localStorage.setItem("banbu-theme-preference-v1", id)` ——
     * 而这条路径**绕过了棋魂解锁**：`?debug=1` 在正式网页包里也有效
     * （`shouldInstallDebugBridge` 的第 ① 条不依赖 dev 构建），所以
     * "收藏夹里存一个 ?debug=1 的链接"就能白拿任意付费主题。
     * 这与桥自己的说明（"等价于点设置里的那一项"）也不符 —— 设置里那一项是要钱的。
     *
     * 现在的口径：免费主题 + **已购**主题可以切；没买的返回一条明确的失败，
     * 告诉调用方"这是付费项"。这样调试（本桥的主要用途是改真机问题）不受影响，
     * 而它不再是一条白拿通道。
     *
     * `__bb.eval` 仍然是逃生口 —— 但那是**任意代码执行**，本来就不该被当成
     * "产品不收钱"的判据（能跑 eval 的人也不需要走这条路）。这一条修的是
     * "看起来像正常功能、实际绕开收费"的那种旁路。
     */
    setTheme: (id) => {
      try {
        const item = soulUnlockForTarget("theme", id);
        // 直接读盘而不是用商店的订阅快照：这里是**一次性的命令**（调试桥不是 React 树），
        // 读盘最不容易拿到旧值。`loadSoulUnlocks` 顺带会跑"老用户在用即赠送"的迁移。
        const unlocked = !item || item.cost <= 0 || loadSoulUnlocks().has(item.id);
        if (!unlocked) {
          return { ok: false, error: `「${item?.title ?? id}」是付费主题（${item?.cost ?? "?"} 棋魂），未解锁；请在设置的棋魂商店里购买。` };
        }
        localStorage.setItem("banbu-theme-preference-v1", id);
        return { ok: true };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
    eval: (code) => {
      try { return { ok: true, value: (0, eval)(code) }; } catch (e) { return { ok: false, error: String(e) }; }
    },
    log: () => [...errors],
    help: () => [
      "__bb.state()          — 关键状态（主题/各层 display/支持特性/CSS 变量）",
      "__bb.click('文字')    — 按可见文字点按钮（可加 index 选第几个）",
      "__bb.clickSel('sel')  — 按选择器点",
      "__bb.setTheme('plum') — 写主题偏好（刷新后生效）",
      "__bb.eval('代码')     — 任意表达式求值",
      "__bb.log()            — 最近的控制台错误",
    ],
  };
  (window as unknown as { __bb: DebugBridgeApi }).__bb = api;
  return api;
};
