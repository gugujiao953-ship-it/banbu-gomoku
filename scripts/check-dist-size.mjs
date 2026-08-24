import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const limit = 20 * 1024 * 1024;

async function totalSize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await totalSize(path) : (await stat(path)).size;
  }
  return total;
}

const size = await totalSize(root);
console.log(`dist 体积 ${(size / 1024 / 1024).toFixed(2)}MB（上限 20MB）`);
if (size > limit) throw new Error("网页资源超过 20MB 体积预算");
