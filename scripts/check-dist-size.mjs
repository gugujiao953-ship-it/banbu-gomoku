import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
// 网页资源预算 20MB —— **不含 engine-packs/**（用户 09-13 拍板）。
// 引擎档位包是 40MB 的 NNUE 数据，随 APK 分发（Capacitor 原样拷进 assets，
// 装完即用、免下载）。它不是「网页资源」，也已在 workbox 预缓存中排除，
// 不影响加载性能，故不计入本预算。
const limit = 20 * 1024 * 1024;

async function totalSize(directory, { skipEnginePacks = false } = {}) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipEnginePacks && entry.isDirectory() && entry.name === "engine-packs") continue;
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await totalSize(path, { skipEnginePacks }) : (await stat(path)).size;
  }
  return total;
}

const size = await totalSize(root, { skipEnginePacks: true });
const enginePacks = await totalSize(join(root, "engine-packs")).catch(() => 0);
console.log(
  `dist 网页资源 ${(size / 1024 / 1024).toFixed(2)}MB（上限 20MB，不含引擎包）` +
  (enginePacks ? `；engine-packs/ ${(enginePacks / 1024 / 1024).toFixed(2)}MB 随包分发不计入` : ""),
);
if (size > limit) throw new Error("网页资源超过 20MB 体积预算");
