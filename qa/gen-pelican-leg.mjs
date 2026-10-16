/**
 * qa/gen-pelican-leg.mjs — 生成「蹬踏板」的腿部/脚掌素材、关键帧与图层定位（离线算 IK）。
 *
 * 为什么必须这么做：腿是「髋→膝→踝」两节连杆，脚要踩在绕中轴做圆周运动的踏板上。
 * 单靠「整层旋转」或「摆动+伸缩」都对不上（试过：①整腿跟曲柄转＝虚空蹬轮子；
 * ②腿绕髋摆、脚在曲柄层＝脚与腿断开）。正解是**反向运动学**：髋固定、踝在圆周上，
 * 反推膝盖位置与两节的角度；把采样角度的解写成 CSS 关键帧，
 * 用「平移(膝相对髋的偏移)+旋转」表示小腿这节刚体——刚体的运动就是平移+旋转，几何上是精确的。
 *
 * ⚠ 2026-10-08 五处修正（都是逐帧放大才看出来的）：
 *  ① 「每圈抽一下」的根因：关键帧**必须显式写出 100%**，且值等于 0%。
 *     否则浏览器按规范用「该属性在级联里的计算值」补一个隐含的 100% —— 而 transform
 *     在级联里没写过，隐含 100% 就是 `none`（零矩阵）。于是每圈最后 6%（约 90 ms）
 *     大腿从 22° 塌回 0°、小腿从 translate(9.5%,6.3%) rotate(122°) 塌回 none，
 *     整条腿折回髋部再弹回来。普通相位截图（0/25/50/75%）永远看不到这一段。
 *  ② 采样数 16 → 48：分段线性插值在 16 段时每段 94 ms，段与段之间角速度是跳变的
 *     （小腿实测 +52°/s → -14°/s → -89°/s），有细碎顿挫；48 段后每段 31 ms。
 *  ③ 脚掌独立成层：脚掌原本画在小腿那一节里，于是**脚掌的姿态＝小腿的姿态**——
 *     到某些相位脚是朝下吊着的（像踮脚/耷拉）。真车脚踏是会自转调平的平台，
 *     脚掌应当基本保持水平、只做小幅「踝动」。所以脚掌单独一层，跟着踝走圆周、姿态几乎不转。
 *  ④ 踏板位置必须与 IK 的踝**同心**：原来画出来的踏板在半径 28.4（偏移 (18,22)），
 *     而 IK 用的半径是 22 —— 脚比踏板靠内 3.5px。现在曲柄一律画成水平指前、长度正好 R。
 *  ⑤ **viewBox 必须以自身原点为中心**（`-215 -132 430 264`）：素材是「以原点为锚点沿 +x 画」的，
 *     若 viewBox 从 (0,0) 起，整条腿有一半（y<0 那侧描边）被裁掉——9 宽的腿实际只渲染出 5 宽，
 *     这就是它一直显得像细竹竿的原因；改成 `0 66 …`（跟场景对齐）更糟，整个原点都在画布外，
 *     腿会完全消失。viewBox 对称后：原点＝元素中心＝`transform-origin:50% 50%`，
 *     缩放仍是 1 单位＝1 单位，且负坐标不再被裁。
 *     （图层 left/top 因此是负百分比，这是正常的：元素中心压在髋上。）
 *
 * 几何只在这一处维护：素材、关键帧、图层定位三者由本脚本一起产出，
 * 直接写进 src/styles.css 的占位区，不再手工改那些百分比。
 */
import { readFileSync, writeFileSync } from "node:fs";

// ── 几何（素材坐标系＝场景坐标系：viewBox 0 66 430 264 那片）──
const HN = { x: 212, y: 186 };     // 近侧（右）髋
const HF = { x: 203, y: 183 };     // 远侧（左）髋：稍偏后上方＝制造前后层次
const C = { x: 208, y: 250 };      // 中轴（曲柄中心）
const R = 22;                      // 曲柄半径（踏板中心到中轴）——务必与 pelican-crank*.svg 一致
const L1 = 44;                     // 大腿长
const L2 = 46;                     // 小腿长（末端即踝＝踏板中心）
const N = 48;                      // 采样数（见文件头注释②：16 太粗）
const VBW = 430, VBH = 264, VBY = 66;
const HALF = { x: VBW / 2, y: VBH / 2 };   // viewBox 对称化后的原点在元素里的位置（215,132）

const DEG = (r) => (r * 180) / Math.PI;
const dir = (x, y) => DEG(Math.atan2(y, x));   // CSS 的 rotate 正值＝顺时针，y 向下，正好一致

function ik(theta, H) {
  const A = { x: C.x + R * Math.cos(theta), y: C.y + R * Math.sin(theta) };  // 踝（＝踏板）
  const d = Math.hypot(A.x - H.x, A.y - H.y);
  const base = Math.atan2(A.y - H.y, A.x - H.x);
  // 余弦定理：大腿与 HA 的夹角；取「膝盖向前弯」的那一侧（+x 方向，车头朝右）
  const ca = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const alpha = Math.acos(Math.max(-1, Math.min(1, ca)));
  const tAng = base - alpha;          // sign=-1：膝盖朝车头方向弯
  const K = { x: H.x + L1 * Math.cos(tAng), y: H.y + L1 * Math.sin(tAng) };   // 膝
  const sAng = Math.atan2(A.y - K.y, A.x - K.x);                              // 小腿方向
  return { tRot: dir(Math.cos(tAng), Math.sin(tAng)), sRot: dir(Math.cos(sAng), Math.sin(sAng)),
           kx: K.x - H.x, ky: K.y - H.y, ax: A.x, ay: A.y, d };
}

const pct = (v, of) => `${((v / of) * 100).toFixed(4).replace(/\.?0+$/, "")}%`;
const atPct = (i) => i === N ? "100%" : `${((i / N) * 100).toFixed(4).replace(/\.?0+$/, "")}%`;
/** 角度：把浮点毛刺收成 0（sin(2π) 会给出 -2.4e-16 → "-0.00deg"，
    和 0% 的 "0.00deg" 字符串不等，会让「100% 与 0% 逐字相同」的闭环断言假失败）。 */
const deg = (v) => (Math.abs(v) < 0.005 ? "0" : v.toFixed(3).replace(/\.?0+$/, ""));
const sols = (H, phase) => Array.from({ length: N + 1 }, (_, i) => ik((i / N) * Math.PI * 2 + phase, H));

const loop = (s, i) => i === N ? "   /* ＝0%，闭环（不写 100% 会被补成 transform:none） */" : "";
/** 大腿：只有旋转（原点＝髋＝元素中心） */
const thighKf = (name, H, phase) => `@keyframes ${name}{\n${sols(H, phase).map((s, i) =>
  `  ${atPct(i)}{transform:rotate(${deg(s.tRot)}deg)}${loop(s, i)}`).join("\n")}\n}`;
/** 小腿：平移(膝−髋) + 旋转（旋转中心＝髋＝元素中心；画出来的原点即膝，见文件头推导） */
const shinKf = (name, H, phase) => `@keyframes ${name}{\n${sols(H, phase).map((s, i) =>
  `  ${atPct(i)}{transform:translate(${pct(s.kx, VBW)},${pct(s.ky, VBH)}) rotate(${deg(s.sRot)}deg)}${loop(s, i)}`).join("\n")}\n}`;
/** 脚掌：只平移（原点＝踝＝踏板中心），姿态基本水平 —— 只叠 ±4° 的踝动 */
const footKf = (name, H, phase) => `@keyframes ${name}{\n${sols(H, phase).map((s, i) =>
  `  ${atPct(i)}{transform:translate(${pct(s.ax - HALF.x, VBW)},${pct(s.ay - VBY - HALF.y, VBH)}) rotate(${deg(4 * Math.sin(i / N * Math.PI * 2))}deg)}${loop(s, i)}`).join("\n")}\n}`;

// ── 素材 ──
// 全部「以原点为锚点、沿 +x 画」：大腿原点＝髋，小腿原点＝膝（末端即踝），脚掌原点＝踝。
// 脚掌足底压在踏板面上（板面在踝上方约 2.5）：否则 BDC（下死点）时足底离地只剩 3 个单位，像在地上蹭。
const lin = (x2, stroke, w) =>
  `  <path d="M0 0 ${x2} 0" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
const legParts = (bright, footMain, footShade) => ({
  thigh: lin(L1, bright, 12),
  shin: lin(L2, bright, 10.5),
  foot: `  <!-- 蹼足：原点＝踝（＝踏板中心）。足底 y≈-2.5 压在踏板面上，趾尖朝前 -->
  <path d="M-6 -2.5C-3 -8 4 -11 12 -11c7 0 13 2 17 6-4 4-11 6-18 6-7 0-13-1-17-3Z" fill="${footMain}"/>
  <path d="M12 -11c7 0 13 2 17 6-4 4-11 6-18 6" fill="${footShade}" opacity=".55"/>
  <path d="M-6 -2.5C-3 -8 4 -11 12 -11" stroke="${footShade}" stroke-width="1.2" opacity=".5" fill="none"/>
  <path d="M4 -8.5c5-2 11-2 16 1" stroke="${footShade}" stroke-width="1.1" opacity=".55" fill="none"/>
  <path d="M-7 -3.2c4-1 8-1 12 0" stroke="${footShade}" stroke-width="1.4" opacity=".45" fill="none"/>`,
});
const wrap = (inner, note) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-HALF.x} ${-HALF.y} ${VBW} ${VBH}" fill="none">
  <!-- ${note} -->
${inner}
</svg>
`;
const near = legParts("#e08030", "#f2a13c", "#d98b2c");
const far = legParts("#b8671c", "#d98b2c", "#b3721f");

const A = "public/theme-assets";
writeFileSync(`${A}/pelican-thigh.svg`, wrap(near.thigh,
  `鹈鹕近侧大腿（原点＝髋＝元素中心，指向 +x，长 ${L1}）。角度由 IK 关键帧给，不手工画姿势。`));
writeFileSync(`${A}/pelican-shin.svg`, wrap(near.shin,
  `鹈鹕近侧小腿（原点＝膝，指向 +x，末端＝踝＝踏板中心）。脚掌**不**在这一节里
   （独立成层 pelican-foot.svg），否则脚掌姿态会被小腿带着走，到某些相位脚会朝下吊着。`));
writeFileSync(`${A}/pelican-foot.svg`, wrap(near.foot,
  `鹈鹕近侧蹼足（原点＝踝＝踏板中心，指向 +x）。只平移、基本不转，始终平踩在踏板面上。`));
writeFileSync(`${A}/pelican-far-thigh.svg`, wrap(far.thigh,
  `鹈鹕远侧（左）大腿，颜色压暗＝在身体后方。髋在 (${HF.x},${HF.y})，相位差 180°。`));
writeFileSync(`${A}/pelican-far-shin.svg`, wrap(far.shin,
  `鹈鹕远侧（左）小腿。相位差 180° 已烘进关键帧，与近侧同一时刻在蹬相反方向。`));
writeFileSync(`${A}/pelican-far-foot.svg`, wrap(far.foot,
  `鹈鹕远侧（左）蹼足，压暗。相位差 180° 已烘进关键帧。`));

// ── 图层定位（同样由几何算出，不再手写百分比）──
// 元素中心＝锚点（髋／踝），因为 viewBox 以原点为中心 ⇒ transform-origin:50% 50%。
const at = (H) => `left:${pct(H.x - HALF.x, VBW)};top:${pct(H.y - VBY - HALF.y, VBH)}`;
const posRules = [
  `/* 腿部 6 层的位置与动画（由 qa/gen-pelican-leg.mjs 生成，别手改——几何都在那个脚本里）。
     元素中心压在锚点上（髋／踝），所以 left/top 是负百分比：正常，不是笔误。 */
html[data-theme="pelican"] .tr-thigh,html[data-theme="pelican"] .tr-shin,
html[data-theme="pelican"] .tr-foot,
html[data-theme="pelican"] .tr-far-thigh,html[data-theme="pelican"] .tr-far-shin,
html[data-theme="pelican"] .tr-far-foot{
  width:100%;height:100%;background-repeat:no-repeat;background-position:0 0;background-size:100% 100%;
  transform-origin:50% 50%}
html[data-theme="pelican"] .tr-thigh{${at(HN)};background-image:url("/theme-assets/pelican-thigh.svg?v=10");
  animation:pelican-thigh 1.5s linear infinite}
html[data-theme="pelican"] .tr-shin{${at(HN)};background-image:url("/theme-assets/pelican-shin.svg?v=10");
  animation:pelican-shin 1.5s linear infinite}
/* ⚠ 脚掌这层的 left/top 必须是 0：关键帧里的 translate 用的是「场景绝对坐标」的百分比
   （(踝 x−215)/430、(踝 y−66−132)/264），只有元素左上角压在场景原点 (0,66) 时才对得上。 */
html[data-theme="pelican"] .tr-foot{left:0;top:0;background-image:url("/theme-assets/pelican-foot.svg?v=10");
  animation:pelican-foot 1.5s linear infinite}
html[data-theme="pelican"] .tr-far-thigh{${at(HF)};background-image:url("/theme-assets/pelican-far-thigh.svg?v=10");
  animation:pelican-far-thigh 1.5s linear infinite}
html[data-theme="pelican"] .tr-far-shin{${at(HF)};background-image:url("/theme-assets/pelican-far-shin.svg?v=10");
  animation:pelican-far-shin 1.5s linear infinite}
html[data-theme="pelican"] .tr-far-foot{left:0;top:0;background-image:url("/theme-assets/pelican-far-foot.svg?v=10");
  animation:pelican-far-foot 1.5s linear infinite}`,
].join("\n");

const css = [posRules, thighKf("pelican-thigh", HN, 0), shinKf("pelican-shin", HN, 0), footKf("pelican-foot", HN, 0),
  thighKf("pelican-far-thigh", HF, Math.PI), shinKf("pelican-far-shin", HF, Math.PI), footKf("pelican-far-foot", HF, Math.PI),
].join("\n");

const p = "src/styles.css";
let s = readFileSync(p, "utf8");
const startMark = "/* @pelican-leg-kf-start */", endMark = "/* @pelican-leg-kf-end */";
if (!s.includes(startMark)) throw new Error("CSS 里没有占位标记");
const a = s.indexOf(startMark), b = s.indexOf(endMark) + endMark.length;
s = s.slice(0, a) + startMark + "\n" + css + "\n" + endMark + s.slice(b);
writeFileSync(p, s);

// ── 自检 ──
const check = (nm, H, phase) => {
  const S = sols(H, phase);
  const step = (k) => Math.max(...S.slice(1).map((v, i) => Math.abs(v[k] - S[i][k])));
  console.log(`  ${nm}: 闭环 Δ大腿=${Math.abs(S[N].tRot - S[0].tRot).toFixed(3)}° Δ小腿=${Math.abs(S[N].sRot - S[0].sRot).toFixed(3)}°`
    + ` | 每步最大 Δ 大腿 ${step("tRot").toFixed(2)}° 小腿 ${step("sRot").toFixed(2)}°`
    + ` | 踝到中轴 ${Math.min(...S.map((v) => Math.hypot(v.ax - C.x, v.ay - C.y))).toFixed(3)}–${Math.max(...S.map((v) => Math.hypot(v.ax - C.x, v.ay - C.y))).toFixed(3)}（必须恒等于曲柄半径 ${R}）`);
};
console.log(`已生成近/远两套 IK 解，各 ${N} 段（含显式 100% 闭环）+ 图层定位：`);
check("近侧", HN, 0);
check("远侧", HF, Math.PI);
const S0 = sols(HN, 0), S1 = sols(HF, Math.PI);
console.log(`髋-踝距离 近侧 ${Math.min(...S0.map((v) => v.d)).toFixed(1)}–${Math.max(...S0.map((v) => v.d)).toFixed(1)}`
  + `，远侧 ${Math.min(...S1.map((v) => v.d)).toFixed(1)}–${Math.max(...S1.map((v) => v.d)).toFixed(1)}（两节共 ${L1 + L2}，需覆盖）`);
console.log(`θ=0 踝：近侧 (${S0[0].ax.toFixed(1)},${S0[0].ay.toFixed(1)})、远侧 (${S1[0].ax.toFixed(1)},${S1[0].ay.toFixed(1)})`
  + ` —— pelican-crank.svg / pelican-crank-far.svg 的踏板中心必须落在这两点`);
console.log(`图层定位：近侧 ${at(HN)}；远侧 ${at(HF)}`);
