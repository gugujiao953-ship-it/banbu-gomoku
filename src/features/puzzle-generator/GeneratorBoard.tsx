import { useEffect } from 'react';
import { coordinateName, columnName } from '../../game';
import { usePinchZoom } from './usePinchZoom';
import type { GeneratedPuzzle, SolutionMove } from './model';

export function GeneratorBoard({ puzzle, moves, outline, supports, candidate, onPoint, onBlocked }: {
  puzzle: GeneratedPuzzle; moves: SolutionMove[]; outline: boolean; supports: boolean;
  candidate: number | null; onPoint?: (at: number) => void;
  /** 点了不该点的地方时的反馈出口（用户 10-07：「无法落子，点几下都是一样的」）——
      以前这两类点击**一声不响**地丢掉：落在已有子上、落在木边（非交叉点）。用户以为棋盘坏了。
      现在交给页面去提示，选点流程本身不变。 */
  onBlocked?: (reason: "occupied" | "outside") => void;
}) {
  // 放大改成和打谱界面一样：双指捏合 / Ctrl+滚轮，围着手指那一点缩放。
  // 原先这里是一个「放大棋盘 / 适应屏幕」的固定档按钮（用户 10-06 要求去掉）。
  const { containerRef, scale, reset } = usePinchZoom<HTMLDivElement>();
  useEffect(() => { reset(); }, [puzzle.id, reset]);
  const cells = new Map<number, { player: number; number?: number }>();
  for (const side of ['black', 'white'] as const) for (const p of puzzle.stones[side]) cells.set(p.row * puzzle.size + p.col, { player: side === 'black' ? 1 : 2 });
  // 编号只数真正落在盘上的子：解线里的停着（at:null）不占一号，否则棋子和数字会错位。
  let stepNumber = 0;
  for (const move of moves) { if (move.at === null) continue; stepNumber += 1; cells.set(move.at, { player: move.player, number: stepNumber }); }
  const step = 540 / (puzzle.size - 1), radius = step * .43;
  const xy = (at: number) => ({ x: 30 + at % puzzle.size * step, y: 30 + Math.floor(at / puzzle.size) * step });
  const fixed = new Set(puzzle.theme?.fixed.map(p => p.at) || []), critical = new Set(puzzle.theme?.critical.map(p => p.at) || []);
  const activeStep = puzzle.theme?.complexity?.steps.find(s => s.at === [...moves].reverse().find(m => m.player === (puzzle.attacker === 'black' ? 1 : 2))?.at);
  const activeSupports = new Set(activeStep?.runs.flatMap(r => r.strokes) || []);
  const last = [...moves].reverse().find(m => m.at !== null)?.at;
  return <div className="generator-board-wrap">
    <div ref={containerRef} className="generator-board-scroll" data-generator-board-scroll style={{ touchAction: scale > 1.01 ? 'none' : 'pan-x pan-y' }}>
      <svg className="generator-board" viewBox="0 0 600 600" style={{ width: `${scale * 100}%`, maxWidth: 'none' }}
        aria-label={`${puzzle.size} 路棋盘，${onPoint ? '点击空点选择落子位置' : '题目预览'}`} role="img"
        onClick={onPoint ? e => {
          const bounds = e.currentTarget.getBoundingClientRect();
          const col = Math.round(((e.clientX - bounds.left) / bounds.width * 600 - 30) / step);
          const row = Math.round(((e.clientY - bounds.top) / bounds.height * 600 - 30) / step);
          const at = row * puzzle.size + col;
          if (row < 0 || col < 0 || row >= puzzle.size || col >= puzzle.size) { onBlocked?.("outside"); return; }
          if (cells.has(at)) { onBlocked?.("occupied"); return; }
          onPoint(at);
        } : undefined}>
        <rect width="600" height="600" rx="12" fill="var(--board-bg, #dfc393)"/>
        {Array.from({ length: puzzle.size }, (_, i) => <g key={i} stroke="#624c31" strokeWidth=".9">
          <path d={`M30 ${30+i*step}H570 M${30+i*step} 30V570`}/>
        </g>)}
        {Array.from({ length: puzzle.size }, (_, i) => (puzzle.size <= 20 || i % 2 === 0 || i === puzzle.size - 1) && <g key={`label-${i}`} fill="#58452f" fontSize={puzzle.size > 20 ? 11 : 13} textAnchor="middle">
          <text x={30+i*step} y="19">{columnName(i)}</text><text x="14" y={34+i*step}>{puzzle.size-i}</text>
        </g>)}
        {[...cells].map(([at, stone]) => { const { x, y } = xy(at); return <g key={at} data-generator-stone={at}>
          <circle cx={x} cy={y} r={radius} fill={stone.player === 1 ? '#202427' : '#fffdf6'} stroke={stone.player === 1 ? '#0f1315' : '#8a847b'} strokeWidth="1"/>
          {outline && fixed.has(at) && <circle cx={x} cy={y} r={radius + 1.5} fill="none" stroke="#2171b8" strokeWidth="2.4"/>}
          {supports && critical.has(at) && <circle cx={x} cy={y} r={radius - 2} fill="none" stroke={activeSupports.has(at) ? '#ff9d29' : '#c256df'} strokeWidth="3"/>}
          {stone.number !== undefined && <text x={x} y={y + radius * .35} fontSize={radius * 1.2} textAnchor="middle" fill={stone.player === 1 ? '#fff' : '#252728'}>{stone.number}</text>}
          {at === last && <circle cx={x} cy={y} r={radius + 1} fill="none" stroke="#c54435" strokeWidth="2"/>}
        </g>; })}
        {candidate !== null && !cells.has(candidate) && <circle cx={xy(candidate).x} cy={xy(candidate).y} r={radius} fill="#387d66" fillOpacity=".5" stroke="#205c47" strokeWidth="2"/>}
      </svg>
    </div>
    <div className="generator-board-footer"><small>{onPoint ? '点空交叉点直接落子 · 双指放大' : '最后一步标有红圈 · 双指放大'}{candidate !== null ? ` · ${coordinateName({ row: Math.floor(candidate / puzzle.size), col: candidate % puzzle.size }, puzzle.size)}` : ''}</small>
      {scale > 1.01 && <button type="button" onClick={reset}>复位（{(scale * 100).toFixed(0)}%）</button>}</div>
  </div>;
}
