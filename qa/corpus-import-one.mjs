import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { importRecordFile } from "../src/formats.ts";
import { compactNodeCount } from "../src/compact-index.ts";

const path = process.env.AUDIT_FILE || process.argv[2];
try {
  const result = await importRecordFile(new File([await readFile(path)], basename(path)));
  const documents = [result.document, ...(result.additionalDocuments || [])];
  const count = documents.reduce((total, document) => total + (compactNodeCount(document) ?? Object.values(document.nodes).length), 0);
  if (count <= documents.length) throw new Error("导入成功但没有识别到任何落子或局面节点（疑似空导入）");
  console.log(JSON.stringify({ ok: true, format: result.format, documents: documents.length, nodes: count, warnings: result.warnings.length }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
