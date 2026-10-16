#!/usr/bin/env node
/**
 * 构建 Android 原生 Rapfi 引擎（arm64-v8a / x86_64），并把它需要的权重铺到 APK 资源里。
 *
 * 为什么走原生：安卓 WebView 拿不到跨源隔离（设备实测 crossOriginIsolated 恒为
 * false、SharedArrayBuffer undefined），所以 wasm pthread 多线程在 APK 里永不生效。
 * 原生进程用真正的线程，不需要 SAB。模拟器实测（4 核 x86_64、同一局面、10 秒）：
 *   wasm 强力 23.7k nps → 原生 1 线程 44.8k → 2 线程 106k → 4 线程 235k（≈10×）
 *
 * ⚠ 版本必须与权重匹配（本轮踩过的大坑）：官方 master（describe = 250615-42-g3c94c2a、
 * 引擎 0.43.02）用的是**新格式经典模型**，250615 及更早只能读旧格式——报 "model xxxx.bin
 * ... not correct" 而整个起不来，看着像文件坏了，实际是模型格式变了。而分发的 40MB
 * 数据包 `rapfi-full-v3.data` 里装的还是旧格式那两份 ⇒ **只从数据包切片会把设备上的模型
 * 退回旧格式**。新格式模型入库在 `scripts/engine-native-overlay/`（≈108KB），脚本切完
 * 包会用它覆盖并核对源码检出点（`manifest.json` 的 `rapfiDescribe`）。
 *
 * ⚠ 顺序也是安全设计：切片先写到 `android/app/build/engine-native-staging/`（不在 assets
 * 里，编译中途崩了也不会被当成资产打进 APK），全部校验通过（含与
 * `NativeEnginePlugin.ENGINE_PAYLOAD_BYTES` 的字节和比对）才换掉正式目录。老版本是先
 * `rmSync` 正式目录再切片、再编译，中途任何一步抛错就把手机上能跑的 39MB 资产删了。
 *
 * 用法：
 *   node scripts/build-android-engine.mjs                    # 两个 ABI 都构建并铺资源
 *   node scripts/build-android-engine.mjs arm64-v8a          # 只构建一个
 *   node scripts/build-android-engine.mjs --assets-only      # 只重铺资产（不碰 NDK）
 *
 * 依赖：NDK（含 cmake/ninja）。本机用的路径见 DEFAULTS，可用环境变量覆盖：
 *   RAPFI_SRC  Rapfi 源码目录（默认 D:/Projects/_rapfi-src-0432，即 0.43.02 那一份）
 *   ANDROID_NDK / ANDROID_CMAKE / PROJECT  工具链路径
 *   RAPFI_ALLOW_REV_MISMATCH=1  明知不一致仍要继续（降级实验用；字节和校验仍会拦）
 * NDK 与 cmake 必须放在**纯英文路径**下：ninja 用 ANSI API，中文路径会直接报
 * "FindFirstFileExA ... 文件名、目录名或卷标语法不正确"。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = process.env.PROJECT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAPFI_SRC = process.env.RAPFI_SRC || "D:/Projects/_rapfi-src-0432";
const NDK = process.env.ANDROID_NDK || "D:/AndroidTools/ndk-r29";
const CMAKE_BIN = process.env.ANDROID_CMAKE || "D:/AndroidTools/cmake-3.22.1/bin";
const EXTRA_ARGS = process.argv.slice(2);
const ASSETS_ONLY = EXTRA_ARGS.includes("--assets-only");
const ABIS = EXTRA_ARGS.filter((value) => value.startsWith("arm") || value.startsWith("x86"));
const TARGET_ABIS = ASSETS_ONLY ? [] : (ABIS.length ? ABIS : ["arm64-v8a", "x86_64"]);

/**
 * 每个 ABI 要构建的变体。交叉编译时 Rapfi 不会自己开 SIMD（CMake 只提示），必须手动给。
 *
 * arm64 出**两份**（2026-09-16）：基线 `-march=armv8-a+simd`，以及 NEON DotProd
 * （`-march=armv8.2-a+dotprod`，Rapfi 的 `USE_NEON_DOTPROD` 一等选项）。DotProd 是
 * NNUE int8 点积的硬件加速（`sdot`/`udot`）——基线库里这类指令数为 **0**，等于把
 * NNUE 推理的主要加速手段整个放弃了。代价是 armv8.2 之前的机器会 SIGILL，所以
 * **不拿它当默认**：两份都打进包里，`NativeEnginePlugin` 启动时读 /proc/cpuinfo 的
 * `asimddp` 特性，支持才用 dotprod 那份，否则用基线（多 ~1.4MB）。
 */
const ABI_VARIANTS = {
  "arm64-v8a": [
    { name: "librapfi-engine.so", flags: ["-DUSE_NEON=ON"] },
    { name: "librapfi-engine-dotprod.so", flags: ["-DUSE_NEON=ON", "-DUSE_NEON_DOTPROD=ON"], buildSuffix: "dotprod" },
  ],
  "x86_64": [
    { name: "librapfi-engine.so", flags: ["-DUSE_SSE=ON", "-DUSE_AVX2=ON", "-DUSE_BMI2=ON"] },
  ],
};

const run = (file, args) => {
  console.log(`  $ ${file} ${args.join(" ")}`);
  execFileSync(file, args, { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
};
const windowsPath = (value) => value.replace(/^([A-Za-z]):\//, "$1:/");

// 1) 校验源码检出点与**入库的新格式经典模型**是否配套（这一步是本轮最大的坑，必须前置）
const overlayDir = join(PROJECT, "scripts/engine-native-overlay");
const overlay = JSON.parse(readFileSync(join(overlayDir, "manifest.json"), "utf8"));
if (!existsSync(RAPFI_SRC)) {
  throw new Error(
    `找不到 Rapfi 源码目录 ${RAPFI_SRC}。\n` +
    `入库的模型（scripts/engine-native-overlay/）是按 ${overlay.rapfiDescribe} 编出来的引擎用的，\n` +
    `换源码请先 clone 同一个检出点，或用 RAPFI_SRC 指到它。`,
  );
}
const described = execFileSync("git", ["-C", RAPFI_SRC, "describe", "--tags"], { encoding: "utf8" }).trim();
if (described !== overlay.rapfiDescribe && !process.env.RAPFI_ALLOW_REV_MISMATCH) {
  throw new Error(
    `Rapfi 源码检出点与入库模型不配套：期望 ${overlay.rapfiDescribe}（引擎 ${overlay.engineVersion}），实际 ${described}。\n` +
    `新格式经典模型只有 ${overlay.engineVersion} 的引擎读得了；用 250615 编出的引擎配上这批模型，\n` +
    `引擎会在加载模型时报 "not correct" 起不来（看着像文件坏了）。\n` +
    `先执行： git -C ${RAPFI_SRC} checkout ${overlay.rapfiDescribe}`,
  );
}
console.log(`Rapfi 源码：${RAPFI_SRC} @ ${described} ✓`);

// 2) Bionic 没有独立 libpthread，需要 CMake 里的 Android 分支
const cmakeLists = join(RAPFI_SRC, "Rapfi/CMakeLists.txt");
if (!readFileSync(cmakeLists, "utf8").includes("if(ANDROID)")) {
  const patch = join(PROJECT, "scripts/android-engine-rapfi.patch");
  if (!existsSync(patch)) throw new Error(`Rapfi/CMakeLists.txt 缺少 Android 分支，且找不到补丁 ${patch}`);
  run("git", ["-C", RAPFI_SRC, "apply", windowsPath(patch)]);
  console.log("  已应用 Android pthread 补丁");
} else {
  console.log("CMakeLists 已含 ANDROID 分支 ✓");
}

// 3) 切片 → 覆盖入库模型 → 调针 → 校验，全程只写 **staging 目录**，全部通过才换正式目录。
//    （包内本来就是 lz4 帧，引擎自己会解，所以这里只按 manifest 偏移切片，不做任何解压）
const packPath = join(PROJECT, "public/engine-packs/rapfi-full-v3.data");
const gluePath = join(PROJECT, "public/rapfi/full/rapfi-single.js");
const assetsDir = join(PROJECT, "android/app/src/main/assets/engine-native");
const stagingDir = join(PROJECT, "android/app/build/engine-native-staging");
const pack = readFileSync(packPath);
const packFiles = readFileSync(gluePath, "utf8").match(/files:\s*(\[[^\]]*\])/)?.[1];
if (!packFiles) throw new Error("未能从 glue 里解析出引擎包 manifest");
const entries = JSON.parse(packFiles.replace(/(\w+):/g, '"$1":'));
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
for (const entry of entries) {
  const name = String(entry.filename).replace(/^\//, "");
  writeFileSync(join(stagingDir, name), pack.subarray(entry.start, entry.end));
}

// 3b) 用**入库的新格式经典模型**覆盖数据包里那两份旧格式（差值 +24,693 字节）。
//     没有这一步，切出来的包配上新编的 0.43.02 引擎就是「model ... not correct」起不来；
//     而 2026-10-01 那次是手工铺的，脚本不知道它们的来历 ⇒ 谁再跑一遍脚本就把模型退回旧版。
for (const [name, size] of Object.entries(overlay.files)) {
  const source = join(overlayDir, name);
  if (!existsSync(source)) throw new Error(`入库模型缺失：${source}`);
  if (statSync(source).size !== size) throw new Error(`${source} 实际 ${statSync(source).size} 字节，与 manifest.json 记的 ${size} 不符`);
  const target = join(stagingDir, name);
  if (!existsSync(target)) throw new Error(`数据包切片里没有 ${name}：引擎包 manifest 变了，先核对 ${gluePath}`);
  copyFileSync(source, target);
}
console.log(`经典模型已换成入库的 ${overlay.engineVersion} 新格式（${Object.keys(overlay.files).join("、")}）`);

// 3c) 把切出来的 config.toml 按 App 的调优规则改针——**针表从网页版那份读**
//     （src/features/ai/engine-pack.ts 的 `CONFIG_TUNE_NEEDLES`），两条路共用一个真值。
//     为什么必须在打包时改：网页版是运行时改的（`tunePackBlob` 在生成包 URL 时做等长字节
//     手术），而**原生引擎是直接读这个文件**，运行时那套针到不了它 ⇒ 官方包里的 0.75
//     一直原样进了 APK，手机每手只用到预算的 71%（3 秒预算实测 OptiTime 2227ms，官方 0.9 是 2673ms）。
//     `default_thread_num` 那针**原生故意跳过**：我们每手都发 `INFO THREAD_NUM`（见
//     public/rapfi/rapfi-worker.js:1170），启动时先把线程铺满只是白白多发热。
//     ⚠ 每针都必须等长：`NativeEnginePlugin.ENGINE_PAYLOAD_BYTES` 是 9 件资产的字节和，
//     少一个字节 `isPayloadComplete()` 就判非法、原生引擎不启动。针未命中也**抛错**
//     （网页版那边是 fail-open 跳过，这里不能——静默跳过就又是一次两条路分叉）。
const needleBlock = /CONFIG_TUNE_NEEDLES\s*:\s*Array<\[string, string\]>\s*=\s*\[([\s\S]*?)\];/.exec(
  readFileSync(join(PROJECT, "src/features/ai/engine-pack.ts"), "utf8"),
)?.[1];
if (!needleBlock) throw new Error("读不到 src/features/ai/engine-pack.ts 的 CONFIG_TUNE_NEEDLES：网页版与原生会分叉，先把那边接上再打包");
const needles = [...needleBlock.matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2]]);
if (!needles.length) throw new Error("CONFIG_TUNE_NEEDLES 是空的：解析方式过期了");
const applied = [];
for (const [find, replace] of needles) {
  const key = find.split("=")[0].trim();
  if (key === "default_thread_num") continue;
  if (Buffer.byteLength(find) !== Buffer.byteLength(replace)) {
    throw new Error(`调针「${find} → ${replace}」不是等长的：会顶掉 ENGINE_PAYLOAD_BYTES 字节和校验，原生引擎直接不启动`);
  }
  const configPath = join(stagingDir, "config.toml");
  const before = readFileSync(configPath, "utf8");
  if (!before.includes(find)) throw new Error(`切出来的 config.toml 里没有「${find}」：官方包变了，请重新核对调优针（不要静默打包出没调优的 APK）`);
  writeFileSync(configPath, before.replace(find, replace));
  applied.push(`${find} → ${replace}`);
}
console.log(`config.toml 已按网页版同一套针调优（${applied.length} 针，等长）：${applied.join("；")}`);

// 3d) **字节和自检**：Java 那边 `isPayloadComplete()` 拿资产字节和当完整性标记，
//     对不上就直接不启动原生引擎。这里不拿前面累加的数字凑，而是**从 staging 目录重新
//     实测一遍**——任何一针、任何一次覆盖要是改变了文件长度，这里都会当场抓住。
const javaSrc = readFileSync(join(PROJECT, "android/app/src/main/java/cn/renjunote/mobile/NativeEnginePlugin.java"), "utf8");
const expectedBytes = Number(/ENGINE_PAYLOAD_BYTES = (\d+)L/.exec(javaSrc)?.[1]);
const assetNames = [...javaSrc.matchAll(/^\s*"([^"]+\.(?:toml|bin|lz4))",/gm)].map((m) => m[1]);
if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) throw new Error("读不到 NativeEnginePlugin.ENGINE_PAYLOAD_BYTES，没法校验字节和");
if (!assetNames.length) throw new Error("读不到 NativeEnginePlugin.ENGINE_ASSETS 的文件清单，没法校验字节和");
let stagedBytes = 0;
for (const name of assetNames) {
  const target = join(stagingDir, name);
  if (!existsSync(target)) throw new Error(`切片/覆盖后缺文件 ${name}：与 Java 侧 ENGINE_ASSETS 清单不一致，装到手机上引擎不会启动`);
  stagedBytes += statSync(target).size;
}
if (stagedBytes !== expectedBytes) {
  throw new Error(
    `切出来的资产字节和 ${stagedBytes} ≠ NativeEnginePlugin.ENGINE_PAYLOAD_BYTES ${expectedBytes}（差 ${stagedBytes - expectedBytes}）。\n`
    + "  多半是官方数据包或 scripts/engine-native-overlay/ 的模型与设备上跑的那套不一致，\n"
    + "  也可能是某一针的替换不是等长的（见上面 3c）。\n"
    + "  别改 Java 里的常量迁就包——先把两边对齐（或按新模型的真实字节和重算常量），\n"
    + "  否则装到手机上完整性校验失败，原生引擎根本不启动。",
  );
}
console.log(`资产校验通过：${assetNames.length} 个文件，${(stagedBytes / 1048576).toFixed(1)}MB，字节和 = ${expectedBytes} ✓`);

// 3e) 换到正式目录（前面任何一步抛错都不会走到这里，正式目录里的已知好资产原样保留）
const swapAssetsIntoPlace = () => {
  rmSync(assetsDir, { recursive: true, force: true });
  renameSync(stagingDir, assetsDir);
  console.log(`权重已铺到 ${assetsDir}/`);
};
swapAssetsIntoPlace();
if (ASSETS_ONLY) {
  console.log("\n--assets-only：只重铺资产，跳过 NDK 编译。");
  process.exit(0);
}

// 4) 交叉编译 + 剥离 + 放进 jniLibs（Android 会把 native libs 解到应用私有目录并允许执行，
//    这是不需要 root 就能 exec 一个自带二进制的标准做法）
const toolchain = `${windowsPath(NDK)}/build/cmake/android.toolchain.cmake`;
const strip = `${windowsPath(NDK)}/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe`;
for (const abi of TARGET_ABIS) {
  const variants = ABI_VARIANTS[abi];
  if (!variants) throw new Error(`未配置的 ABI：${abi}`);
  for (const variant of variants) {
    const buildDir = `${windowsPath(RAPFI_SRC)}/build-android-${abi}${variant.buildSuffix ? `-${variant.buildSuffix}` : ""}`;
    console.log(`\n=== 构建 ${abi}${variant.buildSuffix ? ` · ${variant.buildSuffix}` : ""} ===`);
    rmSync(buildDir, { recursive: true, force: true });
    run(`${windowsPath(CMAKE_BIN)}/cmake.exe`, [
      "-S", `${windowsPath(RAPFI_SRC)}/Rapfi`, "-B", buildDir, "-G", "Ninja",
      "-DCMAKE_MAKE_PROGRAM=" + `${windowsPath(CMAKE_BIN)}/ninja.exe`,
      `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
      `-DANDROID_ABI=${abi}`, "-DANDROID_PLATFORM=android-26", "-DCMAKE_BUILD_TYPE=Release",
      "-DNO_COMMAND_MODULES=ON", "-DNO_MULTI_THREADING=OFF", ...variant.flags, "-DENABLE_LTO=ON",
    ]);
    run(`${windowsPath(CMAKE_BIN)}/cmake.exe`, ["--build", buildDir, "-j", String(Math.max(4, cpus()))]);
    const built = `${buildDir}/pbrain-rapfi`;
    const jniDir = join(PROJECT, "android/app/src/main/jniLibs", abi);
    mkdirSync(jniDir, { recursive: true });
    const target = join(jniDir, variant.name);
    copyFileSync(built, target);
    try {
      run(strip, ["--strip-all", windowsPath(target)]);
    } catch {
      console.log("  （剥离失败，保留带调试信息的二进制——体积大但可用）");
    }
    console.log(`  → ${target} ${(statSync(target).size / 1048576).toFixed(1)}MB`);
  }
}

function cpus() {
  try { return require("node:os").cpus().length; } catch { return 8; }
}
console.log("\n完成。注意：jniLibs 里的文件必须以 lib*.so 命名才会被打进 APK（Android 只解压这个模式）。");
