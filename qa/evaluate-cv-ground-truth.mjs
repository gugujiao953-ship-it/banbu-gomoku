// Compare an application recognition export with row/col/player ground truth.
// Usage: node qa/evaluate-cv-ground-truth.mjs --cv cv.json --truth batch-result.jsonl --out report.json
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    cv: { type: "string" },
    truth: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.cv || !values.truth) throw new Error("Usage: node qa/evaluate-cv-ground-truth.mjs --cv report.json --truth truth.jsonl [--out report.json]");

const cv = JSON.parse(readFileSync(values.cv, "utf8"));
const truthByImage = new Map();
for (const line of readFileSync(values.truth, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  truthByImage.set(row.image, row);
}

const key = (row, col) => `${row},${col}`;
const rows = [];
let total = { gt: 0, predicted: 0, tp: 0, fp: 0, fn: 0, colorErrors: 0, exact: 0 };
for (const entry of cv.entries || []) {
  const truth = truthByImage.get(basename(entry.image));
  if (!truth) continue;
  const expected = new Map();
  for (const stone of truth.black || []) expected.set(key(stone.row, stone.col), "black");
  for (const stone of truth.white || []) expected.set(key(stone.row, stone.col), "white");
  const predicted = new Map((entry.stones || []).map((stone) => [key(stone.row, stone.col), stone.player]));
  let tp = 0;
  let colorErrors = 0;
  for (const [position, player] of predicted) {
    if (!expected.has(position)) continue;
    if (expected.get(position) === player) tp += 1;
    else colorErrors += 1;
  }
  const fp = [...predicted.keys()].filter((position) => !expected.has(position)).length;
  const fn = [...expected.keys()].filter((position) => !predicted.has(position)).length;
  const exact = fp === 0 && fn === 0 && colorErrors === 0;
  const row = {
    image: basename(entry.image),
    gt: expected.size,
    predicted: predicted.size,
    tp,
    fp,
    fn,
    colorErrors,
    exact,
  };
  rows.push(row);
  for (const field of ["gt", "predicted", "tp", "fp", "fn", "colorErrors"]) total[field] += row[field];
  if (exact) total.exact += 1;
}

const report = {
  schemaVersion: 1,
  source: { cv: values.cv, truth: values.truth },
  images: rows.length,
  totals: {
    ...total,
    precision: total.predicted ? total.tp / total.predicted : 0,
    recall: total.gt ? total.tp / total.gt : 0,
    exactRate: rows.length ? total.exact / rows.length : 0,
  },
  rows,
};
for (const row of rows) {
  console.log(`${row.image}: ${row.tp}/${row.gt} correct, fp=${row.fp}, fn=${row.fn}, color=${row.colorErrors}, exact=${row.exact}`);
}
console.log(`TOTAL: ${total.tp}/${total.gt}, precision=${report.totals.precision.toFixed(4)}, recall=${report.totals.recall.toFixed(4)}, exact=${total.exact}/${rows.length}`);
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + "\n", "utf8");
