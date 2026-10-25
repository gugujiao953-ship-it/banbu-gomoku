import { other } from '../board.mjs';
import { checkBranchWindow } from './precheck.mjs';

export function weaveBranches({ board: b, candidate, size, attacker, rule, guard, diagnostics, branchWeave, nearDiagram, networkScore, preservesPlan }) {
  // 第 30 轮：中段岔路接线（branchWeave）。现状：temporal 因果剪枝保证「任何凑到 3 子的窗口都必须
  // 沿计划走」⇒ 题面中段根本没有可供玩家试走的第二冲四，唯一供给是干扰对该类「静态死四」（只在
  // 第 1 手出现，第 13 轮已判「同一颗死四的两端、一眼假」）。这里沿主解中段找窗口，补一颗接线子 T
  // （攻方）＋一颗配对子 S（守方，保行棋方），让窗口在第 j 手之后才凑成「3 子 2 孔」——岔路从
  // 第 j+1 手起出现，先要算两步（堵上后仍留有冲四可续）才知道走不通。每颗 T 落子前都用精确求解
  // 验四件事：主线仍成立（preservesPlan）、两个方向的冲四都是唯一堵点、堵上后攻方在剩余手数内
  // 赢不了（可证死）、至少一个方向仍留有冲四可续（follow≥1，不是一眼假）。验不过就换候选；
  // 最终每条岔路仍由 decoyAudit 逐手独立复核——这里只把候选造出来，不放松任何验收。
  if (branchWeave) {
    const defenderSide = other(attacker);
    const maxBranches = Math.max(1, Math.min(4, branchWeave.maxBranches ?? 2));
    const path = candidate.path, blocks = candidate.blocks, stageCount = path.length;
    const pathIndex = new Map(path.map((q, i) => [q, i]));
    const planMask = new Uint8Array(b.cells.length);
    for (let q = 0; q < planMask.length; q++) if (b.cells[q]) planMask[q] = 1;
    for (const q of path) planMask[q] = 1;
    for (const q of blocks) planMask[q] = 1;
    for (const q of candidate.reserved) planMask[q] = 1;
    // 过 T 的每个窗口逐条核对（含目标窗；按终局计数＝题面子＋全部计划子）：
    //   · ≥4 颗攻方子：某个回合会直接冒出"成五威胁"，audit 会判 secondLine ⇒ 否决这颗 T；
    //   · 含守方子/计划孔：窗口的时间线复杂，本段不逐帧复核 ⇒ 保守否决；
    //   · 恰 3 颗、2 个自由孔、出生 ≤ 倒数第 2 手：一条"3 子 2 孔"的岔路 ⇒ 出生回合逐条验死；
    //   · 出生晚于倒数第 2 手：手数天然用尽（audit 判 dead）⇒ 放过。
    const collateral = (t, targetId) => {
      const list = [];
      for (const id of b.incidence[t]) {
        if (id === targetId) continue;
        let stones = 0, holes = [], blocked = false, maxPi = -1;
        for (const q of b.windows[id]) {
          if (q === t || b.cells[q] === attacker) { stones++; continue; }
          if (b.cells[q] === defenderSide) { blocked = true; break; }
          const pi = pathIndex.get(q);
          if (pi !== undefined) { stones++; if (pi > maxPi) maxPi = pi; continue; }
          if (planMask[q]) { blocked = true; break; }
          holes.push(q);
        }
        if (blocked) { if (stones >= 3) return null; continue; }
        if (stones >= 4) return null;
        if (stones === 3 && holes.length === 2 && maxPi + 1 <= stageCount - 2) list.push({ birth: maxPi + 1, holes });
      }
      return list;
    };
    const stats = diagnostics.branchStats ??= { windows: 0, bad: 0, splits: 0, far: 0, hot: 0, noS: 0, verify: 0, nofive: 0, plan: 0, forcing: 0, alive: 0, weak: 0, placed: 0, bridged: 0 };
    let checks = 0, placed = 0;
    // 验一条"3 子 2 孔"岔路（T/S 已试落）：两个方向的冲四都要唯一堵点、堵上后赢不了；
    // 返回 {plausible}（至少一个方向堵上后仍留有冲四可续）或 null（不成立）。
    const verifyWindow = (j, h1, h2) => checkBranchWindow({
      board: b, candidate, attacker, rule, guard, j, h1, h2, stats,
      checkContinuation: branchWeave.checkContinuation,
    });
    // 候选窗按「真实出生回合」归组：窗内最晚的计划子（path 索引）+1。全部锚点都算候选，
    // 「中段三档」优先（出生太早与静态死四重叠，太晚不够两步反证）。
    const birthTargets = [0.3, 0.6, 0.85].map(f => Math.max(1, Math.min(stageCount - 3, Math.round(f * (stageCount - 1)))));
    const byBirth = new Map(), seenIds = new Set();
    for (let j = 1; j <= stageCount - 3; j++) {
      const anchor = path[j];
      if (anchor === undefined) continue;
      for (const id of b.incidence[anchor]) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        let last = -1;
        for (const q of b.windows[id]) { const pi = pathIndex.get(q); if (pi !== undefined && pi > last) last = pi; }
        if (last < 1 || last > stageCount - 3) continue;
        const list = byBirth.get(last) ?? [];
        list.push(id); byBirth.set(last, list);
      }
    }
    const birthOrder = [...byBirth.keys()].sort((a, z) =>
      (Math.min(...birthTargets.map(t => Math.abs(a - t))) - Math.min(...birthTargets.map(t => Math.abs(z - t)))) || a - z);
    stats.births = birthOrder.length;
    for (const j of birthOrder) {
      if (placed >= maxBranches || checks >= 6) break;
      const anchor = path[j];
      if (anchor === undefined) continue;
      let placedHere = false;
      for (const id of byBirth.get(j)) {
        if (placed >= maxBranches || checks >= 6 || placedHere) break;
        const pts = b.windows[id];
        let present = 0, bad = false;
        const empties = [];
        for (const q of pts) {
          const v = b.cells[q];
          if (v === attacker) { present++; continue; }
          if (v === defenderSide) { bad = true; break; }
          const pi = pathIndex.get(q);
          if (pi !== undefined) { if (pi <= j) { present++; continue; } bad = true; break; }
          if (planMask[q]) { bad = true; break; }
          empties.push(q);
        }
        if (bad) { stats.bad++; continue; }
        const need = 3 - present;
        if (need < 0 || need > 1 || empties.length !== need + 2) { stats.bad++; continue; }
        stats.windows++;
        const splits = need === 1 ? empties.map(t => [t, empties.filter(q => q !== t)]) : [[-1, empties]];
        for (const [t, holes] of splits) {
          if (placed >= maxBranches || checks >= 6 || placedHere) break;
          stats.splits++;
          let coll = [];
          let tBridge = false;
          if (t >= 0) {
            if (planMask[t] || b.cells[t] || !b.legal(t, attacker, rule, guard)) continue;
            // 第 33 轮：T 不贴盘不再一票否决——放宽为「T 与 S 八邻接且 S 贴盘」（T—S—题面的两级桥），
            // 仍无孤子；S 候选因此被限制在 T 的八邻域内，找不到才计 far。
            if (!nearDiagram(t)) tBridge = true;
            coll = collateral(t, id);
            if (coll === null || coll.length > 3) { stats.hot++; continue; }
          }
          const windowCells = new Set(pts);
          const sCands = [...b.cells.keys()].filter(q => !b.cells[q] && !planMask[q] && !windowCells.has(q) && nearDiagram(q)
              && (!tBridge || Math.max(Math.abs(Math.floor(q / size) - Math.floor(t / size)), Math.abs(q % size - t % size)) <= 1))
            .map(q => ({ q, rank: networkScore(q) })).sort((x, y) => y.rank - x.rank || x.q - y.q).slice(0, 3);
          if (!sCands.length) { if (tBridge) stats.far++; else stats.noS++; continue; }
          for (const { q: s } of sCands) {
            if (!b.legal(s, defenderSide, rule, guard)) continue;
            if (t >= 0) b.put(t, attacker);
            b.put(s, defenderSide);
            // 便宜检查不进 checks 预算（不花求解），只有真要走精确求解的复核才算一次。
            if (b.hasFive() || b.winningPoints(attacker, rule, guard).length || b.winningPoints(defenderSide, rule, guard).length) {
              stats.nofive++;
              b.undo(s); if (t >= 0) b.undo(t);
              continue;
            }
            if (!preservesPlan()) {
              stats.plan++;
              b.undo(s); if (t >= 0) b.undo(t);
              continue;
            }
            checks++;
            stats.verify++;
            let ok = true, plausible = false;
            const verdict = verifyWindow(j, holes[0], holes[1]);
            if (verdict) plausible = verdict.plausible; else ok = false;
            for (const w of coll) {
              if (!ok) break;
              if (!verifyWindow(w.birth - 1, w.holes[0], w.holes[1])) ok = false;
            }
            if (ok && plausible) {
              candidate.reserved.add(holes[0]); candidate.reserved.add(holes[1]);
              if (tBridge) stats.bridged++;   // 第 33 轮诊断：这条岔路靠「T-S 搭桥」成立
              if (tBridge && candidate.compact) candidate.compact.bridged = (candidate.compact.bridged || 0) + 1;
              if (candidate.compact) {
                candidate.compact.branches = (candidate.compact.branches || 0) + 1;
                (candidate.compact.branchBirths ??= []).push(j + 1);
                // 诊断/回归用：这条分支实际补了哪几颗子（T 可省）。
                (candidate.compact.branchCells ??= []).push(...(t >= 0 ? [t, s] : [s]));
                // 第 34 轮：逐条留档（撤桥抢救要按条重建 branches/branchBirths/branchCells）。
                (candidate.compact.branchLog ??= []).push({ t, s, holes: [holes[0], holes[1]], birth: j + 1, bridged: tBridge });
              }
              placed++; placedHere = true; stats.placed++;
              break;
            }
            b.undo(s);
            if (t >= 0) b.undo(t);
          }
        }
      }
    }
    if (candidate.compact) candidate.compact.branchChecks = checks;
  }

}
