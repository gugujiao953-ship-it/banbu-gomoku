/** 取新功能口径：成就条数/分组、棋魂怎么攒、商店卖什么 */
import { readFileSync } from "node:fs";

const R = "D:/Projects/五子棋2/src/features/progress/";
const read = (f) => readFileSync(R + f, "utf8");

const cat = read("achievement-catalog.ts");
const ids = [...cat.matchAll(/id:\s*["'`]([a-z0-9._-]+)["'`]/g)].map((m) => m[1]);
const names = [...cat.matchAll(/name:\s*["'`]([^"'`]{2,24})["'`]/g)].map((m) => m[1]);
const groups = [...new Set([...cat.matchAll(/group:\s*["'`]([^"'`]{2,16})["'`]/g)].map((m) => m[1]))];
console.log("成就 id 数:", ids.length);
console.log("成就名(前 12):", names.slice(0, 12).join(" / "));
console.log("分组:", groups.join(" / ") || "(未用 group 字段)");
console.log();

for (const f of ["soul.ts", "soul-economy.ts", "soul-shop.ts", "soul-deliveries.ts"]) {
  let t;
  try { t = read(f); } catch { continue; }
  console.log("=== " + f + " ===");
  const lines = t.split("\n").filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l) && /[\u4e00-\u9fa5]/.test(l)).map((l) => l.replace(/^\s*(\/\/|\*|\/\*)\s?/, "").trim());
  console.log(lines.slice(0, 14).map((l) => "  · " + l.slice(0, 100)).join("\n"));
  const consts = [...t.matchAll(/export const ([A-Z_]+)\s*=\s*([^;\n]{1,60})/g)].map((m) => m[1] + " = " + m[2].trim());
  if (consts.length) console.log("  常量: " + consts.slice(0, 10).join(" | "));
  console.log();
}
