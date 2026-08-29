import { spawnSync } from "node:child_process";

const profile = process.argv[2] || "smoke";
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";

const browserScripts = [
  "qa/advanced-import-blackbox.mjs",
  "qa/chunk-order-blackbox.mjs",
  "qa/draft-storage-guard.mjs",
  "qa/editor-command-bar.mjs",
  "qa/export-content-verify.mjs",
  "qa/mobile-visual.mjs",
];

const run = (label, command, args, env = {}) => {
  console.log(`\n[qa] ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};

const assertPreview = async () => {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(`[qa] 浏览器回归需要已启动的网页：${baseURL}`);
    console.error(`[qa] 请先运行 npm run dev -- --port 5173，或设置 QA_BASE_URL。`);
    throw error;
  }
};

if (!["smoke", "browser", "full"].includes(profile)) {
  console.error("用法：node scripts/run-qa.mjs <smoke|browser|full>");
  process.exit(2);
}

if (profile === "smoke" || profile === "full") {
  run("确定性单元测试", process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src", "--pool=threads", "--maxWorkers=1"]);
}

if (profile === "browser" || profile === "full") {
  await assertPreview();
  for (const script of browserScripts) run(script, process.execPath, [script], { QA_BASE_URL: baseURL });
}

if (profile === "full") {
  run("TypeScript 构建", process.execPath, ["node_modules/typescript/bin/tsc", "-b"]);
  run("Vite 生产构建", process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
  run("产物大小门禁", process.execPath, ["scripts/check-dist-size.mjs"]);
}

console.log(`\n[qa] ${profile} 回归通过`);
