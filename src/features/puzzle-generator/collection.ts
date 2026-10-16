import type { Puzzle, PuzzleCollection } from '../../puzzles';
import { isGeneratedPuzzle, type GeneratedPuzzle } from './model';

/**
 * 从「已经解析好的 JSON 值」里认出一份**生成题目证明**（`banbu-vcf-proof/1`）。
 *
 * 用户 2026-10-11 报「json 文件导入失败」——查下来是**这一类文件没有导入入口**：
 * 生成器与超算产物把题目存成证明 JSON，应用**认得它**（`isGeneratedPuzzle` 为真），
 * 但「导入棋谱」与「题库导入」两条路各自的判据都不是它，于是双双报错
 * （前者"RENJU 文件缺少有效的版本、ID 或节点表"，后者要求顶层有 `puzzles` 数组）。
 *
 * 实测 `artifacts/research/**` 里真实存在**两种**形态，都得认：
 *   · **裸证明**：顶层就是 `{ schema: "banbu-vcf-proof/1", … }`（12 份）；
 *   · **带外壳**：`{ puzzle: { schema: … }, difficulty, geometry, stats }`（11 份）
 *     —— 外壳是 hard-search 的产物包装，`puzzle` 才是题。
 *
 * ⚠ **认不出就返回 `null`，绝不抛异常**：同一目录里还混着研究报表
 * （`{stats:{…}}`、`source-hashes.json` 之类），它们**不是题**，
 * 必须原样落到既有流程去报它自己的错，不能被这里"顺手"当成题吞掉。
 */
export function readGeneratedProof(value: unknown): GeneratedPuzzle | null {
  if (isGeneratedPuzzle(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const inner = (value as { puzzle?: unknown }).puzzle;
    if (isGeneratedPuzzle(inner)) return inner;
  }
  return null;
}

/** 同上，但从**文件文本**读。JSON 坏掉也返回 `null`（交给既有流程报"不是有效 JSON"）。 */
export function readGeneratedProofText(text: string): GeneratedPuzzle | null {
  try { return readGeneratedProof(JSON.parse(text)); } catch { return null; }
}

export function generatedToPuzzle(generated: GeneratedPuzzle): Puzzle {
  return { id: generated.id, title: generated.title, prompt: `${generated.attacker === 'black' ? '黑' : '白'}先，连续冲四 ${generated.depth} 手胜（含最后连五）`,
    player: generated.attacker, boardSize: generated.size, rule: generated.rules,
    difficulty: Math.min(5, Math.ceil(generated.depth / 3)) as Puzzle['difficulty'],
    stones: [...generated.stones.black.map(p => ({ ...p, player: 'black' as const })), ...generated.stones.white.map(p => ({ ...p, player: 'white' as const }))],
    generated };
}
export function generatedMatchesPuzzle(value: unknown, puzzle: Puzzle): value is GeneratedPuzzle {
  if (!isGeneratedPuzzle(value) || value.size !== (puzzle.boardSize || 15) || value.attacker !== puzzle.player || value.rules !== puzzle.rule) return false;
  const points = new Map(puzzle.stones.map(p => [`${p.row},${p.col}`, p.player]));
  const generated = new Map<string, 'black' | 'white'>();
  for (const side of ['black', 'white'] as const) for (const point of value.stones[side]) {
    const key = `${point.row},${point.col}`;
    if (generated.has(key)) return false;
    generated.set(key, side);
  }
  return points.size === puzzle.stones.length && generated.size === points.size &&
    [...points].every(([key, side]) => generated.get(key) === side);
}
export function generatedCollection(puzzles: GeneratedPuzzle[], id: string, title: string): PuzzleCollection {
  return { id, title, source: '半步五子棋 · 棋题生成器', license: '本机原创生成', puzzles: puzzles.map(generatedToPuzzle) };
}

/** 生成题的默认题库文件夹。它沿用固定集合 ID，老用户已保存的生成题不会搬家。 */
export const GENERATED_DEFAULT_FOLDER = 'VCF 生成器';
const LEGACY_GENERATED_FOLDER = '我的题库';
export const GENERATED_COLLECTION_ID = 'generated-vcf-library';

/** 一个集合只能挂一个文件夹，所以换文件夹保存就换集合，避免后一次保存把前一批一起搬走。 */
export function generatedCollectionIdForFolder(folder: string): string {
  const target = folder.trim();
  if (!target || target === GENERATED_DEFAULT_FOLDER || target === LEGACY_GENERATED_FOLDER) return GENERATED_COLLECTION_ID;
  let hash = 5381;
  for (let index = 0; index < target.length; index += 1) hash = ((hash << 5) + hash + target.charCodeAt(index)) >>> 0;
  return `generated-vcf-${hash.toString(36)}`;
}

/** Merge a generated batch without dropping asynchronously loaded collections. */
export function mergeGeneratedCollection(collections: PuzzleCollection[], puzzles: GeneratedPuzzle[], id: string, title: string): PuzzleCollection[] {
  const existing = collections.find(collection => collection.id === id);
  const next = generatedCollection(puzzles, id, existing?.title || title);
  if (existing) {
    next.puzzles = [...existing.puzzles, ...next.puzzles.filter(puzzle => !existing.puzzles.some(previous => previous.id === puzzle.id))];
    return collections.map(collection => collection.id === id ? next : collection);
  }
  return [...collections, next];
}
