/**
 * 棋魂提示条的云雾衬底：钉住四条**不会自己喊疼**的不变量。
 *
 * 为什么值得单测（都是这一轮实际踩过的）：
 *  · 衬底与形状是同一条轮廓 ⇒ 它一旦不盖住文字，字就糊在花底上
 *    （2026-10-11 那次"深色主题下字看不清"就是这个性质，当时靠 66 条像素量才抓出来）；
 *  · 提示条必须落在顶栏 68px 带子里（用户 10-10：「不要挡住棋盘」）⇒ 轮廓不许长出留边；
 *  · CSS 里的偏移/尺寸与 TS 里的留边是**两处**，改一处忘另一处不会报错，只会让墨错位。
 */
// @ts-expect-error Node is available to Vitest, not the browser application.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOUL_MIST_FILTER, SOUL_MIST_GRADIENT, SOUL_MIST_INK, SOUL_MIST_PAD, SOUL_MIST_SIZE, SOUL_MIST_STOPS, soulMistOpacityAt, soulMistPath, soulMistPoints } from "./soul-gain-shape";

/** 内容盒在 viewBox 里的位置（盒 = 标称 179×40，四周是留边）。 */
const BOX = { x0: SOUL_MIST_PAD.l, y0: SOUL_MIST_PAD.t, x1: SOUL_MIST_PAD.l + 179, y1: SOUL_MIST_PAD.t + 40 };
/** 文字带：盒内上下各让 6px（padding 3px + 字肩），这三列分别是魂火 / 数字 / 来源小字的中心。 */
const BAND = { top: BOX.y0 + 6, bottom: BOX.y1 - 6 };
const COLUMNS = { 魂火: BOX.x0 + 17, 数字: BOX.x0 + 55, 来源: BOX.x0 + 140 };

/**
 * 某一列上墨的纵向跨度：把轮廓当闭合折线，与竖线 x=const 求交。
 * ⚠ 不能按"落在 x±1.5 内的采样点"数——极坐标采样在**左端那段**每格能跨 2px 多的 x，
 * 于是有的列只命中 1 个点，跨度量出来是 0（第一版就是这么误报的）。
 * 用折线求交与采样密度无关；贝塞尔还会在折线外一点点过冲，所以这里是偏保守的估法。
 */
const yAt = (pts: Array<[number, number]>, x: number) => {
  const hits: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    if (x1 === x2) continue;
    if ((x1 - x) * (x2 - x) <= 0) hits.push(y1 + ((x - x1) / (x2 - x1)) * (y2 - y1));
  }
  return hits.sort((a, b) => a - b);
};
const spanAt = (pts: Array<[number, number]>, x: number) => {
  const h = yAt(pts, x);
  return h.length >= 2 ? h[h.length - 1] - h[0] : 0;
};
const coversBand = (pts: Array<[number, number]>, x: number) => {
  const h = yAt(pts, x);
  return h.length >= 2 && h[0] <= BAND.top && h[h.length - 1] >= BAND.bottom;
};

describe("棋魂提示条的云雾衬底", () => {
  it("种子 1–97 全部：轮廓不许长出留边（长出=被屏幕裁 / 垂过顶栏下沿）", () => {
    for (let seed = 1; seed <= 97; seed++) {
      for (const [x, y] of soulMistPoints(seed)) {
        expect(x, `seed ${seed} 的 x=${x.toFixed(1)} 出界`).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(SOUL_MIST_SIZE.W);
        expect(y, `seed ${seed} 的 y=${y.toFixed(1)} 出界`).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(SOUL_MIST_SIZE.H);
      }
    }
  });

  it("种子 1–97 全部：魂火 / 数字 / 来源三列都被墨盖住文字带", () => {
    for (let seed = 1; seed <= 97; seed++) {
      const pts = soulMistPoints(seed);
      for (const [who, x] of Object.entries(COLUMNS)) {
        expect(coversBand(pts, x), `seed ${seed} 的「${who}」列没被墨盖住`).toBe(true);
        expect(spanAt(pts, x), `seed ${seed} 的「${who}」列墨太薄`).toBeGreaterThanOrEqual(BAND.bottom - BAND.top);
      }
    }
  });

  it("两头不许收尖（用户：「左边的高度有点窄了，感觉不够平均」）", () => {
    // 端点列与中间列的墨高差不得超过 25%：一旦有人把保底轮廓改回普通椭圆，这条会红
    for (let seed = 1; seed <= 97; seed += 4) {
      const pts = soulMistPoints(seed);
      const mid = spanAt(pts, COLUMNS.数字);
      const flame = spanAt(pts, COLUMNS.魂火);
      expect(flame / mid, `seed ${seed}：魂火列 ${flame.toFixed(1)} / 中间列 ${mid.toFixed(1)}`).toBeGreaterThan(0.75);
    }
  });

  it("中心必须是实的（门禁按 #1a1610 量文字，门槛 4.5:1）", () => {
    expect(SOUL_MIST_INK).toBe("#1a1610");
    expect(SOUL_MIST_STOPS[0].opacity).toBeGreaterThanOrEqual(.9);
    expect(SOUL_MIST_STOPS[1].opacity).toBeGreaterThanOrEqual(.9);
    expect(SOUL_MIST_STOPS[SOUL_MIST_STOPS.length - 1].opacity).toBe(0);
  });

  /**
   * 2026-10-13「字乌漆嘛黑」那条 bug 的守卫：**整段文字坐的那一圈必须还是实心墨**。
   *
   * 为什么单独立一条：上一量的是"中心够不够黑"，而中心一直是够的（中位 11:1）——
   * 坏在**右边那行 11px 小字**，它离圆心最远，正好落在渐隐斜坡上。逐主题量真实像素实测
   * 最差 4.75:1、8~10% 的像素低于 4.5:1，而旧的那两条断言全绿。所以这条量的不是中心，
   * 是**文字带四个角**（objectBoundingBox 单位的椭圆渐变：分数 = 归一化坐标到圆心的距离 / r）。
   */
  it("文字带四角都必须在渐隐圈之内（浅色主题下露白就是把字糊掉）", () => {
    const W = SOUL_MIST_SIZE.W, H = SOUL_MIST_SIZE.H;
    // 文字带 = 内容盒横向到边、纵向让开 padding 与字肩（来源小字最靠右，取它那一侧为最远）
    const band = { x0: BOX.x0, x1: BOX.x1, y0: BAND.top, y1: BAND.bottom };
    const corners = [[band.x0, band.y0], [band.x1, band.y0], [band.x0, band.y1], [band.x1, band.y1]] as const;
    const fractionAt = (x: number, y: number, r: number) => Math.hypot(x / W - SOUL_MIST_GRADIENT.cx / 100, y / H - SOUL_MIST_GRADIENT.cy / 100) / (r / 100);
    for (const [x, y] of corners) {
      const op = soulMistOpacityAt(fractionAt(x, y, SOUL_MIST_GRADIENT.r));
      expect(op, `文字带角 (${x},${y}) 处墨的实心度只有 ${op.toFixed(2)}，亮字会压在露白上`).toBeGreaterThanOrEqual(.88);
    }
    // 反向自检：这条断言必须**有牙** —— 旧半径 60% 时同一批点上确实会掉到平台以下
    const oldWorst = Math.min(...corners.map(([x, y]) => soulMistOpacityAt(fractionAt(x, y, 60))));
    expect(oldWorst).toBeLessThan(.88);
  });

  it("CSS 的偏移/尺寸与 TS 的留边必须一致（两处分开写，改一处就会错位）", () => {
    const css = readFileSync(new URL("./soul-panel.css", import.meta.url), "utf8");
    const block = /\.soul-gain-mist\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const want = {
      left: `-${SOUL_MIST_PAD.l}px`,
      top: `-${SOUL_MIST_PAD.t}px`,
      width: `calc(100% + ${SOUL_MIST_PAD.l + SOUL_MIST_PAD.r}px)`,
      height: `calc(100% + ${SOUL_MIST_PAD.t + SOUL_MIST_PAD.b}px)`,
    };
    for (const [prop, value] of Object.entries(want)) {
      expect(block, `.soul-gain-mist 里缺 ${prop}: ${value}`).toContain(`${prop}: ${value}`);
    }
    expect(block).toContain("z-index: -1");
    // 旧的椭圆柔光必须真的没了（只查**规则**，注释里提到它是历史说明）
    expect(css).not.toMatch(/\.soul-gain::before\s*\{/);
  });

  it("路径是闭合的、且带滤镜引用（丢了 filter 就是一片硬边，不像烟）", () => {
    const d = soulMistPath(12);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.length).toBeGreaterThan(3000);
    expect(SOUL_MIST_FILTER.scale).toBeGreaterThan(0);
  });
});
