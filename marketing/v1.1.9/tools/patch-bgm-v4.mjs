/** 由 make-bgm-v2.py 派生：改为 64 秒 / 9 段章节 / 输出 bgm-v4.wav */
import { readFileSync, writeFileSync } from "node:fs";

const src = "tools/make-bgm-v2.py";
const dst = "tools/make-bgm-v4.py";
let s = readFileSync(src, "utf8");

const edits = [
  ['"""Original 112 BPM score and sound design for the 78-second v1.1.9 film."""',
   '"""Original 112 BPM score and sound design for the 64-second 1.1.9.1 film (v4)."""'],
  ["DURATION = 78.0", "DURATION = 64.0"],
  ["CHAPTERS = [0, 4, 11, 17, 24, 31, 42, 51, 58, 65, 73]",
   "CHAPTERS = [0, 8.0, 17.0, 25.5, 34.0, 39.5, 45.5, 51.5, 57.5]"],
  ['"bgm-v2.wav"', '"bgm-v4.wav"'],
  ['Path("C:/Tools/ffmpeg.exe")', 'Path("ffmpeg")'],
  ['Path("C:/Tools/ffprobe.exe")', 'Path("ffprobe")'],
  ["Synthesizing original v1.1.9 score: 78 s / 112 BPM / 48 kHz stereo",
   "Synthesizing original 1.1.9.1 score: 64 s / 112 BPM / 48 kHz stereo"],
];

for (const [from, to] of edits) {
  if (!s.includes(from)) throw new Error("未找到待替换片段: " + from.slice(0, 48));
  s = s.split(from).join(to);
}
writeFileSync(dst, s, "utf8");
console.log("已生成", dst);
console.log("DURATION 行:", (s.match(/DURATION = [\d.]+/) || [])[0]);
console.log("CHAPTERS 行:", (s.match(/CHAPTERS = \[[^\]]+\]/) || [])[0]);
console.log("输出:", (s.match(/"bgm-v4\.wav"/) || [])[0]);
