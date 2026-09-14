import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// 只覆盖用例超时，其余沿用 app 的 vite 配置（define __APP_VERSION__、插件、dev
// 中间件都还要在，单测里有依赖它们的地方）。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // 全量并行时 79 个测试文件同时抢 CPU，若干 VCF 相关用例（game.test.ts 的
      // 两步杀证明、vcf-corpus 的原创出题）会以 vitest 默认的 5s 用例超时假失败
      // ——它们本身是秒级搜索，超出的时间都花在等 CPU 上。这里只放宽「多久算超时」，
      // 不改任何断言（2026-09-14）。
      testTimeout: 20000,
    },
  }),
);
