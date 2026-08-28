import { createDocument, parseCoordinate } from "./game";
import type { GameDocument, Player, Position, RecordNode } from "./types";

export interface PuzzleStone extends Position { player: Player }
export interface Puzzle {
  id: string;
  title: string;
  prompt: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  stones: PuzzleStone[];
  player: Player;
}
export interface PuzzleCollection {
  id: string;
  title: string;
  source: string;
  license: string;
  puzzles: Puzzle[];
}

const NATIVE_KAIBAO_SETS = [
  "三手胜1-入门题", "三手胜2-初级题", "三手胜3-中级题", "三手胜4-高级题",
  "坂田吾朗追诘胜-白先", "坂田吾朗追诘胜-黑先", "天狗道场2020-白先", "天狗道场2020-黑先",
] as const;

const stone = (coord: string, player: Player): PuzzleStone => {
  const position = parseCoordinate(coord);
  if (!position) throw new Error(`无效坐标：${coord}`);
  return { ...position, player };
};

/** Original fixtures, intentionally not copied from the APK's unlicensed sets. */
export const builtinPuzzleCollections: PuzzleCollection[] = [{
  id: "original-tactics",
  title: "原创攻防体验",
  source: "半步五子棋内置示例",
  license: "项目自有",
  puzzles: [
    { id: "finish-five", title: "一手成五", prompt: "黑先，找到立即取胜的一手", difficulty: 1, player: "black", stones: [stone("F8", "black"), stone("G8", "black"), stone("H8", "black"), stone("I8", "black"), stone("H9", "white"), stone("H7", "white")] },
    { id: "stop-four", title: "先防后攻", prompt: "白先，先化解黑方的直接威胁", difficulty: 2, player: "white", stones: [stone("G8", "black"), stone("H8", "black"), stone("I8", "black"), stone("H9", "white"), stone("I9", "white"), stone("G7", "black")] },
    { id: "cross-attack", title: "中央争夺", prompt: "黑先，在中央制造连续威胁", difficulty: 3, player: "black", stones: [stone("H8", "black"), stone("G8", "black"), stone("H9", "black"), stone("I9", "white"), stone("G9", "white"), stone("I7", "white")] },
  ],
}];

const COLLECTIONS_KEY = "renju-note-puzzle-collections-v1";
const PROGRESS_KEY = "renju-note-puzzle-progress-v1";
const TITLE_OVERRIDES_KEY = "renju-note-puzzle-title-overrides-v1";
interface PuzzleTitleOverrides { collections: Record<string, string>; puzzles: Record<string, string> }
export type PuzzleProgress = Record<string, { solved: boolean; attempts: number; updatedAt: string }>;
export const puzzleProgressKey = (collectionId: string, puzzleId: string) => `${collectionId}/${puzzleId}`;

const loadTitleOverrides = (): PuzzleTitleOverrides => {
  try {
    const value = JSON.parse(localStorage.getItem(TITLE_OVERRIDES_KEY) || "null") as Partial<PuzzleTitleOverrides> | null;
    return { collections: value?.collections || {}, puzzles: value?.puzzles || {} };
  } catch { return { collections: {}, puzzles: {} }; }
};

const applyTitleOverrides = (collections: PuzzleCollection[]) => {
  const overrides = loadTitleOverrides();
  return collections.map((collection) => ({
    ...collection,
    title: overrides.collections[collection.id] || collection.title,
    puzzles: collection.puzzles.map((puzzle) => ({ ...puzzle, title: overrides.puzzles[puzzleProgressKey(collection.id, puzzle.id)] || puzzle.title })),
  }));
};

export function savePuzzleTitleOverride(collectionId: string, title: string, puzzleId?: string) {
  const normalized = title.trim();
  if (!normalized) throw new Error(puzzleId ? "题目名称不能为空" : "题集名称不能为空");
  const overrides = loadTitleOverrides();
  if (puzzleId) overrides.puzzles[puzzleProgressKey(collectionId, puzzleId)] = normalized;
  else overrides.collections[collectionId] = normalized;
  localStorage.setItem(TITLE_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function loadPuzzleCollections(): PuzzleCollection[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLECTIONS_KEY) || "[]") as unknown;
    const custom = Array.isArray(raw) ? raw.filter((item): item is PuzzleCollection => !!item && typeof item === "object" && Array.isArray((item as PuzzleCollection).puzzles)) : [];
    return applyTitleOverrides([...builtinPuzzleCollections, ...custom.filter((item) => !builtinPuzzleCollections.some((builtin) => builtin.id === item.id))]);
  } catch { return applyTitleOverrides(builtinPuzzleCollections); }
}

export function savePuzzleCollections(collections: PuzzleCollection[]) {
  const custom = collections.filter((item) => !builtinPuzzleCollections.some((builtin) => builtin.id === item.id) && !item.id.startsWith("native-kaibao-"));
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(custom));
}

export function loadPuzzleProgress(): PuzzleProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as PuzzleProgress : {};
  } catch { return {}; }
}

export function savePuzzleProgress(progress: PuzzleProgress) { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }

const makeNodeId = (puzzleId: string, index: number) => `puzzle-${puzzleId}-${index}`;

export function createPuzzleDocument(puzzle: Puzzle): { document: GameDocument; initialNodeId: string; initialDepth: number } {
  const document = createDocument(puzzle.title);
  const rootId = document.rootId;
  const nodes: Record<string, RecordNode> = { [rootId]: document.nodes[rootId] };
  let parentId = rootId;
  puzzle.stones.forEach((item, index) => {
    const id = makeNodeId(puzzle.id, index);
    nodes[parentId] = { ...nodes[parentId], children: [id], preferredChildId: id };
    nodes[id] = { id, parentId, children: [], move: { row: item.row, col: item.col, player: item.player }, comment: "", marks: [] };
    parentId = id;
  });
  return {
    document: {
      ...document,
      id: `puzzle-session-${puzzle.id}`,
      nodes,
      metadata: { ...document.metadata, title: puzzle.title, black: puzzle.player === "black" ? "你" : "陪练", white: puzzle.player === "white" ? "你" : "陪练", tags: ["做题"] },
    },
    initialNodeId: parentId,
    initialDepth: puzzle.stones.length,
  };
}

export interface PuzzleImportReport { collection: PuzzleCollection; skipped: number; warnings: string[] }

/** Import the compact JSON used by 开宝: one problem is an array of "J10,1" strings. */
export function importKaibaoPuzzleJson(text: string, title = "导入题集", metadata?: Partial<Pick<PuzzleCollection, "id" | "source" | "license">>): PuzzleImportReport {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("题库顶层必须是数组");
  const warnings: string[] = [];
  let skipped = 0;
  const puzzles: Puzzle[] = [];
  raw.forEach((entry, entryIndex) => {
    if (!Array.isArray(entry) || !entry.length) { skipped += 1; return; }
    let stars = 0;
    const stones: PuzzleStone[] = [];
    for (const value of entry) {
      if (typeof value !== "string") { warnings.push(`第 ${entryIndex + 1} 题含非文本项`); continue; }
      if (!value.includes(",")) { stars = Math.max(stars, [...value].filter((char) => char === "★").length); continue; }
      const [coord, color] = value.split(",");
      const position = parseCoordinate(coord);
      if (!position || (color !== "1" && color !== "2")) { warnings.push(`第 ${entryIndex + 1} 题忽略无效项 ${value}`); continue; }
      if (stones.some((item) => item.row === position.row && item.col === position.col)) { warnings.push(`第 ${entryIndex + 1} 题坐标 ${coord} 重复`); continue; }
      stones.push({ ...position, player: color === "1" ? "black" : "white" });
    }
    if (!stones.length) { skipped += 1; return; }
    // 开宝 itself derives the side to move from total setup-stone parity.
    const player: Player = stones.length % 2 === 0 ? "black" : "white";
    puzzles.push({ id: `imported-${entryIndex + 1}`, title: `第 ${entryIndex + 1} 题`, prompt: `${player === "black" ? "黑" : "白"}先，击败陪练`, difficulty: Math.min(5, Math.max(1, stars || 2)) as Puzzle["difficulty"], stones, player });
  });
  if (!puzzles.length) throw new Error("没有找到可用题目");
  return { collection: { id: metadata?.id || `imported-${Date.now()}`, title, source: metadata?.source || "用户导入", license: metadata?.license || "由用户确认使用权", puzzles }, skipped, warnings };
}

export async function loadNativeKaibaoCollections(): Promise<PuzzleCollection[]> {
  const collections = await Promise.all(NATIVE_KAIBAO_SETS.map(async (title, index) => {
    const response = await fetch(`/puzzles/kaibao/${title}.json`);
    if (!response.ok) throw new Error(`题集加载失败：${title}`);
    return importKaibaoPuzzleJson(await response.text(), title, {
      id: `native-kaibao-${index + 1}`,
      source: "开宝五子棋 1.5.1",
      license: "用户提供 APK · 本地使用",
    }).collection;
  }));
  return applyTitleOverrides(collections);
}
