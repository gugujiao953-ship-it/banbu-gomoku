/** 出 v4 字幕（.srt），与 promo-v4.html 的 SEGS 一一对应 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const SEGMENTS = [
  [0, 8.0, "本地 KataGomo，功能丰富的五子棋手机打谱软件 —— 本地引擎 · VCF 挑战 · 题目生成器。"],
  [8.0, 16.5, "KataGo 随包自带、原生运行：小网 3.2MB、int8 大网 21.9MB，Rapfi 升到 0.43.02。"],
  [16.5, 24.5, "限时 45 秒，每手必须形成四；等级分 1000 起、每多一手 +200，封顶 9100。"],
  [24.5, 32.5, "档位与数量自选，一键出新题；独立验题通过才入题库，题池 8025 道。"],
  [32.5, 39.5, "认真下过的每一手都攒棋魂；成就分六类，攒下的棋魂能换外观与道具卡。"],
  [39.5, 45.5, "人机对弈可以自定义开局：自己摆子、存进局面库，也能从棋谱库挑一份来打。"],
  [45.5, 50.5, "SGF、LIB、DP、DB、JSON、POS，六种格式一个入口；安卓还能一次导入多份。"],
  [50.5, 56.0, "对齐、识别、叠图、核对、编辑、复原手序；确认之前原谱不会被改。"],
  [56.0, 63.6, "古风、铁线白描、水波、彩铅…… 新一批棋盘材质随包更新。"],
  [63.6, 69.1, "计算 / 复盘 / 胜率三页签、四档 AI 对弈、比赛棋钟，顶栏还能一键折叠。"],
  [69.1, 75.5, "半步五子棋打谱 1.2.0 —— 本地 KataGomo，功能丰富的五子棋手机打谱软件。"],
];

const timestamp = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const whole = Math.floor(seconds % 60);
  const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `00:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};
const srt = SEGMENTS.map(([start, end, text], index) => `${index + 1}\n${timestamp(start + 0.08)} --> ${timestamp(end - 0.12)}\n${text}\n`).join("\n");
const output = path.join(ROOT, "video", "半步五子棋打谱-1.2.0-宣传片.srt");
await writeFile(output, srt, "utf8");
console.log(`SRT OK -> ${output}`);
