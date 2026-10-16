/** 校验主题抓取是否有变化 + 拼联览图 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "D:/Projects/五子棋2/marketing/v1.1.9/seq/theme-v4/";
const files = readdirSync(DIR).filter((f) => /^\d\d\.png$/.test(f)).sort();
const hashes = new Map();
for (const f of files) {
  const h = createHash("md5").update(readFileSync(DIR + f)).digest("hex").slice(0, 8);
  hashes.set(f, h);
}
const uniq = new Set(hashes.values());
console.log("抓取张数:", files.length, "| 不同画面数:", uniq.size);
console.log("前 12 张指纹:", [...hashes].slice(0, 12).map(([f, h]) => f + ":" + h).join(" "));

/* 联览图：取前 32 张，5 列 */
const list = files.slice(0, 32);
const args = ["-y", "-loglevel", "error"];
for (const f of list) args.push("-i", DIR + f);
const filter = list.map((_, i) => `[${i}:v]scale=192:-1[v${i}]`).join(";") + ";" + list.map((_, i) => `[v${i}]`).join("") + `xstack=inputs=${list.length}:layout=` +
  list.map((_, i) => `${(i % 5) * 192}_${Math.floor(i / 5) * 416}`).join("|");
args.push("-filter_complex", filter, "-frames:v", "1", DIR + "_sheet.jpg");
try {
  execFileSync("C:/Tools/ffmpeg.exe", args, { stdio: ["ignore", "ignore", "pipe"] });
  console.log("联览图:", Math.round(statSync(DIR + "_sheet.jpg").size / 1024) + "KB");
} catch (error) {
  console.log("拼图失败:", String(error.stderr || error).slice(0, 300));
}
