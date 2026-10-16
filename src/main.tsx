import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import './styles.css';
import './library.css';
import './design-tokens.css';
import './legacy-webview.css';
import './themes/themes.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './ui/overlays/overlays.css';
import './ui/overlays/overlay-art.css';
import './ui/overlays/engine-switch-overlay.css';
import './ui/overlays/native-overlays.css';
/* ⚠ 必须放在**最后**：这一层负责覆盖各处的按钮底色（功能区按钮透明度）。
   既有规则里有 `background: var(--surface) !important` 这种简写+important
   （见 features/workspace/action-layout.css），同强度下靠"加载更晚"取胜。 */
import './action-opacity.css';
import { applyWebViewCompatibilityClass, applyFlexGapCompatibilityClass } from './webview-compat';
import { installDebugBridge, shouldInstallDebugBridge, installDiagOverlay } from './debug-bridge';

const themePreview = new URLSearchParams(window.location.search).has('theme-preview');
applyWebViewCompatibilityClass(document.documentElement);
applyFlexGapCompatibilityClass(document.documentElement);
/* Chrome 79 drops rules whose selector contains :has(). Mirror the handful of
   screen-presence queries used for top-level chrome as ordinary root classes,
   so navigation still switches correctly while a sheet/screen is mounted. */
const syncLegacyScreenState = () => {
  const root = document.documentElement;
  root.classList.toggle("duel-screen-active", Boolean(document.querySelector("[data-duel-screen]")));
  root.classList.toggle("vcf-screen-active", Boolean(document.querySelector(".vcfch-page")));
};
syncLegacyScreenState();
if (document.body) new MutationObserver(syncLegacyScreenState).observe(document.body, { childList: true, subtree: true });
/* 大模型调试通道（用户 2026-10-09 提议「搞一个专门适配大模型调试的模式功能」）：
   满足条件才挂 window.__bb 与屏幕诊断条，用来"后台代码点按钮 / 读状态"，省掉 adb 点屏幕的试错。
   发布包默认**都不挂**（三条激活条件见 debug-bridge.ts）。
   ⚠ 曾经把诊断条无条件画在 main.tsx 里做真机排查 —— 查完必须收进开关，
     否则正式包每个用户屏幕底下都压着一条绿字。 */
if (!themePreview && shouldInstallDebugBridge()) {
  installDebugBridge();
  installDiagOverlay();
}
/* 原生（安卓/iOS 应用内）标记：只为下面这类**平台相关的渲染降级**用，不参与任何逻辑判断。
   第一处用途（用户 10-06 报）：sticky 顶栏 / 固定底栏上的 `backdrop-filter` 毛玻璃，
   在安卓 WebView 快速滚动时会出现整块不重绘——用户看到的就是「靠下面的地方被截断了，
   重新点进来才恢复」。原生端把毛玻璃换成不透明底（见 styles.css 的 html[data-native] 段）。 */
if (Capacitor.isNativePlatform()) document.documentElement.dataset.native = "true";

// 首屏之后装 SW：它会给同源响应补 COOP/COEP（网页版的跨源隔离只能这么做），
// 而隔离只对「被 SW 接管之后」的文档响应生效，所以第一次装完要刷新一次。
// 只在确实没有隔离时刷、并用 sessionStorage 防循环——vite dev/preview 本身就
// 下发隔离头，这里不会触发，门禁与本地预览不受影响。
//
// 2026-10-09：**安卓端也装上**（用户问「为啥电脑识谱快，你不能适配吗」）。
// 同一份识谱代码在网页版 1～2 秒、在 APK 里十几倍慢，差别只在跨源隔离的有无：
// 隔离后 ORT 的 wasm 才能多线程（`numThreads` 才 >1），否则只能单线程。
// 旧写法用 `!Capacitor.isNativePlatform()` 把安卓排除，理由是「WebView 不支持
// 跨源隔离」——那是**在没有任何响应头注入**的前提下测的结论。现在两条注入都做：
//   ① 本 SW（同源响应补头）；
//   ② 安卓侧 IsolatedWebViewClient（Java 层补头，见该类注释）。
// 哪条先生效都能拿到隔离；都拿不到时行为与现在完全一致（单线程），不会更坏。
const COI_RELOAD_KEY = "banbu-coi-reload-v1";

if (!themePreview && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('./sw.js', window.location.href)).then(async () => {
      await navigator.serviceWorker.ready.catch(() => undefined);
      if (window.crossOriginIsolated || sessionStorage.getItem(COI_RELOAD_KEY)) return;
      sessionStorage.setItem(COI_RELOAD_KEY, "1");
      window.location.reload();
    }).catch(() => undefined);
  });
}

const Main = themePreview ? React.lazy(() => import('./themes/ThemePreview')) : App;
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><React.Suspense fallback={null}><Main /></React.Suspense></ErrorBoundary></React.StrictMode>);
