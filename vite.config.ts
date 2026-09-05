import { defineConfig, type ViteDevServer, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  build: {
    // Keep generated CSS parseable by the oldest supported Android WebView.
    // Runtime fallbacks in legacy-webview.css cover features that cannot be
    // losslessly lowered (notably :has() and variable-based color-mix()).
    cssTarget: "chrome83",
  },
  plugins: [
    devServiceWorkerReset(),
    renLibWebAssets(),
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
      workbox: { globPatterns: ["**/*.{js,css,html,svg,json,wasm,data,sgf,db,wav}"] },
    }),
  ],
  base: "./",
});
