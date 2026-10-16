import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const SEGMENTS = [
  [0, 4, "别只落子。把下一手看清。"],
  [4, 11, "一手棋，展开整盘可能。"],
  [11, 17, "来自哪里，都能接住。"],
  [17, 24, "照片不是终点。核对、修正、复原。"],
  [24, 31, "把胜势练成反射。"],
  [31, 42, "旗舰引擎，随包而来。离线，也能深算。"],
  [42, 51, "AI 不在后台。它就在这盘棋里。"],
  [51, 58, "一局一景。每一手都有气质。"],
  [58, 65, "切到后台，棋局不会掉线。"],
  [65, 73, "打谱、做题、分析、对弈。一条学习链。"],
  [73, 78, "给每一手，留下答案。"],
];
const ts = s => { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); const ms = Math.round((s - Math.floor(s)) * 1000); return `00:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`; };
const srt = SEGMENTS.map(([a, b, text], i) => `${i + 1}\n${ts(a + .18)} --> ${ts(b - .22)}\n${text}\n`).join("\n");
const out = path.join(ROOT, "video", "半步五子棋打谱-v1.1.9-v2.srt");
await writeFile(out, srt, "utf8");
console.log(`SRT OK -> ${out}`);
