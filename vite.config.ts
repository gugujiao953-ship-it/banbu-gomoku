import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
