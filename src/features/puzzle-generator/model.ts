import type { Player, Position } from '../../types';

export type GeneratorEngine = 'vcf' | 'vct';
export type GeneratorKind = 'ordinary' | 'forbidden' | 'shape' | 'text';
export interface ProofNode {
  at: number; kind: 'five' | 'four' | 'unanswerable-four'; depth: number;
  wins?: number[]; replies?: { at: number; child: ProofNode }[];
}
export interface SolutionMove { at: number | null; player: 1 | 2; note: string }
export interface GeneratedPuzzle {
  schema: 'banbu-vcf-proof/1'; id: string; title: string; size: number;
  rules: 'renju' | 'freestyle'; attacker: Player; depth: number;
  stones: { black: Position[]; white: Position[] }; proof: ProofNode; solution: SolutionMove[];
  ending?: 'forbidden'; forbidden?: { kind: string; at: number };
  theme?: { text: string; mask: string[]; row: number; col: number; width: number; height: number;
    fixed: { at: number; player: number }[]; critical: { at: number; player: number }[];
    kind?: 'shape'; complexity?: { usedStrokes: number; participatingTurns: number; reusedStrokes: number;
      steps: { move: number; at: number; runs: { axis: number; strokes: number[] }[] }[] };
    [key: string]: unknown };
  verification?: { valid: boolean; status: string; shortest: boolean; depth: number; nodes: number; elapsedMs: number };
  provenance: { method: string; corpusUsed: boolean; seed: number; canonicalHash: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface GeneratorShapePart {
  id: string; label: string; points: { row: number; col: number }[];
}
export interface GeneratorShapeDefinition {
  id: string; label: string; mask: string[]; parts: GeneratorShapePart[]; source: 'custom-mask';
}
export interface GeneratorSettings {
  engine: GeneratorEngine; kind: GeneratorKind; attacker: Player; rules: 'renju' | 'freestyle';
  depth: number; count: 1 | 5 | 10; expand: boolean; maxSize: number;
  shape: string; customShape?: GeneratorShapeDefinition; shapeDescription?: string;
  shapeComplexity: boolean; text: string; textLayout: 'horizontal' | 'vertical';
  seconds: number; uniqueFirst: boolean;
  /** 新的自然/支撑编织路线。关闭后使用兼容的快速旧路线。 */
  qualityRoute: boolean;
  /** @deprecated Kept only to read old settings. Route selection now uses
   * qualityRoute; the UI no longer exposes a separate obstacle toggle. */
  moreObstacles: boolean;
  /** @deprecated Kept for old serialized settings; the public app no longer
   * exposes the experimental hard-search branch. */
  hardSearch?: boolean;
}
export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
  engine: 'vcf', kind: 'ordinary', attacker: 'black', rules: 'renju', depth: 8, count: 1,
  expand: false, maxSize: 30, shape: 'fish-small', shapeComplexity: false,
  text: '国庆', textLayout: 'horizontal', seconds: 15, uniqueFirst: true, qualityRoute: true, moreObstacles: false, hardSearch: false,
};
export function validateSettings(settings: GeneratorSettings) {
  if (settings.engine !== 'vcf') throw new Error('目前开放 VCF 生成');
  if (!['ordinary', 'forbidden', 'shape', 'text'].includes(settings.kind) ||
    !['black', 'white'].includes(settings.attacker) || !['renju', 'freestyle'].includes(settings.rules) ||
    !Number.isInteger(settings.depth) || settings.depth < 3 || settings.depth > 100 ||
    ![1, 5, 10].includes(settings.count) || ![5, 15, 30, 60, 120].includes(settings.seconds) ||
    !Number.isInteger(settings.maxSize) || settings.maxSize < 5 || settings.maxSize > 30 ||
    !['horizontal', 'vertical'].includes(settings.textLayout) ||
    typeof settings.qualityRoute !== 'boolean' ||
    (settings.moreObstacles !== undefined && typeof settings.moreObstacles !== 'boolean') ||
    (settings.hardSearch !== undefined && typeof settings.hardSearch !== 'boolean')) throw new Error('请检查生成设置');
  if (settings.hardSearch && (settings.kind !== 'ordinary' || settings.depth < 6 || settings.depth > 12 || settings.expand || !settings.moreObstacles)) {
    throw new Error('深算死路目前支持标准 15 路的普通 VCF 题，目标手数为 6–12 手，请开启寻找更多阻碍点。');
  }
  if (settings.depth > 40 && (!settings.expand || settings.maxSize < 30)) throw new Error('40 手以上请开启扩展棋盘并将最大路数设为 30，才能保持较高成功率。');
  if (settings.kind === 'forbidden' && (settings.attacker !== 'white' || settings.rules !== 'renju')) throw new Error('抓禁手题需要白先、有禁手');
  if (settings.kind === 'text' && (!settings.text || [...settings.text].length > 4 || /[\p{White_Space}\p{Cc}\p{Cf}]/u.test(settings.text))) throw new Error('请输入一到四个可见文字');
  if (settings.kind === 'text' && [...settings.text].length >= 2) {
    const characters = [...settings.text], compact = settings.depth >= 24 && characters.length <= 2;
    const glyphSize = characters.length >= 3 || compact ? 6 : 9;
    const gap = glyphSize >= 9 ? 2 : 1;
    const required = characters.length * glyphSize + (characters.length - 1) * gap + 2;
    if (!settings.expand || settings.maxSize < required) throw new Error(`${[...settings.text].length} 个字至少需要 ${required} 路，请允许扩展棋盘。`);
    if (characters.length >= 3 && settings.depth < characters.length * 3) throw new Error(`${characters.length} 个字建议至少生成 ${characters.length * 3} 手，才能让每个字参与解题。`);
  }
  if (settings.kind === 'shape') {
    if (settings.shape === 'custom') {
      const custom = settings.customShape;
      const width = custom?.mask[0]?.length || 0, height = custom?.mask.length || 0;
      if (!custom || custom.source !== 'custom-mask' || !custom.label.trim() || !width || !height || width > 28 || height > 28 ||
        custom.mask.some(row => !/^[01]+$/.test(row) || row.length !== width) || !custom.mask.some(row => row.includes('1'))) throw new Error('请绘制一个 1 到 28 路的有效轮廓');
      const points = custom.mask.flatMap((row, r) => [...row].flatMap((bit, col) => bit === '1' ? [{ row: r, col }] : []));
      if (!custom.parts?.length || custom.parts.some(part => !part.points.length) || custom.parts.flatMap(part => part.points).length !== points.length) throw new Error('自定义轮廓分区不完整，请重新绘制');
      // Multi-step proofs require two distinct initial attacker strokes per
      // part. Reject impossible one-point parts before starting the worker.
      if (settings.shapeComplexity && custom.parts.some(part => part.points.length < 2)) throw new Error('“参与更多步骤”要求每个轮廓分区至少有 2 个点');
    }
    const minimum = settings.shape === 'custom'
      ? Math.max(settings.customShape?.mask.length || 0, settings.customShape?.mask[0]?.length || 0) + 2
      : ({ 'fish-small':15,'cat-small':15,heart:15,star:15,fish:21,cat:19,moon:15,sun:15,cloud:17,house:15,flower:15,butterfly:17,rabbit:19,tree:15,rocket:19 } as Record<string,number>)[settings.shape];
    if (!minimum) throw new Error('请选择支持的图案');
    if (minimum > (settings.expand ? settings.maxSize : 15)) throw new Error(`这个轮廓需要至少 ${minimum} 路，请允许扩展棋盘或选择小轮廓。`);
  }
}

// This is only a bounded transport guard. Every loaded proof still goes
// through the independent verifier in the Worker before it can be played.
export function isGeneratedPuzzle(value: unknown): value is GeneratedPuzzle {
  if (!value || typeof value !== 'object') return false;
  const p = value as GeneratedPuzzle;
  if (p.theme && (!Array.isArray(p.theme.fixed) || !Array.isArray(p.theme.critical) ||
    p.theme.fixed.length > 900 || p.theme.critical.length > 900 ||
    !Array.isArray(p.theme.mask) || p.theme.mask.length > 30 || p.theme.mask.some(row => typeof row !== 'string' || row.length > 30))) return false;
  if (p.theme) {
    const validAt = (at: number) => Number.isInteger(at) && at >= 0 && at < p.size * p.size;
    if ([...p.theme.fixed,...p.theme.critical].some(stone => !stone || !validAt(stone.at) || ![1,2].includes(stone.player))) return false;
    const complexity = p.theme.complexity;
    if (complexity && (!Array.isArray(complexity.steps) || complexity.steps.length > 100 || complexity.steps.some(step =>
      !step || !validAt(step.at) || !Array.isArray(step.runs) || step.runs.length > 4 || step.runs.some(run =>
        !run || ![0,1,2,3].includes(run.axis) || !Array.isArray(run.strokes) || run.strokes.length > 900 || run.strokes.some(at => !validAt(at)))))) return false;
  }
  const stack: ProofNode[] = p.proof ? [p.proof] : [];
  const maxProofNodes = Number.isInteger(p.depth) ? Math.max(40, p.depth + 20) : 40;
  let nodes = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++nodes > maxProofNodes || !node || !Number.isInteger(node.at) || node.at < 0 || node.at >= p.size * p.size ||
      !['five','four','unanswerable-four'].includes(node.kind) || !Number.isInteger(node.depth) || node.depth < 1 || node.depth > 100 ||
      (node.wins !== undefined && (!Array.isArray(node.wins) || node.wins.length > 900)) ||
      (node.replies !== undefined && (!Array.isArray(node.replies) || node.replies.length > 1))) return false;
    for (const reply of node.replies || []) stack.push(reply?.child);
  }
  return p.schema === 'banbu-vcf-proof/1' && typeof p.id === 'string' && typeof p.title === 'string' &&
    Number.isInteger(p.size) && p.size >= 5 && p.size <= 30 && Number.isInteger(p.depth) && p.depth >= 3 && p.depth <= 100 &&
    ['black', 'white'].includes(p.attacker) && ['renju', 'freestyle'].includes(p.rules) &&
    !!p.stones && ['black', 'white'].every(side => {
      const stones = p.stones[side as Player];
      return Array.isArray(stones) && stones.length <= p.size * p.size && stones.every(s =>
        s && Number.isInteger(s.row) && Number.isInteger(s.col) && s.row >= 0 && s.col >= 0 && s.row < p.size && s.col < p.size);
    }) && !!p.proof && Array.isArray(p.solution) && p.solution.length <= 2 * p.depth && p.solution.every(move =>
      move && [1,2].includes(move.player) && (move.at === null || Number.isInteger(move.at) && move.at >= 0 && move.at < p.size * p.size));
}
export type WorkerRequest =
  | { type: 'generate'; settings: GeneratorSettings; seed: number; exclude: string[]; raster?: TextRaster }
  | { type: 'verify'; puzzle: GeneratedPuzzle }
  | { type: 'move'; puzzle: GeneratedPuzzle; moves: SolutionMove[]; proof: ProofNode | null; at: number };
export interface TextRaster {
  text: string; mask: string[]; textRaster: { source: string; glyphSize: number; textLayout: string; gap: number;
    characters: string[]; glyphBoxes: { index: number; char: string; character: string; row: number; col: number; height: number; width: number }[] };
}
export type MoveResult = { status: 'accepted' | 'won'; moves: SolutionMove[]; proof: ProofNode | null; note: string }
  | { status: 'wrong' | 'budget'; note: string };
export type WorkerReply =
  | { type: 'progress'; index: number; count: number; size?: number }
  | { type: 'puzzle'; puzzle: GeneratedPuzzle }
  | { type: 'done'; produced: number; requested: number }
  | { type: 'verified'; valid: boolean; note: string }
  | { type: 'move'; result: MoveResult }
  | { type: 'error'; message: string };
