import { Board, BudgetExceeded, budget } from './board.mjs';
import { solve, principalVariation } from './solve.mjs';
import { analyzeDifficulty } from './difficulty.mjs';
import { analyzeMainline } from './mainline.mjs';

// Experimental construction family, separate from the linear-chain generator.
// After an entry P, two fours A/B share P. Their merge M needs BOTH A and B.
// A's forced white block creates a counter-four ending at M. Playing A before
// B fails: M cannot yet give check. B -> A -> M both blocks and gives check.
// No corpus positions, preset diagrams or symmetry variants are used as seeds.
// The caller must assemble fresh certificates and independently verify them.
export function searchJunctionPosition({
  rng, depth = 5, timeMs = 10000, signal, maxAttempts = 20000,
  onProgress = () => {},
} = {}) {
  if (typeof rng !== 'function') throw new Error('Junction search requires rng');
  if (![5, 8, 11].includes(depth)) throw new Error('Junction research supports depths 5, 8, 11');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid attempt limit');
  const guard = budget({ timeMs, signal }), geometry = new Board(15);
  const stages = (depth - 2) / 3;
  const stats = { attempts: 0, geometry: 0, roots: 0, replayed: 0, balanced: 0, exact: 0, global: 0 };
  const pick = values => values[Math.floor(rng() * values.length)];
  const shuffle = values => values.map(value => ({ value, order: rng() }))
    .sort((a, b) => a.order - b.order).map(item => item.value);
  const remaining = cap => { guard.check(); return Math.min(cap, timeMs - guard.elapsedMs); };
  const ends = points => {
    const dr = Math.floor(points[1] / 15) - Math.floor(points[0] / 15);
    const dc = points[1] % 15 - points[0] % 15;
    return [geometry.index(Math.floor(points[0] / 15) - dr, points[0] % 15 - dc),
      geometry.index(Math.floor(points.at(-1) / 15) + dr, points.at(-1) % 15 + dc)];
  };
  const moduleCache = new Map();
  const forkModules = anchor => {
    if (moduleCache.has(anchor)) return moduleCache.get(anchor);
    const options = geometry.incidence[anchor].flatMap(w => {
      const points = geometry.windows[w], back = ends(points);
      if (back.some(q => q < 0)) return [];
      return points.filter(q => q !== anchor).flatMap(at =>
        points.filter(q => q !== anchor && q !== at).map(reply => ({ at, reply,
          entries: [...points.map(q => [q, q === anchor || q === at || q === reply ? 0 : 1]),
            ...back.map(q => [q, 2])],
        })));
    });
    moduleCache.set(anchor, options);
    return options;
  };
  const rootModules = at => geometry.incidence[at].flatMap(w => {
    const points = geometry.windows[w], back = ends(points);
    if (back.some(q => q < 0)) return [];
    return points.filter(q => q !== at).map(reply => ({ reply,
      entries: [...points.map(q => [q, q === at || q === reply ? 0 : 1]), ...back.map(q => [q, 2])],
    }));
  });

  const construct = () => {
    const board = new Board(15), reserved = new Set(), junctions = [];
    const entry = geometry.index(4 + Math.floor(rng() * 7), 4 + Math.floor(rng() * 7));
    const place = entries => {
      guard.tick();
      const unique = new Map();
      for (const [at, color] of entries) {
        if (at < 0 || unique.has(at) && unique.get(at) !== color) return null;
        unique.set(at, color);
      }
      for (const [at, color] of unique) {
        if (board.cells[at] ? board.cells[at] !== color : color && reserved.has(at)) return null;
      }
      const added = [], holes = [];
      for (const [at, color] of unique) {
        if (color && !board.cells[at]) { board.put(at, color); added.push(at); }
        if (!color && !reserved.has(at)) { reserved.add(at); holes.push(at); }
      }
      return () => { for (const at of added) board.undo(at); for (const at of holes) reserved.delete(at); };
    };
    let anchor = entry;
    for (let stage = 0; stage < stages; stage++) {
      let placed = false;
      const forks = forkModules(anchor);
      for (let trial = 0; trial < (stages === 1 ? 1 : 60); trial++) {
        guard.check();
        const a = pick(forks), b = pick(forks);
        if (a.at === b.at || a.reply === b.reply) continue;
        const undoA = place(a.entries);
        if (!undoA) continue;
        const undoB = place(b.entries);
        if (!undoB) { undoA(); continue; }
        const merges = [];
        for (const w of geometry.incidence[a.at]) {
          const points = geometry.windows[w];
          if (!points.includes(b.at)) continue;
          if (stage === stages - 1) {
            for (const drop of [0, 4]) {
              const core = points.filter((_, i) => i !== drop);
              if (!core.includes(a.at) || !core.includes(b.at)) continue;
              const tails = ends(core);
              if (tails.some(q => q < 0)) continue;
              for (const at of core.filter(q => q !== a.at && q !== b.at)) {
                merges.push({ at, entries: [...core.map(q => [q, q === a.at || q === b.at || q === at ? 0 : 1]),
                  ...tails.map(q => [q, 0])] });
              }
            }
          } else {
            const tails = ends(points);
            if (tails.some(q => q < 0)) continue;
            for (const at of points.filter(q => q !== a.at && q !== b.at)) {
              for (const reply of points.filter(q => q !== a.at && q !== b.at && q !== at)) {
                merges.push({ at, reply,
                  entries: [...points.map(q => [q, q === a.at || q === b.at || q === at || q === reply ? 0 : 1]),
                    ...tails.map(q => [q, 2])] });
              }
            }
          }
        }
        const merge = pick(merges), undoMerge = merge && place(merge.entries);
        if (!undoMerge) { undoB(); undoA(); continue; }
        const counters = [];
        for (const w of geometry.incidence[a.reply]) {
          const points = geometry.windows[w], tails = ends(points);
          if (!points.includes(merge.at) || tails.some(q => q < 0)) continue;
          counters.push([...points.map(q => [q, q === a.reply || q === merge.at ? 0 : 2]),
            ...tails.map(q => [q, 1])]);
        }
        const counter = pick(counters), undoCounter = counter && place(counter);
        if (!undoCounter) { undoMerge(); undoB(); undoA(); continue; }
        junctions.push({ anchor, a: a.at, b: b.at, merge: merge.at,
          aReply: a.reply, bReply: b.reply, mergeReply: merge.reply,
          counterStones: counter.filter(([, color]) => color === 2).map(([at]) => at) });
        anchor = merge.at; placed = true; break;
      }
      if (!placed) return null;
    }
    return { board, reserved, junctions, entry, place };
  };

  const replay = (board, path, blocks) => {
    const copy = new Board(15, board.cells);
    for (let i = 0; i < path.length; i++) {
      guard.check();
      if (!copy.legal(path[i], 1, 'renju', guard)) return false;
      copy.put(path[i], 1);
      if (copy.winningPoints(2, 'renju', guard).length) return false;
      const wins = copy.winningPoints(1, 'renju', guard);
      if (i === path.length - 1) return wins.length >= 2;
      if (wins.length !== 1 || wins[0] !== blocks[i]) return false;
      copy.put(blocks[i], 2);
    }
    return false;
  };
  const validDiagram = (board, path, blocks) => !board.hasFive() &&
    !board.winningPoints(1, 'renju', guard).length && !board.winningPoints(2, 'renju', guard).length &&
    replay(board, path, blocks);
  const balance = ({ board, reserved }, path, blocks) => {
    let difference = board.cells.filter(p => p === 1).length - board.cells.filter(p => p === 2).length;
    const player = difference > 0 ? 2 : 1, added = [];
    const occupied = [...board.cells.keys()].filter(at => board.cells[at]);
    const neighbours = at => occupied.filter(q => Math.max(Math.abs(Math.floor(at / 15) - Math.floor(q / 15)), Math.abs(at % 15 - q % 15)) <= 1).length;
    const free = [...board.cells.keys()].filter(at => !board.cells[at] && !reserved.has(at) && neighbours(at) > 0)
      .map(at => ({ at, rank: neighbours(at) + rng() * 2 })).sort((a, b) => b.rank - a.rank);
    for (const { at } of free) {
      guard.check();
      if (!difference) break;
      if (!board.legal(at, player, 'renju', guard)) continue;
      board.put(at, player);
      if (!validDiagram(board, path, blocks)) { board.undo(at); continue; }
      added.push(at); difference += player === 1 ? 1 : -1;
    }
    return { ok: difference === 0, undo: () => { for (const at of added) board.undo(at); } };
  };

  try {
    while (stats.attempts < maxAttempts) {
      guard.check(); stats.attempts++;
      if (stats.attempts % 100 === 1) onProgress({ ...stats });
      const candidate = construct();
      if (!candidate) continue;
      stats.geometry++;
      const { board, junctions, entry, place } = candidate;
      for (const root of shuffle(rootModules(entry)).slice(0, 80)) {
        const undoRoot = place(root.entries);
        if (!undoRoot) continue;
        stats.roots++;
        const path = [entry, ...junctions.flatMap(j => [j.b, j.a, j.merge])];
        const blocks = [root.reply, ...junctions.flatMap(j =>
          [j.bReply, j.aReply, ...(j.mergeReply === undefined ? [] : [j.mergeReply])])];
        if (!validDiagram(board, path, blocks)) { undoRoot(); continue; }
        stats.replayed++;
        const balanced = balance(candidate, path, blocks);
        if (!balanced.ok) { balanced.undo(); undoRoot(); continue; }
        stats.balanced++;
        const result = solve(board, 1, { rule: 'renju', maxDepth: depth, enumerateFirst: true,
          timeMs: remaining(80), nodeLimit: 30000, signal });
        if (result.status === 'win' && result.depth === depth && result.winningFirst.length === 1 &&
            principalVariation(board, 1, result.proof).filter(s => s.player === 1).slice(0, -1).every((s, i) => s.at === path[i])) {
          stats.exact++;
          const difficulty = analyzeDifficulty(board, 1, result.proof, { timeMs: remaining(300), nodeLimit: 100000, signal });
          const mainline = analyzeMainline(board, 1, result.proof, { timeMs: remaining(100), difficulty, signal });
          if (difficulty.status === 'complete' && difficulty.secondLines === 0 &&
              mainline.status === 'complete' && mainline.counterTurns >= stages && mainline.orderDecisionTurns >= stages) {
            guard.check(); stats.global++;
            return { board, result, difficulty, mainline, junctions,
              junctionSearch: { ...stats, elapsedMs: guard.elapsedMs } };
          }
        }
        balanced.undo(); undoRoot();
      }
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
  }
  return null;
}
