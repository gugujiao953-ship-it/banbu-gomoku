/**
 * 棋魂提示条的**云雾衬底**（用户 2026-10-12 从评审稿里点定 ①「墨晕」）。
 *
 * 评审稿与全部踩坑记录：`design-lab/soul-gain-smoke-lab.html`（v1→v3）。
 * 这一版替掉的是原来的 `.soul-gain::before` 那圈**规则椭圆柔光** —— 用户的原话是
 * 「以前的弹窗不是这么规则的，而是那种很帅气的像是游戏一样的，云雾形状的」，
 * 以及「背后那个阴影完全可以去掉，弹窗的形状一体化就行了」。
 *
 * ## 为什么是"一条轮廓"而不是"雾 + 暗芯两层"
 *
 * 提示条**没有框**（用户 10-10 定的），但文字必须有暗底才读得清 ——
 * 在册门禁 `qa/achievements-contrast.mjs` 就是按 `#1a1610` 当背景量文字、门槛 4.5:1。
 * 所以这条轮廓必须在**文字那一块是实的**：中心不透明度 0.92–0.95，只在最外圈化开。
 * v1 曾用"外圈雾 + 另画一块实心暗芯"来满足它，那块暗芯被用户认成"背后的阴影"，
 * 于是改成现在这样：一条路径 + 一份径向填充，衬底与形状是同一个东西。
 *
 * ## 三个反直觉的点（都是实测撞出来的，改动前请先读）
 *
 *  1. **保底轮廓必须是"方"的**（`superR` 的 n=10）。用普通椭圆的话，横长条在**两头收尖**，
 *     魂火那一列的墨高只有中间的一半（实测 32 vs 55 ⇒ 用户：「左边的高度有点窄了」）。
 *     现在保底比盒子还略大（横 +2、竖 +4），端点处仍留 ~48px 墨高。
 *  2. **团块要平滑、舌与咬口不能平滑**。半径随角度快速变化 + 提示条很扁 ⇒ 出来是海胆刺；
 *     所以先对"团块场"做环形滑动平均，**再**把窄高斯的舌/咬口/垫肩加上去（顺序反了会被抹平）。
 *  3. **上界要按射线到四条边的真实距离算**，不能用居中盒的半宽半高：留边左右不等，
 *     当成居中会把墨顶出屏幕（实测下沿 70px、右沿 393px 那次）。
 *
 * ## 纵向变形的天花板
 *
 * 提示条必须落在顶栏那 68px 带子里（棋盘从 108px 起，用户 10-10：「不要挡住棋盘」）：
 * 盒顶 16 + 盒高 40 ⇒ **上下各只剩 ~11px 留边**。所以轮廓被 `wall()` 夹死在这个范围里，
 * 想要更夸张的烟必须先把提示条往上挪，或者接受压到棋盘 —— 两者都要用户点头。
 *
 * 纯函数、不碰 DOM：jsdom 单测里 `getBoundingClientRect` 全 0，所以形状**不能**依赖实测尺寸，
 * 改成按标称盒生成、由 SVG `preserveAspectRatio="none"` 拉伸到实际盒子（竖向恒定、横向随文案伸缩）。
 */

/** 四周留边：轮廓可以长到这里为止（左大是因为团块往左堆，右边顶到屏幕边）。 */
export const SOUL_MIST_PAD = { l: 16, r: 10, t: 12, b: 10 } as const;
/** 标称内容盒（评审稿实测：短文案 179×40）。长文案靠 viewBox 横向拉伸，竖向恒定。 */
const NOMINAL = { w: 179, h: 40 };
/** viewBox 尺寸 = 标称盒 + 四周留边。CSS 那边的 -16/-12 与 +26/+22 要和它对上。 */
export const SOUL_MIST_SIZE = { W: NOMINAL.w + SOUL_MIST_PAD.l + SOUL_MIST_PAD.r, H: NOMINAL.h + SOUL_MIST_PAD.t + SOUL_MIST_PAD.b };
/** 墨色：门禁按这个字面量量对比度，**别换色相**。 */
export const SOUL_MIST_INK = "#1a1610";
/**
 * 墨色的实心度分布。**中心必须够实**（≥0.9）—— 文字就坐在这上面，
 * 在册门禁 `qa/achievements-contrast.mjs` 按 `#1a1610` 当背景量文字、门槛 4.5:1；
 * 化开只允许发生在最外圈。这条数组被单测钉住，改它要先想清楚对比度还过不过。
 */
export const SOUL_MIST_STOPS = [
  { offset: "0%", opacity: .95 },
  { offset: "46%", opacity: .93 },
  { offset: "72%", opacity: .92 },
  { offset: "90%", opacity: .4 },
  { offset: "100%", opacity: 0 },
] as const;

/**
 * 实心度渐变的**圆心与半径**（`radialGradient` 用 objectBoundingBox 单位，
 * 所以它是个椭圆：rx = r × 盒宽、ry = r × 盒高）。
 *
 * ⚠ 半径从 60% 提到 82% 是 2026-10-13 修「字乌漆嘛黑」的正主。用户报的是**浅色主题**下
 * 右边那行来源小字读不清，逐主题量合成后的真实像素（把文字 `visibility:hidden` 再量它身后
 * 那条衬底）实测：来源列最差 4.75~5.63:1、**8~10% 的像素低于 4.5:1**，长文案比短文案更糟
 * （盒被横向拉伸，渐隐圈按比例也跟着拉，所以尾巴越长的盒子露白越多）。按旧算法：
 * 来源文字右端在 viewBox 里到 x≈191，而 `cx=47% r=60%` 时它的归一化半径是
 * `(191−96.35)/123 ≈ 0.77` —— 落在 `.82 → .4` 那段斜坡上，实心度只剩 **≈0.71**，
 * 白页底与页面自己的图标就从墨里透出来，11px 的亮金字压在上面就成了"黑糊一团"。
 * 提到 82% 之后同一点是 0.563 ⇒ 实心度 ≈0.92，四个边（含盒右沿 0.646）全在平台上，
 * 渐隐尾巴被推到盒子**外面**，只剩模糊与位移把它带回来一点烟感。
 */
export const SOUL_MIST_GRADIENT = { cx: 47, cy: 50, r: 82 } as const;

/** 归一化半径处的实心度（把 stops 当折线插值）。给单测用，运行时不查表。 */
export const soulMistOpacityAt = (fraction: number) => {
  const pts = SOUL_MIST_STOPS.map((s) => ({ at: parseFloat(s.offset) / 100, op: s.opacity }));
  if (fraction <= pts[0].at) return pts[0].op;
  for (let i = 1; i < pts.length; i += 1) {
    if (fraction <= pts[i].at) {
      const a = pts[i - 1], b = pts[i];
      return a.op + ((fraction - a.at) / (b.at - a.at)) * (b.op - a.op);
    }
  }
  return pts[pts.length - 1].op;
};

const hash = (i: number, seed: number) => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const vnoise = (t: number, seed: number) => {
  const s = t * 16, i0 = Math.floor(s), f = s - i0;
  const a = hash(i0, seed), b = hash(i0 + 1, seed), u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
};
/**
 * 分形噪声。**倍频表是这条轮廓"变不变形"的总开关**：最低那项只走 1.6 个波的话，
 * 一整圈只鼓一次 ⇒ 怎么加噪声都还是个蛋（v1 就是这么被用户判"不够变形"的）。
 */
const fbm = (t: number, seed: number) => {
  let v = 0, n = 0;
  for (const [f, a] of [[2.6, .4], [5.5, .8], [11, 1], [21, .5]] as const) { v += a * vnoise(t * f + 40, seed + f); n += a; }
  return v / n;
};
/** 超椭圆向径。n=2 是普通椭圆；n 越大越方（端点处越高）。 */
const superR = (theta: number, a: number, b: number, n: number) => {
  const c = Math.abs(Math.cos(theta)) / a, s = Math.abs(Math.sin(theta)) / b;
  return 1 / (Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n));
};
const angDiff = (x: number, y: number) => {
  let d = x - y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
/** Catmull-Rom → 三次贝塞尔（闭合）：把折点连成流动的边。 */
const smoothClosed = (p: Array<[number, number]>) => {
  const n = p.length;
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)},${c2[0].toFixed(1)} ${c2[1].toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
};

/**
 * 轮廓上的采样点（viewBox 坐标，左上为原点）。单独导出是为了**能被单测钉住**：
 * "盖住文字区"与"不许长出留边"这两条只能在点上验，路径字符串里验不动。
 * @param seed 换一张脸：同一个数额每次长得一样（见 ProgressReward 里取种子的口径）。
 */
export function soulMistPoints(seed = 1): Array<[number, number]> {
  const { l, r: rp, t, b: bt } = SOUL_MIST_PAD;
  const { w, h } = NOMINAL;
  const steps = 220, warp = 1.1;
  const cx = l + w / 2, cy = t + h / 2;
  const W = l + rp + w, H = t + bt + h;
  const A = w / 2 + 4, B = h / 2 + 5;        // 打底：比盒子略大，往外的变形才有底子
  const IA = w / 2 + 2, IB = h / 2 + 4;      // 保底：文字区（两头不塌就靠它 + n=10）
  const amp = .40, rough = .09, skew = .16, bodyN = 4.6;
  const bites = [{ deg: 2.55, width: .30, gain: -.30 * h }, { deg: -0.42, width: .26, gain: -.24 * h }];
  const tongues = [{ deg: 1.35, width: .16, len: h * .30 }, { deg: 2.05, width: .13, len: h * .20 }];
  const shoulder = h * .22;
  const ph = seed * 1.732;
  const g = (th: number, deg: number, width: number) => { const d = angDiff(th, deg); return Math.exp(-(d * d) / (2 * width * width)); };
  /** 从盒中心沿射线到留边外沿的真实距离（再往里收 4px 给插值过冲留余量）。 */
  const wall = (ux: number, uy: number) => {
    const tx = ux > 1e-6 ? (W - cx) / ux : ux < -1e-6 ? cx / -ux : Infinity;
    const ty = uy > 1e-6 ? (H - cy) / uy : uy < -1e-6 ? cy / -uy : Infinity;
    return Math.max(4, Math.min(tx, ty) - 4);
  };

  const raw: number[] = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    let rad = superR(th, A, B, bodyN);
    rad *= 1 + amp * warp * (fbm(th / (Math.PI * 2) * 2 + ph, seed) * 2 - 1);
    rad *= 1 + rough * warp * (fbm(th / (Math.PI * 2) * 9 + seed * 3, seed + 11) * 2 - 1);
    rad *= 1 + skew * warp * Math.cos(th - ph * .8);
    raw.push(rad);
  }
  const win = Math.max(2, Math.round(steps / 26));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    let acc = 0;
    for (let k = -win; k <= win; k++) acc += raw[(i + k + steps * 2) % steps];
    const th = (i / steps) * Math.PI * 2;
    let rad = acc / (win * 2 + 1);
    for (const bi of bites) rad += bi.gain * warp * g(th, bi.deg, bi.width);
    for (const tg of tongues) rad += tg.len * warp * g(th, tg.deg, tg.width);
    // 垫肩：补在两端斜上/斜下（补在正左正右只会加长、不会加高）
    for (const sd of [Math.PI - 0.55, Math.PI + 0.55, -0.55, 0.55]) rad += shoulder * g(th, sd, 0.5);
    rad = Math.min(Math.max(rad, superR(th, IA, IB, 10)), wall(Math.cos(th), -Math.sin(th)));
    pts.push([cx + rad * Math.cos(th), cy - rad * Math.sin(th)]);
  }
  return pts;
}

/** 把采样点连成流动的闭合路径。 */
export function soulMistPath(seed = 1): string {
  return smoothClosed(soulMistPoints(seed));
}

/** 边缘的细碎交给这层滤镜：湍流位移 + 一点点模糊（位移量按标称盒高给死值）。 */
export const SOUL_MIST_FILTER = { baseFrequency: "0.032 0.05", octaves: 3, scale: NOMINAL.h * .13, blur: .9 };
