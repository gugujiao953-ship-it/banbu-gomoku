// 棋子大小。棋子半径本来就只随「棋路 + 侧边」自动缩放（格距 gap 的 43%），
// 13 路以上的盘面因此总留着约 14% 的格距缝隙——有人反馈「能更大就好了」。
// 这里让用户在这个自动值上再缩放一档，但上限钉死在「相邻棋子相切」（gap/2）：
// 半径一旦超过它，邻子就会被压住，这是用户明确不接受的方向。所以量程取
// 85%–120%，高端在常见路数上正好顶到相切，滑块推到头也压不到邻子。
export const DEFAULT_STONE_SCALE = 1;
/** 最小档：比默认小 15%，再小就会明显显得「棋子缩水」而失去存在感。 */
export const MIN_STONE_SCALE = 0.85;
/** 最大档：0.43×1.2 = 0.516 倍格距，略高于相切线，由相切上限兜住。 */
export const MAX_STONE_SCALE = 1.2;
export const STONE_SCALE_STEP = 0.05;

/**
 * 自动半径（100% 档）。这就是改造前的公式，默认档必须逐像素不变，
 * 否则等于悄悄改掉所有人现有棋盘的观感。
 */
export const autoStoneRadius = (gap: number): number => Math.min(24, Math.max(10, gap * 0.43));

/** 相切上限：半径到 gap/2 时相邻棋子刚好接触，再大就会压住旁边的棋子。 */
export const tangentStoneRadius = (gap: number): number => gap * 0.5;

/** 存档里的值可能来自旧版本或被手改，用前一律收敛到合法量程。 */
export const clampStoneScale = (value: unknown): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_STONE_SCALE;
  const clamped = Math.min(MAX_STONE_SCALE, Math.max(MIN_STONE_SCALE, numeric));
  return Math.round(clamped * 100) / 100;
};

/** 实际半径：按用户档位缩放自动值，再被相切上限截断（这是「不会压住邻子」的保证）。 */
export const stoneRadiusFor = (gap: number, scale: number): number =>
  Math.min(tangentStoneRadius(gap), autoStoneRadius(gap) * clampStoneScale(scale));

/**
 * 落子热区半径。棋子变大后热区必须跟着长，否则点在大棋子的外缘会没反应；
 * 但热区同样不能越过相切线——越过之后相邻格子的热区会互相覆盖，点边线附近
 * 可能落到隔壁格。默认档返回的值与改造前完全一致。
 */
export const stoneHitRadiusFor = (gap: number, scale: number): number =>
  Math.max(14, Math.min(tangentStoneRadius(gap), stoneRadiusFor(gap, scale) * 1.14));

/** 滑杆与设置项右侧的读数：默认/最小/最大档带语义后缀，中间档给百分比。 */
export const stoneSizeLabel = (scale: number): string => {
  const normalized = clampStoneScale(scale);
  if (normalized >= MAX_STONE_SCALE) return `${Math.round(MAX_STONE_SCALE * 100)}%（最大）`;
  if (normalized <= MIN_STONE_SCALE) return `${Math.round(MIN_STONE_SCALE * 100)}%（最小）`;
  if (normalized === DEFAULT_STONE_SCALE) return "100%（默认）";
  return `${Math.round(normalized * 100)}%`;
};
