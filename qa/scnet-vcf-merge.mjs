// qa/scnet-vcf-merge-entry.ts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var playerNum = (p) => p === "black" ? 1 : 2;
var main = () => {
  const [dir, outFile] = process.argv.slice(2);
  if (!dir || !outFile) {
    console.error("usage: node vcf-merge.mjs <resultsDir> <outFile>");
    process.exit(2);
  }
  const files = readdirSync(dir);
  const walk = /* @__PURE__ */ new Map();
  for (const f of files.filter((x) => x.startsWith("walk-") && x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        walk.set(rec.id, rec);
      } catch {
      }
    }
  }
  const dfs = /* @__PURE__ */ new Map();
  for (const f of files.filter((x) => x.startsWith("dfs-") && x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        dfs.set(rec.id, rec);
      } catch {
      }
    }
  }
  const table = {};
  let nBad = 0, nFixed = 0;
  for (const [id, rec] of walk) {
    if (rec.verdict === "ok") continue;
    if (rec.verdict === "fixed" && rec.line && rec.d) {
      table[id] = { d: rec.d, e: rec.e, line: rec.line.map(([r, c, p]) => [r, c, playerNum(p)]) };
      nFixed += 1;
      continue;
    }
    const d = dfs.get(id);
    if (d && d.verdict === "fixed" && d.line && d.line.length) {
      const attacker = d.line[0].player;
      table[id] = { d: d.line.filter((m) => m.player === attacker).length, line: d.line.map((m) => [m.row, m.col, playerNum(m.player)]) };
      nFixed += 1;
      continue;
    }
    table[id] = { bad: true };
    nBad += 1;
  }
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(outFile, JSON.stringify(sorted), "utf8");
  console.log(`walk ${walk.size} \u9053\uFF08ok ${walk.size - nBad - nFixed} / fixed ${nFixed} / bad ${nBad}\uFF09\uFF1Bdfs \u8BB0\u5F55 ${dfs.size} \u6761`);
  console.log(`\u5DF2\u5199 ${outFile}\uFF1A${Object.keys(sorted).length} \u9879\uFF08bad=${Object.values(sorted).filter((v) => v.bad).length}\uFF09`);
};
main();
