/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "../types";

  /** 确定性伪随机。⚠ 不是密码学用途，只给 SVG 形状做确定性微扰；
   *  "可被预测"正是本意（同一颗子每次渲染必须一样）。安全扫描器报弱随机属误报。 */
  const rng = (seed) => {
    let s = (seed | 0) || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  };

  /** 不规则团块路径。半径波动收在 0.93–1.07，再大棋子大小就失控。 */
  const blob = (x, y, r, seed, { wob = 0.14, n = 14 } = {}) => {
    const rand = rng(seed);
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - wob / 2 + rand() * wob);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i += 1) {
      const c = pts[(i + 1) % n], nx = pts[(i + 2) % n];
      d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${((c[0] + nx[0]) / 2).toFixed(1)} ${((c[1] + nx[1]) / 2).toFixed(1)}`;
    }
    return `${d}Z`;
  };

  /** 轮廓专用种子：**只**由格子坐标派生，不含 player。
   *  ⚠ 以前这些棋子的 seed 里都掺了 `player * 一个大素数`，轮廓 blob 也用它 ——
   *     于是黑白两面各自抽一套随机半径。wob 0.17 就是 ±8.5%，实测下来敦煌候选
   *     黑 1.02R / 白 0.92R，用户看到的就是"一类大、一类小"。
   *     质感（色斑、气泡、指纹）跟着 player 走没问题，**尺寸**不行。 */
  const geoSeed = (x, y) => Math.round(x * 13 + y * 7);

  const relLum = (hex) => {
    const h = String(hex).replace("#", "");
    if (h.length < 6) return 0.5;
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };


  const NEW = [];

  /** 每枚棋子的公共外壳：落影 + 可选轮廓 + 内容 + 当前手环 */
  const shell = ({ x, y, r, player, seed, rim, body, extra = "", isLast, ring }) => {
    let s = `<ellipse cx="${x.toFixed(1)}" cy="${(y + r * 0.16).toFixed(1)}"
                rx="${(r * 0.98).toFixed(2)}" ry="${(r * 0.9).toFixed(2)}" fill="#000" opacity=".26"/>`;
    if (rim) {
      s += `<path d="${blob(x, y, r, geoSeed(x, y), { wob: .1, n: 14 })}" fill="none"
              stroke="${rim}" stroke-width="${(r * .13).toFixed(2)}"/>`;
    }
    s += body;
    if (extra) s += extra;
    if (isLast) {
      s += `<path d="${blob(x, y, r + 4.5, seed + 5, { wob: .1 })}" fill="none"
              stroke="${ring || "#e8b84b"}" stroke-width="2.4"/>`;
    }
    return s;
  };

  const mkStone = (o) => NEW.push(o);





  /* 05 大漆：黑漆/朱漆镜面，边缘薄而利 */
  mkStone({
    id: "st-ns-lacquer", name: "大漆", group: "材质 · 漆器", swatch: "#1c1a1e", selfRim: true,
    defs: `<radialGradient id="ns-lacquer-g" cx="32%" cy="26%" r="82%">
        <stop offset="0" stop-color="#5a5a66"/><stop offset=".22" stop-color="#232028"/>
        <stop offset=".7" stop-color="#100e14"/><stop offset="1" stop-color="#050408"/>
      </radialGradient>
      <radialGradient id="ns-lacquer-r" cx="32%" cy="26%" r="82%">
        <stop offset="0" stop-color="#e8604a"/><stop offset=".3" stop-color="#a82a1e"/>
        <stop offset=".75" stop-color="#6e1410"/><stop offset="1" stop-color="#3c0806"/>
      </radialGradient>`,
    stone: ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 37 + y * 41 + player * 521);
      let inner = `<path d="${blob(x, y, r, geoSeed(x, y), { wob: .08, n: 16 })}" fill="url(#ns-lacquer-${player === 1 ? "g" : "r"})"/>`;
      // 漆面镜光：一道细长锐利的高光 + 一点小反光
      inner += `<path d="M${(x - r * .58).toFixed(1)} ${(y - r * .3).toFixed(1)}
                 q${(r * .42).toFixed(1)} ${(-r * .3).toFixed(1)} ${(r * .96).toFixed(1)} ${(-r * .06).toFixed(1)}"
                fill="none" stroke="#fff" stroke-width="${(r * .13).toFixed(2)}"
                stroke-linecap="round" opacity=".72"/>`;
      inner += `<circle cx="${(x + r * .3).toFixed(1)}" cy="${(y + r * .42).toFixed(1)}"
                 r="${(r * .09).toFixed(2)}" fill="#fff" opacity=".3"/>`;
      return shell({ x, y, r, player, seed, rim: player === 1 ? "rgba(180,180,200,.35)" : "rgba(40,10,6,.6)", body: inner, isLast, ring: "#ffb060" });
    },
  });








  /* ── 二b、敦煌棋子候选（三版里用户留了 A 联珠莲瓣，B 矿物厚涂 / C 藻井叠框 已删）。
     当初立下的三条约束仍然成立，深化时照办：
       · 外径 = 1.0r 基准（含描边），不能像 indie 那枚一样把自己撑大 42%
       · 黑白 ΔL 要过 .check-stones 的 40 线 —— 所以深色那面一律压到 #241009 以下、
         浅色那面抬到 #f4ecda 以上，纹样只用"同面色上的线"，不靠底色区分黑白
       · 确定性 rng(seed)，不碰 Math.random
       · 不用 filter（这三版都靠几何说话，也省掉每颗子一个滤镜的开销）
     配色取 skins/theme-dunhuang.js 的矿物色板（那边是原画，这里只借色不借结构）。 */
  const DH = {
    gold: "#e0ac46", goldHi: "#ffd97a", azurite: "#2c5f8a", malachite: "#2e7d5a",
    tuRed: "#8f3a28", cinnabar: "#c2492f", purple: "#7c4258", clay: "#6b4a30",
    blk: "#241009", wht: "#f4ecda",
  };
  /** 黑白两面的"线色"：暗面用泥金（暗底配亮线），亮面用石青（亮底配暗线）。
   *  ⚠ 对比方向跟着底色明暗走，不是跟着"子叫什么颜色"走 —— 这是敦煌族反复踩的坑。 */
  const dhPair = (player) => (player === 1
    ? { body: DH.blk, line: DH.gold, line2: DH.goldHi, edge: "rgba(0,0,0,.55)" }
    : { body: DH.wht, line: DH.azurite, line2: DH.malachite, edge: "rgba(90,50,20,.35)" });



  /* 候选 A · 联珠圈 + 六瓣莲：敦煌边饰的签名是"一圈小珠夹着主纹"，
     子心放一朵俯视莲花（藻井/平棋的常见母题）。母题最贴壁画。
     ⚠ 12 颗珠、6 片瓣各合成**一条 path 的子路径**：
        实测一颗子 23 个元素 × 60 子 = 1381 节点，压成 7 个元素后是 421 节点，
        观感一模一样。子是要成百颗堆的，元素数比元素样式值钱。 */
  mkStone({
    id: "st-dh-lianzhu", name: "敦煌候选 · 联珠莲瓣", group: "敦煌 · 候选",
    swatch: DH.gold,
    vars: { "--st-black": DH.blk, "--st-white": DH.wht },
    stone: ({ x, y, r, player, isLast }) => {
      const seed = Math.round(x * 11 + y * 17 + player * 307);
      const c = dhPair(player);
      const rand = rng(seed + 3);
      let s = `<path d="${blob(x, y, r * 0.98, geoSeed(x, y), { wob: .07, n: 16 })}" fill="${c.body}" stroke="${c.edge}" stroke-width="${(r * .05).toFixed(2)}"/>`;
      // 联珠圈：12 颗，珠径略有大小（一模一样的珠是印刷，不是手画）
      let beads = "";
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2 + 0.13;
        const pr = r * (0.072 + rand() * 0.026);
        const px = x + Math.cos(a) * r * 0.79, py = y + Math.sin(a) * r * 0.79;
        beads += `M${(px - pr).toFixed(1)} ${py.toFixed(1)}a${pr.toFixed(2)} ${pr.toFixed(2)} 0 1 0 ${(pr * 2).toFixed(2)} 0a${pr.toFixed(2)} ${pr.toFixed(2)} 0 1 0 ${(-pr * 2).toFixed(2)} 0`;
      }
      s += `<path d="${beads}" fill="none" stroke="${c.line}" stroke-width="${(r * .045).toFixed(2)}"/>`;
      // 六瓣莲：每片叶用两段等半径圆弧夹出来（尖头，比 ellipse 更像莲瓣）
      let petals = "";
      // 弧半径必须大于半弦长（弦长 0.40r → 半径要 >0.20r），否则两段弧拼成一个正圆，
      // 看着是「一圈珠子」而不是尖头莲瓣。0.32r 得到约 0.07r 的矢高，正好是瓣形。
      const w = (r * 0.32).toFixed(2);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + 0.21;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x0 = x + ca * r * 0.17, y0 = y + sa * r * 0.17;
        const x1 = x + ca * r * 0.57, y1 = y + sa * r * 0.57;
        petals += `M${x0.toFixed(1)} ${y0.toFixed(1)}A${w} ${w} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}A${w} ${w} 0 0 1 ${x0.toFixed(1)} ${y0.toFixed(1)}`;
      }
      s += `<path d="${petals}" fill="none" stroke="${c.line}" stroke-width="${(r * .042).toFixed(2)}" opacity=".92"/>`;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * .11).toFixed(2)}" fill="${c.line2}" opacity=".85"/>`;
      if (isLast) s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * .99).toFixed(2)}" fill="none" stroke="${DH.goldHi}" stroke-width="${(r * .14).toFixed(2)}"/>`;
      return s;
    },
  });




/** 手工零件 → 皮肤记录：去掉 st- 前缀当 id，只带棋子半边（没有盘字段，
 *  derive() 因此不会给它生成棋盘零件）。 */
export const SKINS: Skin[] = NEW.map((p: any) => ({
  id: String(p.id).replace(/^st-/, ""), name: p.name, group: p.group, swatch: p.swatch,
  defs: p.defs, vars: p.vars, selfRim: p.selfRim, stone: p.stone, stoneMotions: p.stoneMotions,
}));
