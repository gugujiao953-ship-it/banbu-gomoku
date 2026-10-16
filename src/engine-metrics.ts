/**
 * 引擎指标的紧凑显示。
 *
 * 用户 2026-09-15：节点速度这类数字要「过千就用 k 代替」——223456 写成 223k 才
 * 一眼能比出单线程/多线程的差距。
 * 用户 2026-09-15 追加：数字到 1000k 就进位成 M 并保留一位小数（原生引擎单轮
 * 节点数已经会跨过百万，四位数的 k 反而看不出量级）。
 */
export const formatEngineCount = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return "-";
  if (value < 1000) return String(Math.round(value));
  // 进位判据用「四舍五入后的低级单位」而不是原始值：999 999 会被舍成 1000k、
  // 999 999 999 会被舍成 1000M，必须和下一档一样走进位，否则同一量级两种写法。
  const thousands = Math.round(value / 1000);
  if (thousands < 1000) return `${thousands}k`;
  const millions = Math.round(value / 1_000_000);
  if (millions < 1000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
};
