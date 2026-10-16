import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "video");

/* 与 promo.html 的 SEGS 同步（72s，11 段）*/
const SEGS = [
  [0.0,   4.8,  "半步五子棋打谱 — 手机端打谱研究工具"],
  [4.8,   9.6,  "拍一张棋盘照片，整局棋零误差自动复原"],
  [9.6,   14.4, "SGF · LIB · DP · DB · JSON · POS 一键导入"],
  [14.4,  21.6, "分支树管理变化，书签直达关键局面"],
  [21.6,  30.0, "内置《九天指南》，原谱自带文字标注"],
  [30.0,  37.2, "本地引擎完全离线，冠军网络一键启用"],
  [37.2,  45.6, "持续 · 自对弈 · 提示，候选变化展开即看"],
  [45.6,  52.8, "常驻计算，越算越深，数字持续刷新"],
  [52.8,  60.0, "四档对战强度，开局库毫秒落子"],
  [60.0,  64.8, "VCF 习题 · 棋谱库 · 标注写回 · 快速面板"],
  [64.8,  72.0, "研究，从半步开始"],
];

const ts = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

const LEAD = 0.22, TAIL = 0.35;
let srt = "";
SEGS.forEach(([a, b, text], i) => {
  srt += `${i + 1}\n${ts(a + LEAD)} --> ${ts(b - TAIL)}\n${text}\n\n`;
});
const base = "半步五子棋打谱-v1.1.8-宣传片-v2";
await writeFile(path.join(OUT, base + ".srt"), srt, "utf8");

const ast = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60), cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};
let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Banbu,Microsoft YaHei,46,&H00FFFFFF,&H00FFFFFF,&H78000000,&H90080A0F,0,0,0,0,100,100,1,0,3,10,0,2,120,120,40,134

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
SEGS.forEach(([a, b, text], i) => {
  ass += `Dialogue: 0,${ast(a + LEAD)},${ast(b - TAIL)},Banbu,,0,0,0,,${text}\n`;
});
await writeFile(path.join(OUT, base + ".ass"), ass, "utf8");
console.log("SRT/ASS OK ->", OUT);