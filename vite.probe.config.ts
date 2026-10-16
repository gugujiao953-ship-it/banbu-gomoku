// 一次性探针配置（用完即删）：dev 服务器默认会去 watch `artifacts/`（几万个小文件），
// 在本机直接 ENOMEM 崩掉。这里只加一条忽略，其余全部沿用 vite.config.ts。
import { mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(base, {
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
    watch: { ignored: ["**/artifacts/**", "**/dist-probe/**", "**/dist-audit*/**", "**/棋谱/**", "**/design-lab/**"] },
  },
});
