import type { SolutionMove } from './model';

export interface ReplayStep { move: SolutionMove; passBefore: boolean }

/**
 * 答案回放的「一步」= 一颗看得见的落子。解线里的停着（at:null，抓禁手时黑棋那一口
 * 是禁手不能堵）不占一步：以前游标按条目走，跨过停着时棋盘一颗子都不动，看起来就是
 * 「退一步没反应、只把上一步盖掉」。停着仍然记在它后面那一步的说明里。
 */
export function replaySteps(solution: SolutionMove[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let passBefore = false;
  for (const move of solution || []) {
    if (move.at === null) { passBefore = true; continue; }
    steps.push({ move, passBefore });
    passBefore = false;
  }
  if (passBefore && steps.length) steps[steps.length - 1].passBefore = true;
  return steps;
}

/** 显示前 N 个可见落子时，解线该取到第几个条目（中间的停着一起带上，它们不画子）。 */
export function replayPrefix(solution: SolutionMove[], steps: number): number {
  if (!solution || solution.length === 0 || steps < 1) return 0;
  let seen = 0;
  for (let index = 0; index < solution.length; index++) {
    if (solution[index].at === null) continue;
    seen += 1;
    if (seen >= steps) return index + 1;
  }
  return solution.length;
}
