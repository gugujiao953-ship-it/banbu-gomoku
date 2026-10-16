import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const svg = readFileSync("public/theme-assets/scene-plum.svg", "utf8");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 500, height: 1000 } });
await p.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
await p.waitForTimeout(200);
console.log(await p.evaluate(() => {
  const out = [];
  // 只取"枝干"那两组的 path（主干系统 + 次干系统），排除积雪与远层的白线
  const groups = [...document.querySelectorAll("svg > g")];
  groups.forEach((g, gi) => {
    const stroke = g.getAttribute("stroke") || "";
    if (!/plumBark/.test(stroke)) return;
    const tag = gi === groups.findIndex(x => /plumBark\b(?!Far)/.test(x.getAttribute("stroke") || "")) ? "主干系统" : "次干系统";
    [...g.querySelectorAll("path")].forEach((path, i) => {
      const L = path.getTotalLength();
      const e = path.getPointAtLength(L);
      const s = path.getPointAtLength(0);
      const w = path.getAttribute("stroke-width");
      out.push(`${tag} 第${i + 1}条 粗${w}  起(${s.x.toFixed(0)},${s.y.toFixed(0)})  末梢(${e.x.toFixed(0)},${e.y.toFixed(0)})`);
    });
  });
  return out.join("\n");
}));
await b.close();
