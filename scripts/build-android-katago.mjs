#!/usr/bin/env node
/**
 * 把 KataGo 旗舰引擎（KataGomo 分支 + ONNX Runtime CPU 后端）铺进安卓工程。
 *
 * 为什么需要它：`android/app/src/main/jniLibs/` 在 .gitignore 里（二进制不进仓库），
 * Rapfi 的二进制由 scripts/build-android-engine.mjs 从本地源码树重建；KataGo 同理，
 * 由本脚本从引擎实验室（_engine-lab）的构建产物铺进来。**模型与配置不算构建产物**：
 * `assets/engine-katago/{distill-fp16.onnx,kata.cfg}` 是版本化的输入（作者网与运行时
 * 配置），随仓库走，本脚本只校验它们在场、不覆盖。
 *
 * 依赖本机已有的产物（都在引擎实验室，见 蒸馏路线总结-2026-09-24.md §5.0）：
 *   KATAGO_SRC/katago                      未剥离的 arm64 构建（build-android-onnxcpu-arm64/）
 *   KATAGO_SRC/ort-bench/deploy/libonnxruntime.so   与二进制匹配的 ORT 动态库
 *   LAB/zhizi-150/unpacked/assets/katago_zz  智子大网档引擎（社区分发）
 *
 * **智子两档引擎为什么也走 jniLibs（2026-10-01 修复）**：Android 10（API 29）起，
 * 应用可写目录（files/）里的文件即使 chmod +x 也不允许 exec —— `ProcessBuilder`
 * 直接抛 `error=13, Permission denied`（W^X 策略）。旧版把它们当 assets 铺到
 * files/native-katago/ 再 chmod，真机上必然起不来，用户看到的却是「切了档、
 * 引擎没换、还是 rapfi 在算」。系统只允许执行安装器解压到 nativeLibraryDir
 * （jniLibs）的 `lib*.so`，所以这里统一铺进 jniLibs。
 *
 * 用法：
 *   node scripts/build-android-katago.mjs
 * 环境变量：
 *   KATAGO_LAB   引擎实验室目录（默认 D:/Projects/_engine-lab）
 *   ANDROID_NDK  NDK 路径（默认 D:/AndroidTools/ndk-r29，用其中的 llvm-strip）
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = process.env.PROJECT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAB = process.env.KATAGO_LAB || "D:/Projects/_engine-lab";
const NDK = process.env.ANDROID_NDK || "D:/AndroidTools/ndk-r29";

// 默认 onnx：当前随包的「自带档」就是 ONNX-CPU 后端（DT_NEEDED libonnxruntime.so），
// 跑 eigen 会把它换成只吃原生 .bin 的 Eigen 引擎、并删掉 libonnxruntime.so——
// 那会让自带档加载 distill-fp16.onnx 直接失败。要出 Eigen 版得显式 KATAGO_BACKEND=eigen。
const BACKEND = process.env.KATAGO_BACKEND || "onnx";
const SRC_BINARY = join(LAB, BACKEND === "onnx" ? "build-android-onnxcpu-arm64" : "build-android-eigen-arm64", "katago");
const SRC_ONNXRUNTIME = join(LAB, "ort-bench", "deploy", "libonnxruntime.so");
const ZHIZI_ASSETS = join(LAB, "zhizi-150", "unpacked", "assets");
const JNI_DIR = join(PROJECT, "android/app/src/main/jniLibs/arm64-v8a");
const ASSET_DIR = join(PROJECT, "android/app/src/main/assets/engine-katago");

/** 智子大网档引擎 → jniLibs 里的 `lib*.so` 名（档位名与模型见 NativeKataGoPlugin）。
 *  2026-10-01 移除了「智子迷你网」档（Eigen + 6b64f，棋力最弱），它的引擎与模型不再入包。 */
const ZHIZI_ENGINES = [
  { src: join(ZHIZI_ASSETS, "katago_zz"), target: join(JNI_DIR, "libkatago_zz.so") },
];

const LLVM_STRIP = join(
  NDK,
  "toolchains/llvm/prebuilt",
  process.platform === "win32" ? "windows-x86_64" : process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64",
  "bin",
  process.platform === "win32" ? "llvm-strip.exe" : "llvm-strip",
);

/** 必需输入（构建产物与版本化资产分开报告，缺哪个说哪个）。 */
const BUILD_INPUTS = [
  { path: SRC_BINARY, hint: "未剥离的 arm64 构建（在引擎实验室构建目录里）" },
  ...(process.env.KATAGO_BACKEND === "onnx" ? [{ path: SRC_ONNXRUNTIME, hint: "ORT 动态库（引擎实验室 ort-bench/deploy/）" }] : []),
];
const VERSIONED_INPUTS = [
  { path: join(ASSET_DIR, "distill-fp16.onnx"), hint: "作者网·连珠（有禁手）版（版本化输入，应随仓库分发）" },
  { path: join(ASSET_DIR, "distill-freestyle-fp16.onnx"), hint: "作者网·无禁手版 f15（版本化输入，应随仓库分发）" },
  { path: join(ASSET_DIR, "kata.cfg"), hint: "KataGo 运行时配置（版本化输入，应随仓库分发）" },
  { path: join(ASSET_DIR, "zhizi-b24-int8.onnx"), hint: "智子·大网档模型（int8 静态量化版，版本化输入，应随仓库分发）" },
];
const ZHIZI_INPUTS = ZHIZI_ENGINES.map((entry) => ({
  path: entry.src,
  hint: "智子档引擎（从智子安装包 assets 解出，社区分发）",
}));

const missing = [...BUILD_INPUTS, ...VERSIONED_INPUTS, ...ZHIZI_INPUTS].filter((entry) => !existsSync(entry.path));
if (missing.length) {
  for (const entry of missing) console.error(`缺少 ${entry.path}\n  → ${entry.hint}`);
  process.exit(1);
}
if (!existsSync(LLVM_STRIP)) {
  console.error(`找不到 llvm-strip：${LLVM_STRIP}\n  → 检查 ANDROID_NDK（默认 D:/AndroidTools/ndk-r29）`);
  process.exit(1);
}

mkdirSync(JNI_DIR, { recursive: true });
mkdirSync(ASSET_DIR, { recursive: true });

// 剥离后铺进 jniLibs：名字必须是 lib*.so，AGP 才会打包并让安装器解压到
// nativeLibraryDir（且带执行位）——这是不 root 也能 exec 自带二进制的标准做法。
// 数组形态调用、不经 shell。
const stripped = join(JNI_DIR, "libkatago-engine.so");
execFileSync(LLVM_STRIP, ["--strip-all", SRC_BINARY, "-o", stripped], { stdio: "inherit" });
if (BACKEND === "onnx") copyFileSync(SRC_ONNXRUNTIME, join(JNI_DIR, "libonnxruntime.so"));
else rmSync(join(JNI_DIR, "libonnxruntime.so"), { force: true });

// 智子两档引擎 → jniLibs（**不是** assets：Android 10+ 只有 nativeLibraryDir 里的
// 文件允许 exec，见文件头注释）。只依赖 libc/libm/libz/liblog 等系统库，无需附带 .so。
for (const entry of ZHIZI_ENGINES) {
  copyFileSync(entry.src, entry.target);
}

const mb = (bytes) => (bytes / 1048576).toFixed(1);
console.log("KataGo 旗舰引擎已铺好：");
console.log(`  ${stripped}  ${mb(statSync(stripped).size)}MB（strip 自 ${mb(statSync(SRC_BINARY).size)}MB）`);
if (BACKEND === "onnx") console.log(`  ${join(JNI_DIR, "libonnxruntime.so")}  ${mb(statSync(join(JNI_DIR, "libonnxruntime.so")).size)}MB`);
for (const entry of ZHIZI_ENGINES) {
  console.log(`  ${entry.target}  ${mb(statSync(entry.target).size)}MB（智子档引擎，jniLibs）`);
}
console.log(`  资产（版本化输入，未改动）：`);
for (const entry of VERSIONED_INPUTS) console.log(`    ${entry.path}  ${mb(statSync(entry.path).size)}MB`);
console.log("\n注意：libc++ 已静态链接进各引擎（DT_NEEDED 只有系统库），无需额外 .so。");
