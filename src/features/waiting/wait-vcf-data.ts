/**
 * 等待动效「VCF 演算」的数据 —— **由 qa/gen-wait-vcf.test.ts 生成，别手改**。
 * 手摆棋形试过了：摆出来的局面中间会直接出现五连、五连后还在落子，用户点过名；
 * 而"盘面上不出现五连"正是用户的要求（三子正常、四子＝冲四、五连才是胜利）。
 * 这里的数据＝「随机紧凑局面 → 项目 solveVcf 搜线 → verifyVcfLine 复核通过 → 双方全程连子 ≤ 4」。
 * 重新生成：npx vitest run qa/gen-wait-vcf.test.ts
 */
export const WAIT_GIVENS: ReadonlyArray<readonly [number, number, 0 | 1]> = [[1,6,0],[4,5,0],[2,6,0],[5,6,0],[6,7,0],[4,3,0],[1,1,1],[7,6,1],[7,1,1],[3,3,1]];
/** 解的手顺：[列, 行, 0=黑 1=白]，按顺序演出，全程不超过四子 */
export const WAIT_LINE: ReadonlyArray<readonly [number, number, 0 | 1]> = [[2,3,0],[3,4,1],[4,6,0],[3,6,1],[4,4,0]];
/** 取景窗口：[起始列, 起始行, 显示格数]。**不等边距**（左/上 1 格、右/下 2 格）——构图不许对称。 */
export const WAIT_CROP: readonly [number, number, number] = [0, 0, 9];
/** 落在取景窗口里的星位（真实棋盘坐标） */
export const WAIT_STARS: ReadonlyArray<readonly [number, number]> = [[3,3],[3,7],[7,3],[7,7]];
