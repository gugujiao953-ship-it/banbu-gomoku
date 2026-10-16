// 只剥离「手机 App 内」那份网页引擎包（2026-10-07 用户要求：只限手机 App 去掉，网页版保留）。
//
// 背景：dist/engine-packs/rapfi-full-v3.data（38.4MB）是**网页版** rapfi 的冠军权重档。
// 安卓的算力走 jniLibs 原生引擎 + assets/engine-native 权重（39MB，本就在包里），
// 这份网页权重在 APK 里是多余的一份；但网页版部署（GitHub Pages）仍需要它。
//
// 为什么单独成脚本：Capacitor 的 `cap sync` 会把整个 dist 拷进
// android/app/src/main/assets/public/，源里有什么就拷什么。此前 release 脚本靠
// 「先删 dist/engine-packs 再 sync」实现——那样连网页版那份也被删掉，且只在
// release 这一条路径生效（Android Studio 手动 sync + 打包时会重新拷进去 39MB）。
// 本脚本只删 Capacitor 的拷贝目标、不碰 dist，并挂在 android:sync 上，
// 覆盖所有安卓打包路径。
//
// 失败行为：目标不存在（还没 cap sync）时打印说明并正常退出；不做任何其它改动。
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "android/app/src/main/assets/public/engine-packs");

const dirSize = (dir) => {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
};

if (!existsSync(join(root, "android/app/src/main/assets/public"))) {
  console.log("跳过：android/app/src/main/assets/public 不存在（还没跑过 cap sync）。");
  process.exit(0);
}
if (!existsSync(target)) {
  console.log("跳过：APK 内本来就没有 engine-packs（已剥离）。");
  process.exit(0);
}

const before = dirSize(target);
rmSync(target, { recursive: true, force: true });
console.log(
  `已从手机 App 内剥离网页引擎包：public/engine-packs/ ${(before / 1048576).toFixed(1)}MB（APK 减重）\n` +
  `  · 安卓两大引擎不受影响：原生 rapfi 走 jniLibs + assets/engine-native 权重，KataGo 走 assets/engine-katago；\n` +
  `  · 仅在「原生引擎不可用 + 引擎档位选冠军/自调」时，应用会走线上获取该包（网页版部署仍保留它）。`,
);
