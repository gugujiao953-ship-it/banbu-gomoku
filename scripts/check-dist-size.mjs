import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
// 网页资源预算 —— **不含 engine-packs/**。
// 2026-10-04 定为 30MB（当时约 22.5MB）。
// 2026-10-07 上调到 45MB：识谱增强包改为**内置**（用户明确要「不要下载」）——
// public/ort/onnxruntime wasm 13.58MB + public/models/（cell-cls 1.9MB +
// digit-head-iter8 5.3MB）≈ 20.8MB；同时把误打进包里的 public/.tmp-bench
// 临时语料 4.4MB 移出（净增 ~16.4MB）。
// engine-packs/（38.8MB 引擎档位包）仍不计入：随 APK 分发、workbox 已排除预缓存。
const limit = 45 * 1024 * 1024;

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
  `dist 网页资源 ${(size / 1024 / 1024).toFixed(2)}MB（上限 45MB，不含引擎包）` +
  (enginePacks ? `；engine-packs/ ${(enginePacks / 1024 / 1024).toFixed(2)}MB 随包分发不计入` : ""),
);
if (size > limit) throw new Error("网页资源超过 45MB 体积预算");
