import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "video");
const SEGS = [
  [0, 7, "半步五子棋打谱 v1.1.9 · 手机端五子棋研究工具"],
  [7, 14, "从落子、分支到导出，一张棋盘完成整套研究流程"],
  [14, 21, "SGF · LIB · DP · DB · JSON · POS，拿来就读"],
  [21, 31, "识别之后先核对、再编辑，确认才生成棋谱"],
  [31, 40, "VCF 挑战 + 题目生成器，把必胜变化练成肌肉记忆"],
  [40, 50, "KataGo 随包自带，Rapfi 同步升级，离线也有算力"],
  [50, 59, "专门的对弈界面，四档强度，退出还能接着下"],
  [59, 68, "14 种棋盘 × 16 种棋子 × 20 套配色，实时预览"],
  [68, 77, "分支树、书签、棋谱库和导出，每一步都能回到现场"],
  [77, 82, "半步五子棋打谱 v1.1.9 —— 研究，从半步开始"],
];
const ts = (s) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `00:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};
let srt = "";
SEGS.forEach(([a, b, text], i) => { srt += `${i + 1}\n${ts(a + .2)} --> ${ts(b - .35)}\n${text}\n\n`; });
const base = "半步五子棋打谱-v1.1.9-宣传片";
await writeFile(path.join(OUT, `${base}.srt`), srt, "utf8");
console.log(`SRT OK -> ${path.join(OUT, `${base}.srt`)}`);
