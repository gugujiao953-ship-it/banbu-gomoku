import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { importRecordFile } from '../src/formats.ts';
import { compactIndexOf } from '../src/compact-index.ts';
for (const path of process.argv.slice(2)) {
  const result = await importRecordFile(new File([await readFile(path)], basename(path)));
  const index = result.compactIndex;
  const commentRefs = index ? Array.from(index.textRefs).filter((v,i)=>i%2===0&&v>=0).length : 0;
  const boardTextRefs = index ? Array.from(index.textRefs).filter((v,i)=>i%2===1&&v>=0).length : 0;
  console.log(JSON.stringify({path, stats:result.stats, warnings:result.warnings.slice(-5), textPool:index?.texts.length, commentRefs, boardTextRefs, marks:index?.marks.length}));
}
