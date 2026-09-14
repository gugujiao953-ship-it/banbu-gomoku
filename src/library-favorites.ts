// 收藏体系：棋谱 / 题集 / 题目三级收藏，独立持久化。
// 被收藏的棋谱与题集在棋谱库列表顶部进入「收藏」文件夹（五角星图标、默认置顶）。

export interface LibraryFavorites {
  /** 普通棋谱与大型棋谱共用 id 空间（与 recordAssignments 一致）。 */
  records: string[];
  /** 题集 id（puzzle collection）。 */
  puzzleCollections: string[];
  /** 题目：collectionId -> puzzleId[]。 */
  puzzles: Record<string, string[]>;
}

export const FAVORITES_KEY = "banbu-library-favorites-v1";

export const emptyFavorites = (): LibraryFavorites => ({ records: [], puzzleCollections: [], puzzles: {} });

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

export const loadFavorites = (): LibraryFavorites => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return emptyFavorites();
    const value = JSON.parse(raw) as Partial<LibraryFavorites>;
    const puzzles = value.puzzles && typeof value.puzzles === "object" && !Array.isArray(value.puzzles)
      ? Object.fromEntries(Object.entries(value.puzzles as Record<string, unknown>).filter(([, ids]) => isStringArray(ids)).map(([key, ids]) => [key, ids as string[]]))
      : {};
    return {
      records: isStringArray(value.records) ? value.records : [],
      puzzleCollections: isStringArray(value.puzzleCollections) ? value.puzzleCollections : [],
      puzzles,
    };
  } catch {
    return emptyFavorites();
  }
};

export const saveFavorites = (favorites: LibraryFavorites) => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // 存储满或不可用时静默失败，不影响主流程。
  }
};

export const isRecordFavorite = (favorites: LibraryFavorites, id: string) => favorites.records.includes(id);
export const isCollectionFavorite = (favorites: LibraryFavorites, id: string) => favorites.puzzleCollections.includes(id);
export const isPuzzleFavorite = (favorites: LibraryFavorites, collectionId: string, puzzleId: string) => Boolean(favorites.puzzles[collectionId]?.includes(puzzleId));

const toggleIn = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);

export const toggleRecordFavorite = (favorites: LibraryFavorites, id: string): LibraryFavorites => ({ ...favorites, records: toggleIn(favorites.records, id) });

export const toggleCollectionFavorite = (favorites: LibraryFavorites, id: string): LibraryFavorites => ({ ...favorites, puzzleCollections: toggleIn(favorites.puzzleCollections, id) });

export const togglePuzzleFavorite = (favorites: LibraryFavorites, collectionId: string, puzzleId: string): LibraryFavorites => {
  const current = favorites.puzzles[collectionId] || [];
  const next = toggleIn(current, puzzleId);
  const puzzles = next.length
    ? { ...favorites.puzzles, [collectionId]: next }
    : Object.fromEntries(Object.entries(favorites.puzzles).filter(([key]) => key !== collectionId));
  return { ...favorites, puzzles };
};

/** 删除棋谱/题集/题目时清理对应收藏，避免悬空引用。 */
export const pruneFavorites = (favorites: LibraryFavorites, removedRecords: string[], removedCollections: string[], removedPuzzles: Array<[string, string]>): LibraryFavorites => {
  const recordSet = new Set(removedRecords);
  const collectionSet = new Set(removedCollections);
  const puzzleSet = new Set(removedPuzzles.map(([collectionId, puzzleId]) => `${collectionId}/${puzzleId}`));
  const records = favorites.records.filter((id) => !recordSet.has(id));
  const puzzleCollections = favorites.puzzleCollections.filter((id) => !collectionSet.has(id));
  const puzzles = Object.fromEntries(
    Object.entries(favorites.puzzles)
      .filter(([collectionId]) => !collectionSet.has(collectionId))
      .map(([collectionId, ids]) => [collectionId, ids.filter((puzzleId) => !puzzleSet.has(`${collectionId}/${puzzleId}`))])
      .filter(([, ids]) => ids.length > 0),
  );
  return { records, puzzleCollections, puzzles };
};
