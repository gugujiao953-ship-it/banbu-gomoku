import type { Position } from "../../types";

/**
 * 开局识别（用户 2026-10-09：人机对战时摆出标准开局，棋盘中心下方飘一下名字）。
 *
 * ## 只做这一件事
 *
 * 用户原话划定的范围：「开局探索器我们就只做这种开局识别的就行，人机对战的时候才会出现，
 * 就是 26 个开局这种的，当我们摆出这个开局后，会出现弹窗的字『xx』，比如花月，雨月这种的……
 * 其他的什么历史对局什么乱七八糟的就先不加了」。
 *
 * 所以这里**只有**「三手局面 → 26 开局名」这一个纯函数：没有开局树、没有实战走向统计、
 * 没有库内筛选、不读网络也不读数据库。历史对局统计那一层明确不做。
 *
 * ## 名字与几何的对应从哪来（不许凭记忆写）
 *
 * 26 个开局名对专业用户是硬事实，把花月写成浦月一眼就被看出来。下面的表**不是手写**的，
 * 是从项目自己随包的数据里挖出来、再用第二份项目内数据交叉核对过的：
 *
 *  1. **主源** `public/opening-book/sosyov-v1.json`（索索夫打点簿，由 `build-opening-book.mjs`
 *     从「妙手の淡淡整理」定式库导出，每个候选点带自己的标注）。它 len=2 的两个局面——
 *     `[[7,7],[8,7]]`（白2 直指）与 `[[7,7],[8,8]]`（白2 斜指）——候选点标签正是
 *     13 + 13 个开局名。坐标是 `[row, col]`，所以下表用 (dRow, dCol) 表示相对天元。
 *  2. **交叉源** `artifacts/opening-book-dingshi.sgf`（项目自备定式谱，GB2312）——
 *     它 `hhhg`（黑1 天元 hh、白2 hg）节点标着 `ig:花`，与主源同一几何、整体上下镜像。
 *     两份来源逐点吻合（见 `qa/opening-name-check.mjs` 的断言），这是本表可信的依据。
 *  3. **名字字形**以 `renju-reference.ts` 的 `zhName`（RIF 官方名）为准：打点簿写单字省称
 *     （「寒」「溪」「花」），斜指系的「彗星」在簿里写作「慧」。
 *
 * 直指系的下表顺序**恰好**等于 RIF 的 d1–d13（寒溪疏花残雨金松丘新瑞山游），
 * 核对脚本会断言这一点；斜指系的顺序是几何序而非 RIF 序，因此名字逐个显式写出。
 *
 * ## 判定规则（为什么这么定）
 *
 * - **黑1 必须落在棋盘中心**：RIF 的 26 开局由「黑1 天元」定义，整体平移过的同形不是那个开局。
 * - **白2 必须与黑1 相邻**：这不是额外条件，而是表的性质——白2 相对位置在 D4 下只会落到
 *   (1,0)（直指）或 (1,1)（斜指），其余位置匹配不上任何一格，自然返回 null。
 * - **黑3 必须落在表里的对应点**，否则返回 null（自由开局里白2 拉得很远就不叫开局）。
 * - **按八向对称归一**：同一开局的旋转/镜像同形识别成同一个名字。
 * - 只认**前三手**；后面手数再多也与开局名无关。
 */

type OpeningPoint = { dRow: number; dCol: number; name: string; code: string };

/**
 * 直指系：白2 在黑1 正下（相对 (1,0)）时，黑3 的落点决定名字。
 * 顺序 = RIF d1–d13（核对脚本会断言这一点）。
 */
const DIRECT_OPENINGS: OpeningPoint[] = [
  { dRow: 2, dCol: 0, name: "寒星", code: "d1" },
  { dRow: 2, dCol: 1, name: "溪月", code: "d2" },
  { dRow: 2, dCol: 2, name: "疏星", code: "d3" },
  { dRow: 1, dCol: 1, name: "花月", code: "d4" },
  { dRow: 1, dCol: 2, name: "残月", code: "d5" },
  { dRow: 0, dCol: 1, name: "雨月", code: "d6" },
  { dRow: 0, dCol: 2, name: "金星", code: "d7" },
  { dRow: -1, dCol: 0, name: "松月", code: "d8" },
  { dRow: -1, dCol: 1, name: "丘月", code: "d9" },
  { dRow: -1, dCol: 2, name: "新月", code: "d10" },
  { dRow: -2, dCol: 0, name: "瑞星", code: "d11" },
  { dRow: -2, dCol: 1, name: "山月", code: "d12" },
  { dRow: -2, dCol: 2, name: "游星", code: "d13" },
];

/** 斜指系：白2 在黑1 右下（相对 (1,1)）时，黑3 的落点决定名字。 */
const INDIRECT_OPENINGS: OpeningPoint[] = [
  { dRow: 2, dCol: 2, name: "长星", code: "i1" },
  { dRow: 1, dCol: 2, name: "峡月", code: "i2" },
  { dRow: 0, dCol: 1, name: "云月", code: "i6" },
  { dRow: 0, dCol: 2, name: "恒星", code: "i3" },
  { dRow: -1, dCol: -1, name: "斜月", code: "i11" },
  { dRow: -1, dCol: 0, name: "银月", code: "i9" },
  { dRow: -1, dCol: 1, name: "浦月", code: "i7" },
  { dRow: -1, dCol: 2, name: "水月", code: "i4" },
  { dRow: -2, dCol: -2, name: "彗星", code: "i13" }, // 打点簿写作「慧」（单字省称）
  { dRow: -2, dCol: -1, name: "名月", code: "i12" },
  { dRow: -2, dCol: 0, name: "明星", code: "i10" },
  { dRow: -2, dCol: 1, name: "岚月", code: "i8" },
  { dRow: -2, dCol: 2, name: "流星", code: "i5" },
];

export type OpeningFamily = "direct" | "indirect";

export interface OpeningIdentity {
  /** RIF 中文名，如「花月」。 */
  name: string;
  /** RIF 编号（d1–d13 直指 / i1–i13 斜指），界面上那行小字用。 */
  code: string;
  /** 直指（白2 与黑1 正交相邻）/ 斜指（对角相邻）。 */
  family: OpeningFamily;
  /** 归一化后的相对位置，供测试与调试。 */
  relative: { white2: { dRow: number; dCol: number }; black3: { dRow: number; dCol: number } };
}

/** 八向对称：4 个旋转 × 2 个镜像。棋盘八向对称，故同形的旋转/镜像认成同一个开局。 */
const D4: Array<(point: { dRow: number; dCol: number }) => { dRow: number; dCol: number }> = [
  ({ dRow, dCol }) => ({ dRow, dCol }),
  ({ dRow, dCol }) => ({ dRow, dCol: -dCol }),
  ({ dRow, dCol }) => ({ dRow: -dRow, dCol }),
  ({ dRow, dCol }) => ({ dRow: -dRow, dCol: -dCol }),
  ({ dRow, dCol }) => ({ dRow: dCol, dCol: dRow }),
  ({ dRow, dCol }) => ({ dRow: dCol, dCol: -dRow }),
  ({ dRow, dCol }) => ({ dRow: -dCol, dCol: dRow }),
  ({ dRow, dCol }) => ({ dRow: -dCol, dCol: -dRow }),
];

const lookup = (table: OpeningPoint[], point: { dRow: number; dCol: number }) =>
  table.find((entry) => entry.dRow === point.dRow && entry.dCol === point.dCol) ?? null;

/**
 * 由前三手棋子位置识别开局名；无法归属 26 开局时返回 null（不猜、不硬套）。
 *
 * @param first     黑 1（必须落在棋盘中心，否则返回 null）
 * @param second    白 2
 * @param third     黑 3
 * @param boardSize 棋盘路数。标准 26 开局定义在 15 路；其它**奇数**路数按各自中心处理
 *                  （形状相同即算），偶数路数没有中心点，返回 null。
 */
export const identifyOpening = (
  first: Position,
  second: Position,
  third: Position,
  boardSize = 15,
): OpeningIdentity | null => {
  if (!Number.isInteger(boardSize) || boardSize <= 0 || boardSize % 2 === 0) return null;
  const center = (boardSize - 1) / 2;
  // 黑 1 不在中心 ⇒ 平移过的同形，不是 RIF 的那个开局。
  if (first.row !== center || first.col !== center) return null;

  const rawWhite2 = { dRow: second.row - center, dCol: second.col - center };
  const rawBlack3 = { dRow: third.row - center, dCol: third.col - center };

  let hit: OpeningIdentity | null = null;
  for (const transform of D4) {
    const white2 = transform(rawWhite2);
    const black3 = transform(rawBlack3);
    // 白 2 落在正交邻位 = 直指；落在对角邻位 = 斜指。其余位置不是 26 开局。
    const family: OpeningFamily | null =
      white2.dRow === 1 && white2.dCol === 0 ? "direct"
        : white2.dRow === 1 && white2.dCol === 1 ? "indirect"
          : null;
    if (!family) continue;
    const point = family === "direct" ? lookup(DIRECT_OPENINGS, black3) : lookup(INDIRECT_OPENINGS, black3);
    if (!point) continue;
    // 同一局面在 D4 下可能有多条路径命中，它们必须给出同一个名字（D4 是群、名字是它的不变量）。
    if (hit && hit.name !== point.name) return null; // 理论不可达；真出现说明表有错，宁可不出名字
    hit = { name: point.name, code: point.code, family, relative: { white2, black3 } };
  }
  return hit;
};

/** 供核对脚本与单测读取的表（不是运行时 API）。 */
export const OPENING_TABLE_FOR_AUDIT = {
  direct: DIRECT_OPENINGS.map((entry) => ({ ...entry })),
  indirect: INDIRECT_OPENINGS.map((entry) => ({ ...entry })),
  d4Size: D4.length,
};

/**
 * 从「对局的前几手」识别开局名——**带颜色校验的对外入口**。
 *
 * 26 开局的定义里带着颜色（黑1 天元、白2 相邻、黑3 决定名字），所以颜色是定义的一部分，
 * 不该留给调用方自己记得检查。开局规则（交换、五手两打等）会让前几手的颜色顺序变化，
 * 那种局面**不是**标准 26 开局，这里一律返回 null。
 *
 * @param moves 按落子顺序的半回合列表。`position` 为 null 表示过手（过手会让颜色错位，
 *              所以一旦前三手里出现过手就不命名）。
 */
export const identifyOpeningFromMoves = (
  moves: ReadonlyArray<{ position: Position | null; player: "black" | "white" }>,
  boardSize = 15,
): OpeningIdentity | null => {
  const first3 = moves.slice(0, 3);
  if (first3.length < 3) return null;
  const [a, b, c] = first3;
  if (!a.position || !b.position || !c.position) return null;
  if (a.player !== "black" || b.player !== "white" || c.player !== "black") return null;
  return identifyOpening(a.position, b.position, c.position, boardSize);
};
