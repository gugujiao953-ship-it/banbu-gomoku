/**
 * verify.mjs — 程序化验收：渲染到指定时刻，读 DOM 状态断言
 * 用法: node tools/verify.mjs
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo.html");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__promo && [...document.images].every(i => i.complete), null, { timeout: 90000 }).catch(() => {});
await page.evaluate(() => document.fonts.ready);

const read = (t) => page.evaluate((tt) => {
  window.__promo.renderFrame(tt);
  const on = id => document.getElementById(id)?.classList.contains('on');
  const show = id => {
    const el = document.getElementById(id);
    return el && el.classList.contains('show') && el.complete && el.naturalWidth > 0;
  };
  const cur = ["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10","s11"].find(on);
  const imgsLoaded = [...document.images].filter(i => i.dataset.src).every(i => i.complete && i.naturalWidth > 0);
  return {
    seg: cur,
    imgsLoaded,
    sub: document.getElementById('subText').textContent,
    chapter: document.getElementById('chapterNow').textContent,
    p: {
      s1a: show('p1a'), s2a: show('p2a'), s2b: show('p2b'), s2c: show('p2c'),
      s3a: show('p3a'), s3b: show('p3b'),
      s4a: show('p4a'), s4b: show('p4b'), s4c: show('p4c'),
      s5src: document.getElementById('p5a')?.src.split('/').slice(-2).join('/'),
      s6a: show('p6a'),
      s7a: show('p7a'), s7b: show('p7b'), s7c: show('p7c'), s7d: show('p7d'),
      s8a: show('p8a'),
      s9a: show('p9a'), s9b: show('p9b'), s9c: show('p9c'),
      g1: show('g1'), g2: show('g2'), g3: show('g3'), g4: show('g4'),
      s11a: show('p11a'),
    },
    bn: document.getElementById('bn1')?.textContent,
    fmts: document.querySelectorAll('#formats .fmt').length,
    cursor: document.getElementById('cursor').style.opacity,
  };
}, t);

const checks = [
  [2.0,  r => r.seg === 's1' && r.p.s1a && /打谱/.test(r.sub), "t2 片头+棋盘图+字幕"],
  [8.5, r => r.seg === 's2' && r.p.s2c && /复原/.test(r.sub), "t8.5 识谱结果+字幕"],
  [12.0, r => r.seg === 's3' && r.p.s3a && r.p.s3b && r.fmts === 5, "t12 导入双屏+5格式"],
  [17.0, r => r.seg === 's4' && r.p.s4a, "t17 分支树"],
  [25.0, r => r.seg === 's5' && r.p.s5src.includes('jiutian'), "t25 九天序列帧"],
  [33.0, r => r.seg === 's6' && r.p.s6a, "t33 引擎下载"],
  [41.0, r => r.seg === 's7' && r.p.s7b && r.p.s7d, "t41 三模式+副屏"],
  [49.0, r => r.seg === 's8' && r.p.s8a && Number(r.bn) > 100, "t49 数字滚动>100"],
  [58.0, r => r.seg === 's9' && r.p.s9c, "t58 对战开打"],
  [61.2, r => r.seg === 's10' && r.p.g2, "t61.2 闪切四宫"],
  [69.0, r => r.seg === 's11' && r.p.s11a && /研究/.test(r.sub), "t69 收尾金句"],
];

let pass = 0, fail = 0;
for (const [t, fn, desc] of checks) {
  const r = await read(t);
  const ok = fn(r) && r.imgsLoaded;
  if (ok) { pass++; console.log(`✓ t=${t} ${desc}`); }
  else { fail++; console.log(`✗ t=${t} ${desc} :: imgsLoaded=${r.imgsLoaded} ${JSON.stringify(r).slice(0, 220)}`); }
}
console.log(`\n断言 ${pass}/${checks.length} 通过`);
await browser.close().catch(() => {});
process.exit(0);