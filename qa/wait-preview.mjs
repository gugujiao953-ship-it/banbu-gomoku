/**
 * qa/wait-preview.mjs — 等待动效的离线预览台（不需要 dev/preview 服务器）。
 *
 * 为什么要有它：等待动效只在"正在生成"那几秒里出现，靠真机流程抓帧很费劲
 * （生成一快就抓不到，我第一版就是这么扑空的）。这里直接照数据 + 生产 CSS
 * 把动效拼出来，按相位钉住逐帧截图——一眼能看出「第几手落在哪、盘上有没有五连、
 * 取景有没有封边、构图是不是太对称」。
 *
 * 用法：node qa/wait-preview.mjs
 * 输出：qa/tmp-studio/wait-anim.png（16 帧接触表）+ wait-anim-zoom.png（放大 3 帧）
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('qa/tmp-studio', { recursive: true });
const data = readFileSync('src/features/waiting/wait-vcf-data.ts', 'utf8');
const arr = (k) => JSON.parse(data.match(new RegExp(`${k}[^=]*=\\s*(\\[[\\s\\S]*?\\]);`))[1]);
const G = arr('WAIT_GIVENS'), L = arr('WAIT_LINE');
const [C0, R0, CELLS] = JSON.parse(data.match(/WAIT_CROP[^=]*=\s*(\[[\s\S]*?\]);/)[1]);
const STARS = arr('WAIT_STARS');
const css = readFileSync('src/features/waiting/waiting.css', 'utf8');

const CELL = 100 / (CELLS + 1);
const at = (k, o) => +((k - o + 0.5) * CELL).toFixed(3);
const LO = -1.5 * CELL, HI = 100 + 1.5 * CELL;
const lines = Array.from({ length: CELLS + 3 }, (_, i) => C0 - 1 + i);
const stone = (c, r, w, cls, extra = '') => `<circle class="${cls} ${w ? 'is-white' : 'is-black'}" cx="${at(c, C0)}" cy="${at(r, R0)}" r="${(CELL * 0.44).toFixed(3)}"${extra}/>`;
const svg = `<svg class="wait-vcf" viewBox="0 0 100 100" style="--wait-cycle:calc(${L.length} * var(--wait-step))">
  <rect class="wait-vcf__wood" x="${LO}" y="${LO}" width="${HI - LO}" height="${HI - LO}"/>
  <g class="wait-vcf__grid">${lines.map(c => `<path d="M${at(c, C0)} ${LO}V${HI}"/>`).join('')}${lines.map(r => `<path d="M${LO} ${at(r, R0)}H${HI}"/>`).join('')}</g>
  <g class="wait-vcf__stars">${STARS.map(([c, r]) => `<circle cx="${at(c, C0)}" cy="${at(r, R0)}" r="1.1"/>`).join('')}</g>
  <g class="wait-vcf__givens">${G.map(([c, r, w]) => stone(c, r, w, 'wait-vcf__stone')).join('')}</g>
  <g class="wait-vcf__line">${L.map(([c, r, w], i) => stone(c, r, w, 'wait-vcf__move', ` style="--kf:wait-vcf-${i}"`)).join('')}</g>
</svg>`;

/** 每帧：把整套动画钉在相位 p（0..1），看第几手该亮着 */
const frame = (p, i) => `<div class="cell"><style>.f${i} .wait-vcf__move{animation-delay:calc(var(--wait-cycle) * ${-p})!important;animation-play-state:paused!important}</style><div class="f${i}">${svg}</div><div class="cap">${p.toFixed(2)}</div></div>`;

const N = 16;
const phases = Array.from({ length: N }, (_, i) => +(i / N).toFixed(4));
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
html,body{margin:0;background:#241c2e}
.row{display:grid;grid-template-columns:repeat(8,170px);gap:8px;padding:10px}
.cell{position:relative;width:170px;height:170px}
.cap{position:absolute;left:2px;top:2px;font:10px ui-monospace,monospace;color:#ffd9a4;background:#000a;padding:0 3px;z-index:9}
.zoom{display:flex;gap:10px;padding:10px}
.zoom .cell{width:340px;height:340px}
.zoom .wait-vcf{width:340px;height:340px}
</style></head><body>
<div class="row">${phases.map((p, i) => frame(p, i)).join('')}</div>
<div class="zoom">${[0.02, 0.36, 0.72].map((p, i) => `<div class="cell"><style>.z${i} .wait-vcf__move{animation-delay:calc(var(--wait-cycle) * ${-p})!important;animation-play-state:paused!important}.z${i} .wait-vcf{width:340px;height:340px}</style><div class="z${i}">${svg}</div><div class="cap">${p}</div></div>`).join('')}</div>
</body></html>`;

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1480, height: 1200 }, deviceScaleFactor: 2 });
await pg.setContent(page, { waitUntil: 'load' });
await pg.waitForTimeout(500);
await pg.screenshot({ path: 'qa/tmp-studio/wait-anim.png', fullPage: true });
await pg.close();

const pg2 = await b.newPage({ viewport: { width: 372, height: 170 }, deviceScaleFactor: 3 });
await pg2.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}html,body{margin:0;background:#241c2e}
.c{position:relative;width:372px;height:170px}.wait-vcf{width:170px;height:170px}
.cap{position:absolute;left:2px;top:2px;font:10px ui-monospace,monospace;color:#ffd9a4;background:#000a;padding:0 3px}
</style></head><body><div class="c"><style>.z .wait-vcf__move{animation-delay:calc(var(--wait-cycle) * -.05)!important;animation-play-state:paused!important}</style><div class="z">${svg}</div><div class="cap">真实尺寸 170px</div></div></body></html>`, { waitUntil: 'load' });
await pg2.waitForTimeout(400);
await pg2.screenshot({ path: 'qa/tmp-studio/wait-anim-real.png' });

console.log(JSON.stringify({ 手数: L.length, 题面: G.length, 取景: [C0, R0, CELLS], 星位: STARS.length, 帧数: N + 3 }));
await b.close();
