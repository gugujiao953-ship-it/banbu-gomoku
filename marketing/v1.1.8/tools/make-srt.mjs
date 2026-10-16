import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "video");

const SEGS = [
  [0,    7.0,  "半步五子棋打谱 · 开源免费的手机端五子棋打谱软件。"],
  [7.0,  12.5, "一张棋盘，八种能力：打谱、导入、识谱、分析、对战、主题、分支、做题。"],
  [12.5, 18.5, "SGF、RenLib 的 LIB 库、DP、DB、JSON、POS，以及直接拍照识谱。"],
  [18.5, 27.0, "内置《九天指南》局面库，原谱自带的文字标注直接显示在棋盘上。"],
  [27.0, 34.0, "本地 Rapfi 引擎，完全离线。候选点、评估分与 VCF 必胜搜索。"],
  [34.0, 40.5, "初级到大师四档强度，0.6 秒到 10 秒一步，随时悔棋重来。"],
  [40.5, 49.0, "14 种棋盘 × 16 种棋子 × 22 套外观，任你搭配。"],
  [49.0, 54.0, "拍一张棋盘照片，自动识别落子，变成可编辑的棋谱。"],
  [54.0, 60.5, "树形图看清整盘变化，关键局面一键加书签，随时回到分叉点。"],
  [60.5, 64.5, "半步五子棋打谱 v1.1.8 —— 手机端五子棋打谱软件。"],
];

const ts = (s) => {
  const h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = Math.floor(s%60), ms = Math.round((s-Math.floor(s))*1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
};

const LEAD = 0.22, TAIL = 0.35;
let srt = "";
SEGS.forEach(([a,b,text], i) => {
  srt += `${i+1}\n${ts(a+LEAD)} --> ${ts(b-TAIL)}\n${text}\n\n`;
});
await writeFile(path.join(OUT, "半步五子棋打谱-v1.1.8-宣传片.srt"), srt, "utf8");

// 附带一个带样式信息的 ASS（需要重新烧字幕时可用）
const assHead = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Banbu,Microsoft YaHei,46,&H00FFFFFF,&H00FFFFFF,&H78000000,&H90080A0F,0,0,0,0,100,100,1,0,3,10,0,2,180,180,42,134

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const ast = (s) => {
  const h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = Math.floor(s%60), cs = Math.round((s-Math.floor(s))*100);
  return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
};
let ass = assHead;
SEGS.forEach(([a,b,text]) => {
  ass += `Dialogue: 0,${ast(a+LEAD)},${ast(b-TAIL)},Banbu,,0,0,0,,${text}\n`;
});
await writeFile(path.join(OUT, "半步五子棋打谱-v1.1.8-宣传片.ass"), ass, "utf8");

console.log("SRT + ASS written. segments:", SEGS.length);
