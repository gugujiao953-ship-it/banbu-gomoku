/** 把 1.2.0 宣传页下载区换成已构建 APK 的真实数字（大小 / SHA-256 / versionCode） */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const APK = "D:/Projects/五子棋2/android/app/build/outputs/apk/release/app-release.apk";
const SITE = "D:/Projects/五子棋2/marketing/v1.2.0/site/index.html";

const buf = readFileSync(APK);
const sizeMB = (buf.length / 1048576).toFixed(1);
const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
const shaShort = sha.slice(0, 8) + "…" + sha.slice(-8);
console.log(`APK: ${sizeMB}MB  versionCode/Name 见 gradle`);
console.log(`SHA-256: ${sha}`);

let s = readFileSync(SITE, "utf8");
const before = s;

/* 旧 APK 事实（1.1.9 · 80.1MB · versionCode 65 · 旧 SHA）→ 换成新包的实测值 */
const OLD_SHA = "3A0733AD7C20789B85C0A655269738169986328B7B4D5C8012D86BD4B1309FB6";
s = s.split(OLD_SHA).join(sha);
s = s.split("3A0733AD…B1309FB6").join(shaShort);
s = s.split("（80.1MB）").join(`（${sizeMB}MB）`);
s = s.split("<b>80.1MB</b>").join(`<b>${sizeMB}MB</b>`);
s = s.split("versionCode <em>65</em>").join("versionCode <em>97</em>");
s = s.split("版本 1.1.9 · versionCode 65").join("版本 1.2.0 · versionCode 97");
s = s.split("versionCode 65 · 可直接覆盖安装").join("versionCode 97 · 可直接覆盖安装");
/* 下载卡片标题里的历史说明保留（提到 2026-09-17 的 1.1.9 测试包是有意留的） */

const n = s === before ? 0 : 1;
writeFileSync(SITE, s, "utf8");
console.log(n ? "已更新下载区数字" : "未发生变化（检查待替换串）");
const hits = [...s.matchAll(/(?:versionCode|SHA-256|MB)/g)].length;
console.log("页面中相关标记数:", hits);
for (const m of s.matchAll(/versionCode[^<]{0,20}(?:<em>)?\d+/g)) console.log("  ·", m[0].replace(/\s+/g, " ").slice(0, 48));
