/** 抽取：本版更新数组 + 关键区块标记（供改 1.2.0 用） */
import { readFileSync } from "node:fs";

const P = "D:/Projects/五子棋2/marketing/v1.1.9/site/index.html";
const s = readFileSync(P, "utf8");

const i = s.indexOf("本版更新（18 条");
console.log("=== 更新数组（含前后各 200 字）===");
console.log(s.slice(Math.max(0, i - 400), i + 2200));

console.log("\n=== 模块/统计类标记 ===");
for (const kw of ["MODULES", "MATERIALS", "ENTRIES", "SAMPLE"]) {
  const j = s.indexOf(kw);
  if (j >= 0) console.log("· " + kw + ": " + s.slice(j - 120, j + 260).replace(/\s+/g, " "));
}
