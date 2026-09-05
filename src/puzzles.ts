import { createDocument, isSupportedBoardSize, parseCoordinate } from "./game";
import { parsePuzzleRule } from "./features/puzzles/puzzle-rules";
import type { GameDocument, Player, Position, RecordNode, RuleSet } from "./types";

export interface PuzzleStone extends Position { player: Player }
export interface Puzzle {
  id: string;
  title: string;
  prompt: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  stones: PuzzleStone[];
  player: Player;
  /** Native puzzle JSON may carry a board size; old compact sets default to 15. */
  boardSize?: number;
  /** Explicit puzzle rules override the user's general doing-puzzle preference. */
  rule?: RuleSet;
}
export interface PuzzleCollection {
  id: string;
  title: string;
  source: string;
  license: string;
  puzzles: Puzzle[];
  /** Optional collection-wide rule used only when an individual puzzle omits it. */
  rule?: RuleSet;
}

const NATIVE_KAIBAO_SETS = [
  "三手胜1-入门题", "三手胜2-初级题", "三手胜3-中级题", "三手胜4-高级题",
  "坂田吾朗追诘胜-白先", "坂田吾朗追诘胜-黑先", "天狗道场2020-白先", "天狗道场2020-黑先",
  "白先胜100题_puzzle", "白先VCF_puzzle", "棋谱控超级题", "棋谱控高级题", "日本段级位测试题",
  "实战VCF_1052题", "五子棋发阳论残本1.4", "五子棋九段感觉-习题", "RenjuPortalVCF",
] as const;

const COLLECTIONS_KEY = "renju-note-puzzle-collections-v1";
const PROGRESS_KEY = "renju-note-puzzle-progress-v1";
const TITLE_OVERRIDES_KEY = "renju-note-puzzle-title-overrides-v1";
const REMOVED_BUILTIN_COLLECTION_IDS = new Set(["original-tactics"]);
const builtinPuzzleCollections: PuzzleCollection[] = [];
interface PuzzleTitleOverrides { collections: Record<string, string>; puzzles: Record<string, string> }
export type PuzzleProgress = Record<string, { solved: boolean; attempts: number; updatedAt: string }>;
export const puzzleProgressKey = (collectionId: string, puzzleId: string) => `${collectionId}/${puzzleId}`;

export interface PuzzleReviewEntry {
  collectionId: string;
  collectionIndex: number;
  collectionTitle: string;
  puzzleId: string;
  puzzleIndex: number;
  puzzleTitle: string;
  attempts: number;
  updatedAt: string;
  solved: boolean;
}

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
    return applyTitleOverrides([...builtinPuzzleCollections, ...custom.filter((item) => !REMOVED_BUILTIN_COLLECTION_IDS.has(item.id) && !builtinPuzzleCollections.some((builtin) => builtin.id === item.id))]);
  } catch { return applyTitleOverrides(builtinPuzzleCollections); }
}

export function savePuzzleCollections(collections: PuzzleCollection[]) {
  const custom = collections.filter((item) => !REMOVED_BUILTIN_COLLECTION_IDS.has(item.id) && !builtinPuzzleCollections.some((builtin) => builtin.id === item.id) && !item.id.startsWith("native-kaibao-"));
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(custom));
}

export function loadPuzzleProgress(): PuzzleProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as PuzzleProgress : {};
  } catch { return {}; }
}

export function savePuzzleProgress(progress: PuzzleProgress) { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }

export function deriveWrongPuzzleEntries(collections: PuzzleCollection[], progress: PuzzleProgress): PuzzleReviewEntry[] {
  return collections.flatMap((collection, collectionIndex) => collection.puzzles.flatMap((puzzle, puzzleIndex) => {
    const entry = progress[puzzleProgressKey(collection.id, puzzle.id)];
    if (!entry || entry.solved || (entry.attempts || 0) <= 0) return [];
    return [{
      collectionId: collection.id,
      collectionIndex,
      collectionTitle: collection.title,
      puzzleId: puzzle.id,
      puzzleIndex,
      puzzleTitle: puzzle.title,
      attempts: entry.attempts,
      updatedAt: entry.updatedAt,
      solved: entry.solved,
    }];
  })).sort((a, b) => {
    const timeDelta = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    if (timeDelta) return timeDelta;
    if (b.attempts !== a.attempts) return b.attempts - a.attempts;
    if (a.collectionTitle !== b.collectionTitle) return a.collectionTitle.localeCompare(b.collectionTitle, "zh-Hans-CN");
    return a.puzzleIndex - b.puzzleIndex;
  });
}

const makeNodeId = (puzzleId: string, index: number) => `puzzle-${puzzleId}-${index}`;

export function createPuzzleDocument(puzzle: Puzzle, rule: RuleSet = puzzle.rule || "freestyle"): { document: GameDocument; initialNodeId: string; initialDepth: number } {
  const document = createDocument(puzzle.title, puzzle.boardSize || 15);
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
      metadata: { ...document.metadata, title: puzzle.title, black: puzzle.player === "black" ? "你" : "陪练", white: puzzle.player === "white" ? "你" : "陪练", rule, tags: ["做题"] },
    },
    initialNodeId: parentId,
    initialDepth: puzzle.stones.length,
  };
}

export interface PuzzleImportReport { collection: PuzzleCollection; skipped: number; warnings: string[] }

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const textValue = (value: unknown) => typeof value === "string" ? value.trim() : "";
const coordinateText = (position: Position) => String.fromCharCode(65 + position.col) + position.row;

const parseNativeCoordinateSequence = (value: unknown, size: number): { positions: Position[]; invalid: string[] } => {
  const source = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(" ") : typeof value === "string" ? value : "";
  const positions: Position[] = [];
  const invalid: string[] = [];
  const pattern = /([A-Za-z])(\d{1,2})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const separator = source.slice(lastIndex, match.index);
    if (separator && !/^[,;\s|]+$/.test(separator)) invalid.push(separator);
    const coordinate = match[1].toUpperCase() + match[2];
    const position = parseCoordinate(coordinate, size);
    if (position) positions.push(position);
    else invalid.push(coordinate);
    lastIndex = pattern.lastIndex;
  }
  const trailing = source.slice(lastIndex);
  if (trailing && !/^[,;\s|]+$/.test(trailing)) invalid.push(trailing);
  if (!source.trim() || !positions.length) invalid.push(source || "空坐标");
  return { positions, invalid };
};

const addPuzzleStone = (stones: PuzzleStone[], position: Position, player: Player, warnings: string[], context: string) => {
  const existing = stones.find((item) => item.row === position.row && item.col === position.col);
  if (existing) {
    warnings.push(context + "坐标 " + coordinateText(position) + " 重复" + (existing.player === player ? "" : "（黑白颜色冲突，保留先读到的颜色）"));
    return;
  }
  stones.push({ ...position, player });
};

const parseCompactPuzzleEntry = (entry: unknown[], entryIndex: number, warnings: string[]): { stones: PuzzleStone[]; stars: number } => {
  let stars = 0;
  const stones: PuzzleStone[] = [];
  for (const value of entry) {
    if (typeof value !== "string") { warnings.push("第 " + (entryIndex + 1) + " 题含非文本项"); continue; }
    if (!value.includes(",")) { stars = Math.max(stars, [...value].filter((char) => char === "★").length); continue; }
    const [coord, color] = value.split(",").map((item) => item.trim());
    const position = parseCoordinate(coord);
    if (!position || (color !== "1" && color !== "2")) { warnings.push("第 " + (entryIndex + 1) + " 题忽略无效项 " + value); continue; }
    addPuzzleStone(stones, position, color === "1" ? "black" : "white", warnings, "第 " + (entryIndex + 1) + " 题");
  }
  return { stones, stars };
};

const nativeSide = (value: unknown, fallback: Player): Player => {
  if (value === 1 || value === "1" || value === "black") return "black";
  if (value === 2 || value === "2" || value === "white") return "white";
  return fallback;
};

const nativeDifficulty = (value: unknown, fallback: number): Puzzle["difficulty"] => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Math.min(5, Math.max(1, Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback)) as Puzzle["difficulty"];
};

const nativeSize = (value: unknown, warnings: string[], entryIndex: number) => {
  const size = value === undefined ? 15 : Number(value);
  if (!isSupportedBoardSize(size)) {
    warnings.push("第 " + (entryIndex + 1) + " 题棋盘尺寸 " + String(value) + " 不受支持，已按 15 路读取");
    return 15;
  }
  return size;
};

const parseNativeColoredStones = (value: unknown, player: Player, size: number) => {
  const parsed = parseNativeCoordinateSequence(value, size);
  return { stones: parsed.positions.map((position) => ({ ...position, player })), invalid: parsed.invalid };
};

const parseNativeObjectEntry = (entry: JsonObject, entryIndex: number, warnings: string[]) => {
  const size = nativeSize(entry.size, warnings, entryIndex);
  const stones: PuzzleStone[] = [];
  const blackRaw = entry.blackStones ?? entry.black ?? entry.black_stones;
  const whiteRaw = entry.whiteStones ?? entry.white ?? entry.white_stones;
  const hasSplitColors = blackRaw !== undefined || whiteRaw !== undefined;
  if (hasSplitColors) {
    for (const [raw, player, name] of [[blackRaw, "black", "黑棋"], [whiteRaw, "white", "白棋"]] as const) {
      if (raw === undefined || raw === null || raw === "") continue;
      const parsed = parseNativeColoredStones(raw, player, size);
      parsed.stones.forEach((item) => addPuzzleStone(stones, item, player, warnings, "第 " + (entryIndex + 1) + " 题" + name));
      parsed.invalid.forEach((item) => warnings.push("第 " + (entryIndex + 1) + " 题" + name + "忽略无效坐标 " + item));
    }
  } else if (entry.stones !== undefined) {
    const raw = entry.stones;
    const values = Array.isArray(raw) ? raw : [raw];
    let sequenceIndex = 0;
    for (const value of values) {
      if (typeof value !== "string") { warnings.push("第 " + (entryIndex + 1) + " 题含非文本棋子序列"); continue; }
      const colored = value.match(/^\s*([A-Za-z]\d{1,2})\s*,\s*([12])\s*$/);
      if (colored) {
        const position = parseCoordinate(colored[1], size);
        if (position) addPuzzleStone(stones, position, colored[2] === "1" ? "black" : "white", warnings, "第 " + (entryIndex + 1) + " 题");
        else warnings.push("第 " + (entryIndex + 1) + " 题忽略无效坐标 " + colored[1]);
        sequenceIndex += 1;
        continue;
      }
      const parsed = parseNativeCoordinateSequence(value, size);
      parsed.positions.forEach((position) => {
        const player: Player = sequenceIndex % 2 === 0 ? "black" : "white";
        addPuzzleStone(stones, position, player, warnings, "第 " + (entryIndex + 1) + " 题");
        sequenceIndex += 1;
      });
      parsed.invalid.forEach((item) => warnings.push("第 " + (entryIndex + 1) + " 题忽略无效坐标 " + item));
    }
  }
  const fallbackPlayer: Player = stones.length % 2 === 0 ? "black" : "white";
  const player = nativeSide(entry.side, fallbackPlayer);
  const comment = textValue(entry.comment) || textValue(entry.prompt);
  const stars = typeof entry.stars === "number" ? entry.stars : 0;
  const difficulty = nativeDifficulty(entry.level ?? entry.difficulty, Math.min(5, Math.max(1, stars || 2)));
  const rule = parsePuzzleRule(entry.rule ?? entry.rules ?? entry.forbiddenEnabled ?? entry.forbidden);
  return { stones, player, difficulty, size, comment, rule };
};
const importNativePuzzleObject = (raw: JsonObject, title: string, metadata?: Partial<Pick<PuzzleCollection, "id" | "source" | "license">>): PuzzleImportReport => {
  if (!Array.isArray(raw.puzzles)) {
    if ("Board" in raw || "fullscreenUI" in raw || "Button" in raw) {
      throw new Error("这个 JSON 是摆棋小工具主题配置，不是题库文件；请选择包含 puzzles 的题库 JSON");
    }
    throw new Error("题库 JSON 顶层需要题目数组，或包含 puzzles 数组的题库对象");
  }
  const warnings: string[] = [];
  let skipped = 0;
  const puzzles: Puzzle[] = [];
  raw.puzzles.forEach((entry, entryIndex) => {
    if (Array.isArray(entry)) {
      if (!entry.length) { skipped += 1; return; }
      const compact = parseCompactPuzzleEntry(entry, entryIndex, warnings);
      if (!compact.stones.length) { skipped += 1; return; }
      const player: Player = compact.stones.length % 2 === 0 ? "black" : "white";
      puzzles.push({ id: "imported-" + (entryIndex + 1), title: "第 " + (entryIndex + 1) + " 题", prompt: (player === "black" ? "黑" : "白") + "先，击败陪练", difficulty: Math.min(5, Math.max(1, compact.stars || 2)) as Puzzle["difficulty"], stones: compact.stones, player });
      return;
    }
    if (!isJsonObject(entry)) { skipped += 1; warnings.push("第 " + (entryIndex + 1) + " 题不是可识别的题目对象"); return; }
    const parsed = parseNativeObjectEntry(entry, entryIndex, warnings);
    if (!parsed.stones.length) { skipped += 1; return; }
    const prompt = parsed.comment || ((parsed.player === "black" ? "黑" : "白") + "先，击败陪练");
    puzzles.push({ id: "imported-" + (entryIndex + 1), title: textValue(entry.title) || ("第 " + (entryIndex + 1) + " 题"), prompt, difficulty: parsed.difficulty, stones: parsed.stones, player: parsed.player, boardSize: parsed.size, ...(parsed.rule ? { rule: parsed.rule } : {}) });
  });
  if (!puzzles.length) throw new Error("没有找到可用题目");
  const defaultSettings = isJsonObject(raw.defaultSettings) ? raw.defaultSettings : undefined;
  const settings = defaultSettings ? textValue(defaultSettings.title) : "";
  const collectionRule = parsePuzzleRule(raw.rule ?? raw.rules ?? raw.forbiddenEnabled ?? raw.forbidden ?? defaultSettings?.rule ?? defaultSettings?.forbiddenEnabled ?? defaultSettings?.forbidden);
  const collectionTitle = title === "导入题集" && settings ? settings : title;
  return {
    collection: {
      id: metadata?.id || "imported-" + Date.now(),
      title: collectionTitle,
      source: metadata?.source || textValue(raw.link) || "用户导入",
      license: metadata?.license || "由用户确认使用权",
      puzzles,
      ...(collectionRule ? { rule: collectionRule } : {}),
    },
    skipped,
    warnings,
  };
};

/** Detect puzzle JSON before the general record importer treats it as a move list. */
export function isPuzzleJsonText(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return Array.isArray(raw)
      ? raw.some((entry) => Array.isArray(entry))
      : isJsonObject(raw) && Array.isArray(raw.puzzles);
  } catch {
    return false;
  }
}

export function importKaibaoPuzzleJson(text: string, title = "导入题集", metadata?: Partial<Pick<PuzzleCollection, "id" | "source" | "license">>): PuzzleImportReport {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) {
    if (isJsonObject(raw)) return importNativePuzzleObject(raw, title, metadata);
    throw new Error("题库 JSON 顶层需要题目数组，或包含 puzzles 数组的题库对象");
  }
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
