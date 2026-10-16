/**
 * 编码（encode.sh 的 Node 版，避免 shell PATH 问题）
 * 用法： node encode.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const VIDEO = path.join(ROOT, "video");
const FRAMES = path.join(VIDEO, "frames");
const BGM = path.join(VIDEO, "bgm.wav");
const OUT = path.join(VIDEO, "半步五子棋打谱-v1.1.8-宣传片.mp4");

if (!existsSync(FRAMES)) throw new Error("frames 目录不存在");
const n = readdirSync(FRAMES).filter(f => f.endsWith(".jpg")).length;
console.log("帧数 =", n);
if (!existsSync(BGM)) throw new Error("bgm.wav 不存在");

const args = [
  "-y", "-hide_banner", "-loglevel", "warning", "-stats",
  "-framerate", "30", "-i", path.join(FRAMES, "f%05d.jpg"),
  "-i", BGM,
  "-c:v", "libx264", "-preset", "slow", "-crf", "17",
  "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.0",
  "-x264-params", "keyint=60:min-keyint=30:scenecut=0:ref=4:bframes=3",
  "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
  "-shortest", "-movflags", "+faststart",
  OUT,
];
console.log("开始编码…");
execFileSync("ffmpeg", args, { stdio: "inherit" });

const st = statSync(OUT);
const probe = execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration,size,bit_rate",
  "-show_entries", "stream=codec_name,width,height,r_frame_rate",
  "-of", "default=noprint_wrappers=1", OUT,
], { encoding: "utf8" });
console.log("\n=== 成片 ===");
console.log(probe.trim());
console.log("大小 =", (st.size / 1048576).toFixed(1), "MB");
console.log("mtime =", st.mtime.toISOString());
