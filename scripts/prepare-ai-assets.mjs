// 识谱增强包的内置资源准备（2026-10-07）：把 onnxruntime 的 wasm 运行时与两个
// 模型文件拷进 public/，让「复原手序-本地」增强链路在应用内直接可用（零下载）。
//
// 为什么是脚本而不是手工拷贝：wasm 来自 node_modules（可随依赖恢复，不入库），
// 模型是我们自己的训练产物（入库，7.6MB）。prebuild 自动跑，缺任何一份都直接报错，
// 避免「本机有、别人构建出来是坏的」。
// 用法：node scripts/prepare-ai-assets.mjs
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const jobs = [
  // onnxruntime 运行时三件套（2026-10-07 改为「应用内自持 + 运行时按 URL 动态加载」）：
  // 此前只 emit 了 .wasm，导致**线程 worker 的加载器 .mjs 在生产构建里缺失**——
  // 多线程起不来、静默跑单线程（实测 225 格单线程 5.6s，四线程约 2s）。
  // 现在 JS/wasm/加载器都放 public/ort（不预缓存），vite 不再打包 ORT → 也不会有第二份 wasm。
  {
    from: resolve(root, "node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs"),
    to: resolve(root, "public/ort/ort.wasm.bundle.min.mjs"),
    note: "ORT wasm-only 入口（自包含，70KB）",
  },
  {
    from: resolve(root, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs"),
    to: resolve(root, "public/ort/ort-wasm-simd-threaded.mjs"),
    note: "wasm 加载器 + 线程 worker 脚本",
  },
  {
    from: resolve(root, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"),
    to: resolve(root, "public/ort/ort-wasm-simd-threaded.wasm"),
    note: "onnxruntime wasm 运行时（14MB）",
  },
  // 模型用 **FP16 版**（2026-10-07 实测：体积正好减半 7.22→3.61MB，
  // 浏览器里 40/40 输出与 fp32 完全一致、单格还略快 16%）——
  // 拷成正式文件名，应用代码零改动。
  {
    from: resolve(root, "qa/fixtures/models/cell-cls-real-mix-fp16.onnx"),
    to: resolve(root, "public/models/cell-cls-real-mix.onnx"),
    note: "逐格分类器 FP16（空/黑/白）",
  },
  // 旧数字头 digit-head-iter8 **不再拷进包**（2026-10-13 用户要求）：它在运行时代码里
  // 零引用（`DIGIT_HEAD_MODEL_FILE` 与 `ensureModelSessions` 的兜底都指向 combo46），
  // 白白占 2.66MB APK 体积。fixture 仍留在 `qa/fixtures/models/`（本地，不进包），
  // 要回滚就把上面这条拷贝加回来、并把 `model-inference.ts` 的 DIGIT_HEAD_MODEL_FILE
  // 改回 "digit-head-iter8.onnx" 即可。
  // 注意：`public/models/` 是构建产物目录，删掉这里不代表包里的旧文件会消失——
  // 残留文件必须显式清理（见本文件末尾的 stale 清理）。
  // 现役数字头（2026-10-12 换）：226 类（0..225），真实域 468 盘 × 3 宽度 161,427 条
  // + 合成 527,840 条训练。文件名走 `model-inference.ts` 的 DIGIT_HEAD_MODEL_FILE，
  // 换/回滚只改那一行常量（这里只需保证文件被拷到位）。
  // 现役数字头（2026-10-12）：226 类（0..225），真实域 468 盘 × 3 宽度 161,427 条
  // + 合成 527,840 条。文件名走 `model-inference.ts` 的 DIGIT_HEAD_MODEL_FILE，
  // 换/回滚只改那一行常量。
  //
  // ⚠ combo48（智子风格语料训的那一轮）**已训完但未采纳**：门禁 order-hi-ply-restore 红了，
  // 账见 model-inference.ts 的 DIGIT_HEAD_MODEL_FILE 注释。要用就把下面这条改成 combo48，
  // 并把 combo48 从 stale 清单里拿掉；模型文件在 qa/fixtures/models/ 里留着。
  {
    from: resolve(root, "qa/fixtures/models/digit-head-combo46-fp16.onnx"),
    to: resolve(root, "public/models/digit-head-combo46-fp16.onnx"),
    note: "数字头 FP16（现役 combo46，226 类 0..225）",
  },
];

/** 曾经拷进 public/、如今不再需要的模型：**显式删掉**，否则上一轮构建的残留会被
 *  原样打进 APK（脚本只做拷贝、不会清理目标目录）。 */
const stale = [
  resolve(root, "public/models/digit-head-iter8.onnx"),
  resolve(root, "dist/models/digit-head-iter8.onnx"),
  // combo48 已训完但**未采纳**（门禁 order-hi-ply-restore 红了）：别让它躺在包里白占 2.67MB。
  resolve(root, "public/models/digit-head-combo48-fp16.onnx"),
  resolve(root, "public/models/digit-head-combo49-fp16.onnx"),
  resolve(root, "dist/models/digit-head-combo48-fp16.onnx"),
];

let copied = 0;
for (const job of jobs) {
  if (!existsSync(job.from)) {
    console.error(`缺少源文件：${job.from}\n  （${job.note}）`);
    process.exit(1);
  }
  mkdirSync(dirname(job.to), { recursive: true });
  copyFileSync(job.from, job.to);
  copied += 1;
  console.log(`✓ ${job.to.replace(root + "\\", "").replace(root + "/", "")}  ${(statSync(job.to).size / 1048576).toFixed(2)}MB`);
}
for (const path of stale) {
  if (!existsSync(path)) continue;
  rmSync(path, { force: true });
  console.log(`✗ 清理不再使用的旧模型 ${path.replace(root + "\\", "").replace(root + "/", "")}`);
}
console.log(`识谱增强包资源就绪（${copied} 份）。`);
