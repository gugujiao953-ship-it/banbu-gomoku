import { Board, other } from '../board.mjs';

export function addCounterThreat({ board: b, candidate, size, attacker, rule, guard, diagnostics, counterThreat, nearDiagram, blendScore, preservesPlan }) {
  // 第 40 轮：末段牵制（counterThreat）。R39 取证：守方成四的唯一安全位置是「攻方最后一手双四
  // 的那一堵 Q」——Q 之后攻方立即成五、守方再无回合（人类素材 397/397、我们 4/4 全在这一残手；
  // 早段的守方四会迫使攻方分心甚至反输，已被第 39 轮 L1/L2 实测排除）。这里仿 branchWeave 在
  // balance 期补一对纹理子：守方 S 使 Q 落子后守方带四（S 自身不造四、成四只允许出现在 Q 之后，
  // 判据与 qa/score.mjs 的 counterRate＝「堵手本身成四」一致），攻方 T 只用于保持手数配平（攻守
  // 各一颗，真实对局到得了的奇偶）。落子前用与主求解同口径的精确求解（prior＝主解、
  // enumerateFirst＝uniqueFirst）验「仍按目标深度赢」；再用与下游同函数同口径的岔路复核
  // （decoyAudit＋可骗下限；≤30 手才查下限）预筛，不过就撤子、题面回到加牵制之前。
  // temporal 剪枝与 preservesPlan 的判据一字未动（balance 期落子不进构造期扫描），最终产出仍走
  // solve/verify/唯一首手/最短解/decoyAudit 全部下游门——这里只造候选，不放松任何验收。
  if (counterThreat) {
    const ct = diagnostics.counterStats ??= { target: 0, cands: 0, tries: 0, tNone: 0, noWin: 0, short: 0, nonunique: 0, shallow: 0, audit: 0, placed: 0 };
    // 底本已经是重复盘时整段跳过：加了牵制子会改 canonicalKey、逃过下游 duplicate 门（见 generate-core isSeen）。
    const seenBase = !!(counterThreat.isSeen && counterThreat.isSeen(b));
    if (seenBase) ct.seenSkip = (ct.seenSkip || 0) + 1;
    const pathArr = candidate.path, blockArr = candidate.blocks, defenderColor = other(attacker);
    const planCells = new Set(pathArr);
    for (const q of blockArr) planCells.add(q);
    // 重放到「攻方最后一手四已落、守方堵手未落」的局面（全部在副本上）。主解若重放不过就整段跳过。
    const replayTerminal = () => {
      const play = new Board(size, b.cells);
      for (let k = 0; k < pathArr.length; k++) {
        if (!play.legal(pathArr[k], attacker, rule, guard)) return null;
        play.put(pathArr[k], attacker);
        if (k < pathArr.length - 1) {
          if (k >= blockArr.length || !play.legal(blockArr[k], defenderColor, rule, guard)) return null;
          play.put(blockArr[k], defenderColor);
        }
      }
      return play;
    };
    const probe = replayTerminal();
    if (probe) {
      const wins = probe.winningPoints(attacker, rule, guard);
      const q = wins.length === 2 ? wins.find(at => probe.legal(at, defenderColor, rule, guard)) : undefined;
      // Q 之后必须恰好剩 1 个成五点：末手成五即终局，decoyAudit 也不允许末手多出第二颗成五手。
      const postQ = q === undefined ? -1 : probe.withMove(q, defenderColor, () => probe.winningPoints(attacker, rule, guard).length);
      // 该题本来就带「Q 成四」的纹理时不再加牵制：S 不参与那条四、加子只会平白多两颗石头。
      const innate = q !== undefined && postQ === 1 && probe.withMove(q, defenderColor, () => probe.fourGroups(q, defenderColor, rule).length > 0);
      if (innate) ct.innate = (ct.innate || 0) + 1;
      if (q !== undefined && postQ === 1 && !innate && !seenBase) {
        ct.target++;
        // 「只给本来就会过关的题加牵制」：先把底本（不含 S/T）按下游同口径过一遍电池——求解按目标
        // 深度赢＋唯一首手＋根门＋decoyAudit/可骗下限。底本摆不平的题如果加上 S/T 恰好多过一道门，
        // 就等于"用牵制救活一道本该被拒的题"，整批的接受集会因此重摇（第 40 轮实测：池 A 接受集
        // 整体换血、compactPassRate 0.311→0.222）。底本过不了 → 整段跳过，这道题照旧走原门；
        // 底本求解无论过不过都留给主求解复用（同盘、同口径；budget 除外，把时间让给官方那次）。
        // 底本求解优先复用已存在的整题解（桥/干扰对复核留下的 pairSolve 与主求解同盘同口径），
        // 没有再自己跑一次；底本审计只在"确实有 S 可加"时才跑（它只影响「要不要加」的决策，
        // 实测 D14 s102：13 个候选里 0 个 S 却花了 3.0s 审计——纯白干）。
        const reusedSolve = candidate.compact.pairSolve && candidate.compact.pairSolve.status !== 'budget' ? candidate.compact.pairSolve : null;
        const baseVerdict = reusedSolve || counterThreat.checkFull(b);
        if (!reusedSolve) ct.baseSolveMs = (ct.baseSolveMs || 0) + (baseVerdict?.elapsedMs || 0);
        if (!candidate.compact.pairSolve && baseVerdict && baseVerdict.status !== 'budget') candidate.compact.pairSolve = baseVerdict;
        const baseRough = !!(baseVerdict && baseVerdict.status === 'win' && baseVerdict.depth === counterThreat.depth &&
          !(counterThreat.uniqueFirst && baseVerdict.winningFirst?.length !== 1) &&
          b.forcingMoves(attacker, rule, guard).length >= 2);
        if (!baseRough) ct.baseGate = (ct.baseGate || 0) + 1;
        if (baseRough) {
        ct.basePass = (ct.basePass || 0) + 1;
        // 连通块口径（= qa/score.mjs）：S/T 只许贴进已有块或搭桥，不许把题面拆出新块
        // （实测 D20 s33 一道牵制把 3 块顶到 4 块、批内自然度 −0.05）。优先挑「加子后块数不变」的
        // 落点排最前，最终仍以硬检查兜底；加子总数固定两颗，块数不增＝题面不会被拆碎。
        const componentsOf = () => {
          const seen = new Uint8Array(b.cells.length);
          let n = 0;
          for (let start = 0; start < b.cells.length; start++) {
            if (!b.cells[start] || seen[start]) continue;
            n++;
            const stack = [start];
            seen[start] = 1;
            while (stack.length) {
              const cur = stack.pop(), r = Math.floor(cur / size), c = cur % size;
              for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                const rr = r + dr, cc = c + dc;
                if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
                const nq = rr * size + cc;
                if (b.cells[nq] && !seen[nq]) { seen[nq] = 1; stack.push(nq); }
              }
            }
          }
          return n;
        };
        const partsBefore = componentsOf();
        // 外接矩形（span 口径）——S/T 落在框外会顶大 spanMax（实测 D8 两道 10→11 丢掉紧凑过线）。
        let bbR0 = size, bbR1 = -1, bbC0 = size, bbC1 = -1;
        for (let at = 0; at < b.cells.length; at++) {
          if (!b.cells[at]) continue;
          const r = Math.floor(at / size), c = at % size;
          if (r < bbR0) bbR0 = r;
          if (r > bbR1) bbR1 = r;
          if (c < bbC0) bbC0 = c;
          if (c > bbC1) bbC1 = c;
        }
        const insideBox = at => {
          const r = Math.floor(at / size), c = at % size;
          return bbR1 < 0 || (r >= bbR0 && r <= bbR1 && c >= bbC0 && c <= bbC1) ? 1 : 0;
        };
        const spanOf = () => {
          let r0 = size, r1 = -1, c0 = size, c1 = -1;
          for (let at = 0; at < b.cells.length; at++) {
            if (!b.cells[at]) continue;
            const r = Math.floor(at / size), c = at % size;
            if (r < r0) r0 = r;
            if (r > r1) r1 = r;
            if (c < c0) c0 = c;
            if (c > c1) c1 = c;
          }
          return r1 < 0 ? 0 : Math.max(r1 - r0 + 1, c1 - c0 + 1);
        };
        const spanBefore = spanOf();
        const nearQ = at => Math.max(Math.abs(Math.floor(at / size) - Math.floor(q / size)), Math.abs(at % size - q % size));
        const sCands = [];
        for (let at = 0; at < b.cells.length; at++) {
          guard.check();
          if (b.cells[at] || candidate.reserved.has(at) || planCells.has(at) || at === q) continue;
          // S 自身不造四（Q 之前的守方四由 preservesPlan 逐手再查一遍）；S＋Q 让守方成四。
          const ok = probe.withMove(at, defenderColor, () => {
            if (probe.winningPoints(defenderColor, rule, guard).length) return false;
            return probe.withMove(q, defenderColor, () => !probe.hasFive() && probe.fourGroups(q, defenderColor, rule).length > 0);
          });
          if (ok) sCands.push({ at, ats: [at], keep: b.withMove(at, defenderColor, () => componentsOf()) <= partsBefore ? 1 : 0, box: insideBox(at), attach: nearDiagram(at) ? 1 : 0, near: nearQ(at) });
        }
        // R42 两子牵制回退：单子形态（窗口里 2 守方子＋2 空）在 Q 邻域几乎是零供给（10 job 实测 2/31），
        // 但「1 守方子＋3 空」窗口大量存在（44 个）——两颗守方子 S1/S2 补进窗口、留一格作成五点，
        // 四仍只在 Q 之后出现（每个落点都查「不造四」）；另外配两颗攻方 T 保行棋方奇偶。
        if (!sCands.length) {
        let pad = 0;
        for (const id of probe.incidence[q]) {
          let d = 0, a = 0;
          const slots = [];
          for (const cell of probe.windows[id]) {
            const v = probe.cells[cell];
            if (v === defenderColor) d++;
            else if (v === attacker) a++;
            else if (cell !== q && !candidate.reserved.has(cell) && !planCells.has(cell)) slots.push(cell);
          }
          if (a || d !== 1 || slots.length < 3) continue;
          for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
            const s1 = slots[i], s2 = slots[j];
            const ok = probe.withMove(s1, defenderColor, () => {
              if (probe.winningPoints(defenderColor, rule, guard).length) return false;
              return probe.withMove(s2, defenderColor, () => {
                if (probe.winningPoints(defenderColor, rule, guard).length) return false;
                return probe.withMove(q, defenderColor, () => !probe.hasFive() && probe.fourGroups(q, defenderColor, rule).length > 0);
              });
            });
            if (!ok) continue;
            const keep = b.withMove(s1, defenderColor, () => b.withMove(s2, defenderColor, () => componentsOf())) <= partsBefore ? 1 : 0;
            sCands.push({ at: s1, ats: [s1, s2], pair: 1, keep, box: insideBox(s1) & insideBox(s2), attach: nearDiagram(s1) && nearDiagram(s2) ? 1 : 0, near: Math.min(nearQ(s1), nearQ(s2)) });
            pad++;
          }
        }
        if (pad) ct.padCands = (ct.padCands || 0) + pad;
        }
        sCands.sort((x, y) => (y.keep - x.keep) || (y.box - x.box) || (y.attach - x.attach) || (x.near - y.near) || (x.at - y.at));
        ct.cands += sCands.length;
        // 没有 S 可加＝直接收工（底本审计也省掉；见上）。
        if (!sCands.length) {
          ct.noCands = (ct.noCands || 0) + 1;
          // R42 临时插桩：Q 邻域窗口按「守方子数 d / 空格数 eX（不含 q）」归类，判断两子牵制能不能解锁。
          for (const id of probe.incidence[q]) {
            let d = 0, a = 0, eX = 0, slots = 0;
            for (const cell of probe.windows[id]) {
              const v = probe.cells[cell];
              if (v === defenderColor) d++;
              else if (v === attacker) a++;
              else if (cell !== q) {
                eX++;
                if (!candidate.reserved.has(cell) && !planCells.has(cell)) slots++;
              }
            }
            if (a) continue;
            if (d >= 2 && eX >= 2) { ct.wD2 = (ct.wD2 || 0) + 1; if (slots) ct.wD2slots = (ct.wD2slots || 0) + 1; }
            else if (d === 1 && eX >= 3) { ct.wD1 = (ct.wD1 || 0) + 1; if (slots >= 2) ct.wD1slots = (ct.wD1slots || 0) + 1; }
          }
        }
        else {
        const auditStart = performance.now();
        // 预筛口径 150ms（D14 s102 型种子实测：500ms 档两次审计 3.0s+3.1s；150ms 档约 1s。
        // 重种子上代价与产出都不划算，收窄口径把成本封顶；正常种子审计是毫秒级、不受影响）。
        const av = counterThreat.audit(b, baseVerdict.proof, 150);
        ct.baseAuditMs = (ct.baseAuditMs || 0) + (performance.now() - auditStart);
        const baseAuditPass = !av.secondLine && !av.unproven && !(counterThreat.depth <= 30 && av.plausible < av.turns - 1);
        if (!baseAuditPass) ct.baseAuditGate = (ct.baseAuditGate || 0) + 1;
        if (baseAuditPass) {
        // 去重口径：接受进 seen 的是"装饰后的盘"的哈希，底盘 key 并不在 seen 里——同一底盘的
        // 对称双胞胎之后查 isSeen 会漏网、被装饰成另一个新盘、逃过 duplicate（实测 D12 s22 第 9 次
        // 尝试＝第 7 次底盘的翻版，OFF 拒 dup、ON 收下）。所以落子前先记下底盘 key，
        // 接受时由 generate-core 一并入 seen（见调用方 isSeen/keyOf 注释）。
        const baseKey = counterThreat.keyOf ? counterThreat.keyOf(b) : null;
        // 上限按「每个候选题」计（不是整批）：整批只试 2 个 S 等于大部分题拿不到牵制。
        const maxTries = Math.max(1, Math.min(32, counterThreat.maxTries ?? 2));
        // 结构关卡统一成一个闭包：块数硬门（S/T 落定后不许增加）＋主解重放＋终局恰好剩 1 个成五点
        // ＋Q 成四。单子/两子两种形态共用。
        const structureOk = () => {
          // 同一道硬门管两件事：加子后连通块不许增加、外接矩形（spanMax 口径）不许长大——
          // 实测 D12 s22 一道两子牵制把 span 10→11、丢紧凑过线（compactPassRate 0.2→0.16 的唯一来源）。
          const term = componentsOf() <= partsBefore && spanOf() <= spanBefore ? replayTerminal() : null;
          if (!(term && preservesPlan())) return false;
          const wins2 = term.winningPoints(attacker, rule, guard);
          if (!(wins2.length === 2 && wins2.find(x => term.legal(x, defenderColor, rule, guard)) === q)) return false;
          const res = term.withMove(q, defenderColor, () => ({
            four: term.fourGroups(q, defenderColor, rule).length > 0,
            left: term.winningPoints(attacker, rule, guard).length,
          }));
          return res.four && res.left === 1;
        };
        const undoTs = chosenT => { for (let i = chosenT.length - 1; i >= 0; i--) b.undo(chosenT[i]); };
        let tried = 0;
        for (const cand of sCands) {
          if (tried >= maxTries) break;
          tried++; ct.tries++;
          const sAts = cand.ats;
          for (const s of sAts) b.put(s, defenderColor);
          const forceBase = new Set(b.forcingMoves(attacker, rule, guard).map(m => m.at));
          // T 太靠近攻方成片窗口时会催生「比目标更短」的赢法（实测 short 是大头），
          // 所以排序＝贴题面优先、其次 T 参与的「近成四窗口」（≥3 攻方子）最少，最后才看连通分。
          const tCands = [...b.cells.keys()]
            .filter(t => !b.cells[t] && !candidate.reserved.has(t) && !planCells.has(t) && t !== q)
            .map(t => ({ at: t, keep: b.withMove(t, attacker, () => componentsOf()) <= partsBefore ? 1 : 0, box: insideBox(t), attach: nearDiagram(t) ? 1 : 0, risk: b.incidence[t].filter(w => b.counts[attacker][w] + 1 >= 3).length, blend: blendScore(t) }))
            .sort((x, y) => (y.keep - x.keep) || (y.box - x.box) || (y.attach - x.attach) || (x.risk - y.risk) || (x.blend - y.blend) || (x.at - y.at))
            .slice(0, 4);
          // 配平 T：单子形态保持原行为（每个 T 单独过结构关卡、不过就换下一个 T）；两子形态取前两颗
          // calm 的 T 一起落定后过一次结构关卡（T 只是配平，不值得为组合枚举多花求解）。
          const chosenT = [];
          if (sAts.length === 1) {
            for (const cand of tCands) {
              const at = cand.at;
              if (!b.legal(at, attacker, rule, guard)) continue;
              // T 是配平用的攻方补子：落子后不许新增任何攻方冲四、不造任何成五点（与 count-fill 同判据）。
              const calm = b.withMove(at, attacker, () =>
                !b.hasFive() && !b.winningPoints(1, rule, guard).length && !b.winningPoints(2, rule, guard).length &&
                b.forcingMoves(attacker, rule, guard).every(m => forceBase.has(m.at)));
              if (!calm) continue;
              b.put(at, attacker);
              if (structureOk()) { chosenT.push(at); break; }
              b.undo(at);
            }
          } else {
            for (const cand of tCands) {
              if (chosenT.length >= sAts.length) break;
              const at = cand.at;
              if (!b.legal(at, attacker, rule, guard)) continue;
              const calm = b.withMove(at, attacker, () =>
                !b.hasFive() && !b.winningPoints(1, rule, guard).length && !b.winningPoints(2, rule, guard).length &&
                b.forcingMoves(attacker, rule, guard).every(m => forceBase.has(m.at)));
              if (!calm) continue;
              b.put(at, attacker);
              chosenT.push(at);
            }
            if (chosenT.length === sAts.length && !structureOk()) undoTs(chosenT), chosenT.length = 0;
          }
          if (chosenT.length < sAts.length) {
            ct.tNone++; undoTs(chosenT);
            for (let i = sAts.length - 1; i >= 0; i--) b.undo(sAts[i]);
            continue;
          }
          const veto = () => { undoTs(chosenT); for (let i = sAts.length - 1; i >= 0; i--) b.undo(sAts[i]); };
          const verdict = counterThreat.checkFull(b);
          ct.trySolveMs = (ct.trySolveMs || 0) + (verdict?.elapsedMs || 0);
          if (!(verdict && verdict.status === 'win' && verdict.depth === counterThreat.depth)) {
            if (verdict?.status === 'win') ct.short++; else ct.noWin++;
            veto(); continue;
          }
          if (counterThreat.uniqueFirst && verdict.winningFirst?.length !== 1) { ct.nonunique++; veto(); continue; }
          if (b.forcingMoves(attacker, rule, guard).length < 2) { ct.shallow++; veto(); continue; }
          const tryAuditStart = performance.now();
          const audit = counterThreat.audit(b, verdict.proof, 150);
          ct.tryAuditMs = (ct.tryAuditMs || 0) + (performance.now() - tryAuditStart);
          if (audit.secondLine || audit.unproven || (counterThreat.depth <= 30 && audit.plausible < audit.turns - 1)) { ct.audit++; veto(); continue; }
          candidate.compact.pairSolve = verdict;
          (candidate.compact.counter ??= []).push({ q, s: sAts.length === 1 ? sAts[0] : sAts, t: chosenT.length === 1 ? chosenT[0] : chosenT });
          if (baseKey) candidate.compact.counterBaseKey = baseKey;
          ct.placed++;
          if (sAts.length > 1) ct.placedPairs = (ct.placedPairs || 0) + 1;
          (ct.tryPos ??= []).push(tried);
          break;
        }
        }
        }
        }
      }
    }
  }
}
