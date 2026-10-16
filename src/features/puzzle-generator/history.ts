import { isGeneratedPuzzle, type GeneratedPuzzle } from './model';

const HISTORY_KEY = 'banbu-puzzle-generator-history-v1';
/** 用户要的口径：最多能看最近 100 道生成题，每页 10 道、最多 10 页。 */
export const HISTORY_LIMIT = 100;
export const HISTORY_PAGE_SIZE = 10;

export interface GeneratedBatch { id: string; createdAt: number; puzzles: GeneratedPuzzle[] }

const isBatch = (value: unknown): value is GeneratedBatch => {
  const batch = value as GeneratedBatch;
  return !!batch && typeof batch.id === 'string' && typeof batch.createdAt === 'number'
    && Array.isArray(batch.puzzles) && batch.puzzles.every(isGeneratedPuzzle);
};

export function loadBatches(): GeneratedBatch[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isBatch) : [];
  } catch { return []; }
}

function persist(batches: GeneratedBatch[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(batches)); }
  // 整批题面+证明比设置大得多，配额满时至少留住最近一批（做题与「最后一次生成」都靠它）。
  catch { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(batches.slice(0, 1))); } catch { /* 存不下就算了，不影响生成 */ } }
}

export function appendBatch(puzzles: GeneratedPuzzle[], id: string): GeneratedBatch[] {
  const clean = puzzles.filter(isGeneratedPuzzle);
  const batches = loadBatches().filter(batch => batch.id !== id);
  const next = clean.length ? [{ id, createdAt: Date.now(), puzzles: clean }, ...batches] : batches;
  const kept: GeneratedBatch[] = [];
  let total = 0;
  for (const batch of next) {
    if (total >= HISTORY_LIMIT) break;
    const room = HISTORY_LIMIT - total;
    if (batch.puzzles.length > room) { kept.push({ ...batch, puzzles: batch.puzzles.slice(0, room) }); total = HISTORY_LIMIT; break; }
    kept.push(batch);
    total += batch.puzzles.length;
  }
  persist(kept);
  return kept;
}

/** 最近一次生成的那一批（重进页面默认展示它）。 */
export function lastBatch(): GeneratedBatch | null { return loadBatches()[0] || null; }

export function historyPuzzles(batches: GeneratedBatch[] = loadBatches()): GeneratedPuzzle[] {
  return batches.flatMap(batch => batch.puzzles).slice(0, HISTORY_LIMIT);
}

export function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* 清不掉也不该抛给用户 */ }
}
