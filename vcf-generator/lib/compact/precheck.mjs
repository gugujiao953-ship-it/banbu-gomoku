import { Board, other } from '../board.mjs';

// Prechecks only decide whether a decoration is worth keeping. Complete
// exact solving and independent verification remain mandatory downstream.
export function checkBranchWindow({ board: b, candidate, attacker, rule, guard, j, h1, h2, stats, checkContinuation }) {
  const defenderSide = other(attacker);
  const size = b.size, path = candidate.path, blocks = candidate.blocks, stageCount = path.length;
  const play = new Board(size, b.cells);
  for (let k = 0; k <= j; k++) { play.put(path[k], attacker); play.put(blocks[k], defenderSide); }
  const left = stageCount - j - 1;
  const alts = play.forcingMoves(attacker, rule, guard);
  let seen = 0, plausible = 0;
  for (const [attackCell, blockCell] of [[h1, h2], [h2, h1]]) {
    const alt = alts.find(m => m.at === attackCell);
    if (!alt) continue;
    seen++;
    if (alt.five || alt.wins.length !== 1 || alt.wins[0] !== blockCell) { stats.forcing++; return null; }
    const verdict = play.withMove(attackCell, attacker, () => {
      if (play.winningPoints(defenderSide, rule, guard).length || left < 1) return { dead: true, follow: 0 };
      if (!play.legal(blockCell, defenderSide, rule, guard)) return { dead: false, follow: 0 };
      return play.withMove(blockCell, defenderSide, () => {
        const res = checkContinuation(play, left);
        return { dead: res.status === 'not-found', follow: play.forcingMoves(attacker, rule, guard).length };
      });
    });
    if (!verdict.dead) { stats.alive++; return null; }
    if (verdict.follow >= 1) plausible++;
  }
  if (!seen) { stats.weak++; return null; }
  return { plausible: plausible >= 1 };
}

export function repairBridges({ board: b, candidate, size, branchWeave }) {
  // 第 34 轮：带桥候选的整题复核 + 抢救。verifyWindow 只看接线当刻的窗口；decoy 对与后续接线子
  // 能把 T 参与的新窗口补成四、把目标手数带短（实测 D14 s102 第 4/13/19 次尝试：桥落子后
  // accept→shortcut，单去 T 即恢复目标深度；D8/D14/D30 三处洪水种子同型）。所以带桥的候选
  // 在这里补一次与主求解同口径的全求解：
  //   · 按目标深度赢 → 存成 pairSolve 给主求解复用（净零成本）；
  //   · 赢得更短 → 在副本上撤掉全部桥对（T/S 与预订孔）重解，成功就抢救回这道候选
  //     （非桥分支保留、元数据同步）；失败则维持原盘面并复用这次短解，走原路拒收。
  // 验收不放松：抢救后的题面仍走 solve/verify/唯一首手/最短解/decoyAudit 全部下游门。
  if (branchWeave?.checkFull && !candidate.compact?.pairSolve && (candidate.compact?.bridged ?? 0) > 0) {
    const target = branchWeave.depth;   // 目标手数（含最后成五；path 只到最后一个四，+1 才是五）
    const first = branchWeave.checkFull(b);
    if (first?.status === 'win' && first.depth === target) {
      candidate.compact.pairSolve = first;
    } else if (first?.status === 'win') {
      const log = candidate.compact.branchLog ?? [];
      const dropped = log.filter(entry => entry.bridged);
      const kept = log.filter(entry => !entry.bridged);
      if (dropped.length) {
        const lite = new Board(size, b.cells);
        const holes = [];
        for (const entry of dropped) {
          for (const q of (entry.t >= 0 ? [entry.t, entry.s] : [entry.s])) lite.undo(q);
          holes.push(...entry.holes);
        }
        const second = branchWeave.checkFull(lite);
        if (second?.status === 'win' && second.depth === target) {
          candidate.compact.branches = kept.length;
          candidate.compact.branchBirths = kept.map(entry => entry.birth);
          candidate.compact.branchCells = kept.flatMap(entry => (entry.t >= 0 ? [entry.t, entry.s] : [entry.s]));
          candidate.compact.branchLog = kept;
          candidate.compact.bridged = 0;
          candidate.compact.bridgeSalvaged = dropped.length;
          for (const q of holes) candidate.reserved.delete(q);
          candidate.compact.pairSolve = second;
          return lite;
        }
        candidate.compact.pairSolve = first;
      }
    }
  }
  return null;
}
