import { defineConfig, type ViteDevServer, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync, writeFileSync, createReadStream, statSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { transformAsync as babelTransformAsync } from "@babel/core";
import presetEnv from "@babel/preset-env";
import { scaleUiFontDeclarations } from "./src/ui-font-css.ts";
import { legacyWebViewCss } from "./scripts/legacy-webview-css.ts";

const scalableUiFonts = (): Plugin => ({
  name: "scalable-ui-fonts",
  enforce: "pre",
  transform(code, id) {
    const cleanId = id.split("?")[0].replaceAll("\\", "/");
    // 名单以前只有 styles.css 与 library.css，于是「设置 → 界面字号」的大字/特大字档
    // 对各功能自己的 CSS 完全无效：对弈界面（game-screen.css）、比赛计时器（clock.css）、
    // 题库/对弈入口（duel.css）、状态栏（unified-status.css）里的 font-size 全是写死 px，
    // 实测这些界面上「标准 → 特大字」倍率恒为 1.00（而设置页里是 1.30）。
    // 改成覆盖 src 下所有 CSS：scaleUiFontDeclarations 本身会跳过已经写了
    // `var(--ui-font-scale)` 的值，所以 image-verify.css 那批手写 calc 不会被套两层。
    // 唯一排除的是 legacy-webview.css——那是给不支持 calc(var()) 的老 WebView 兜底的。
    if (!cleanId.includes("/src/") || !cleanId.endsWith(".css")) return null;
    if (cleanId.endsWith("/legacy-webview.css")) return null;
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
      // 包实际放在 public/engine-packs/（public/ 是 dev 的静态根）；早先这里只找项目根的
      // engine-packs/，于是 404 → 预览版一直静默跑轻量档（用户 09-16 实测「网页版只有
      // 60k，之前明明到过 1200k」就是这个）。两个位置都找，优先项目根（保留旧的摆放习惯）。
      const candidates = [
        resolve(process.cwd(), "engine-packs", requested),
        resolve(process.cwd(), "public", "engine-packs", requested),
      ];
      const file = candidates.find((candidate) => existsSync(candidate));
      if (!file) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`Engine pack missing on this machine: build it with scripts/repack-rapfi-data.py`);
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      // Same as /renlib/: pre-header middleware responses must carry COOP/COEP
      // themselves or the COEP page rejects the cross-island resource.
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
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
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
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

/**
 * 把 **worker 产物**的语法降到 Chrome 79（2026-10-08，群友 HLTE203T / WebView 79 兼容）。
 *
 * 为什么只降 worker：Chrome 79 上主页面由 plugin-legacy 走 **legacy 包**（现代包探测脚本
 * 要求 import.meta.resolve，79 不满足），那条路已有 babel 按 targets 降过；**worker chunk
 * 不分现代/遗留**——它由 `new Worker(url)` 直接加载，构建目标是现代语法，79 上「构造成功 →
 * 解析 SyntaxError → 线程死」：表现就是「引擎能打开、但没有速度」、导入卡在「第 2/2 份」、
 * DP 数据库与识谱线程不可用。vite 8（rolldown）下 `build.target` 不再驱动旧式降级链
 * （实测设成 chrome79 后产物里仍有上千处 `?.`），所以在这里用 babel（plugin-legacy 自带的
 * 那份，离线可用）对 worker chunk 做一次降级。writeBundle 早于 PWA 的 closeBundle 预缓存
 * 哈希，改完的内容会被正确记进 manifest。
 *
 * 语法边界（为什么只降这些 token 就够）：Chrome 79 = ES2019 + 数字分隔符(75+) + 类字段(72+)
 * + 动态 import(63+) + import.meta(64+)；缺的语法只有 `?.` / `??` / `||=` / `&&=` / `??=`。
 * 运行时 API（.at / replaceAll / structuredClone 等）不在降级范围——worker 源码里没有使用
 * （legacy-assets.test.ts 有一条 worker 脚本的同类断言）。
 */
const lowerWorkerSyntaxToChrome79 = (): Plugin => ({
  name: "lower-worker-syntax-chrome79",
  apply: "build",
  async writeBundle(options) {
    const outDir = typeof options.dir === "string" ? options.dir : resolve(process.cwd(), "dist");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith(".js")
          && (entry.name.includes(".worker-") || entry.name.includes("-worker-"))) files.push(full);
      }
    };
    walk(outDir);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const esm = /^\s*(import[\s"'(]|export[\s{*])/.test(source);
      const result = await babelTransformAsync(source, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceType: esm ? "module" : "script",
        compact: true,
        comments: false,
        presets: [[presetEnv, { targets: { chrome: "79" }, modules: false, bugfixes: true }]],
      });
      if (result?.code) writeFileSync(file, result.code);
    }
  },
});

/** Vite 8's legacy plugin still leaves optional chaining in legacy chunks
 * when used with the rolldown pipeline. Chrome 79 can execute the nomodule
 * path but cannot parse those tokens, so lower every emitted legacy chunk. */
const lowerLegacyChunksToChrome79 = (): Plugin => ({
  name: "lower-legacy-chunks-chrome79",
  apply: "build",
  async writeBundle(options) {
    const outDir = typeof options.dir === "string" ? options.dir : resolve(process.cwd(), "dist");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /-legacy-[^/]+\.js$/.test(entry.name)) files.push(full);
      }
    };
    walk(outDir);
    for (const file of files) {
      const result = await babelTransformAsync(readFileSync(file, "utf8"), {
        filename: file, babelrc: false, configFile: false, sourceType: "script",
        compact: true, comments: false,
        presets: [[presetEnv, { targets: { chrome: "79" }, modules: false, bugfixes: true }]],
      });
      if (result?.code) writeFileSync(file, result.code);
    }
  },
});

/** Workbox's final inject step emits sw.js after writeBundle. It is loaded by
 * the same old WebView, so lower that classic worker in closeBundle too. */
const lowerServiceWorkerSyntaxToChrome79 = (): Plugin => ({
  name: "lower-service-worker-chrome79",
  enforce: "post",
  apply: "build",
  async closeBundle() {
    const file = resolve(process.cwd(), "dist", "sw.js");
    if (!existsSync(file)) return;
    const result = await babelTransformAsync(readFileSync(file, "utf8"), {
      filename: file, babelrc: false, configFile: false, sourceType: "script",
      compact: true, comments: false,
      presets: [[presetEnv, { targets: { chrome: "79" }, modules: false, bugfixes: true }]],
    });
    if (result?.code) writeFileSync(file, result.code);
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
  css: { postcss: { plugins: [legacyWebViewCss()] } },
  // 版本号单一来源（用户 09-13：快捷中心图标下要显示版本）：构建时从
  // package.json 注入 __APP_VERSION__，代码侧只读该常量——避免再出现
  // diagnostics.ts 里手写 "1.1.7.5" 与实际版本漂移（曾导致门禁与关于页不一致）。
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).version),
  },
  server: {
    // WASM 多线程（pthread/SharedArrayBuffer）要求 crossOriginIsolated。
    // 用 require-corp 而不是 credentialless：Safari 不支持 credentialless，
    // Chromium 96 以下把它当未知值（等同不隔离），而本应用没有任何跨源子资源
    // 需要豁免（CSP 已挡掉跨源图片/脚本）。生产网页版由 Service Worker 注入
    // 同一组头，这里保持一致，本地验证才代表线上下场。
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // worker 以 **classic（iife）** 输出（2026-10-08 修：向下兼容到 Chrome 79）。
  // 上一版（10-07）改成 format:"es"，前提是「目标浏览器 WebView 83+ 都支持 module
  // worker」——但群友的 HLTE203T 是 Android 10 + WebView **Chrome 79**，module worker
  // 要 Chrome 80+，于是 `new Worker(url,{type:"module"})` 直接抛
  // 「Module scripts are not supported on DedicatedWorker yet」，导入/DP数据库/
  // 识谱线程/内置兜底引擎全体不可用（用户 2026-10-08 反馈的截图就是这个）。
  // 10-07 那版要修的原始 bug（包装按 classic 加载、chunk 却是 ESM → 生产环境
  // SyntaxError、静默回落单线程）在 format:"iife" 下同样被修掉：包装与 chunk
  // **都**是 classic，格式一致，且从 Chrome 4x 起都能跑。配合下面的
  // build.target:"chrome79"，chunk 语法本身也不会超出 79 的能力。
  worker: { format: "iife" },
  build: {
    // 兼容下限：Chrome 79（2026-10-08，群友 HLTE203T / WebView 79）。
    // ⚠ 实测 vite 8（rolldown）**不会**按这个值降级产物语法（设成 chrome79 后现代包
    // 与 worker chunk 里仍有上千处 ?. / ??）——这里保留它只为表达下限意图、并在
    // vite 将来接通这条链路时自动受益；**真正生效的降级**是下面的
    // lowerWorkerSyntaxToChrome79 插件（worker chunk 用 babel 降到 chrome79），
    // 主页面在这些老机型上本就由 plugin-legacy 走 legacy 包（已按 targets 降过）。
    target: "chrome79",
    // Keep generated CSS parseable by the oldest supported Android WebView.
    // Runtime fallbacks in legacy-webview.css cover features that cannot be
    // losslessly lowered (notably :has() and variable-based color-mix()).
    cssTarget: "chrome79",
  },
  plugins: [
    devServiceWorkerReset(),
    renLibWebAssets(),
    enginePackDevServer(),
    legacyRapfiSyntax(),
    lowerWorkerSyntaxToChrome79(),
    lowerLegacyChunksToChrome79(),
    scalableUiFonts(),
    react(),
    legacy({
      // Redmi K20 ships with Chromium 83 in the current test environment.
      // Keep a module build for modern WebViews and emit a nomodule fallback
      // for older Android WebViews that cannot parse module scripts.
      // 2026-10-08：下限从 83 降到 79（群友 HLTE203T 是 Chrome 79），polyfills
      // 与 build.target:"chrome79" 对齐。
      targets: ["Chrome >= 79", "Android >= 8"],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
    VitePWA({
      injectRegister: false,
      registerType: "autoUpdate",
      // injectManifest：自己写 SW（src/sw.js）。除了 Workbox 预缓存，还要给同源响应
      // 补 COOP/COEP——网页版的跨源隔离只能这么做（GitHub Pages 不能下发响应头），
      // 而跨源隔离是 WASM 多线程（SharedArrayBuffer）的唯一前提。generateSW 模式下
      // 没法在预缓存路由之前插入自己的路由（先注册者优先），只能换模式。
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
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
      //
      // version.json 必须一起排掉（2026-09-18）：它是构建产物里唯一一个**部署侧故意
      // 不放**的文件（gh-pages 只把版本文件放在站点根，`app/` 不带）。Workbox 的预缓存
      // 是全有或全无——安装期只要有一条 404，整个 install 就 reject、注册被丢弃，于是
      // 页面永远拿不到 SW 补的 COOP/COEP：crossOriginIsolated 恒为 false，网页版唯一
      // 能跑到百万 nps 的 WASM 多线程档永远加载不了，离线预缓存也一并消失。线上 /app/
      // 实测：91 条预缓存里只有 version.json 是 404，就是它把整条链子掐死的。
      // 应用内「检查更新」读的是站点根的绝对地址（src/update-check.ts 的
      // PAGES_VERSION_URL），不依赖预缓存里这份，所以排掉它没有副作用。
      // maximumFileSizeToCacheInBytes：workbox 默认单文件 2MiB，超限直接构建报错。
      // index-legacy（旧浏览器降级包）随功能累积已长到 2.6MB——它本来就该被预缓存
      // （离线可用正是 APK 的意义），提额到 4MiB；这个包别再无节制地长。
      //
      // ort/** 与 models/** 是**识谱增强包**（2026-10-07 改为内置，用户明确要「不要下载」）：
      // onnxruntime wasm 14.2MB + 两个模型（1.9MB / 5.3MB）。它们都超过 4MiB 上限，
      // 进预缓存既会挂构建、又会让「装 PWA/首启」平白多下 20MB。已排除：首次点
      // 「复原手序-本地」时同源 fetch，之后交给浏览器 HTTP 缓存（离线二次可用）。
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,json,gz,wasm,data,sgf,db,wav}"], globIgnores: ["**/engine-packs/**", "**/version.json", "**/models/**", "**/ort/**"], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
    lowerServiceWorkerSyntaxToChrome79(),
    // 引擎包随 APK 分发（用户 09-13：装完即用，不再依赖应用内下载）。
    // 40MB 的 v3 数据包留在 dist/ 里由 Capacitor 拷进 APK 的 assets，运行时
    // 通过同源 /engine-packs/ 路径读取（engine-pack.ts 的 DEV 分支已覆盖同源
    // 候选，生产侧见 enginePackUrls 的同源优先改造）。
    // 注意：Web 部署（GitHub Pages）不含该目录，走远端下载兜底。
  ],
  base: "./",
});
