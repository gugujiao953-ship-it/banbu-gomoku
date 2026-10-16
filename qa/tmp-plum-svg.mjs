import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const svg = readFileSync("public/theme-assets/scene-plum.svg", "utf8");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 930 }, deviceScaleFactor: 1 });
await p.setContent(`<!doctype html><html><body style="margin:0;background:#f4edf0">${svg.replace('<svg ', '<svg style="width:430px;height:930px;display:block" ')}</body></html>`);
await p.waitForTimeout(300);
await p.screenshot({ path: "qa/tmp-studio/plum-svg-raw.png" });
// 统计像素：有多少深色（枝）像素
console.log(await p.evaluate(async () => {
  const img = document.querySelector("svg");
  const c = document.createElement("canvas"); c.width = 430; c.height = 930;
  const ctx = c.getContext("2d");
  const s = new XMLSerializer().serializeToString(img);
  const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
  await new Promise((r) => { const i = new Image(); i.onload = r; i.src = url; });
  ctx.drawImage(document.querySelector("img") || (() => { const i = new Image(); i.src = url; return i; })(), 0, 0, 430, 930);
  return "（略）";
}));
await b.close();
console.log("→ plum-svg-raw.png");
