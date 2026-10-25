import { other } from '../board.mjs';

// Fill the count deficit after a legal plan has been replayed. This stage only
// chooses legal setup stones and returns ranking helpers for later decoration;
// it never solves or certifies the VCF.
export function fillBalance({ board, candidate, size, attacker, rule, rng, guard, naturalStyle, preserveWhiteDefender = false, preservesPlan }) {
  const delta = board.cells.filter(cell => cell === 1).length
    - board.cells.filter(cell => cell === 2).length - (attacker === 1 ? 0 : 1);
  const player = delta >= 0 ? 2 : 1;
  const baseline = [null,
    new Set(board.forcingMoves(1, rule, guard).map(move => move.at)),
    new Set(board.forcingMoves(2, rule, guard).map(move => move.at)),
  ];
  let left = Math.abs(delta);
  const windows = candidate.network?.windows || [];
  const networkScore = q => {
    const row = Math.floor(q / size), col = q % size;
    let score = 0;
    for (const window of windows) {
      const points = window.points;
      const near = points.reduce((best, at) => Math.min(best,
        Math.max(Math.abs(row - Math.floor(at / size)), Math.abs(col - at % size))), size);
      if (near === 1) score += 3;
      else if (near === 2) score += 1;
      const dr = Math.floor(points[1] / size) - Math.floor(points[0] / size);
      const dc = points[1] % size - points[0] % size;
      const before = window.before, after = window.after;
      if (before >= 0 && Math.max(Math.abs(row - Math.floor(before / size)), Math.abs(col - before % size)) <= 1) score += 2;
      if (after >= 0 && Math.max(Math.abs(row - Math.floor(after / size)), Math.abs(col - after % size)) <= 1) score += 2;
      if (dr && dc && Math.abs(row - Math.floor(points[0] / size)) === Math.abs(col - points[0] % size)) score += 0.25;
    }
    return score;
  };
  const blendScore = q => {
    const row = Math.floor(q / size), col = q % size;
    let oppositeNear = 0;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      const at = board.index(row + dr, col + dc);
      if (at >= 0 && board.cells[at] === other(player)) oppositeNear++;
    }
    return networkScore(q) + oppositeNear * 2;
  };
  const nearDiagram = q => {
    const row = Math.floor(q / size), col = q % size;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      if (board.cells[r * size + c]) return true;
    }
    return false;
  };
  const free = [...board.cells.keys()]
    .filter(q => !board.cells[q] && !candidate.reserved.has(q))
    .map(q => ({ q, order: rng(), network: networkScore(q), blend: blendScore(q), attached: nearDiagram(q) ? 1 : 0 }));
  free.sort((a, z) => {
    const risk = q => board.incidence[q].reduce((n, id) => n
      + (board.counts[other(player)][id] === 0 ? board.counts[player][id] ** 2 : 0), 0);
    return (naturalStyle ? (z.attached - a.attached) || (z.blend - a.blend) : 0)
      || risk(a.q) - risk(z.q) || a.order - z.order;
  });
  for (const { q } of free) {
    if (!left) break;
    guard.check();
    if (naturalStyle && blendScore(q) <= 0 && left > 1) continue;
    if (!board.legal(q, player, rule, guard)) continue;
    const safe = board.withMove(q, player, () => !board.hasFive()
      && board.winningPoints(1, rule, guard).length === 0
      && board.winningPoints(2, rule, guard).length === 0
      && board.forcingMoves(attacker, rule, guard).every(move => baseline[attacker].has(move.at))
      // Standard synthesis preserves both sides' initial forcing moves. The
      // natural black router historically allowed new defensive forcing moves
      // because they were harmless to the black attacker's route. For white
      // attackers those new black threats frequently turn a balanced setup
      // into a shorter win, so keep the defender forcing set stable there too.
      // This is a stricter construction filter; final exact/independent gates
      // remain unchanged.
      && ((naturalStyle && (attacker !== 2 || !preserveWhiteDefender))
        || board.forcingMoves(other(attacker), rule, guard).every(move => baseline[other(attacker)].has(move.at)))
      && preservesPlan());
    if (safe) { board.put(q, player); left--; }
  }
  if (left) return { ok: false, reason: 'count-fill' };
  return { ok: true, baseline, networkScore, blendScore, nearDiagram, free };
}

export function addDecoyPairs({ board: b, candidate, attacker, rule, rng, guard, decoyPairs, pairVerify, baseline, nearDiagram, blendScore, preservesPlan }) {
  // 干扰手：计划与证明已经固定，成对补纹理子（攻守各一，保持手数合法），其中攻方那颗
  // 必须恰好造出一个只有单堵点的冲四——看着像另一条胜路，其实冲不死。新增候选若真能赢，
  // 唯一首手与最短解会在求解阶段整题拒收，所以这里只负责造岔路，不负责改证明。
  let pairSolve=null,pairChecks=0,pairTotal=0;
  for(let pair=0;pair<decoyPairs;pair++){
    const defenderColor=other(attacker);
    // 第 31 轮：干扰子落点的 rng 消耗与自由格数解耦——固定池＝全部格子，占用/保留格也照抽，
    // 排好序后再过滤（是否落子只影响过滤，不再影响抽取次数）。旧写法每调用一次 spots() 就按
    // 当下的自由格数消耗随机数，题面里多两颗接线子（第 30 轮）会把共享流的位置整体错开、把
    // 后续每次尝试的构造全部重排——两池 compactPass −0.10 的轨迹耦合根因。攻守两列表共用一次排序。
    const ranked=[...b.cells.keys()]
      .map(q=>({q,score:(nearDiagram(q)?40:0)+blendScore(q)+rng()})).sort((x,y)=>y.score-x.score);
    let placed=false;
    for(const {q:attack} of ranked){
      if(b.cells[attack]||candidate.reserved.has(attack))continue;
      if(pairVerify)pairChecks=0;
      if(!b.legal(attack,attacker,rule,guard))continue;
      const deadFour=b.withMove(attack,attacker,()=>{
        if(b.hasFive()||b.winningPoints(1,rule,guard).length||b.winningPoints(2,rule,guard).length)return false;
        const added=b.forcingMoves(attacker,rule,guard).filter(m=>!baseline[attacker].has(m.at));
        return added.length>0&&added.every(m=>!m.five&&m.wins.length===1)&&preservesPlan();
      });
      if(!deadFour)continue;
      b.put(attack,attacker);
      baseline[attacker]=new Set(b.forcingMoves(attacker,rule,guard).map(m=>m.at));
      for(const {q:reply} of ranked){
        if(b.cells[reply]||candidate.reserved.has(reply))continue;
        if(pairVerify&&!nearDiagram(reply))break;
        if(!b.legal(reply,defenderColor,rule,guard))continue;
        const calm=b.withMove(reply,defenderColor,()=>!b.hasFive()&&!b.winningPoints(1,rule,guard).length&&!b.winningPoints(2,rule,guard).length&&preservesPlan());
        if(!calm)continue;
        b.put(reply,defenderColor);
        // 干扰对的守方那颗会给防守方"占死资源"、让整题按更短深度赢（第 27 轮实测：D30 的 shortcut
        // 拒收全部由它引起——去掉它立刻恢复原深度赢）。有校验器时逐个应手用"精确求解仍按原深度赢"复核：
        // 只试贴着题面的应手格（防止被挤到远处加碎块），每颗攻方子 4 次、整题 12 次为限；
        // 复核通过时把解直接留给调用方复用，省一次全求解。
        if(pairVerify){
          if(pairChecks>=4||pairTotal>=12){ b.undo(reply); break; }
          pairChecks++; pairTotal++;
          const verdict=pairVerify(b);
          if(!verdict||verdict.kind!=='ok'){ b.undo(reply); continue; }
          pairSolve=verdict.result;
        }
        for(const p of [1,2])baseline[p]=new Set(b.forcingMoves(p,rule,guard).map(m=>m.at));
        // 第 38 轮：记录干扰对坐标，给生成端的「撤 decoy 对抢救」用（只记坐标，不改落子行为）。
        if(candidate.compact)(candidate.compact.decoyCells??=[]).push(attack,reply);
        placed=true;break;
      }
      if(placed)break;
      b.undo(attack);
    }
    if(!placed)break;
  }
  if(pairSolve&&candidate.compact)candidate.compact.pairSolve=pairSolve;
}
