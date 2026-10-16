/** 逐文件删除 frames-* 临时帧目录，统计失败原因 */
import { readdirSync, statSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
import path from "node:path";

const base = "D:/Projects/五子棋2/marketing/v1.1.9/video";
for (const dir of ["frames-v4", "frames-v3", "frames-v2"]) {
  const full = path.join(base, dir);
  if (!existsSync(full)) { console.log("无", dir); continue; }
  let ok = 0;
  const fails = new Map();
  for (const name of readdirSync(full)) {
    const file = path.join(full, name);
    try {
      if (statSync(file).isDirectory()) continue;
      unlinkSync(file);
      ok += 1;
    } catch (error) {
      const code = error && error.code ? error.code : "UNKNOWN";
      fails.set(code, (fails.get(code) || 0) + 1);
    }
  }
  let removed = false;
  try { rmdirSync(full); removed = true; } catch { /* 还有残留 */ }
  console.log(`${dir}: 删除 ${ok} 个文件；失败 ${[...fails].map(([c, n]) => c + "×" + n).join(" ") || "无"}；目录${removed ? "已移除" : "仍存在：" + readdirSync(full).length + " 项"}`);
}
