/**
 * Service worker（vite-plugin-pwa 的 injectManifest 模式）。
 *
 * 除了既有的 Workbox 预缓存（离线可用），它还给**同源响应补上
 * Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy**：网页版因此拿到
 * 「跨源隔离」，`SharedArrayBuffer` 才可用，WASM 多线程引擎（pthread 构建强制
 * import 共享内存）才有可能加载。GitHub Pages 无法下发自定义响应头，所以只能
 * 由 SW 在响应上补 —— 这和 gomocalc.com 用 CDN 下发头是同一个目的，只是手段不同。
 *
 * 为什么不另起一个 SW：同一个 scope 只能有一个注册，两个脚本会互相顶掉
 * （实测非确定性：要么丢隔离、要么丢预缓存）。所以隔离逻辑与预缓存合并在这里，
 * 并且必须**先注册兜底路由、再用 matchPrecache 取预缓存**——反过来的话，命中的
 * 预缓存响应会走 Workbox 预缓存路由，不带隔离头，页面时灵时不灵。
 *
 * 写法说明：这是 .js 而不是 .ts。项目的 tsconfig 只有 DOM lib（没有
 * ServiceWorkerGlobalScope / FetchEvent），而文件级 `/// <reference lib="webworker" />`
 * 会与 DOM 的 `self` 声明冲突；allowJs 为 false 让 tsc 直接跳过本文件。
 */
import { cleanupOutdatedCaches, matchPrecache, precache } from "workbox-precaching";
import { registerRoute } from "workbox-routing";

const COOP = "Cross-Origin-Opener-Policy";
const COEP = "Cross-Origin-Embedder-Policy";
const CORP = "Cross-Origin-Resource-Policy";

// 必须出现 `self.__WB_MANIFEST`：vite-plugin-pwa 用注入的清单替换它。
// precache() 只负责把清单写进缓存，不注册路由（路由由下面的兜底路由负责）。
precache(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

/** 给响应补上跨源隔离头。已经带头的（例如 vite dev/preview 或带头的宿主）不重复设置。 */
const withIsolationHeaders = (response) => {
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set(COOP, "same-origin");
  // 用 require-corp 而不是 credentialless：Safari 不支持 credentialless，
  // 而 Chromium 96 以下把它当未知值、等同不隔离。
  headers.set(COEP, "require-corp");
  headers.set(CORP, "cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

registerRoute(
  // 只管同源 GET：跨源请求（检查更新、引擎包远端回退、在线棋谱库）交给浏览器
  // 默认行为，避免把它们的 CORS 结果重包一遍。
  ({ request, url }) => request.method === "GET" && url.origin === self.location.origin,
  async ({ request }) => {
    let cached = await matchPrecache(request);
    // 导航到目录（例如 Pages 上的 /app/）时 URL 与预缓存的 index.html 不同名，
    // 必须回退到 index.html，否则离线打开会白屏。
    if (!cached && request.mode === "navigate") {
      cached = await matchPrecache(new URL("index.html", self.registration.scope).href);
    }
    if (cached) return withIsolationHeaders(cached);
    try {
      return withIsolationHeaders(await fetch(request));
    } catch (error) {
      // 网络失败时不要伪造响应：让调用方拿到和没有 SW 时一致的网络错误。
      throw error;
    }
  },
);
