/** 从抓取日志的面板文字里，按顺序抽出棋盘材质名 */
import { readFileSync, existsSync } from "node:fs";

const logs = ["D:/Projects/五子棋2/marketing/v1.1.9/tools/_boards.log", "D:/Projects/五子棋2/marketing/v1.1.9/tools/_boards2.log"];
let text = "";
for (const p of logs) {
  if (!existsSync(p)) continue;
  const line = readFileSync(p, "utf8").split("\n").find((l) => l.startsWith("面板文字"));
  if (line) text += " " + line;
}
const after = text.slice(Math.max(0, text.indexOf("棋盘材质")));
/* 素材卡片的文字形态：名字 + 「默认盘/暖…/自带动效」描述，名字里可能含「 · 」 */
const names = [];
const re = /([\u4e00-\u9fa5A-Za-z0-9·]+(?: · [\u4e00-\u9fa5A-Za-z0-9]+)?)\s*(默认盘|自带动效|暖|纯|逐帧|深|浅|低|高|雪落|纸质|纸|布|木|石|墨|线|格|色)/g;
let m;
while ((m = re.exec(after)) !== null) {
  const n = m[1].trim();
  if (n.length >= 2 && !names.includes(n)) names.push(n);
}
console.log("顺序抽出的名字（前 40）:");
names.slice(0, 40).forEach((n, i) => console.log("  " + i + ". " + n));
console.log();
console.log("含关键词的条目:", names.filter((n) => /敦煌|木刻|版画/.test(n)).join(" / ") || "(本页未见敦煌/木刻)");
console.log();
console.log("面板原文长度:", after.length);
console.log("原文片段:", after.slice(0, 1200));
