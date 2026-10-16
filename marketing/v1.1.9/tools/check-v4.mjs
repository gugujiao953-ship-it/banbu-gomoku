/** 从成片抽帧体检 + 用 ffmpeg 自身取规格（ffprobe 在本机被锁，改用 ffmpeg -i 的 stderr） */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const MP4 = path.join(ROOT, "video", "半步五子棋打谱-1.1.9.1-宣传片.mp4");
const OUT = path.join(ROOT, "video", "_check-v4");
const FFMPEG = "C:/Tools/ffmpeg.exe";
const FFPROBE = "C:/Tools/ffprobe.exe";
mkdirSync(OUT, { recursive: true });

try {
  console.log(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration,size,bit_rate", "-show_entries", "stream=codec_name,width,height,r_frame_rate,pix_fmt,color_range,color_space,sample_rate,channels", "-of", "default=noprint_wrappers=1", MP4], { encoding: "utf8" }).trim());
} catch (error) {
  console.log("ffprobe 不可用:", String(error).split("\n")[0]);
}

/* 规格：ffmpeg -i 把信息写在 stderr，正常退出码为 1 */
let info = "";
try {
  execFileSync(FFMPEG, ["-hide_banner", "-i", MP4, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
} catch (error) {
  info = String(error.stderr || "");
}
const dur = (info.match(/Duration: (\d+):(\d+):([\d.]+)/) || []).slice(1);
const video = (info.match(/Stream #0:0.*/) || [""])[0].trim();
const audio = (info.match(/Stream #0:1.*/) || [""])[0].trim();
console.log("时长:", dur.length ? `${dur[0]}h${dur[1]}m${dur[2]}s` : "(未解析)");
console.log("视频流:", video.slice(0, 150));
console.log("音频流:", audio.slice(0, 110));
console.log("大小:", (statSync(MP4).size / 1048576).toFixed(1) + "MB");

const times = [1.2, 3.3, 6.8, 12.0, 21.0, 29.0, 36.6, 42.5, 61.5];
const rows = [];
for (const t of times) {
  const file = path.join(OUT, `t${String(t).replace(".", "_")}.jpg`);
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-ss", String(t), "-i", MP4, "-frames:v", "1", "-update", "1", file]);
  const size = statSync(file).size;
  rows.push(`t=${String(t).padStart(5)} → ${String(Math.round(size / 1024)).padStart(4)}KB ${size > 15000 ? "OK" : "!! 可能空白"}`);
}
console.log(rows.join("\n"));
