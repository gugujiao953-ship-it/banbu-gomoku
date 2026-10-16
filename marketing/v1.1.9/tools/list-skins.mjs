/** 列出外观皮肤名与外观界面挂点（供抓图脚本选目标） */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const ROOT = "D:/Projects/五子棋2/";
const show = (title, value) => console.log(title + ": " + value);

if (existsSync(ROOT + "src/appearance/materials")) {
  show("皮肤文件", readdirSync(ROOT + "src/appearance/materials").join(" "));
}
if (existsSync(ROOT + "src/appearance")) {
  show("appearance 根", readdirSync(ROOT + "src/appearance").filter((f) => !f.includes(".")).join(" "));
}

/* 从每个皮肤文件里抓中文名（name: "…" / `…`） */
const files = ["theme-dunhuang", "theme-tiexian", "illustrated-indie", "illustrated-print", "illustrated-handmade", "gufeng", "colored-pencil", "ripple", "verdant", "blues"];
for (const f of files) {
  for (const ext of [".ts", ".tsx"]) {
    const p = ROOT + "src/appearance/materials/" + f + ext;
    if (!existsSync(p)) continue;
    const s = readFileSync(p, "utf8");
    const names = [...s.matchAll(/name:\s*(?:"([^"]{2,30})"|'([^']{2,30})'|`([^`]{2,30})`)/g)]
      .map((m) => m[1] || m[2] || m[3])
      .filter((n) => /[\u4e00-\u9fa5]/.test(n));
    const uniq = [...new Set(names)];
    show(f + " (" + uniq.length + ")", uniq.slice(0, 14).join(" / "));
  }
}

/* 外观界面章节文件：找可点击的条目结构 */
const sectionDir = ROOT + "src/features/manual/sections";
if (existsSync(sectionDir)) {
  const target = readdirSync(sectionDir).filter((f) => /appearance|theme/i.test(f));
  show("外观章节文件", target.join(" "));
  for (const t of target) {
    const s = readFileSync(sectionDir + "/" + t, "utf8");
    const hooks = [...new Set([...s.matchAll(/data-[\w-]+/g)].map((m) => m[0]))].slice(0, 24);
    const labels = [...new Set([...s.matchAll(/(?:"([\u4e00-\u9fa5]{2,10})")/g)].map((m) => m[1]))].slice(0, 26);
    show(t + " 挂点", hooks.join(" "));
    show(t + " 文案", labels.join(" / "));
  }
}
