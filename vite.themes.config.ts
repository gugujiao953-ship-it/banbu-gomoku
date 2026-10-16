import { defineConfig } from "vite";
import { resolve } from "node:path";
import application from "./vite.config.ts";

// Isolate the theme studio's dependency cache from other running app sessions.
export default defineConfig({
  ...application,
  cacheDir:"node_modules/.vite-themes",
  optimizeDeps:{ noDiscovery:true, include:["react", "react/jsx-runtime", "react-dom/client", "lucide-react", "@capacitor/core"] },
  server:{ ...application.server, watch:{ ignored:["**/artifacts/**", "**/dist*/**"] } },
  build:{ ...application.build, rolldownOptions:{ input:{ app:resolve("index.html"), themes:resolve("theme-preview.html") } } },
});
