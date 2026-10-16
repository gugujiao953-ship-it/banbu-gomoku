import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const VIDEO = path.join(ROOT, "video");
const FRAMES = path.join(VIDEO, "frames-v3");
const BGM = path.join(VIDEO, "bgm-v2.wav");
const OUT = path.join(VIDEO, "半步五子棋打谱-v1.1.9-v3.mp4");
if (!existsSync(FRAMES)) throw new Error("frames-v3 目录不存在");
const frames = readdirSync(FRAMES).filter((name) => /^f\d{5}\.jpg$/.test(name)).length;
if (frames !== 1530) throw new Error(`frames-v3 应有 1530 帧，实际 ${frames}`);
if (!existsSync(BGM)) throw new Error("bgm-v2.wav 不存在");
execFileSync("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "warning", "-stats",
  "-framerate", "30", "-i", path.join(FRAMES, "f%05d.jpg"), "-i", BGM,
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
  "-vf", "format=yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-profile:v", "high", "-level", "4.0", "-x264-params", "keyint=60:min-keyint=30:scenecut=0:ref=4:bframes=3",
  "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-shortest", "-movflags", "+faststart", OUT,
], { stdio: "inherit" });
const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size,bit_rate", "-show_entries", "stream=codec_name,width,height,r_frame_rate,pix_fmt,color_range,color_space", "-of", "default=noprint_wrappers=1", OUT], { encoding: "utf8" });
console.log(probe.trim());
console.log(`output=${OUT}`);
console.log(`size=${(statSync(OUT).size / 1048576).toFixed(1)}MB`);
