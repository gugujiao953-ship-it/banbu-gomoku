/** 抽取宣传页要改的几块（版本标签、这一版、下载区），压缩输出 */
import { readFileSync } from "node:fs";

const P = "D:/Projects/五子棋2/marketing/v1.1.9/site/index.html";
const s = readFileSync(P, "utf8");

/* 1) 各 section 的起止与首行，用于定位 */
const marks = [...s.matchAll(/<section[^>]*id="([\w-]+)"[^>]*>/g)].map((m) => ({ id: m[1], at: m.index }));
console.log("=== 段落地图 ===");
marks.forEach((m, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].at : s.length;
  const body = s.slice(m.at, end);
  const txt = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log(`${m.id.padEnd(9)} ${Math.round(body.length / 1024)}KB  ${txt.slice(0, 90)}`);
});

/* 2) 版本标签出现处 */
console.log("\n=== 版本相关标记 ===");
for (const m of s.matchAll(/[^>\n]{0,80}v?1\.1\.9[^<\n]{0,80}/g)) {
  console.log("· " + m[0].replace(/\s+/g, " ").trim().slice(0, 120));
}

/* 3) 下载区整块 */
const dl = s.indexOf('id="download"');
console.log("\n=== 下载区（原样）===");
console.log(s.slice(dl - 60, dl + 2600));
