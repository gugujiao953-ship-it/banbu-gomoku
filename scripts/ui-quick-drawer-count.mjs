// 快捷中心条目池的「单真源」读取器（2026-09-23）。
//
// 背景：ui-quick-drawer-custom-check.mjs 过去自己维护一份条目清单镜像表 + 写死的
// 条目数 39。池子加了条目而镜像表没加时，S5 会静默通过——「快捷中心覆盖不全」
// 那类缺口就是这么漏出去的。这里直接从 src/quick-drawer-customization.ts 读出
// 池子与分区表的真实数量，供门禁比对，避免第二真源。
//
// 用法（在跑 ui-quick-drawer-custom-check.mjs 之前）：
//   eval "$(node scripts/ui-quick-drawer-count.mjs --export)"
// 或单独查看：
//   node scripts/ui-quick-drawer-count.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/quick-drawer-customization.ts"), "utf8");

const countBetween = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`找不到片段：${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`找不到结束标记：${endMarker}`);
  return source.slice(start, end);
};

// 条目：QUICK_DRAWER_ITEMS 数组里每个 `{ id: "…"` 一行
const itemsBlock = countBetween("export const QUICK_DRAWER_ITEMS", "export const QUICK_DRAWER_STORAGE_KEY");
const itemIds = [...itemsBlock.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);

// 分区：QUICK_DRAWER_SECTIONS 数组里的 id
const sectionsBlock = countBetween("export const QUICK_DRAWER_SECTIONS", "export const QUICK_DRAWER_ITEMS");
const sectionIds = [...sectionsBlock.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);

if (itemIds.length === 0 || sectionIds.length === 0) {
  console.error(`读取失败：条目=${itemIds.length} 分区=${sectionIds.length}（解析规则可能与池子写法脱节）`);
  process.exit(1);
}

if (process.argv.includes("--export")) {
  console.log(`export BANBU_EXPECTED_DRAWER_ITEMS=${itemIds.length}`);
  console.log(`export BANBU_EXPECTED_DRAWER_GROUPS=${sectionIds.length}`);
} else {
  console.log(`条目 ${itemIds.length} 项 · 分区 ${sectionIds.length} 个`);
  console.log(`分区：${sectionIds.join(" / ")}`);
}
