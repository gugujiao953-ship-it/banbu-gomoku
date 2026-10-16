// 连珠禁手判定（黑方）：经典「逐线图元分类 + 组合子」实现。
//
// 算法参照 MIT 授权的 realjustice/renju_forbid（Go，作者 realjustice），按本项目结构用
// TypeScript 重写：数据结构、命名、边界处理按本仓库风格；只移植**黑方**路径——那份里
// 白方（x0 == -1）的分支对"判黑方禁手"是死代码，这里不搬（将来需要再补）。
//
// 与 src/game.ts 原有实现的差别（也正是移植它的理由）：
//   1. 三三里的「三」要**递归**验完成点：A3r 拿到这条线上三的完成点后，会检查
//      「完成点自己是不是禁手」「在该点落子是否成五」——两者都不成立，这个三就不算数
//      （上游用 count-- 表达）。原实现只嵌一层，这类三三会漏判。
//   2. 四四**逐线计数**：同一条线可贡献两个四（B4 在 OOO_O 这类形状上返回 2），
//      原实现按"石头集合去重"会把它们并成一个。
//   3. 判定顺序：五连（不算禁手）→ 四四 → 三三 → 长连；长连排最后，故"既长连又四四"报四四。
//
// 入口：forbiddenAt(board, x, y)。board 为 15×15 的 0 / 1 / -1（1 黑、-1 白、0 空）。
// 语义：把 (x,y) 当成黑方落子点来判（空点会临时落上再撤回；已有子则按现状判）。

const S = 15;
/** 出盘哨兵：既非空点也非任一方，天然充当阻挡（上游用 1024）。 */
const BORDER = 1024;
const BLACK = 1;
const WHITE = -1;

export type RenjuFoulKind = "double-three" | "double-four" | "overline";

/** 线（长度 S）两端各补两个哨兵：线上第 i 格 → 数组下标 i+2（与上游 newLine 一致）。 */
const padLine = (cells: number[]): number[] => {
  const line = new Array<number>(S + 4).fill(BORDER);
  for (let i = 0; i < S; i += 1) line[i + 2] = cells[i] ?? BORDER;
  return line;
};

/** 取经过 (x,y) 的某条线（0 横 / 1 竖 / 2 ↘ / 3 ↗）与落点在**线内**的下标。 */
const lineThrough = (board: number[][], x: number, y: number, direction: number): { line: number[]; position: number } => {
  const cells: number[] = [];
  if (direction === 0) {
    for (let col = 0; col < S; col += 1) cells.push(board[x][col] ?? 0);
    return { line: padLine(cells), position: y };
  }
  if (direction === 1) {
    for (let row = 0; row < S; row += 1) cells.push(board[row][y] ?? 0);
    return { line: padLine(cells), position: x };
  }
  // 对角线：线内不足 S 格的位置补哨兵（↘ 的下标 = x+y、↗ 的下标 = S-1-y+x，位置同上游）
  const key = direction === 2 ? x + y : S - 1 - y + x;
  for (let j = 0; j < S; j += 1) {
    const row = direction === 2 ? key - j : key - j;
    const col = direction === 2 ? j : S - 1 - j;
    cells.push(row >= 0 && row < S && col >= 0 && col < S ? board[row][col] ?? 0 : BORDER);
  }
  return { line: padLine(cells), position: direction === 2 ? y : S - 1 - y };
};

/** 五个整数相加（内联给 V8 一点机会，语义与逐个相加一致）。 */
const sum5 = (line: number[], i: number) => line[i] + line[i + 1] + line[i + 2] + line[i + 3] + line[i + 4];

/** A5：这条线上 p 处是否成「恰好五连」（黑方）。 */
const lineA5 = (line: number[], rawP: number): number => {
  const p = rawP + 2;
  if (line[p] === 0) return 0;
  const lower = Math.max(2, p - 4);
  const upper = Math.min(S - 3, p);
  for (let i = lower; i <= upper; i += 1) {
    if (sum5(line, i) !== 5) continue;
    if (line[i - 1] !== BLACK && line[i + 5] !== BLACK) return 1;
  }
  return 0;
};

/** B4：这条线上 p 处贡献几个「四」（同一条线上限两个）。严格照上游黑方分支。 */
const lineB4 = (line: number[], rawP: number): number => {
  const x0 = BLACK;
  const p = rawP + 2;
  if (line[p] === 0) return 0;
  const lower = Math.max(2, p - 4);
  const upper = Math.min(S - 3, p);
  for (let i = lower; i <= upper; i += 1) {
    if (sum5(line, i) !== 4) continue;
    const shape = (line[i] << 4) + (line[i + 1] << 3) + (line[i + 2] << 2) + (line[i + 3] << 1) + line[i + 4];
    switch (shape) {
      case 0x1e: // OOOO_  两端不留黑子才算四
        if (line[i - 1] !== x0 && line[i + 5] !== x0) return 1;
        break;
      case 0x1d: // OOO_O
        if (line[i - 1] !== x0 && line[i + 5] !== x0) {
          if (line[i + 5] === 0 && i <= 8 && line[i + 6] === x0 && line[i + 7] === x0 && line[i + 8] === x0 && line[i + 9] !== x0 && p === i + 4) return 2;
          return 1;
        }
        break;
      case 0x1b: // OO_OO
        if (line[i - 1] !== x0 && line[i + 5] !== x0) {
          if (line[i + 5] === 0 && i <= 9 && line[i + 6] === x0 && line[i + 7] === x0 && line[i + 8] !== x0 && (p === i + 4 || p === i + 3)) return 2;
          return 1;
        }
        break;
      case 0x17: // O_OOO
        if (line[i - 1] !== x0 && line[i + 5] !== x0) {
          if (line[i + 5] === 0 && i <= 10 && line[i + 6] === x0 && line[i + 7] !== x0 && (p === i + 4 || p === i + 3 || p === i + 2)) return 2;
          return 1;
        }
        break;
      case 0xf: // _OOOO
        if (line[i - 1] !== x0 && line[i + 5] !== x0) return 1;
        break;
      default:
        break;
    }
  }
  return 0;
};

/** 组合子：把「等级」与「完成点」打包进一个整数；位置的减 2 是线内下标→棋盘坐标。 */
const COMB = (level: number, paddedIndex: number) => (level << 8) | (paddedIndex - 2);
const COMC = (level: number, first: number, second: number) => COMB(COMB(level, first), second);
const lowByte = (packed: number) => packed & 0xff;
const highByte = (packed: number) => (packed & 0xff00) >> 8;

/** A3：这条线上 p 处是否为「活三」（黑方口径）；返回值里带完成点（棋盘坐标）。 */
const lineA3 = (line: number[], rawP: number): number => {
  const x0 = BLACK;
  const p = rawP + 2;
  if (line[p] === 0) return 0;
  const lower = Math.max(2, p - 3);
  const upper = Math.min(S - 2, p);
  for (let i = lower; i <= upper; i += 1) {
    const sum = line[i] + line[i + 1] + line[i + 2] + line[i + 3];
    const product = line[i] * line[i + 1] * line[i + 2] * line[i + 3];
    if (sum !== 3 || product !== 0) continue;   // 三个黑子 + 恰好一个空点
    const shape = (line[i] << 3) + (line[i + 1] << 2) + (line[i + 2] << 1) + line[i + 3];
    switch (shape) {
      case 0xe: // XXX_
        if (line[i - 1] === 0 && line[i - 2] !== x0 && line[i + 4] !== x0) {
          if (line[i - 2] === 0 && line[i - 3] !== x0 && line[i + 4] === 0 && line[i + 5] !== x0) return COMC(1, i - 1, i + 3);
          if (line[i - 2] === 0 && line[i - 3] !== x0) return COMB(1, i - 1);
          if (line[i + 4] === 0 && line[i + 5] !== x0) return COMB(1, i + 3);
        }
        break;
      case 0xd: // XX_X
        if (line[i - 1] === 0 && line[i + 4] === 0 && line[i - 2] !== x0 && line[i + 5] !== x0) return COMB(1, i + 2);
        break;
      case 0xb: // X_XX
        if (line[i - 1] === 0 && line[i + 4] === 0 && line[i - 2] !== x0 && line[i + 5] !== x0) return COMB(1, i + 1);
        break;
      default:
        break;
    }
  }
  return 0;
};

/** A6：这条线上 p 处是否构成长连（六连及以上，只对黑）。 */
const lineA6 = (line: number[], rawP: number): number => {
  const p = rawP + 2;
  if (line[p] !== BLACK) return 0;
  const lower = Math.max(2, p - 5);
  const upper = Math.min(S - 4, p);
  for (let i = lower; i <= upper; i += 1) {
    if (sum5(line, i) + line[i + 5] === 6) return 1;
  }
  return 0;
};

/** 四个方向的逐线汇总：把 lineXxx 的结果按方向收集起来。 */
const perDirection = <T>(board: number[][], x: number, y: number, run: (line: number[], position: number) => T): T[] => {
  const out: T[] = [];
  for (let direction = 0; direction < 4; direction += 1) {
    const { line, position } = lineThrough(board, x, y, direction);
    out.push(run(line, position));
  }
  return out;
};

/** 落子后是否成五（临时落子再撤回）。 */
const makesFiveAt = (board: number[][], x: number, y: number): number => {
  const placed = board[x][y] === 0;
  if (placed) board[x][y] = BLACK;
  const result = perDirection(board, x, y, lineA5).some((value) => value !== 0) ? 1 : 0;
  if (placed) board[x][y] = 0;
  return result;
};

/** 四的计数：四个方向相加（同一条线可能是 2）。 */
const fourCountAt = (board: number[][], x: number, y: number): number =>
  perDirection(board, x, y, lineB4).reduce((sum, value) => sum + value, 0);

/** 三的计数：逐个方向取三，并**递归**验证完成点（完成点非法／不成五 → 这个三不算）。 */
const threeCountAt = (board: number[][], x: number, y: number): number => {
  let count = 0;
  for (let direction = 0; direction < 4; direction += 1) {
    const { line, position } = lineThrough(board, x, y, direction);
    const packed = lineA3(line, position);
    if (packed === 0) continue;
    // 完成点在棋盘上的坐标：按方向把"线内坐标"还原成 (row, col)（方法与上游一致）。
    const toBoard = (value: number): [number, number] => {
      if (direction === 0) return [x, value];
      if (direction === 1) return [value, y];
      if (direction === 2) return [x + y - value, value];
      return [S - 1 + x - y - value, S - 1 - value];
    };
    const inspect = (value: number) => {
      const [row, col] = toBoard(value);
      if (row < 0 || col < 0 || row >= S || col >= S) return false;   // 边界外的完成点不作数
      return foulAt(board, row, col) !== null || makesFiveAt(board, row, col) !== 0;
    };
    if (packed < 65536) {
      if (inspect(lowByte(packed))) count -= 1;   // 唯一的完成点非法 → 这个三白算
    } else if (inspect(lowByte(packed)) && inspect(highByte(packed))) {
      count -= 1;                                  // 两个完成点都不合法才算白算
    }
    count += 1;
  }
  return count;
};

/** 这里的黑子在四方向上是否有长连。 */
const overlineAt = (board: number[][], x: number, y: number): boolean =>
  perDirection(board, x, y, lineA6).some((value) => value !== 0);

/**
 * 判定：在 (x,y) 落黑子是否禁手，返回禁手种类。
 * 顺序与上游一致：五连（赢，不算禁手）→ 四四 → 三三 → 长连。
 * 降级为"空点临时落子、判完撤回"，因此可以安全地被三三的递归复用。
 */
const foulAt = (board: number[][], x: number, y: number): RenjuFoulKind | null => {
  if (board[x][y] === WHITE) return null;
  const placed = board[x][y] === 0;
  if (placed) board[x][y] = BLACK;
  let result: RenjuFoulKind | null = null;
  if (makesFiveAt(board, x, y) === 0) {
    if (fourCountAt(board, x, y) >= 2) result = "double-four";
    else if (threeCountAt(board, x, y) >= 2) result = "double-three";
    else if (overlineAt(board, x, y)) result = "overline";
  }
  if (placed) board[x][y] = 0;
  return result;
};

/** 判定报告：禁手种类 + 四/三的计数（给既有 RenjuMoveEvaluation 的字段复用）。 */
export const foulReport = (board: number[][], x: number, y: number): { kind: RenjuFoulKind | null; fours: number; threes: number } => {
  const working = board.map((row) => row.slice());
  if (working[x]?.[y] === WHITE) return { kind: null, fours: 0, threes: 0 };
  const placed = working[x][y] === 0;
  if (placed) working[x][y] = BLACK;
  const five = makesFiveAt(working, x, y) !== 0;
  const fours = fourCountAt(working, x, y);
  const threes = threeCountAt(working, x, y);
  const over = overlineAt(working, x, y);
  if (placed) working[x][y] = 0;
  // 五连优先（成五＝赢，不算禁手）；其余按 四四 → 三三 → 长连 的顺序取第一个成立的。
  const kind: RenjuFoulKind | null = five ? null : fours >= 2 ? "double-four" : threes >= 2 ? "double-three" : over ? "overline" : null;
  return { kind, fours, threes };
};

/** 对外入口：不改动传入的棋盘。 */
export const forbiddenAt = (board: number[][], x: number, y: number): RenjuFoulKind | null => {
  const working = board.map((row) => row.slice());
  return foulAt(working, x, y);
};

/** 便捷入口：从 0/1/-1 的 15×15 矩阵批量扫出全部禁手点。 */
export const forbiddenPointsOn = (board: number[][]): Array<{ row: number; col: number; kind: RenjuFoulKind }> => {
  const out: Array<{ row: number; col: number; kind: RenjuFoulKind }> = [];
  for (let row = 0; row < S; row += 1) for (let col = 0; col < S; col += 1) {
    if (board[row][col] !== 0) continue;
    const kind = forbiddenAt(board, row, col);
    if (kind) out.push({ row, col, kind });
  }
  return out;
};
