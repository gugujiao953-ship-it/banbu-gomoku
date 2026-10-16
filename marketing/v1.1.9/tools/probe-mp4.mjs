/** 不依赖 ffmpeg 的 MP4 规格读取：解析 mvhd / tkhd / avc1 盒 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const MP4 = path.join(ROOT, "video", "半步五子棋打谱-1.2.0-宣传片.mp4");
const buf = readFileSync(MP4);

const find = (type, from = 0) => {
  const idx = buf.indexOf(Buffer.from(type, "latin1"), from);
  return idx < 0 ? null : idx;
};

/* mvhd：版本 + timescale + duration */
let duration = null, timescale = null;
const mv = find("mvhd");
if (mv) {
  const version = buf[mv + 4];
  if (version === 0) {
    timescale = buf.readUInt32BE(mv + 16);
    duration = buf.readUInt32BE(mv + 20);
  } else {
    timescale = buf.readUInt32BE(mv + 24);
    duration = Number(buf.readBigUInt64BE(mv + 28));
  }
}

/* tkhd：画面宽高（16.16 定点） */
let width = null, height = null;
const tk = find("tkhd");
if (tk) {
  const version = buf[tk + 4];
  const off = version === 0 ? tk + 80 : tk + 92;
  width = Math.round(buf.readUInt32BE(off) / 65536);
  height = Math.round(buf.readUInt32BE(off + 4) / 65536);
}

const codecs = ["avc1", "hvc1", "mp4a", "ac-3"].filter((c) => find(c));
console.log("文件:", path.basename(MP4));
console.log("大小:", (statSync(MP4).size / 1048576).toFixed(1) + "MB");
console.log("时长:", duration && timescale ? (duration / timescale).toFixed(2) + "s" : "(未解析)", `(timescale=${timescale})`);
console.log("画面:", width ? `${width}×${height}` : "(未解析)");
console.log("编解码盒:", codecs.join(" "));
console.log("首字节:", buf.slice(4, 12).toString("latin1"), "(ftyp/moov 顺序，faststart 应为 moov 在前)");
