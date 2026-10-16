// 半步五子棋打谱 · 1.1.9 宣传片合成脚本（ffmpeg）
//
// 读 artifacts/promo/1.1.9/shots/manifest.json + 各镜头的帧序列，**一次 ffmpeg** 过完：
// 变帧率的帧表 -> 30fps CFR -> 缩放到竖屏成片 -> H.264/yuv420p/faststart。
// 只编码一次（不先出中间 mp4 再合），所以画质不掉第二代。
//
// 用法：
//   node scripts/promo-119/compose.mjs
//   PROMO_FIT=blur   PROMO_SIZE=1080x1920  默认：同画面放大模糊补边
//   PROMO_FIT=solid                          纯色补边
//   PROMO_FIT=direct                         不补边，按录制比例出全画幅（1080x2348）
//   PROMO_PER_SHOT=1                         额外给每个镜头单独出一条 mp4（便于回看/复用）
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.resolve(ROOT, process.env.PROMO_OUT || path.join("artifacts", "promo", "1.1.9"));
const SHOTS_DIR = path.join(OUT, "shots");
const FINAL = path.join(OUT, "banbu-1.1.9-promo.mp4");
const FPS = Number(process.env.PROMO_FPS || 30);
const FIT = (process.env.PROMO_FIT || "blur").toLowerCase();     // blur | solid | direct
const [TW, TH] = (process.env.PROMO_SIZE || "1080x1920").split("x").map(Number);
const CRF = process.env.PROMO_CRF || "19";
const PRESET = process.env.PROMO_PRESET || "medium";

const run = (bin, args, label) => {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) { console.error(`[compose] ${label} 失败（exit ${r.status}）:\n${(r.stderr || r.stdout || "").slice(-3000)}`); process.exit(1); }
  return r;
};
const ffmpeg = (args, label) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], label);
const ffprobe = (file) => run("ffprobe", ["-v", "error", "-show_entries",
  "format=duration,size,bit_rate:stream=codec_name,profile,width,height,r_frame_rate,nb_frames,pix_fmt",
  "-of", "default=noprint_wrappers=1", file], "ffprobe").stdout.trim();

/* ------------------------------------------------- 1. 帧表 -> 一条 concat 清单 */

const manifest = JSON.parse(await readFile(path.join(SHOTS_DIR, "manifest.json"), "utf8"));
const src = manifest.captureSize || { width: 784, height: 1704 };
const shots = manifest.shots || [];
if (!shots.length) { console.error("[compose] manifest 里没有镜头，先跑 record.mjs"); process.exit(2); }
for (const s of shots) if (!s.frames?.length) { console.error(`[compose] 镜头 ${s.id} 一帧都没有`); process.exit(2); }

let total = 0;
const lines = [];
for (const shot of shots) {
  for (let i = 0; i < shot.frames.length; i++) {
    const t = shot.frames[i].t;
    const next = i + 1 < shot.frames.length ? shot.frames[i + 1].t : shot.seconds * 1000;
    let d = (next - t) / 1000;
    if (!(d > 0)) d = 1 / FPS;
    lines.push(`file '${shot.frames[i].f.replace(/\\/g, "/")}'`, `duration ${d.toFixed(4)}`);
  }
  lines.push(`file '${shot.frames[shot.frames.length - 1].f.replace(/\\/g, "/")}'`); // 末帧重复一次才会被显示
  total += shot.seconds;
}
const listFile = path.join(SHOTS_DIR, "concat-all.txt");
await mkdir(SHOTS_DIR, { recursive: true });
await writeFile(listFile, lines.join("\n") + "\n", "utf8");

/* ------------------------------------------------- 2. 几何与滤镜 */

const even = (n) => 2 * Math.round(n / 2);
const FGW = even((src.width * TH) / src.height);   // 补边时前景宽：高撑满 1920 -> 884
const OUT_H = FIT === "direct" ? even((TW * src.height) / src.width) : TH;

const fade = `,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, total - 0.5).toFixed(3)}:d=0.5`;
const filters = (() => {
  if (FIT === "direct") return ["-vf", `fps=${FPS},scale=${TW}:${OUT_H}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0${fade},format=yuv420p`];
  if (FIT === "solid") return ["-vf", `fps=${FPS},scale=${FGW}:${TH}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,pad=${TW}:${TH}:${Math.floor((TW - FGW) / 2)}:0:color=0x0e0f12${fade},format=yuv420p`];
  return ["-filter_complex",
    `[0:v]fps=${FPS},split=2[bg][fg];`
    + `[bg]scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},boxblur=14:2,eq=brightness=-0.05:saturation=0.75[bgb];`
    + `[fg]scale=${FGW}:${TH}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0[fgs];`
    + `[bgb][fgs]overlay=(W-w)/2:0${fade},format=yuv420p`];
})();

const geom = FIT === "direct" ? `${TW}x${OUT_H}` : `${TW}x${TH}`;
console.log(`[compose] 应用     ${manifest.appUrl}`);
console.log(`[compose] 镜头     ${shots.length} 个 / 帧 ${shots.reduce((a, b) => a + b.frameCount, 0)} 张 / 目标 ${total.toFixed(2)}s`);
console.log(`[compose] 源帧     ${src.width}x${src.height} -> 成片 ${geom} @${FPS}fps，fit=${FIT}`);

/* ------------------------------------------------- 3. 编码 */

const common = ["-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p",
  "-profile:v", "high", "-level", "4.1", "-movflags", "+faststart", "-an",
  "-r", String(FPS), "-fps_mode", "cfr", "-g", String(FPS * 2),
  "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];

if (process.env.PROMO_PER_SHOT === "1") {
  for (const shot of shots) {
    const per = (await readFile(path.join(SHOTS_DIR, shot.id, "concat.txt"), "utf8")).split("\n").filter(Boolean);
    const tmp = path.join(SHOTS_DIR, `.${shot.id}.local.txt`);
    await writeFile(tmp, per.join("\n") + "\n", "utf8");
    const one = path.join(SHOTS_DIR, `${shot.id}.mp4`);
    const chain = FIT === "direct"
      ? `fps=${FPS},scale=${TW}:${OUT_H}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,format=yuv420p`
      : `fps=${FPS},scale=${FGW}:${TH}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,pad=${TW}:${TH}:${Math.floor((TW - FGW) / 2)}:0:color=0x0e0f12,format=yuv420p`;
    ffmpeg(["-f", "concat", "-safe", "0", "-i", tmp, "-vf", chain, ...common], `镜头 ${shot.id}`);
    await rm(tmp, { force: true });
    console.log(`[compose] 单镜头 ${shot.id}.mp4 ok（${shot.seconds.toFixed(2)}s）`);
  }
}

await mkdir(OUT, { recursive: true });
await rm(FINAL, { force: true });
console.log("[compose] 合成整片…");
ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, ...filters, ...common, FINAL], "合成");

/* ------------------------------------------------- 4. 验证 */

const mb = statSync(FINAL).size / 1048576;
console.log("\n==== ffprobe 验证 ====");
console.log(ffprobe(FINAL));
console.log(`文件大小 ${mb.toFixed(2)} MB`);
if (mb < 1) { console.error("[compose] 成片小于 1MB，多半是帧表空或编码失败"); process.exit(3); }
console.log(`\n成片 ${FINAL}`);
