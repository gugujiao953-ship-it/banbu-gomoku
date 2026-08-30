import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { importKaibaoPuzzleJson } from "../src/puzzles.ts";

const files = process.argv.slice(2);
if (!files.length) throw new Error("用法：npx vite-node qa/puzzle-json-import-corpus.mjs <json文件>...");

const results = [];
for (const path of files) {
  try {
    const report = importKaibaoPuzzleJson(await readFile(path, "utf8"), basename(path));
    results.push({ file: path, ok: true, puzzles: report.collection.puzzles.length, skipped: report.skipped, warnings: report.warnings.length });
  } catch (error) {
    results.push({ file: path, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;
