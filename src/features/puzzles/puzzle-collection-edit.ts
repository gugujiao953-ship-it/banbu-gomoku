/**
 * 题库覆盖层与题集编辑（用户 2026-09-21）。
 *
 * 三件事各占一个独立的 localStorage 槽位，**都不改既有存档结构**：
 *  - overlays：每题一层覆盖（已掌握标记、真实尝试次数、最近结果与用时）；
 *    「已掌握」刻意与 `progress.solved` 分开——solved 是「真的做出来了」，
 *    mastered 是「用户说不用再练了」，两件事不该共用一个字段（解出后错题本
 *    本来就会自动收起，mastered 是给「不想再练但也确实没解出」的题目用的）。
 *  - hidden collections：隐藏的题集 id。内置题库历来不可删，所以隐藏是它唯一
 *    的退出方式；自建题集也能隐藏，规则统一，减少一条分支。
 *  - review queue：错题本「重做一遍」的队列。2026-09-19 用户明确否掉了错题
 *    排期与打卡（见 daily-training.ts 顶部注释），所以这里只有「排过队」这一个
 *    状态，不存到期时间、不做间隔重复。
 *
 * 存储键统一用 `banbu-` 前缀（与 banbu-daily-training-v1 一致），不用老的
 * `renju-note-` 前缀——那批键名是历史包袱，新的不再跟着走。
 */
import type { Player, RuleSet } from "../../types";
import { puzzleProgressKey, type Puzzle, type PuzzleCollection, type PuzzleProgress } from "../../puzzles";

export const PUZZLE_OVERLAYS_KEY = "banbu-puzzle-overlays-v1";
export const PUZZLE_HIDDEN_COLLECTIONS_KEY = "banbu-puzzle-hidden-collections-v1";
export const PUZZLE_REVIEW_KEY = "banbu-puzzle-review-v1";

export type PuzzleLastResult = "won" | "lost" | "stopped";

export interface PuzzleOverlay {
  /** 用户手动标记「已掌握」：从错题本收起，但不改动 solved。 */
  mastered?: true;
  /** 真实尝试次数：打开一题即 +1（含中途放弃），与 progress.attempts（完局次数）不同。 */
  attemptCount?: number;
  lastResult?: PuzzleLastResult;
  lastPlayedAt?: string;
  lastDurationMs?: number;
}

export type PuzzleOverlays = Record<string, PuzzleOverlay>;

export interface PuzzleReviewQueue {
  version: 1;
  items: { key: string; queuedAt: string }[];
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null") as unknown;
    return raw === null || raw === undefined ? fallback : raw as T;
  } catch {
    return fallback;
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 只保留认识的字段：存档里混进别的键不会污染类型，也不会被原样写回。 */
const sanitizeOverlay = (value: unknown): PuzzleOverlay | null => {
  if (!isPlainObject(value)) return null;
  const overlay: PuzzleOverlay = {};
  if (value.mastered === true) overlay.mastered = true;
  if (typeof value.attemptCount === "number" && Number.isFinite(value.attemptCount) && value.attemptCount > 0) overlay.attemptCount = Math.floor(value.attemptCount);
  if (value.lastResult === "won" || value.lastResult === "lost" || value.lastResult === "stopped") overlay.lastResult = value.lastResult;
  if (typeof value.lastPlayedAt === "string" && value.lastPlayedAt) overlay.lastPlayedAt = value.lastPlayedAt;
  if (typeof value.lastDurationMs === "number" && Number.isFinite(value.lastDurationMs) && value.lastDurationMs > 0) overlay.lastDurationMs = Math.round(value.lastDurationMs);
  return Object.keys(overlay).length ? overlay : null;
};

export function loadPuzzleOverlays(): PuzzleOverlays {
  const raw = readJson<unknown>(PUZZLE_OVERLAYS_KEY, null);
  if (!isPlainObject(raw)) return {};
  const overlays: PuzzleOverlays = {};
  for (const [key, value] of Object.entries(raw)) {
    const overlay = sanitizeOverlay(value);
    if (overlay) overlays[key] = overlay;
  }
  return overlays;
}

export function savePuzzleOverlays(overlays: PuzzleOverlays): void {
  try { localStorage.setItem(PUZZLE_OVERLAYS_KEY, JSON.stringify(overlays)); } catch { /* 存储满/隐私模式：退化为本次会话可用 */ }
}

/**
 * 写一题的覆盖层；传 null 清空该题，空对象不留下垃圾键。
 *
 * `mastered` 在这里是三态：`true` 置标记、`false` 清除标记、不传则保持原样
 * （合并补丁时只改 lastResult 之类不该顺手抹掉「已掌握」）。所以补丁类型写成
 * `boolean` 而不是接口里的 `true`——接口描述的是**存下来的形态**，补丁描述的是**意图**。
 */
export type PuzzleOverlayPatch = Omit<Partial<PuzzleOverlay>, "mastered"> & { mastered?: boolean };

export function updatePuzzleOverlay(
  overlays: PuzzleOverlays,
  collectionId: string,
  puzzleId: string,
  patch: PuzzleOverlayPatch | null,
): PuzzleOverlays {
  const key = puzzleProgressKey(collectionId, puzzleId);
  const next = { ...overlays };
  const previous = next[key];
  if (patch === null) { delete next[key]; return next; }
  const { mastered: masteredIntent, ...rest } = patch;
  const merged: PuzzleOverlay = { ...(previous || {}), ...rest };
  delete merged.mastered;
  const mastered = masteredIntent === true ? true : masteredIntent === false ? false : previous?.mastered === true;
  const sanitized = sanitizeOverlay(mastered ? { ...merged, mastered: true } : merged);
  if (sanitized) next[key] = sanitized; else delete next[key];
  return next;
}

export function loadHiddenPuzzleCollections(): string[] {
  const raw = readJson<unknown>(PUZZLE_HIDDEN_COLLECTIONS_KEY, []);
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

export function saveHiddenPuzzleCollections(ids: string[]): void {
  try { localStorage.setItem(PUZZLE_HIDDEN_COLLECTIONS_KEY, JSON.stringify(ids)); } catch { /* 同上 */ }
}

export const emptyPuzzleReviewQueue = (): PuzzleReviewQueue => ({ version: 1, items: [] });

export function loadPuzzleReviewQueue(): PuzzleReviewQueue {
  const raw = readJson<unknown>(PUZZLE_REVIEW_KEY, null);
  if (!isPlainObject(raw) || !Array.isArray(raw.items)) return emptyPuzzleReviewQueue();
  const items: PuzzleReviewQueue["items"] = [];
  const seen = new Set<string>();
  for (const item of raw.items) {
    if (!isPlainObject(item) || typeof item.key !== "string" || !item.key || seen.has(item.key)) continue;
    seen.add(item.key);
    items.push({ key: item.key, queuedAt: typeof item.queuedAt === "string" ? item.queuedAt : "" });
  }
  return { version: 1, items };
}

export function savePuzzleReviewQueue(queue: PuzzleReviewQueue): void {
  try { localStorage.setItem(PUZZLE_REVIEW_KEY, JSON.stringify(queue)); } catch { /* 同上 */ }
}

/** 入队（已在队里则只更新时间，不重复）。 */
export function enqueuePuzzleReview(queue: PuzzleReviewQueue, collectionId: string, puzzleId: string, at: string): PuzzleReviewQueue {
  const key = puzzleProgressKey(collectionId, puzzleId);
  const rest = queue.items.filter((item) => item.key !== key);
  return { ...queue, items: [...rest, { key, queuedAt: at }] };
}

export function dequeuePuzzleReview(queue: PuzzleReviewQueue, collectionId: string, puzzleId: string): PuzzleReviewQueue {
  const key = puzzleProgressKey(collectionId, puzzleId);
  return { ...queue, items: queue.items.filter((item) => item.key !== key) };
}

export function isPuzzleQueued(queue: PuzzleReviewQueue, collectionId: string, puzzleId: string): boolean {
  const key = puzzleProgressKey(collectionId, puzzleId);
  return queue.items.some((item) => item.key === key);
}

/** 掌握状态三态（外加 solved 这一终态）。untried 与 wrong 的区分沿用「有无完局记录」这一既有口径。 */
export type PuzzleMastery = "solved" | "mastered" | "wrong" | "untried";

export interface PuzzleStats {
  solved: boolean;
  /** 完局次数（progress.attempts，错题本排序与显示都用它）。 */
  completions: number;
  /** 真实尝试次数（overlay.attemptCount，含中途放弃）。旧存档没有就回落到 completions。 */
  attempts: number;
  lastResult?: PuzzleLastResult;
  lastPlayedAt?: string;
  lastDurationMs?: number;
  mastery: PuzzleMastery;
}

export function derivePuzzleStats(
  collectionId: string,
  puzzleId: string,
  progress: PuzzleProgress,
  overlays: PuzzleOverlays,
): PuzzleStats {
  const key = puzzleProgressKey(collectionId, puzzleId);
  const entry = progress[key];
  const overlay = overlays[key];
  const solved = entry?.solved === true;
  const completions = Math.max(0, entry?.attempts || 0);
  const attempts = Math.max(overlay?.attemptCount || 0, completions);
  const mastery: PuzzleMastery = solved ? "solved" : overlay?.mastered === true ? "mastered" : completions > 0 ? "wrong" : "untried";
  return {
    solved,
    completions,
    attempts,
    ...(overlay?.lastResult ? { lastResult: overlay.lastResult } : {}),
    ...(overlay?.lastPlayedAt ? { lastPlayedAt: overlay.lastPlayedAt } : {}),
    ...(overlay?.lastDurationMs ? { lastDurationMs: overlay.lastDurationMs } : {}),
    mastery,
  };
}

/** 某个题集的汇总：管理区表头用它显示正确率与平均用时。 */
export interface PuzzleCollectionSummary {
  total: number;
  solved: number;
  /** 有过完局的题数（正确率分母：只算真的做过的，没做过的不该拉低正确率）。 */
  attempted: number;
  /** 有完局记录的平均每局用时（毫秒）；没有记录时为 0。 */
  averageDurationMs: number;
}

export function summarizeCollection(
  collection: PuzzleCollection,
  progress: PuzzleProgress,
  overlays: PuzzleOverlays,
): PuzzleCollectionSummary {
  let solved = 0, attempted = 0, durationSum = 0, durationCount = 0;
  for (const puzzle of collection.puzzles) {
    const stats = derivePuzzleStats(collection.id, puzzle.id, progress, overlays);
    if (stats.solved) solved += 1;
    if (stats.completions > 0) attempted += 1;
    if (stats.lastDurationMs) { durationSum += stats.lastDurationMs; durationCount += 1; }
  }
  return {
    total: collection.puzzles.length,
    solved,
    attempted,
    averageDurationMs: durationCount ? Math.round(durationSum / durationCount) : 0,
  };
}

// ---- 题集内的单题编辑（全部不可变，返回新题集） ------------------------------

/** 新增题目时生成的自定义题 id：题集内单调递增，不受删除影响（不会与已删题的 id 复用）。 */
export function nextPuzzleId(collection: PuzzleCollection): string {
  let max = 0;
  for (const puzzle of collection.puzzles) {
    const match = /^custom-(\d+)$/.exec(puzzle.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `custom-${max + 1}`;
}

export function removePuzzleFromCollection(collection: PuzzleCollection, puzzleId: string): PuzzleCollection {
  return { ...collection, puzzles: collection.puzzles.filter((puzzle) => puzzle.id !== puzzleId) };
}

export function addPuzzlesToCollection(collection: PuzzleCollection, puzzles: Puzzle[]): PuzzleCollection {
  return { ...collection, puzzles: [...collection.puzzles, ...puzzles] };
}

export type PuzzleEditPatch = Partial<Pick<Puzzle, "title" | "prompt" | "difficulty" | "player" | "rule" | "stones" | "boardSize">>;

export function updatePuzzleInCollection(collection: PuzzleCollection, puzzleId: string, patch: PuzzleEditPatch): PuzzleCollection {
  return {
    ...collection,
    puzzles: collection.puzzles.map((puzzle) => puzzle.id === puzzleId ? { ...puzzle, ...patch } : puzzle),
  };
}

/** 把一道题从一个题集移到另一个（题 id 不变 → 做题进度自动跟随）。 */
export function movePuzzleBetweenCollections(
  from: PuzzleCollection,
  to: PuzzleCollection,
  puzzleId: string,
): { from: PuzzleCollection; to: PuzzleCollection } {
  const puzzle = from.puzzles.find((item) => item.id === puzzleId);
  if (!puzzle) return { from, to };
  return { from: removePuzzleFromCollection(from, puzzleId), to: addPuzzlesToCollection(to, [puzzle]) };
}

// ---- 题集级：合并与拆分 -------------------------------------------------------

/** 局面指纹：先手 + 尺寸 + 规则 + 按坐标排序的子。用于合并去重。 */
export function puzzlePositionKey(puzzle: Puzzle): string {
  const stones = [...puzzle.stones]
    .sort((a, b) => a.row - b.row || a.col - b.col || a.player.localeCompare(b.player))
    .map((stone) => `${stone.player.charAt(0)}${stone.row},${stone.col}`)
    .join("|");
  return `${puzzle.player}|${puzzle.boardSize || 15}|${puzzle.rule || ""}|${stones}`;
}

/** 合并去重的判等：标题相同**且**局面相同才算同一道题（只同局面可能是同名变型，不强删）。 */
const isSamePuzzle = (a: Puzzle, b: Puzzle) => a.title.trim() === b.title.trim() && puzzlePositionKey(a) === puzzlePositionKey(b);

export interface MergeCollectionsInput {
  collections: PuzzleCollection[];
  ids: string[];
  /** 合并后的题集；id 由调用方生成，避免这里依赖 Date.now。 */
  result: Pick<PuzzleCollection, "id" | "title" | "source" | "license">;
  dedupe: boolean;
}

export interface MergeCollectionsResult {
  collections: PuzzleCollection[];
  /** 新建出来的合并题集（调用方据此设置文件夹归属）。 */
  merged: PuzzleCollection;
  removed: PuzzleCollection[];
  duplicateCount: number;
}

/**
 * 把若干题集合并成一个新题集，原题集从列表移除（调用方负责把 removed 交给撤销栈）。
 * 题 id 原样保留 → 进度与掌握标记自动跟随；去重时保留**排序在前**的那一份（进度也留前一份的）。
 */
export function mergeCollections(input: MergeCollectionsInput): MergeCollectionsResult {
  const picked: PuzzleCollection[] = [];
  for (const id of input.ids) {
    const collection = input.collections.find((item) => item.id === id);
    if (collection) picked.push(collection);
  }
  const puzzles: Puzzle[] = [];
  const seenKeys = new Set<string>();
  let duplicateCount = 0;
  for (const collection of picked) {
    for (const puzzle of collection.puzzles) {
      const key = `${puzzle.title.trim()}\u0000${puzzlePositionKey(puzzle)}`;
      if (input.dedupe && seenKeys.has(key)) { duplicateCount += 1; continue; }
      seenKeys.add(key);
      puzzles.push(puzzle);
    }
  }
  // 合并题集的规则：只在所有来源一致时继承，否则留给每道题自己（题目级 rule 优先级更高）。
  const ruleValues: RuleSet[] = [];
  for (const collection of picked) if (collection.rule && !ruleValues.includes(collection.rule)) ruleValues.push(collection.rule);
  const merged: PuzzleCollection = {
    ...input.result,
    puzzles,
    ...(ruleValues.length === 1 ? { rule: ruleValues[0] } : {}),
  };
  const removedIds = new Set(picked.map((collection) => collection.id));
  return {
    collections: [...input.collections.filter((collection) => !removedIds.has(collection.id)), merged],
    merged,
    removed: picked,
    duplicateCount,
  };
}

export interface SplitCollectionInput {
  collections: PuzzleCollection[];
  collectionId: string;
  /** 1 起的题号区间，含两端；越界自动夹到有效范围。 */
  from: number;
  to: number;
  /** 新题集；id 由调用方生成。 */
  result: Pick<PuzzleCollection, "id" | "title" | "source" | "license">;
}

export interface SplitCollectionResult {
  collections: PuzzleCollection[];
  /** 抽出来的新题集；区间内没有题时为 null（调用方给提示、不要落盘）。 */
  created: PuzzleCollection | null;
  before: PuzzleCollection | null;
}

/**
 * 按题号区间把题目抽到一个新题集：原题集题 id 不变，被抽走的题在新题集里也保持原 id
 * ——所以做题进度、掌握标记、重做队列全部自动跟随，不需要任何迁移。
 */
export function splitCollection(input: SplitCollectionInput): SplitCollectionResult {
  const index = input.collections.findIndex((collection) => collection.id === input.collectionId);
  if (index < 0) return { collections: input.collections, created: null, before: null };
  const collection = input.collections[index];
  const total = collection.puzzles.length;
  const from = Math.min(Math.max(1, Math.min(input.from, input.to)), total);
  const to = Math.min(Math.max(1, Math.max(input.from, input.to)), total);
  const taken = collection.puzzles.slice(from - 1, to);
  if (!taken.length) return { collections: input.collections, created: null, before: collection };
  const takenIds = new Set(taken.map((puzzle) => puzzle.id));
  const created: PuzzleCollection = {
    ...input.result,
    puzzles: taken,
    ...(collection.rule ? { rule: collection.rule } : {}),
  };
  const remaining: PuzzleCollection = { ...collection, puzzles: collection.puzzles.filter((puzzle) => !takenIds.has(puzzle.id)) };
  const next = [...input.collections];
  next[index] = remaining;
  next.push(created);
  return { collections: next, created, before: collection };
}

/** 删掉单题时同步清掉它的进度与覆盖层，避免存档里留下永远用不到的键。 */
export function prunePuzzleRecords(
  progress: PuzzleProgress,
  overlays: PuzzleOverlays,
  queue: PuzzleReviewQueue,
  collectionId: string,
  puzzleId: string,
): { progress: PuzzleProgress; overlays: PuzzleOverlays; queue: PuzzleReviewQueue } {
  const key = puzzleProgressKey(collectionId, puzzleId);
  const nextProgress = { ...progress };
  delete nextProgress[key];
  const nextOverlays = { ...overlays };
  delete nextOverlays[key];
  return { progress: nextProgress, overlays: nextOverlays, queue: { ...queue, items: queue.items.filter((item) => item.key !== key) } };
}

/** 重置做题进度：清完局记录与重做队列，**保留**掌握标记与隐藏题集（用户明确要求区分）。 */
export function resetPuzzleProgressState(overlays: PuzzleOverlays): { progress: PuzzleProgress; overlays: PuzzleOverlays; queue: PuzzleReviewQueue } {
  return { progress: {}, overlays, queue: emptyPuzzleReviewQueue() };
}

/** 从题目生成新题（「加题」与「存题」共用）。棋子由调用方从棋盘取，这里只管字段默认值。 */
export function createPuzzleFromBoard(input: {
  id: string;
  title: string;
  prompt: string;
  player: Player;
  stones: Puzzle["stones"];
  boardSize: number;
  rule?: RuleSet;
  difficulty?: Puzzle["difficulty"];
}): Puzzle {
  return {
    id: input.id,
    title: input.title,
    prompt: input.prompt,
    difficulty: input.difficulty ?? 3,
    stones: input.stones,
    player: input.player,
    boardSize: input.boardSize,
    ...(input.rule ? { rule: input.rule } : {}),
  };
}
