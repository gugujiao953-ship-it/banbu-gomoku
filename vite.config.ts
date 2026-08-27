import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const renLibWebAssets = () => ({
  name: "renlib-web-assets",
  generateBundle() {
    const root = resolve(process.cwd(), "src/renlib-web");
    const shared = resolve(process.cwd(), "src/renlib-reference");
    const files = [
      ["JFile.js", root], ["JPoint.js", root], ["LibraryFile.js", root], ["MoveList.js", root],
      ["MoveNode.js", root], ["RenLibDoc.js", root], ["RenLibDoc_wasm.js", root], ["RenjuLib_worker.js", root],
      ["Stack.js", root], ["IntervalPost.js", shared], ["TextCoder.js", shared], ["RenLib.wasm", root],
    ];
    for (const [name, directory] of files) {
      this.emitFile({ type: "asset", fileName: `renlib/${name}`, source: readFileSync(resolve(directory, name)) });
    }
  },
});

export default defineConfig({
  plugins: [
    renLibWebAssets(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "半步五子棋",
        short_name: "半步五子棋",
        description: "移动优先的五子棋打谱与做题工具",
        theme_color: "#365e4b",
        background_color: "#f8f6f1",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: ".",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,json}"] },
    }),
  ],
  base: "./",
});
