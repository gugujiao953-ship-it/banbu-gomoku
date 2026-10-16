/**
 * qa/pelican-rig-check.mjs — 黄昏骑行「蹬踏骨架」门禁（离线，不需要 dev/preview 服务器）。
 *
 * 为什么要有这条门禁：这一块连续踩了几次同一类坑，而且都是**眼睛看不出来**的那种——
 *  ① keyframes 没写 100% → 浏览器按规范用「该属性在级联里的计算值」补出隐含 100%，
 *     而 transform 在级联里没写过 ⇒ 隐含值就是 none ⇒ 每圈最后 6%（约 90ms）整条腿
 *     折回髋部再弹回。用户原话：「蹬着蹬着会抽抽一下，大概一轮抽一下」。
 *     隐蔽之处：抽动只发生在 93.8%–100% 这一段，而人手截图习惯取 0/25/50/75% —— 四个相位
 *     全是干净的，怎么看都看不出问题（这次是靠逐帧放大到 φ=0.995 才抓到）。
 *  ② 素材 viewBox 与「以原点为锚点沿 +x 画」的约定不一致 ⇒ 整条腿被裁掉一半（细得像竹竿）
 *     甚至整个消失。
 *  ③ 关键帧里引用未定义的自定义属性 ⇒ 整条 animation 简写失效 ⇒ animationName:none。
 *  ④ 曲柄素材画出来的踏板半径与 IK 用的半径不一致 ⇒ 脚比踏板靠内几个像素。
 * 这四条都不是「再看一眼截图」能稳定守住的，所以写成断言。
 *
 *   node qa/pelican-rig-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const F = [];
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) F.push(m); };

const A = "public/theme-assets";
const CSS = readFileSync("src/styles.css", "utf8");
/** 按花括号配对取 @keyframes 的块体。
    ⚠ 不能用 `\{([\s\S]*?)\n\}` 这种正则：单行写法的块（`100%{...}}`）结尾那个 `}` 前面不是换行，
    惰性匹配会一路吞到后面别的块（曾经把 pelican-mote 的 translate3d 吞进 pelican-body-bob，
    于是「上身只用旋转」这条断言假失败）。 */
const kfBody = (name) => {
  const at = CSS.indexOf(`@keyframes ${name}`);
  if (at < 0) return null;
  const open = CSS.indexOf("{", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(open + 1, i);
  }
  return null;
};
/** 两条 transform 串是否等价（逐数字比较，容差 1e-6）——比逐字比较更稳，又仍然是强约束 */
const sameTransform = (a, b) => {
  const na = String(a).match(/-?\d*\.?\d+(e-?\d+)?/gi) || [];
  const nb = String(b).match(/-?\d*\.?\d+(e-?\d+)?/gi) || [];
  return na.length === nb.length && na.every((v, i) => Math.abs(parseFloat(v) - parseFloat(nb[i])) < 1e-6);
};

/* ── 1. 静态：关键帧闭环（①） ── */
const LEG = ["pelican-thigh", "pelican-shin", "pelican-foot",
  "pelican-far-thigh", "pelican-far-shin", "pelican-far-foot"];
for (const name of LEG) {
  const b = kfBody(name);
  if (!b) { ok(false, `@keyframes ${name} 不存在`); continue; }
  const keys = [...b.matchAll(/^\s*([\d.]+%|from|to)\s*\{([^}]*)\}/gm)].map((m) => ({ at: m[1], v: m[2].trim() }));
  const first = keys[0], last = keys[keys.length - 1];
  const pcts = keys.map((k) => (k.at === "from" ? 0 : k.at === "to" ? 100 : parseFloat(k.at)));
  ok(keys.length >= 20, `${name}: 采样够密（${keys.length} 帧；≥20 才不会有分段线性的顿挫）`);
  ok(!!first && pcts[0] === 0, `${name}: 有显式 0% 关键帧`);
  ok(!!last && pcts[pcts.length - 1] === 100,
    `${name}: 有显式 100% 关键帧（缺它会被补成 transform:none ⇒ 每圈抽一下）`);
  ok(first && last && sameTransform(first.v, last.v), `${name}: 100% 的变换与 0% 相同＝循环闭合（0%: ${first && first.v}）`);
  ok(pcts.every((v, i) => i === 0 || v > pcts[i - 1]), `${name}: 关键帧百分比严格递增`);
}
ok(/to\s*\{|100%\s*\{/.test(kfBody("pelican-spin") || ""), "pelican-spin: 有 to/100%（曲柄整圈旋转必须闭环）");
const bob = kfBody("pelican-body-bob") || "";
ok(/100%\s*\{/.test(bob), "pelican-body-bob: 有显式 100%");
ok(!/translate3d|translate\(/.test(bob), "pelican-body-bob: 上身只用旋转、不用平移（平移会让髋与身体错开，腿像从肚子里脱出来）");

/* ── 2. 静态：素材 viewBox 与原点约定（②） ── */
const VB_OK = `viewBox="-215 -132 430 264"`;
for (const f of LEG.map((n) => n.replace("pelican-", ""))) {
  const p = `${A}/pelican-${f}.svg`;
  if (!existsSync(p)) { ok(false, `pelican-${f}.svg 不存在`); continue; }
  ok(readFileSync(p, "utf8").includes(VB_OK), `pelican-${f}.svg: viewBox 以自身原点为中心（否则以原点为锚点画的内容会被裁）`);
}

/* ── 3. 静态：图层与素材一一对应，无孤儿 ── */
const refs = [...new Set([...CSS.matchAll(/\/theme-assets\/([A-Za-z0-9_.-]+\.svg)/g)].map((m) => m[1]))]
  .filter((f) => f.includes("pelican"));
const have = readdirSync(A).filter((f) => f.includes("pelican"));
ok(refs.every((r) => existsSync(`${A}/${r}`)), `CSS 引用的 ${refs.length} 个 pelican 素材全部存在`);
ok(have.length === refs.length, `没有未引用的孤儿 pelican 素材（文件 ${have.length}／引用 ${refs.length}）`);

/* ── 4. 动态：每个相位都不许丢动画／丢素材（③），脚掌必须落在 IK 解析解上（④） ── */
const LAYERS = ["tr-wheel tr-wheel-rear", "tr-wheel tr-wheel-front", "tr-crank-far", "tr-far-thigh", "tr-far-shin",
  "tr-far-foot", "tr-frame", "tr-crank", "tr-thigh", "tr-shin", "tr-foot", "tr-body"];
const NEED_ANIM = ["tr-crank-far", "tr-far-thigh", "tr-far-shin", "tr-far-foot", "tr-crank",
  "tr-thigh", "tr-shin", "tr-foot", "tr-body"];
const PHASES = [0, 0.0625, 0.25, 0.5, 0.75, 0.9, 0.9375, 0.97, 0.995];

const inlined = CSS.replace(/url\(\s*["']?\/theme-assets\/([A-Za-z0-9_.\-]+\.svg)(\?[^"')]*)?["']?\s*\)/g,
  (_m, f) => `url("${existsSync(`${A}/${f}`) ? `data:image/svg+xml;base64,${readFileSync(`${A}/${f}`).toString("base64")}` : "none"}")`);

// IK 解析解（与 qa/gen-pelican-leg.mjs 同一套几何：半径 22、中轴 (208,250)）
const C = { x: 208, y: 250 }, R = 22;
const ankle = (t) => ({ x: C.x + R * Math.cos(t), y: C.y + R * Math.sin(t) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cells = PHASES.map((p, i) => `<div class="cell" style="left:${20 + i * 460}px;top:20px"><div class="theme-scene">
    <span class="ts-ride" style="--d:${(-p * 1.5).toFixed(4)}s">${LAYERS.map((c) => `<b class="${c}"></b>`).join("")}</span>
  </div></div>`).join("");
await page.setContent(`<!doctype html><html data-theme="pelican"><head><meta charset="utf-8">
<style>${inlined}</style><style>
html,body{margin:0;background:#141020!important;background-image:none!important}
body{position:relative;width:${40 + PHASES.length * 460}px;height:320px}
.cell{position:absolute;width:440px;height:264px}
.cell .theme-scene{position:static!important;width:440px!important;height:264px!important;transform:none!important;display:block!important}
.cell .ts-ride{display:block!important;position:relative!important;left:0!important;top:0!important;bottom:auto!important;
  margin:0!important;width:440px!important;height:264px!important;aspect-ratio:auto!important;animation:none!important}
.cell .ts-ride>*{animation-play-state:paused!important;animation-delay:var(--d,0s)!important}
.cell .tr-crank-far{animation-delay:calc(var(--d,0s) - .75s)!important}
</style></head><body>${cells}</body></html>`, { waitUntil: "load" });
await page.waitForTimeout(300);

const res = await page.evaluate(([phases, needAnim]) => {
  const need = new Set(needAnim);
  const out = { lostAnim: [], lostBg: [], feet: [] };
  document.querySelectorAll(".cell").forEach((cell, i) => {
    const p = phases[i];
    cell.querySelectorAll(".ts-ride > *").forEach((el) => {
      const cs = getComputedStyle(el);
      const cls = el.className.split(" ")[0];
      if (need.has(cls) && cs.animationName === "none") out.lostAnim.push(`${cls}@${p}`);
      if (cs.backgroundImage === "none") out.lostBg.push(`${cls}@${p}`);
    });
    // 脚掌层只有平移：computed transform 的 e/f 是元素左上角的像素偏移。
    // 转回场景单位要**分轴**换算：430 单位映射到元素宽、264 单位映射到元素高，
    // 两轴缩放并不相等（同一个 scale 用在 y 上会凭空引入 ~1.7 单位的假偏差）。
    // 又因为素材 viewBox 以自身原点为中心，锚点（＝踝）在元素中心、不是左上角：
    // 场景坐标 = e/scaleX + 215、f/scaleY + 66 + 132。
    const rect = cell.querySelector(".ts-ride").getBoundingClientRect();
    const sx = rect.width / 430, sy = rect.height / 264;
    const read = (sel) => {
      const t = getComputedStyle(cell.querySelector(sel)).transform;
      const m = new DOMMatrixReadOnly(t === "none" ? "" : t);
      return { x: m.e / sx + 215, y: m.f / sy + 198 };
    };
    out.feet.push({ p, near: read(".tr-foot"), far: read(".tr-far-foot") });
  });
  return out;
}, [PHASES, NEED_ANIM]);

ok(res.lostAnim.length === 0, `所有相位所有图层 animationName 都不是 none（异常：${res.lostAnim.join(",") || "无"}）`);
ok(res.lostBg.length === 0, `所有相位所有图层 background-image 都不是 none（异常：${res.lostBg.join(",") || "无"}）`);

const dev = { near: 0, far: 0 };
for (const { p, near, far } of res.feet) {
  const a0 = ankle(p * 2 * Math.PI), a1 = ankle(p * 2 * Math.PI + Math.PI);
  dev.near = Math.max(dev.near, Math.hypot(near.x - a0.x, near.y - a0.y));
  dev.far = Math.max(dev.far, Math.hypot(far.x - a1.x, far.y - a1.y));
}
ok(dev.near < 1, `近侧脚掌始终落在 IK 解析解的踝上（最大偏差 ${dev.near.toFixed(3)} 场景单位 ≈ ${(dev.near * 0.546).toFixed(2)}px）`);
ok(dev.far < 1, `远侧（左）脚掌同样落在解析解的踝上（最大偏差 ${dev.far.toFixed(3)} 单位 ≈ ${(dev.far * 0.546).toFixed(2)}px）`);

const steps = (k) => res.feet.slice(1).map((f, i) => Math.hypot(f[k].x - res.feet[i][k].x, f[k].y - res.feet[i][k].y));
for (const k of ["near", "far"]) {
  const s = steps(k), med = s.slice().sort((a, b) => a - b)[Math.floor(s.length / 2)];
  const ratio = Math.max(...s) / Math.max(med, 1e-6);
  ok(ratio < 6, `${k === "near" ? "近侧" : "远侧"}脚掌逐帧位移无异常跳变（max/median = ${ratio.toFixed(2)}，正常 < 6）`);
}

await browser.close();
console.log(F.length ? `\n蹬踏骨架门禁未通过：${F.length} 项` : "\n蹬踏骨架门禁通过：关键帧闭环、素材 viewBox、图层动画与 IK 落点全部对齐");
process.exit(F.length ? 1 : 0);
