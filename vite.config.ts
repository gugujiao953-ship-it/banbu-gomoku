import { defineConfig, type ViteDevServer, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync, writeFileSync, createReadStream, statSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { scaleUiFontDeclarations } from "./src/ui-font-css.ts";

const scalableUiFonts = (): Plugin => ({
  name: "scalable-ui-fonts",
  enforce: "pre",
  transform(code, id) {
    const cleanId = id.split("?")[0].replaceAll("\\", "/");
    if (!cleanId.endsWith("/src/styles.css") && !cleanId.endsWith("/src/library.css")) return null;
    return { code: scaleUiFontDeclarations(code), map: null };
  },
});

// Single manifest for both build-time emission and dev-time serving so the two
// can never drift. /renlib/* only exists in build output otherwise, which makes
// every LIB-related dev/debug round-trip require a full build first.
const renLibFiles = () => {
  const root = resolve(process.cwd(), "src/renlib-web");
  const shared = resolve(process.cwd(), "src/renlib-reference");
  return [
    ["JFile.js", root], ["JPoint.js", root], ["LibraryFile.js", root], ["MoveList.js", root],
    ["MoveNode.js", root], ["RenLibDoc.js", root], ["RenLibDoc_wasm.js", root], ["RenjuLib_worker.js", root],
    ["Stack.js", root], ["IntervalPost.js", shared], ["TextCoder.js", shared], ["RenLib.wasm", root],
  ].map(([name, directory]) => ({ name: name as string, path: resolve(directory, name as string) }));
};

const renLibContentType = (name: string) => (name.endsWith(".wasm") ? "application/wasm" : "application/javascript; charset=utf-8");

// The full-strength engine pack lives in gitignored engine-packs/ and is served
// by the dev server only; production downloads it in-app from the app's own
// Pages hosting. Keeping it out of dist/ keeps the APK at the lightweight size.
const enginePackDevServer = (): Plugin => ({
  name: "engine-pack-dev-server",
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      if (!url.startsWith("/engine-packs/")) {
        next();
        return;
      }
      const requested = url.slice("/engine-packs/".length);
      if (!/^rapfi-full-v\d+\.data$/.test(requested) || requested.includes("..")) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Engine pack not found");
        return;
      }
      const file = resolve(process.cwd(), "engine-packs", requested);
      if (!existsSync(file)) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`Engine pack missing on this machine: build it with scripts/repack-rapfi-data.py`);
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      // Same as /renlib/: pre-header middleware responses must carry COOP/COEP
      // themselves or the COEP page rejects the cross-island resource.
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      res.setHeader("Content-Length", String(statSync(file).size));
      res.setHeader("Cache-Control", "no-store");
      createReadStream(file).pipe(res);
    });
  },
});

const renLibWebAssets = (): Plugin => ({
  name: "renlib-web-assets",
  enforce: "pre",
  generateBundle() {
    for (const file of renLibFiles()) {
      this.emitFile({ type: "asset", fileName: `renlib/${file.name}`, source: readFileSync(file.path) });
    }
  },
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      if (!url.startsWith("/renlib/")) {
        next();
        return;
      }
      const requested = url.slice("/renlib/".length);
      const file = renLibFiles().find((item) => item.name === requested);
      // This middleware runs before Vite's server.headers middleware, so the
      // global COOP/COEP headers never reach these responses. Without them the
      // browser refuses to spin up the RenLib classic worker from this COEP
      // page (ERR_BLOCKED_BY_RESPONSE) and .lib files cannot be opened at all.
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      if (!file) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("RenLib asset not found");
        return;
      }
      res.setHeader("Content-Type", renLibContentType(file.name));
      res.setHeader("Cache-Control", "no-store");
      res.end(readFileSync(file.path));
    });
  },
});

// Emscripten's prebuilt Rapfi loaders contain logical-assignment syntax in a
// few generated helpers. Rewrite only the emitted Rapfi assets so Chromium 83
// can parse the fallback and full variants without changing the upstream
// generated sources by hand.
const legacyRapfiSyntax = (): Plugin => ({
  name: "legacy-rapfi-syntax",
  writeBundle(options) {
    const outputDirectory = typeof options.dir === "string" ? options.dir : resolve(process.cwd(), "dist");
    for (const variant of ["fallback", "full"]) {
      const file = resolve(outputDirectory, "rapfi", variant, "rapfi-single.js");
      if (!existsSync(file)) continue;
      const source = readFileSync(file, "utf8");
      const compatible = source
        .replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)&&=/g, "$1=$1&&")
        .replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\|\|=/g, "$1=$1||")
        .replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\?\?=/g, "$1=$1??");
      if (compatible !== source) writeFileSync(file, compatible);
    }
  },
});

// A production preview may previously have registered a PWA service worker on
// the same localhost port. During development that worker can keep serving an
// old precache forever because Vite normally has no /sw.js update to replace
// it. Publish a development-only replacement that unregisters itself without
// clearing IndexedDB or localStorage, so local records remain intact.
const devServiceWorkerReset = () => ({
  name: "dev-service-worker-reset",
  configureServer(server: { middlewares: { use: (path: string, handler: (_request: unknown, response: { setHeader: (name: string, value: string) => void; end: (body: string) => void }) => void) => void } }) {
    server.middlewares.use("/sw.js", (_request, response) => {
      response.setHeader("Content-Type", "application/javascript; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(`
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) await client.navigate(client.url);
  })());
});
      `);
    });
  },
});

export default defineConfig({
  // 版本号单一来源（用户 09-13：快捷中心图标下要显示版本）：构建时从
  // package.json 注入 __APP_VERSION__，代码侧只读该常量——避免再出现
  // diagnostics.ts 里手写 "1.1.7.5" 与实际版本漂移（曾导致门禁与关于页不一致）。
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).version),
  },
  server: {
    // WASM 多线程（pthread/SharedArrayBuffer）要求 crossOriginIsolated：
    // COOP same-origin + COEP credentialless（Chromium 96+，免子资源 CORP 头）。
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  build: {
    // Keep generated CSS parseable by the oldest supported Android WebView.
    // Runtime fallbacks in legacy-webview.css cover features that cannot be
    // losslessly lowered (notably :has() and variable-based color-mix()).
    cssTarget: "chrome83",
  },
  plugins: [
    devServiceWorkerReset(),
    renLibWebAssets(),
    enginePackDevServer(),
    legacyRapfiSyntax(),
    scalableUiFonts(),
    react(),
    legacy({
      // Redmi K20 ships with Chromium 83 in the current test environment.
      // Keep a module build for modern WebViews and emit a nomodule fallback
      // for older Android WebViews that cannot parse module scripts.
      targets: ["Chrome >= 83", "Android >= 8"],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
    VitePWA({
      injectRegister: false,
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icon-maskable.svg"],
      manifest: {
        name: "半步五子棋打谱",
        short_name: "半步五子棋打谱",
        description: "移动优先的五子棋打谱与做题工具",
        theme_color: "#365e4b",
        background_color: "#f8f6f1",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: ".",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      // engine-packs/** 是 40MB 级引擎档位包：随 APK 分发（见下方 closeBundle 说明），
      // 但绝不能进 Workbox 预缓存——超过 2MiB 上限会让 SW 生成直接报错挂构建，
      // 且 40MB 预缓存对首启是灾难。运行时从同源 /engine-packs/ 直接取用。
      workbox: { globPatterns: ["**/*.{js,css,html,svg,json,gz,wasm,data,sgf,db,wav}"], globIgnores: ["**/engine-packs/**"] },
    }),
    // 引擎包随 APK 分发（用户 09-13：装完即用，不再依赖应用内下载）。
    // 40MB 的 v3 数据包留在 dist/ 里由 Capacitor 拷进 APK 的 assets，运行时
    // 通过同源 /engine-packs/ 路径读取（engine-pack.ts 的 DEV 分支已覆盖同源
    // 候选，生产侧见 enginePackUrls 的同源优先改造）。
    // 注意：Web 部署（GitHub Pages）不含该目录，走远端下载兜底。
  ],
  base: "./",
});
