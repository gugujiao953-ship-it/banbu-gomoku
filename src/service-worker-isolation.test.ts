import { describe, expect, it } from "vitest";
import serviceWorkerSource from "./sw.js?raw";

/**
 * Service Worker 的隔离契约。
 *
 * 网页版的多线程引擎（WASM pthread 构建强制 import 共享内存）只有在
 * crossOriginIsolated 的页面里才能加载，而 GitHub Pages 不能下发响应头——
 * 隔离头只能由这个 SW 补。所以下面每一条都是「多线程能不能用」的必要条件，
 * 改坏任意一条都不会有运行时异常，只会静默退回单线程（历史上正是这样丢了
 * 一整轮多线程工作），因此用测试钉死。
 *
 * 这里只读源码文本、不执行：`self` 在测试环境里不是 ServiceWorkerGlobalScope，
 * 执行会在 precache(self.__WB_MANIFEST) 处直接抛错。
 */
describe("service worker 跨源隔离契约", () => {
  it("注入 COOP 与 COEP，且用 require-corp（Safari 与旧 Chromium 只认它）", () => {
    expect(serviceWorkerSource).toContain("Cross-Origin-Opener-Policy");
    expect(serviceWorkerSource).toContain("Cross-Origin-Embedder-Policy");
    expect(serviceWorkerSource).toContain("require-corp");
    // 只看字符串字面量：注释里解释「为什么不用 credentialless」不算违规。
    expect(serviceWorkerSource).not.toContain('"credentialless"');
  });

  it("保留 Workbox 预缓存清单注入点（离线可用不能丢）", () => {
    expect(serviceWorkerSource).toContain("self.__WB_MANIFEST");
    expect(serviceWorkerSource).toContain("precache(");
    expect(serviceWorkerSource).toContain("cleanupOutdatedCaches");
  });

  it("路由用 matchPrecache 回退到 index.html（目录导航在 Pages 上是 /app/）", () => {
    expect(serviceWorkerSource).toContain("matchPrecache");
    expect(serviceWorkerSource).toContain('"index.html"');
    expect(serviceWorkerSource).toContain('request.mode === "navigate"');
  });

  it("只接管同源 GET，跨源请求（更新检查/引擎包回退/在线棋谱库）不受影响", () => {
    expect(serviceWorkerSource).toContain("request.method === \"GET\"");
    expect(serviceWorkerSource).toContain("url.origin === self.location.origin");
  });

  it("接管页面（skipWaiting + claim），否则首屏装完不会生效", () => {
    expect(serviceWorkerSource).toContain("skipWaiting");
    expect(serviceWorkerSource).toContain("clients.claim");
  });
});
