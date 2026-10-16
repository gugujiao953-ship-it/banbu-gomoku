import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const SEGMENTS = [
  [0, 2.4, "别只落子。把下一手看清。"],
  [2.4, 5, "1.1.9：引擎、对弈、识谱、复盘、棋钟、外观，一次补齐。"],
  [5, 8.2, "落子、回退、继续往下读；主线横排，变化缩进，棋盘放大到六倍。"],
  [8.2, 11, "一手棋，展开整盘可能；分支树、主分支和书签都能接着研究。"],
  [11, 13.8, "SGF、LIB、DP、DB、JSON、POS，六种格式从一个入口接住。"],
  [13.8, 17.8, "照片进来，对齐、识别、叠图、编辑、复原手序，确认之前原谱不被改。"],
  [17.8, 21.2, "四三不是运气，是可以重复的 VCF 训练；四十五秒，形成四才能继续。"],
  [21.2, 25.2, "KataGo 原生随包，Rapfi 0.43.02；iKataGo 接管分析，结果留在本机。"],
  [25.2, 28.2, "计算、复盘、胜率三页看懂一盘棋；分析结果还能从缓存继续。"],
  [28.2, 32.2, "AI 不在后台。强度、规则、执子、思考时间，都在专门的对弈界面里。"],
  [32.2, 35.4, "菲舍尔、布龙斯坦、包干、读秒；独立棋钟，正式比赛一样下。"],
  [35.4, 38.6, "公用效果实时预览，棋盘材质、棋子进场和主题即时反馈。"],
  [38.6, 41.6, "好棋、坏棋、疑问手，长按环形菜单就能留下证据。"],
  [41.6, 44.4, "切到后台，分析、AI 应手、复盘、VCF 生成一起暂停，回来继续。"],
  [44.4, 47.6, "棋谱库接住搜索、分类、草稿、收藏和批量处理；导出保留变化树、注释与标注。"],
  [47.6, 51, "给每一手，留下答案。半步五子棋打谱 1.1.9。"],
];
const timestamp = (seconds) => { const minutes = Math.floor(seconds / 60); const whole = Math.floor(seconds % 60); const millis = Math.round((seconds - Math.floor(seconds)) * 1000); return `00:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(millis).padStart(3, "0")}`; };
const srt = SEGMENTS.map(([start, end, text], index) => `${index + 1}\n${timestamp(start + 0.08)} --> ${timestamp(end - 0.12)}\n${text}\n`).join("\n");
const output = path.join(ROOT, "video", "半步五子棋打谱-v1.1.9-v3.srt");
await writeFile(output, srt, "utf8");
console.log(`SRT OK -> ${output}`);
