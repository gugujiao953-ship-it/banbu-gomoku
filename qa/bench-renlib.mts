import fs from "node:fs";
import { importRecordFile } from "../src/formats";

const bytes = Number(process.argv[2] || 64) * 1024 * 1024;
const file = new File([fs.readFileSync("D:/五子棋/定式谱/斜月.lib").subarray(0, bytes)], "probe.lib");
const started = performance.now();
try {
  const result = await importRecordFile(file);
  console.log(JSON.stringify({ ms: Math.round(performance.now() - started), stats: result.stats }));
} catch (error) {
  console.log(JSON.stringify({ ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) }));
}
