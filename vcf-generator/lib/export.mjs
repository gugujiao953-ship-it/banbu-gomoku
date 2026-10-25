import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordName, coordinates, playerId } from './board.mjs';
import { verify } from './verify.mjs';
import { viewer, forbiddenReason } from './viewer.mjs';

const escapeSgf = text => String(text).replaceAll('\\', '\\\\').replaceAll(']', '\\]');
// FF[4] coordinates allow a-z then A-Z, hence at most 52 intersections.
const sgfCoord = (row, col) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return alphabet[col] + alphabet[row];
};
export function toSgf(p) {
  if (p.size > 52) throw new Error('SGF FF[4] coordinates support at most 52 lines; use proof JSON for this board');
  const setup = (key, stones) => stones.length ? key + stones.map(s => '[' + sgfCoord(s.row, s.col) + ']').join('') : '';
  const comment = `最短 ${p.depth} 手；包含最后成五；完整证明见 JSON${p.forbidden?'。'+forbiddenReason(p):''}`;
  const initial = `(;FF[4]GM[4]CA[UTF-8]SZ[${p.size}]PL[${p.attacker === 'black' ? 'B' : 'W'}]GN[${escapeSgf(p.title)}]RU[${p.rules}]C[${escapeSgf(comment)}]${setup('AB', p.stones.black)}${setup('AW', p.stones.white)}`;
  return initial + p.solution.map(m => {
    const point = m.at === null ? null : coordinates(m.at, p.size);
    const note=m.at===null&&p.forbidden?'黑无法合法堵（停着演示）':m.note;
    return `;${playerId(m.player) === 1 ? 'B' : 'W'}[${point ? sgfCoord(point.row, point.col) : ''}]C[${escapeSgf(note)}]`;
  }).join('') + ')';
}

export function toAppCollection(puzzles) {
  if (puzzles.some(p => p.size > 30)) throw new Error('Half-step Gomoku currently supports at most 30 lines; refusing silent resizing');
  return { title: '从空盘生成 · 已证明 VCF', source: 'banbu-vcf-synthesis', puzzles: puzzles.map(p => ({
    id: p.id, title: p.title, size: p.size, side: p.attacker, rule: p.rules,
    generated: p,
    blackStones: p.stones.black.map(s => coordName(s.row * p.size + s.col, p.size)).join(''),
    whiteStones: p.stones.white.map(s => coordName(s.row * p.size + s.col, p.size)).join(''),
    comment: `最短 ${p.depth} 手（进攻方，含最终成五）；从空盘合成；已完成独立复核及更短解排除。${forbiddenReason(p)}`,
  })) };
}

// A complete export never overwrites a previous batch, and only verified
// results may be exported. Proof JSON remains canonical for every board size.
export function writeBatch(batch, directory) {
  const puzzles = batch.puzzles;
  if (!Array.isArray(puzzles) || puzzles.some(p => !p.verification?.valid || !p.verification.shortest)) throw new Error('Refusing to export unverified puzzles');
  if (new Set(puzzles.map(p => p.id)).size !== puzzles.length) throw new Error('Refusing to export duplicate puzzle IDs');
  // A verified flag is not a certificate: callers can change a board/answer
  // after generation. Revalidate the exact objects being written to disk.
  for (const p of puzzles) {
    const check=verify(p,{timeMs:Math.max(30000,2*(p.verification.elapsedMs||0))});
    if(!check.valid)throw new Error('Refusing to export invalid puzzle '+p.id+': '+check.error);
  }
  const compatible = puzzles.filter(p => p.size <= 30);
  const sizePolicies = batch.jobs?.flatMap(job=>job.sizePolicy?[job.sizePolicy]:[]) ?? (batch.sizePolicy?[batch.sizePolicy]:[]);
  const files = new Map([
    ['proofs.json', JSON.stringify(batch, null, 2)],
    ['index.html', viewer(puzzles)],
    ['answers.txt', puzzles.map(p => p.title + `（${p.size}路）\n` + (p.forbidden?forbiddenReason(p)+'\n':'') + p.solution.map((m, i) => m.at===null&&p.forbidden?`${i+1}. 黑无法合法堵（停着演示）`:`${i + 1}. ${playerId(m.player) === 1 ? '黑' : '白'} ${m.at === null ? 'pass' : coordName(m.at, p.size)} ${m.note}`).join('\n')).join('\n\n')],
    ['manifest.json', JSON.stringify({ requested: batch.requested, generated: puzzles.length, status: batch.status, boardSizes:[...new Set(puzzles.map(p=>p.size))].sort((a,b)=>a-b),
      sizePolicies, applicationCompatible: compatible.length, proofJsonOnly: puzzles.filter(p => p.size > 52).map(p => p.id), rejected: batch.rejected }, null, 2)],
  ]);
  if (compatible.length) files.set('banbu-puzzles.json', JSON.stringify(toAppCollection(compatible), null, 2));
  for (const p of puzzles) if (p.size <= 52) files.set(p.id + '.sgf', toSgf(p));
  for (const name of files.keys()) if (existsSync(join(directory, name))) throw new Error('Output already exists: ' + join(directory, name));
  mkdirSync(directory, { recursive: true });
  for (const [name, text] of files) writeFileSync(join(directory, name), text, { encoding: 'utf8', flag: 'wx' });
  return [...files.keys()];
}
