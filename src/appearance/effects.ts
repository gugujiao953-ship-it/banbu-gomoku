/* ════════════════════════════════════════════════════════════════════════
   公用的「落子交互 / 棋子进场」特效方案。

   **从 `预览/parts/motion.js` 移植，几何按本体适配。**
   实验室那份是写死的（viewBox 620×620、15 路、PAD 46、GAP=(620-92)/14、
   棋子半径 R=GAP*0.42）；本体棋盘是活的（viewBox 572×572、5–21 路、边距可调），
   所以调用方必须把本体实际的 x / y / r / gridMin / gridMax 传进 spawn()——
   实验室所有方案都是按 r 的倍数缩放的（如 r*1.5），传对 r 就自动等比适配；
   「行光贯穿」是唯一需要盘面量度的方案，用 gridMin/gridMax 横贯整条行列。

   ── 设计约束（与实验室一致，别丢）─────────────────────────────────
     · 全部走 **CSS 动画**（transform / opacity），不碰滤镜输入。
       ⚠ 给 SVG 滤镜的输入做动画会让每帧重跑 feTurbulence，最贵的操作，
         20 颗子就能把帧率拖垮。所以动效只用 transform/opacity。
         （静态 filter / 渐变允许，例如墨点的柔边径向渐变。）
     · 每次落子的特效元素**动画结束即自删**（animationend + 兜底定时器），
       否则连下 100 手会堆 100 个 DOM 节点。
     · **所有 @keyframes 都写在 css(id) 里**，spawn 只负责插元素、挂类名。
       早先在 spawn 里 insertAdjacentHTML 一段 <style>，每落一手就重复注入一份，
       样式表会无限膨胀 —— 别那么干。
     · 只动 transform / opacity。
     · SVG 里做 scale/rotate 要 `transform-box:fill-box; transform-origin:center`（SELF）。
     · 返回的 CSS 带 `@media(prefers-reduced-motion:reduce)` 降级（RM）。

   ── 接口 ─────────────────────────────────────────────────────────────
     css(id)                          该方案要的 @keyframes / 类样式
     spawn(id, {x, y, r, host, accent, gridMin, gridMax})
        x,y   落点的 SVG 坐标（棋盘坐标，原点左上）——用本体的 visualXY()
        r     本体实际的棋子半径（**不要**沿用实验室的 GAP*0.42）
        host  往哪个 <svg> 里插（place→棋子之上；drop→压棋子之下）
        accent 当前盘面上看得见的强调色
        gridMin/gridMax  棋盘网格的起止坐标（"行光贯穿"要横贯整条行列时用）
   ════════════════════════════════════════════════════════════════════════ */

export interface EffectSpawnPayload {
  /** 落点的 SVG 横坐标（本体棋盘坐标） */
  x: number;
  /** 落点的 SVG 纵坐标（本体棋盘坐标） */
  y: number;
  /** 本体实际的棋子半径 */
  r: number;
  /** 往哪个元素里插（本体的 `#board` <svg>） */
  host: Element;
  /** 当前盘面上看得见的强调色 */
  accent: string;
  /** 棋盘网格起始坐标（= margin）；只有 pl-rowcol 需要 */
  gridMin?: number;
  /** 棋盘网格结束坐标（= margin + (boardSize-1)*gap）；只有 pl-rowcol 需要 */
  gridMax?: number;
}

export interface EffectScheme {
  id: string;
  /** 设置里给人看的名字 */
  name: string;
  /** 一句话说明它的动作 */
  desc: string;
  /** 该方案要的 @keyframes / 类样式；id 是方案 id，用来拼选择器与 keyframes 名 */
  css: (id: string) => string;
  /** 插特效元素并挂类名；自己负责在动画结束后删除自己 */
  spawn?: (id: string, payload: EffectSpawnPayload) => unknown;
}

const SVGNS = "http://www.w3.org/2000/svg";
const gEl = (cls?: string): SVGGElement => {
  const g = document.createElementNS(SVGNS, "g");
  g.setAttribute("pointer-events", "none");
  if (cls) g.setAttribute("class", cls);
  return g;
};
/** 挂到棋子**下面**（drop 的伴随特效）。
 *  实验室找的是 `#stones` 分组；本体没有这个分组（棋子直接铺在 <svg> 里），
 *  所以找不到分组时退而插在第一枚 `.stone-piece` 之前 —— 同样是"压在棋子下面"。
 *  两者都没有才 append。 */
const insertUnderStones = (host: Element, node: Element): Element => {
  const stones = host.querySelector("#stones");
  if (stones) { host.insertBefore(node, stones); return node; }
  const firstStone = host.querySelector(".stone-piece");
  if (firstStone) { host.insertBefore(node, firstStone); return node; }
  host.appendChild(node);
  return node;
};
/** 动画结束即自删；兜底定时器防 animationend 丢失。 */
const autoRemove = (node: Element, probe: Element | null | undefined, ms: number) => {
  (probe || node).addEventListener("animationend", () => node.remove(), { once: true });
  setTimeout(() => node.remove(), ms);
};

/** 每次落子都要新建一份渐变，所以它的 id 必须**这一手独一份**。
 *  ⚠ 原来固定写 `${id}-g`：连点两下（间隔小于动画时长）就会在同文档里出现两份
 *    同名 `<radialGradient id="pl-ink-g">`，后一份按规范解析到**前一份**，而前一份
 *    随它自己的特效组 animationend 自删 → 还在飞的那滴墨可能突然没了填充（看不见）。
 *    重复 id 本身也是 HTML/SVG 非法状态。 */
let gradientSeq = 0;
const uniqueGradientId = (schemeId: string) => `${schemeId}-g${(gradientSeq += 1).toString(36)}`;

/** 取一个"在任意盘面上都看得见"的强调色。
 *  实验室优先用皮肤自己声明的 `--ui-accent`；本体没有这个变量，
 *  于是再取本体的主题强调色 `--color-accent`；都没有才按盘面明暗给白/黑。 */
const readVar = (name: string): string => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return "";
  }
};
export const effectAccent = (dark = true): string =>
  readVar("--ui-accent") || readVar("--color-accent") || (dark ? "#f0ece0" : "#20180e");

/** 盘面是不是偏暗（决定没有主题色时用亮光还是暗影做特效）。 */
export const isDarkBoard = (): boolean => {
  const bg = readVar("--bd-bg") || readVar("--color-bg");
  if (bg && bg.startsWith("#") && bg.length >= 7) {
    const h = bg.slice(1);
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] < 0.35;
  }
  return true;
};

/** 无障碍：尊重系统的"减少动态效果" */
const RM = (sel: string) => `@media (prefers-reduced-motion:reduce){${sel}{animation:none}}`;
/** 棋子/特效自身为原点的缩放旋转（不然会绕 SVG 左上角转，整块飞出去） */
const SELF = "transform-box:fill-box;transform-origin:center;";
/** 固定角度表 —— 不用 Math.random，保证同一手每次刷新长得一样 */
const ring = (n: number, off = 0) => Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2 + off);

/* ══════════════════════════════════════════════════════════════════════
   ① 落子交互动效（11 套）
   画在棋子**之上**（短暂、不挡操作）。设计上刻意拉开"机制"而不是"参数"：

     中心扩散   pl-ripple 涟漪扩散   pl-cross 十字光斩   pl-sigil 符印轮转
     飞散/生发  pl-spark 星火迸溅    pl-shard 碎裂飞散   pl-petal 花瓣绽开
     材质/气质  pl-ink   墨点晕开    pl-dust  尘爆扬散
     整盘尺度   pl-rowcol 行光贯穿
     反向/短促  pl-vortex 漩涡收束   pl-flash 爆闪
    ══════════════════════════════════════════════════════════════════════ */

const PLACE_EFFECTS_RAW: EffectScheme[] = [
  {
    id: "pl-ripple",
    name: "涟漪扩散",
    desc: "一圈水波从落点荡开，最含蓄",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scale(.34);opacity:.95}
          60% {opacity:.42}
          100%{transform:scale(2.5);opacity:0}
        }
        .${id}{${SELF}animation:${id}-k 1.05s cubic-bezier(.22,.68,.36,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const g = gEl();
      g.innerHTML = `
          <circle class="${id}" cx="${x}" cy="${y}" r="${r * 1.5}" fill="none"
                  stroke="${accent}" stroke-width="${(r * .22).toFixed(2)}" opacity=".9"/>
          <circle class="${id}" cx="${x}" cy="${y}" r="${r * 1.5}" fill="none"
                  stroke="${accent}" stroke-width="${(r * .1).toFixed(2)}" opacity=".5"
                  style="animation-delay:.16s"/>`;
      host.appendChild(g);
      autoRemove(g, g.querySelector("circle:last-child"), 1500);
      return g;
    },
  },
  {
    id: "pl-cross",
    name: "十字光斩",
    desc: "一道十字光斩弹出并旋转，锐利",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scale(.28);opacity:1}
          62% {opacity:.75}
          100%{transform:scale(2.7);opacity:0}
        }
        @keyframes ${id}-rot{0%{transform:rotate(0)}100%{transform:rotate(52deg)}}
        @keyframes ${id}-sh{0%{opacity:1}70%{opacity:.6}100%{opacity:0}}
        .${id}{${SELF}animation:${id}-k .62s cubic-bezier(.18,.82,.4,1) forwards}
        .${id}-r{${SELF}animation:${id}-rot .62s cubic-bezier(.18,.82,.4,1) forwards}
        .${id}-c{${SELF}animation:${id}-sh .62s ease-out forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const L = r * 1.5;
      const g = gEl();
      g.innerHTML = `
          <g class="${id}">
            <g class="${id}-r" stroke="${accent}" stroke-linecap="round" fill="none">
              <path d="M${(x - L).toFixed(1)} ${y.toFixed(1)}H${(x + L).toFixed(1)}" stroke-width="${(r * .2).toFixed(2)}"/>
              <path d="M${x.toFixed(1)} ${(y - L).toFixed(1)}V${(y + L).toFixed(1)}" stroke-width="${(r * .2).toFixed(2)}"/>
              <path d="M${(x - L * .62).toFixed(1)} ${(y - L * .62).toFixed(1)}L${(x + L * .62).toFixed(1)} ${(y + L * .62).toFixed(1)}" stroke-width="${(r * .1).toFixed(2)}" opacity=".7"/>
              <path d="M${(x + L * .62).toFixed(1)} ${(y - L * .62).toFixed(1)}L${(x - L * .62).toFixed(1)} ${(y + L * .62).toFixed(1)}" stroke-width="${(r * .1).toFixed(2)}" opacity=".7"/>
            </g>
          </g>
          <circle class="${id}-c" cx="${x}" cy="${y}" r="${(r * .5).toFixed(1)}" fill="${accent}"/>`;
      host.appendChild(g);
      autoRemove(g, g.querySelector(`.${id}`), 1000);
      return g;
    },
  },
  {
    id: "pl-spark",
    name: "星火迸溅",
    desc: "十点火星朝四面八方炸开，最热闹",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translate(0,0) scale(1);opacity:1}
          55% {opacity:.95}
          100%{transform:translate(var(--dx),var(--dy)) scale(.35);opacity:0}
        }
        .${id} circle{${SELF}animation:${id}-k .62s cubic-bezier(.18,.72,.35,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const g = gEl(id);
      let dots = "";
      ring(10, 0.3).forEach((a, i) => {
        // 颗粒至少 ~4px 才看得见；飞行距离 2.6~4.2 个棋子半径（≈1~1.7 格）
        const d = r * (2.6 + (i % 3) * 0.8);
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * (i % 2 ? 0.24 : 0.34)).toFixed(2)}"
              fill="${accent}"
              style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;animation-delay:${((i % 4) * 0.022).toFixed(3)}s"/>`;
      });
      // 中心一记短促的亮核（不动，只缩掉）
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * .7).toFixed(1)}" fill="${accent}"
                  style="--dx:0px;--dy:0px"/>`;
      g.innerHTML = dots;
      host.appendChild(g);
      autoRemove(g, g.querySelector("circle:last-child"), 1000);
      return g;
    },
  },
  {
    id: "pl-ink",
    name: "墨点晕开",
    desc: "一滴墨在宣纸上洇开，东方味最足",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scale(.18);opacity:.95}
          30% {opacity:.8}
          100%{transform:scale(2.4);opacity:0}
        }
        @keyframes ${id}-d{
          0%  {transform:translate(0,0) scale(.3);opacity:.9}
          100%{transform:translate(var(--dx),var(--dy)) scale(.4);opacity:0}
        }
        .${id}{${SELF}animation:${id}-k 1.15s cubic-bezier(.14,.72,.3,1) forwards}
        .${id}-drop{${SELF}animation:${id}-d .8s ease-out forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const g = gEl();
      const gid = uniqueGradientId(id);
      // 主墨团用径向渐变给柔边（静态渐变，不是动画滤镜）
      let body = `<defs>
            <radialGradient id="${gid}" cx="50%" cy="50%" r="50%">
              <stop offset="0" stop-color="${accent}" stop-opacity=".5"/>
              <stop offset=".62" stop-color="${accent}" stop-opacity=".3"/>
              <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <circle class="${id}" cx="${x}" cy="${y}" r="${r * 1.2}" fill="url(#${gid})"/>
          <circle class="${id}" cx="${x}" cy="${y}" r="${r * .7}" fill="${accent}" opacity=".28"
                  style="animation-delay:.08s"/>`;
      // 四散的小墨点
      ring(5, 0.5).forEach((a, i) => {
        const d = r * (1.3 + (i % 2) * 0.7);
        body += `<circle class="${id}-drop" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * .22).toFixed(2)}"
                    fill="${accent}" style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;animation-delay:.06s"/>`;
      });
      g.innerHTML = body;
      host.appendChild(g);
      autoRemove(g, g.querySelector(`.${id}`), 1700);
      return g;
    },
  },
  {
    id: "pl-rowcol",
    name: "行光贯穿",
    desc: "落点所在的行与列整条亮起再退去，唯一横贯全盘的方案",
    css: (id) => `
        @keyframes ${id}-h{
          0%  {transform:scaleX(0);opacity:1}
          62% {transform:scaleX(1);opacity:.85}
          100%{transform:scaleX(1);opacity:0}
        }
        @keyframes ${id}-v{
          0%  {transform:scaleY(0);opacity:1}
          62% {transform:scaleY(1);opacity:.85}
          100%{transform:scaleY(1);opacity:0}
        }
        @keyframes ${id}-n{0%{transform:scale(.45);opacity:.9}100%{transform:scale(2.1);opacity:0}}
        .${id}-r{transform-box:fill-box;transform-origin:left   center;animation:${id}-h .62s cubic-bezier(.2,.8,.35,1) forwards}
        .${id}-l{transform-box:fill-box;transform-origin:right  center;animation:${id}-h .62s cubic-bezier(.2,.8,.35,1) forwards}
        .${id}-d{transform-box:fill-box;transform-origin:center top;   animation:${id}-v .62s cubic-bezier(.2,.8,.35,1) forwards}
        .${id}-u{transform-box:fill-box;transform-origin:center bottom;animation:${id}-v .62s cubic-bezier(.2,.8,.35,1) forwards}
        .${id}-n{${SELF}animation:${id}-n .62s ease-out forwards}`,
    spawn: (id, { x, y, r, host, accent, gridMin, gridMax }) => {
      // 需要棋盘网格的起止坐标；取不到就退化成一小段（正常不会发生）
      const a0 = gridMin == null ? x - r * 3 : gridMin;
      const a1 = gridMax == null ? x + r * 3 : gridMax;
      const w = Math.max(r * 0.2, 1.4);
      const line = (cls: string, d: string, wd: string) =>
        `<path class="${id}-${cls}" d="${d}" fill="none" stroke="${accent}"
             stroke-width="${wd}" stroke-linecap="round"/>`;
      const g = gEl();
      g.innerHTML =
        line("r", `M${x.toFixed(1)} ${y.toFixed(1)}H${a1.toFixed(1)}`, w.toFixed(2))
        + line("l", `M${x.toFixed(1)} ${y.toFixed(1)}H${a0.toFixed(1)}`, w.toFixed(2))
        + line("d", `M${x.toFixed(1)} ${y.toFixed(1)}V${a1.toFixed(1)}`, w.toFixed(2))
        + line("u", `M${x.toFixed(1)} ${y.toFixed(1)}V${a0.toFixed(1)}`, w.toFixed(2))
        + `<circle class="${id}-n" cx="${x}" cy="${y}" r="${(r * .7).toFixed(1)}" fill="none"
               stroke="${accent}" stroke-width="${(r * .16).toFixed(2)}"/>`;
      host.appendChild(g);
      autoRemove(g, g.querySelector(`.${id}-r`), 1100);
      return g;
    },
  },
  {
    id: "pl-shard",
    name: "碎裂飞散",
    desc: "九片锐角碎块炸开并各自翻滚，硬碰硬的手感",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translate(0,0) rotate(0) scale(.5);opacity:1}
          60% {opacity:.92}
          100%{transform:translate(var(--dx),var(--dy)) rotate(var(--rot)) scale(1.1);opacity:0}
        }
        .${id} path{${SELF}animation:${id}-k .78s cubic-bezier(.15,.75,.3,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const g = gEl(id);
      let shards = "";
      ring(9, 0.2).forEach((a, i) => {
        const ux = Math.cos(a), uy = Math.sin(a);
        const px = -uy, py = ux;                       // 垂直方向
        const tip = r * 0.8, half = r * 0.4;           // 初始聚成一颗小星
        const p1 = [x + ux * tip, y + uy * tip];
        const p2 = [x + px * half, y + py * half];
        const p3 = [x - px * half, y - py * half];
        const d = r * (2.3 + (i % 3) * 0.7);
        const rot = (i % 2 ? 1 : -1) * (110 + i * 17);
        shards += `<path d="M${p1[0].toFixed(1)} ${p1[1].toFixed(1)}L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}L${p3[0].toFixed(1)} ${p3[1].toFixed(1)}Z"
              fill="${accent}" opacity=".9"
              style="--dx:${(ux * d).toFixed(1)}px;--dy:${(uy * d).toFixed(1)}px;--rot:${rot}deg"/>`;
      });
      g.innerHTML = shards;
      host.appendChild(g);
      autoRemove(g, g.querySelector("path"), 1300);
      return g;
    },
  },
  {
    id: "pl-petal",
    name: "花瓣绽开",
    desc: "八片花瓣打着旋儿展开，最柔和的一档",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:rotate(-16deg) scale(.35);opacity:0}
          20% {opacity:.95}
          52% {opacity:.9}
          100%{transform:rotate(18deg) scale(2.4);opacity:0}
        }
        .${id}{${SELF}animation:${id}-k 1s cubic-bezier(.2,.7,.3,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const g = gEl(id);
      let petals = "";
      const n = 8;
      ring(n, -Math.PI / 2).forEach((a) => {
        const deg = a * 180 / Math.PI;
        const cx = x + Math.cos(a) * r * 1.05;
        const cy = y + Math.sin(a) * r * 1.05;
        // 花瓣长轴沿半径方向：椭圆长轴本来是竖直的，故 rotate(a - 90°)
        petals += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}"
              rx="${(r * .34).toFixed(2)}" ry="${(r * 1).toFixed(2)}"
              fill="${accent}" opacity=".55"
              transform="rotate(${(deg - 90).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
      });
      petals += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * .42).toFixed(2)}"
              fill="${accent}" opacity=".8"/>`;
      g.innerHTML = petals;
      host.appendChild(g);
      autoRemove(g, g, 1500);
      return g;
    },
  },
  {
    id: "pl-sigil",
    name: "符印轮转",
    desc: "一圈刻度环带着星形骨架旋转展开，仪式感最强",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:rotate(-130deg) scale(.18);opacity:0}
          26% {opacity:.95}
          100%{transform:rotate(76deg) scale(2.3);opacity:0}
        }
        .${id}{${SELF}animation:${id}-k .82s cubic-bezier(.18,.8,.3,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const R = r * 1.15;
      // 六角星骨架
      const pts: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? R * 0.52 : R;
        pts.push(`${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`);
      }
      // 环上刻度
      let ticks = "";
      ring(24).forEach((a) => {
        const long = Math.round(a * 100) % 3 === 0;
        const r0 = R * 0.94, r1 = R * (long ? 1.22 : 1.08);
        ticks += `<path d="M${(x + Math.cos(a) * r0).toFixed(1)} ${(y + Math.sin(a) * r0).toFixed(1)}L${(x + Math.cos(a) * r1).toFixed(1)} ${(y + Math.sin(a) * r1).toFixed(1)}"
              stroke="${accent}" stroke-width="${(r * (long ? .11 : .07)).toFixed(2)}" stroke-linecap="round"
              opacity="${long ? ".95" : ".6"}"/>`;
      });
      const g = gEl();
      g.innerHTML = `<g class="${id}">
            <circle cx="${x}" cy="${y}" r="${R.toFixed(1)}" fill="none" stroke="${accent}"
              stroke-width="${(r * .12).toFixed(2)}" stroke-dasharray="${(r * .5).toFixed(1)} ${(r * .34).toFixed(1)}"/>
            <path d="M${pts.join("L")}Z" fill="none" stroke="${accent}" stroke-width="${(r * .13).toFixed(2)}"
              stroke-linejoin="round" opacity=".85"/>
            ${ticks}
          </g>`;
      host.appendChild(g);
      autoRemove(g, g.querySelector(`.${id}`), 1300);
      return g;
    },
  },
  {
    id: "pl-dust",
    name: "尘爆扬散",
    desc: "十几粒大小不一的尘点慢慢散开上浮，最轻最慢",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translate(0,0) scale(.6);opacity:0}
          16% {opacity:.85}
          55% {opacity:.6}
          100%{transform:translate(var(--dx),var(--dy)) scale(1.25);opacity:0}
        }
        .${id} circle{${SELF}animation:${id}-k var(--d,1.5s) ease-out forwards;animation-delay:var(--t,0s)}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const g = gEl(id);
      let dots = "";
      ring(14, 0.15).forEach((a, i) => {
        const d = r * (1.0 + (i % 5) * 0.42);
        dots += `<circle cx="${(x + Math.cos(a) * r * .4).toFixed(1)}"
              cy="${(y + Math.sin(a) * r * .4).toFixed(1)}"
              r="${(r * (0.15 + (i % 4) * 0.06)).toFixed(2)}" fill="${accent}"
              style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d - r * 0.5).toFixed(1)}px;--d:${(1.15 + (i % 6) * 0.13).toFixed(2)}s;--t:${(i * 0.035).toFixed(3)}s"/>`;
      });
      g.innerHTML = dots;
      host.appendChild(g);
      autoRemove(g, g.querySelector("circle:last-child"), 2600);
      return g;
    },
  },
  {
    id: "pl-vortex",
    name: "漩涡收束",
    desc: "三圈弧线反向旋进来收成一点 —— 唯一「由外向内」的方案",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:rotate(210deg) scale(2.7);opacity:.9}
          100%{transform:rotate(-40deg) scale(.3);opacity:0}
        }
        .${id} circle{${SELF}animation:${id}-k .8s cubic-bezier(.3,.85,.35,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      const g = gEl();
      let s = "";
      [[1.55, 1.0, .34], [2.15, .62, .26], [2.75, .4, .18]].forEach(([rr, dash, gap], i) => {
        s += `<circle class="${id}" cx="${x}" cy="${y}" r="${(r * rr).toFixed(1)}" fill="none"
              stroke="${accent}" stroke-width="${(r * (0.16 - i * 0.03)).toFixed(2)}"
              stroke-dasharray="${(r * dash * 4).toFixed(1)} ${(r * gap * 4).toFixed(1)}"
              stroke-linecap="round" opacity=".85" style="animation-delay:${(i * 0.05).toFixed(2)}s"/>`;
      });
      g.innerHTML = s;
      host.appendChild(g);
      const cs = g.querySelectorAll("circle");
      autoRemove(g, cs[cs.length - 1], 1300);
      return g;
    },
  },
  {
    id: "pl-flash",
    name: "爆闪",
    desc: "一记极短的强光炸开，只 0.3 秒，节奏最跳",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scale(.18);opacity:0}
          10% {opacity:1}
          100%{transform:scale(1.65);opacity:0}
        }
        @keyframes ${id}-r{
          0%  {transform:scale(.35);opacity:1}
          100%{transform:scale(2.1);opacity:0}
        }
        .${id}{transform-box:fill-box;transform-origin:center;animation:${id}-k .3s ease-out forwards}
        .${id}-ray{${SELF}animation:${id}-r .36s ease-out forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      let rays = "";
      ring(8, 0.4).forEach((a) => {
        const r0 = r * 0.75, r1 = r * 1.9;
        rays += `<path class="${id}-ray" d="M${(x + Math.cos(a) * r0).toFixed(1)} ${(y + Math.sin(a) * r0).toFixed(1)}L${(x + Math.cos(a) * r1).toFixed(1)} ${(y + Math.sin(a) * r1).toFixed(1)}"
              stroke="${accent}" stroke-width="${(r * .24).toFixed(2)}" stroke-linecap="round"/>`;
      });
      const g = gEl();
      const gid = uniqueGradientId(id);
      g.innerHTML = `<defs>
            <radialGradient id="${gid}" cx="50%" cy="50%" r="50%">
              <stop offset="0" stop-color="${accent}" stop-opacity="1"/>
              <stop offset=".38" stop-color="${accent}" stop-opacity=".62"/>
              <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <circle class="${id}" cx="${x}" cy="${y}" r="${(r * 1.7).toFixed(1)}" fill="url(#${gid})"/>
          <g class="${id}-rays">${rays}</g>`;
      host.appendChild(g);
      autoRemove(g, g.querySelector(`.${id}`), 900);
      return g;
    },
  },
];

/* ══════════════════════════════════════════════════════════════════════
   ② 棋子落子动效（12 套）
   只输出 CSS：把动画挂到「刚落下的那颗子」的外层 <g> 上。
   引擎给新落的子加 class，动画跑完由引擎摘掉（否则整盘子的 class 会一直堆着）。
   可选 spawn()：落点的伴随特效，插在棋子**下面**。
   ══════════════════════════════════════════════════════════════════════ */

const DROP_EFFECTS_RAW: EffectScheme[] = [
  {
    id: "dp-settle",
    name: "落下弹定",
    desc: "从上方落下并轻微回弹，有重量",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translateY(-46%) scale(.86);opacity:0}
          55% {transform:translateY(0)     scale(1.06);opacity:1}
          76% {transform:translateY(0)     scale(.97)}
          100%{transform:translateY(0)     scale(1)}
        }
        .${id}{${SELF}animation:${id}-k .42s cubic-bezier(.34,1.4,.6,1) both}`,
  },
  {
    id: "dp-pop",
    name: "由小胀开",
    desc: "从很小弹到原尺寸，轻快",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scale(.28);opacity:0}
          62% {transform:scale(1.14);opacity:1}
          100%{transform:scale(1)}
        }
        .${id}{${SELF}animation:${id}-k .34s cubic-bezier(.3,1.5,.55,1) both}`,
  },
  {
    id: "dp-fade",
    name: "淡入浮现",
    desc: "透明渐显 + 极轻缩放，最安静",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scale(.9);opacity:0}
          100%{transform:scale(1);opacity:1}
        }
        .${id}{${SELF}animation:${id}-k .3s ease-out both}`,
  },
  {
    id: "dp-spin",
    name: "旋入落定",
    desc: "打着旋儿转进来再稳住，像陀螺停下",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:rotate(-220deg) scale(.12);opacity:0}
          56% {transform:rotate(14deg)  scale(1.1);opacity:1}
          78% {transform:rotate(-6deg)  scale(.97)}
          100%{transform:rotate(0)      scale(1)}
        }
        @keyframes ${id}-tk{0%{transform:rotate(-200deg) scale(.4);opacity:.8}100%{transform:rotate(60deg) scale(1.35);opacity:0}}
        .${id}{${SELF}animation:${id}-k .54s cubic-bezier(.3,1.2,.5,1) both}
        .${id}-tr{${SELF}animation:${id}-tk .6s cubic-bezier(.3,1.15,.5,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      // 旋转拖尾：一道渐隐的弧，点出"转进来"的方向感
      const g = gEl();
      g.innerHTML = `<circle class="${id}-tr" cx="${x}" cy="${y}" r="${(r * 1.25).toFixed(1)}"
              fill="none" stroke="${accent}" stroke-width="${(r * .16).toFixed(2)}"
              stroke-dasharray="${(r * 1.1).toFixed(1)} ${(r * 6).toFixed(1)}" opacity=".75"/>`;
      insertUnderStones(host, g);
      autoRemove(g, g.querySelector("circle"), 1100);
      return g;
    },
  },
  {
    id: "dp-flip",
    name: "翻面落定",
    desc: "像硬币翻正一样从侧面摊平，另有风味",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scaleX(.05) scaleY(1.09);opacity:.18}
          42% {transform:scaleX(1.13) scaleY(.93);opacity:1}
          66% {transform:scaleX(.94)  scaleY(1.03)}
          100%{transform:scaleX(1)    scaleY(1)}
        }
        .${id}{${SELF}animation:${id}-k .46s cubic-bezier(.3,1.1,.45,1) both}`,
  },
  {
    id: "dp-squash",
    name: "弹压落定",
    desc: "砸下来被压扁再弹回，卡通式的手感",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translateY(-62%) scale(1.5,.74);opacity:0}
          46% {transform:translateY(0)    scale(1.3,.7);opacity:1}
          64% {transform:translateY(0)    scale(.9,1.15)}
          82% {transform:translateY(0)    scale(1.05,.97)}
          100%{transform:translateY(0)    scale(1,1)}
        }
        @keyframes ${id}-wk{0%{transform:scale(.3);opacity:.9}100%{transform:scale(2.3);opacity:0}}
        .${id}{${SELF}animation:${id}-k .52s cubic-bezier(.3,1.08,.4,1) both}
        .${id}-w{${SELF}animation:${id}-wk .5s cubic-bezier(.16,.84,.44,1) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      // 落地一记压扁的横向冲击环
      const g = gEl();
      g.innerHTML = `<ellipse class="${id}-w" cx="${x}" cy="${(y + r * .5).toFixed(1)}"
              rx="${(r * 1.2).toFixed(1)}" ry="${(r * .42).toFixed(1)}"
              fill="none" stroke="${accent}" stroke-width="${(r * .2).toFixed(2)}" opacity=".85"/>`;
      insertUnderStones(host, g);
      autoRemove(g, g.querySelector("ellipse"), 1000);
      return g;
    },
  },
  {
    id: "dp-fall",
    name: "坠落入定",
    desc: "从天而降 + 落地扬尘，最有分量",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translateY(-330%) scale(.72);opacity:0}
          14% {opacity:1}
          60% {transform:translateY(0) scale(1.16,.86)}
          79% {transform:translateY(0) scale(.93,1.07)}
          100%{transform:translateY(0) scale(1,1)}
        }
        @keyframes ${id}-dk{0%{transform:scale(.3);opacity:.85}100%{transform:scale(2.1);opacity:0}}
        @keyframes ${id}-pk{0%{transform:translate(0,0) scale(1);opacity:.9}100%{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
        .${id}{${SELF}animation:${id}-k .6s cubic-bezier(.42,0,.34,1.24) both}
        .${id}-d{${SELF}animation:${id}-dk .5s cubic-bezier(.16,.84,.44,1) .3s forwards;opacity:0}
        .${id}-p{${SELF}animation:${id}-pk .55s ease-out forwards;opacity:0}`,
    spawn: (id, { x, y, r, host, accent }) => {
      // 落地扬尘：一圈薄环 + 两侧散开的尘点
      const g = gEl();
      let s = `<ellipse class="${id}-d" cx="${x}" cy="${(y + r * .62).toFixed(1)}"
              rx="${(r * 1.1).toFixed(1)}" ry="${(r * .34).toFixed(1)}"
              fill="none" stroke="${accent}" stroke-width="${(r * .16).toFixed(2)}"/>`;
      for (let i = 0; i < 6; i += 1) {
        const dir = i < 3 ? -1 : 1;
        const k = i % 3;
        s += `<circle class="${id}-p" cx="${x.toFixed(1)}" cy="${(y + r * .6).toFixed(1)}"
                  r="${(r * (0.1 + k * 0.05)).toFixed(2)}" fill="${accent}"
                  style="--dx:${(dir * r * (1.1 + k * 0.5)).toFixed(1)}px;--dy:${(-r * (0.25 + k * 0.2)).toFixed(1)}px;animation-delay:${(0.3 + k * 0.04).toFixed(2)}s"/>`;
      }
      g.innerHTML = s;
      insertUnderStones(host, g);
      autoRemove(g, g.querySelector(`.${id}-d`), 1300);
      return g;
    },
  },
  {
    id: "dp-arc",
    name: "抛入落定",
    desc: "被斜着甩进来，带一点旋转的惯性",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translate(-98%,-98%) rotate(-165deg) scale(.42);opacity:0}
          58% {transform:translate(0,0) rotate(0) scale(1.12);opacity:1}
          78% {transform:translate(0,0) rotate(0) scale(.95)}
          100%{transform:translate(0,0) rotate(0) scale(1)}
        }
        .${id}{${SELF}animation:${id}-k .58s cubic-bezier(.24,1.05,.4,1) both}`,
  },
  {
    id: "dp-jelly",
    name: "果冻颤定",
    desc: "弹到位后来回抖几下，很调皮",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:scale(.2);opacity:0}
          34% {transform:scale(1.26);opacity:1}
          50% {transform:scale(.85,1.17)}
          64% {transform:scale(1.13,.9)}
          78% {transform:scale(.94,1.05)}
          90% {transform:scale(1.03,.98)}
          100%{transform:scale(1,1)}
        }
        .${id}{${SELF}animation:${id}-k .66s cubic-bezier(.3,1.25,.5,1) both}`,
  },
  {
    id: "dp-slide",
    name: "侧滑入位",
    desc: "从右边滑进来、蹭两下停住",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:translateX(130%) scale(.82);opacity:0}
          58% {transform:translateX(-7%) scale(1.05);opacity:1}
          79% {transform:translateX(4%)  scale(.99)}
          100%{transform:translateX(0)   scale(1)}
        }
        .${id}{${SELF}animation:${id}-k .5s cubic-bezier(.28,1.1,.45,1) both}`,
  },
  {
    id: "dp-spiral",
    name: "螺旋收束",
    desc: "从大到小拧着收进来，最戏剧化",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {transform:rotate(540deg) scale(2.5);opacity:0}
          26% {opacity:1}
          70% {transform:rotate(22deg) scale(.9)}
          100%{transform:rotate(0) scale(1)}
        }
        @keyframes ${id}-sk{0%{transform:rotate(380deg) scale(1.9);opacity:.75}100%{transform:rotate(-40deg) scale(.55);opacity:0}}
        .${id}{${SELF}animation:${id}-k .68s cubic-bezier(.26,.9,.34,1.06) both}
        .${id}-s{${SELF}animation:${id}-sk .68s cubic-bezier(.26,.9,.34,1.06) forwards}`,
    spawn: (id, { x, y, r, host, accent }) => {
      // 螺旋拖尾：两道渐隐的弧，跟着一起收
      const g = gEl();
      g.innerHTML = `
          <circle class="${id}-s" cx="${x}" cy="${y}" r="${(r * 1.5).toFixed(1)}" fill="none"
            stroke="${accent}" stroke-width="${(r * .12).toFixed(2)}"
            stroke-dasharray="${(r * .9).toFixed(1)} ${(r * 4).toFixed(1)}" opacity=".75"/>
          <circle class="${id}-s" cx="${x}" cy="${y}" r="${(r * 2.1).toFixed(1)}" fill="none"
            stroke="${accent}" stroke-width="${(r * .08).toFixed(2)}"
            stroke-dasharray="${(r * .7).toFixed(1)} ${(r * 3).toFixed(1)}" opacity=".5"
            style="animation-delay:.1s"/>`;
      insertUnderStones(host, g);
      const cs = g.querySelectorAll("circle");
      autoRemove(g, cs[cs.length - 1], 1200);
      return g;
    },
  },
  {
    id: "dp-flash",
    name: "闪白定格",
    desc: "先亮一下再定住，节奏最跳",
    css: (id) => `
        @keyframes ${id}-k{
          0%  {opacity:0;transform:scale(1.75)}
          20% {opacity:1;transform:scale(1.06)}
          38% {opacity:.3;transform:scale(1.24)}
          58% {opacity:1;transform:scale(.95)}
          100%{opacity:1;transform:scale(1)}
        }
        .${id}{${SELF}animation:${id}-k .5s ease-out both}`,
  },
];

/* 实验室那两份数组的 place/drop 方案 css() 里其实**没带** prefers-reduced-motion 降级
   （只有已下线的 ambient 带了）。移植约束明确要求"返回的 CSS 要带降级"，
   所以这里统一包一层：id 相关的所有元素（含 `${id}-r` / `${id}-c` 这些派生类名）
   在系统开启"减少动态效果"时直接 animation:none。
   方案正文仍与实验室逐字一致，只有这一层 RM 是本体补的。 */
const withReducedMotion = (scheme: EffectScheme): EffectScheme => ({
  ...scheme,
  css: (id) => `${scheme.css(id)}\n@media(prefers-reduced-motion:reduce){[class*="${id}"]{animation:none!important}}`,
});

/** 原始方案（**不带** reduced-motion 降级）：只有「外观 → 公用效果」的预览舞台用它——
 *  那一小块就是让用户看清动画长什么样，而老 Android WebView 常把 `prefers-reduced-motion`
 *  报成 reduce（真机上「公用效果预览永远只有一颗静止子」的成因），带降级的版本会被自己那条
 *  `animation:none` 静音。实盘一律用下面带降级的 PLACE_EFFECTS / DROP_EFFECTS。 */
export const PLACE_EFFECTS_RAW_SCHEMES: EffectScheme[] = PLACE_EFFECTS_RAW;
export const DROP_EFFECTS_RAW_SCHEMES: EffectScheme[] = DROP_EFFECTS_RAW;
export const PLACE_EFFECTS: EffectScheme[] = PLACE_EFFECTS_RAW.map(withReducedMotion);
export const DROP_EFFECTS: EffectScheme[] = DROP_EFFECTS_RAW.map(withReducedMotion);
