/** 侦察：近期版本说明、道具卡/自定义布局对弈的位置、宣传页结构 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const R = "D:/Projects/五子棋2/";
const show = (t, v) => console.log(t + ": " + v);

/* ① 近期版本说明 */
const rn = readFileSync(R + "src/release-notes.ts", "utf8");
const blocks = [...rn.matchAll(/"(1\.1\.9\.[2-9]\d)":\s*\{([\s\S]{0,1800}?)summary:\s*"([^"]{10,220})"/g)];
console.log("=== 近期版本（1.1.9.2x–3x）===");
for (const b of blocks.slice(0, 6)) {
  console.log("· " + b[1] + " —— " + b[3].slice(0, 130));
  const titles = [...b[2].matchAll(/title:\s*"([^"]{2,40})"/g)].map((m) => m[1]);
  if (titles.length) console.log("   条目: " + titles.join(" / "));
}

/* ② 新功能落点 */
const kws = ["道具卡", "道具", "自定义布局", "布局", "道具商店", "卡片"];
const hits = {};
const walk = (d, depth) => {
  if (depth > 4) return;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (/^(node_modules|\.git|dist|dist-web|artifacts|experiments)$/.test(e.name)) continue;
    const p = d + "/" + e.name;
    if (e.isDirectory()) { walk(p, depth + 1); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    let t;
    try { t = readFileSync(p, "utf8"); } catch { continue; }
    for (const k of kws) if (t.includes(k)) (hits[k] = hits[k] || []).push(p.replace(R, ""));
  }
};
walk(R + "src", 0);
console.log();
for (const k of kws) {
  const list = [...new Set(hits[k] || [])];
  if (list.length) console.log("「" + k + "」(" + list.length + " 文件): " + list.slice(0, 8).join(" "));
}

/* ③ 宣传页结构 */
const site = R + "marketing/v1.1.9/site/index.html";
if (existsSync(site)) {
  const s = readFileSync(site, "utf8");
  console.log();
  console.log("=== 宣传页 ===");
  const ids = [...s.matchAll(/<section[^>]*id="([\w-]+)"/g)].map((m) => m[1]);
  show("section id", ids.join(" "));
  const h3 = [...s.matchAll(/<h3[^>]*>([\s\S]{0,60}?)<\/h3>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  show("h3 列表", h3.slice(0, 22).join(" | "));
  const chips = [...s.matchAll(/class="[^"]*(chip|tag|pill|feature)[^"]*"[^>]*>([^<]{2,24})</g)].map((m) => m[2].trim());
  show("标签文字", [...new Set(chips)].slice(0, 26).join(" | "));
  const dl = [...s.matchAll(/(v?1\.1\.9[.\d]*)\.apk/g)].map((m) => m[0]);
  show("APK 提及", [...new Set(dl)].join(" ") || "(无)");
}
