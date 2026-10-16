/**
 * 分析深度档位（用户 2026-09-16：「显示和计算器差不多，就是最少和最大的深度」）。
 *
 * 两端都是「自动 / 具体档」：
 *  - 最大深度 = Rapfi 的 `MAX_DEPTH`（0 = 自动，沿用各路径原本的取值：持续分析 512、
 *    单次分析 96、落子型回合 64）。
 *  - 最小深度 = Rapfi 的 `START_DEPTH`（迭代加深从第几层起算；0/1 = 从第 1 层正常起算）。
 *
 * **诚实提示（别让用户误以为能白拿速度）**：持续分析每轮都是热 TT，从轮次开始走到 d12
 * 只要约 0.1s（改造表 R21 实测），所以抬高最小深度省下的是很小一块；它的真正用途是
 * 「已经算过、只想继续加深」以及给用户一个明确的搜索下界。因此默认两端都是「自动」，
 * 行为与加入这个设置之前逐字一致。
 */
export const DEPTH_MIN_OPTIONS: readonly (readonly [string, string])[] = [
  ["0", "自动"],
  ["4", "≥4"],
  ["6", "≥6"],
  ["8", "≥8"],
  ["10", "≥10"],
  ["12", "≥12"],
  ["16", "≥16"],
  ["20", "≥20"],
  ["24", "≥24"],
];

export const DEPTH_MAX_OPTIONS: readonly (readonly [string, string])[] = [
  ["0", "自动"],
  ["16", "16"],
  ["24", "24"],
  ["32", "32"],
  ["48", "48"],
  ["64", "64"],
  ["96", "96"],
  ["128", "128"],
  ["256", "256"],
  ["512", "512"],
];

/** 面板/行内显示的紧凑标签：自动 → 自动，其余带层级前缀。 */
export const depthMinLabel = (value: number): string => {
  if (!Number.isFinite(value) || value <= 1) return "自动";
  return `≥${Math.round(value)}`;
};

export const depthMaxLabel = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "自动";
  return String(Math.round(value));
};

/** 当前生效的说明文案，直接写在设置行里，免得用户看不出「自动」到底是几层。 */
export const depthHint = (min: number, max: number, autoMax: number): string => {
  const lower = min > 1 ? `≥${Math.round(min)}` : "自动（从第 1 层）";
  const upper = max > 0 ? String(Math.round(max)) : `自动（本路径 ${autoMax}）`;
  return `最小 ${lower} · 最大 ${upper}。最小深度会跳过更浅的迭代，持续分析里收益很小（热 TT 下走到第 12 层只要约 0.1 秒）`;
};
