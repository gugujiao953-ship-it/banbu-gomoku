import { spawnSync } from "node:child_process";
import { formalBrowserRegressions } from "../qa/regression-manifest.mjs";

const profile = process.argv[2] || "smoke";
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaURL = new URL(baseURL);
qaURL.searchParams.set("qa", "1");

const browserScripts = formalBrowserRegressions.map(({ script }) => script);

/** 失败的步骤（label + 退出码）。见下面 run() 的注释：不能一红就退出。 */
const failures = [];

const run = (label, command, args, env = {}) => {
  console.log(`\n[qa] ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  // 原来这里直接 process.exit()：72 条浏览器门禁里第 1 条一红，后面 71 条到底
  // 红不红根本看不到（2026-10-01 排查时踩到，chunk-order 一崩整套就停）。
  // 改成记下来继续跑，最后汇总并仍以非 0 退出。
  if (result.status !== 0) {
    failures.push({ label, status: result.status });
    console.log(`[qa] ✗ ${label} 失败（exit ${result.status}）—— 继续跑后面的步骤`);
  }
};

const assertPreview = async () => {
  // 5 秒太紧：vite dev 冷启动或「发现新依赖 → 重新预打包」的那几秒里，请求会整片挂住，
  // 于是本脚本在第一步就抛 TimeoutError，72 条一条没跑（2026-10-01 实测踩到）。
  // 给它 20 秒、失败再试两次（每次间隔 3 秒），仍然不通才认输。
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  console.error(`[qa] 浏览器回归需要已启动的网页：${baseURL}`);
  console.error(`[qa] 请先运行 npm run dev -- --port 5173，或设置 QA_BASE_URL。`);
  throw lastError;
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
  // Product regressions skip the first-run overlay through the app's explicit
  // QA query flag. The onboarding regression removes this flag itself so the
  // real acknowledgement and persistence flow remains covered.
  for (const script of browserScripts) run(script, process.execPath, [script], { QA_BASE_URL: qaURL.href });
}

if (profile === "full") {
  run("TypeScript 构建", process.execPath, ["node_modules/typescript/bin/tsc", "-b"]);
  run("CSS 死变量检查", process.execPath, ["scripts/check-dead-css-vars.mjs"]);
  // 这一行先不接：HEAD 的 library.css 里还有 15 处「亮强调色 + 写死白字」没解混进不了库，
  // 这时接上等于在新克隆里交付一条必红的门禁。等 library.css 落地后再接（R112 第十节）。
  run("强调色上不许写死文字色检查", process.execPath, ["scripts/check-hardcoded-ink.mjs"]);
  run("Vite 生产构建", process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
  run("产物大小门禁", process.execPath, ["scripts/check-dist-size.mjs"]);
}

if (failures.length > 0) {
  console.log(`\n[qa] ${profile} 有 ${failures.length} 步失败：`);
  failures.forEach((failure) => console.log(`  ✗ ${failure.label}（exit ${failure.status}）`));
  process.exit(1);
}

console.log(`\n[qa] ${profile} 回归通过`);
