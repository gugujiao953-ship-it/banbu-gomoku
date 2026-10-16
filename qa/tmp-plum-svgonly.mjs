import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const svg = readFileSync("public/theme-assets/scene-plum.svg", "utf8");
const b = await chromium.launch();
// 竖屏比例（390×844）与桌面比例（900×900）各看一次
for (const [w, h, tag] of [[430, 930, "raw"], [390, 844, "phone"], [560, 900, "desktop"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><html><body style="margin:0;background:#f4edf0;overflow:hidden">
    <div style="width:${w}px;height:${h}px;background:linear-gradient(180deg,#f8f3f6,#f1e8ee 58%,#e7dde6);position:relative">
      <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"
           style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    </div></body></html>`);
  await p.waitForTimeout(350);
  await p.screenshot({ path: `qa/tmp-studio/plum-svg-${tag}.png` });
  await p.close();
}
console.log("→ plum-svg-raw / plum-svg-phone / plum-svg-desktop");
await b.close();
