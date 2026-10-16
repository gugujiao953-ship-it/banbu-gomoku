/**
 * 把官方引擎包按 App 的调优规则处理一份，供**基准对比**使用。
 *
 * App 内的调优是会话内存里的等长字节手术（IndexedDB 里始终是官方字节，见
 * engine-pack.ts 的 tunePackBytes），所以想在命令行里量「调优后」的速度就得
 * 自己生成一份：把官方包的三针改掉，包括把 default_thread_num 提到 4（单线程
 * 构建忽略该字段，多线程构建读它）。产出 public/.tmp-tuned-pack.data，配
 * scripts/benchmark-rapfi.mjs 的 AI_ENGINE=multi AI_DATA_URL=/.tmp-tuned-pack.data
 * 使用；用完请删掉，public/ 下的文件会被打进构建产物（曾顶爆 20MB 体积预算）。
 *
 * 针与偏移复制自 src/features/ai/engine-pack.ts；偏离会打「未命中」并计数，
 * 所以改针时这里会显式报出来，不会静默用旧针。
 */
import { readFileSync, writeFileSync } from "node:fs";

const SEGMENT_START = 11470;
const SEGMENT_END = 18183;
const NEEDLES = [
  ["aspiration_window = true", "aspiration_window= false"],
  ["advanced_stop_ratio = 0.75", "advanced_stop_ratio = 0.90"],
  // 线程数可调：THREADS=8 node scripts/make-tuned-pack.mjs
  ["default_thread_num = 1", `default_thread_num = ${Math.min(99, Math.max(1, Number(process.env.THREADS || 4)))}`.padEnd("default_thread_num = 1".length)],

];

const bytes = readFileSync("public/engine-packs/rapfi-full-v3.data");
const encoder = new TextEncoder();
let applied = 0;
for (const [findText, replaceText] of NEEDLES) {
  const find = encoder.encode(findText);
  const replace = encoder.encode(replaceText);
  if (find.length !== replace.length) throw new Error("针长度不等长：" + findText);
  const scope = bytes.subarray(SEGMENT_START, SEGMENT_END);
  let idx = -1;
  outer: for (let i = 0; i <= scope.length - find.length; i += 1) {
    for (let j = 0; j < find.length; j += 1) if (scope[i + j] !== find[j]) continue outer;
    idx = i;
    break;
  }
  if (idx < 0) { console.log("✗ 未命中：", findText); continue; }
  bytes.set(replace, SEGMENT_START + idx);
  applied += 1;
  console.log("✓ 命中并替换：", findText, "->", replaceText, "@", SEGMENT_START + idx);
}
writeFileSync("public/.tmp-tuned-pack.data", bytes);
console.log(`应用 ${applied}/${NEEDLES.length} 针，写出 public/.tmp-tuned-pack.data（${bytes.length} 字节）`);
