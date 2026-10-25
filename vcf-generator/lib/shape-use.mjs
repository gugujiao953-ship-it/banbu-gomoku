import { AXES, Board, other } from './board.mjs';

// Geometry is collected by the producer and, separately, by the reference
// verifier. This module only groups their witnesses and sets quality targets;
// it does not decide move legality, winning points, or shortest depth.
export function summarizeShapeUse(steps, shape, theme, size) {
  const uses = new Map(), directions = new Set();
  for (const step of steps) for (const run of step.runs) {
    directions.add(run.axis);
    for (const at of run.strokes) {
      if (!uses.has(at)) uses.set(at, { turns: new Set(), axes: new Set() });
      uses.get(at).turns.add(step.move); uses.get(at).axes.add(run.axis);
    }
  }
  return {
    usedStrokes: uses.size,
    participatingTurns: steps.filter(step => step.runs.length).length,
    reusedStrokes: [...uses.values()].filter(use => use.turns.size >= 2).length,
    crossAxisStrokes: [...uses.values()].filter(use => use.turns.size >= 2 && use.axes.size >= 2).length,
    directions: directions.size,
    parts: shape.parts.map(part => {
      const points = new Set(part.points.map(p => (theme.row + p.row) * size + theme.col + p.col));
      const turns = new Set(); let usedStrokes = 0;
      for (const [at, use] of uses) if (points.has(at)) {
        usedStrokes++; for (const turn of use.turns) turns.add(turn);
      }
      return { id: part.id, usedStrokes, turns: turns.size };
    }),
  };
}

export function meetsMultiStepUse(summary, depth) {
  return summary.parts.every(part => part.usedStrokes >= 2 && part.turns >= 2)
    && summary.participatingTurns >= Math.ceil((depth - 1) * .6)
    && summary.reusedStrokes >= 1 && summary.directions >= 2;
}

// Count actual initial outline stones in promised winning runs. Terminal
// four's two endpoints share one turn: they are never counted as two attacks.
export function collectShapeUse(initial, attacker, rule, proof, theme, shape) {
  const board = new Board(initial.size, initial.cells), fixed = new Set(theme.fixed.filter(s => s.player === attacker).map(s => s.at));
  const steps = [];
  const visit = (node, move) => board.withMove(node.at, attacker, () => {
    if (node.kind !== 'five') {
      const axes = new Map();
      for (const win of node.wins) board.withMove(win, attacker, () => {
        for (let axis = 0; axis < AXES.length; axis++) {
          const run = board.run(win, attacker, ...AXES[axis]);
          if (rule === 'renju' && attacker === 1 ? run.length !== 5 : run.length < 5) continue;
          const strokes = run.filter(at => fixed.has(at));
          if (strokes.length) {
            if (!axes.has(axis)) axes.set(axis, new Set());
            for (const at of strokes) axes.get(axis).add(at);
          }
        }
      });
      steps.push({ move, at: node.at, runs: [...axes].sort(([a], [b]) => a - b)
        .map(([axis, strokes]) => ({ axis, strokes: [...strokes].sort((a, b) => a - b) })) });
    }
    for (const reply of node.replies || []) board.withMove(reply.at, other(attacker), () => visit(reply.child, move + 1));
  });
  visit(proof, 1);
  return { mode: 'multi-step', ...summarizeShapeUse(steps, shape, theme, initial.size), steps };
}
