// Manual ordering for the library: folder trees, records, puzzle collections
// and puzzles. Orders are stored as explicit id lists per container; an absent
// entry always means the natural (insertion) order, so "恢复默认排序" is just a
// key deletion and stays reversible.

export type LibraryOrderKind = "recordFolders" | "puzzleFolders" | "records" | "puzzleCollections" | "puzzles";

export type LibraryOrderMaps = Partial<Record<LibraryOrderKind, Record<string, string[]>>>;

export const isLibraryOrderMaps = (value: unknown): value is LibraryOrderMaps => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((bucket) => {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return false;
    return Object.values(bucket as Record<string, unknown>).every((entry) => Array.isArray(entry) && entry.every((id) => typeof id === "string"));
  });
};

/** Natural ids re-sequenced by a stored order; unknown/stale ids are ignored
 * and natural ids missing from the order keep their relative tail order. */
export const applyOrder = (naturalIds: string[], order: string[] | undefined): string[] => {
  if (!order || !order.length) return naturalIds;
  const naturalSet = new Set(naturalIds);
  const orderedSet = new Set<string>();
  const head: string[] = [];
  for (const id of order) {
    if (naturalSet.has(id) && !orderedSet.has(id)) { head.push(id); orderedSet.add(id); }
  }
  return [...head, ...naturalIds.filter((id) => !orderedSet.has(id))];
};

/** Drops `draggedId` next to `targetId` in the currently displayed sequence. */
export const moveRelative = (orderedIds: string[], draggedId: string, targetId: string, placeBefore: boolean): string[] => {
  if (draggedId === targetId || !orderedIds.includes(draggedId)) return orderedIds;
  const next = orderedIds.filter((id) => id !== draggedId);
  const index = next.indexOf(targetId);
  if (index < 0) return orderedIds;
  next.splice(placeBefore ? index : index + 1, 0, draggedId);
  return next;
};

export const compareByTitle = (a: string, b: string) => a.localeCompare(b, "zh-Hans-CN", { numeric: true });

export const sortIdsByTitles = (ids: string[], titles: Record<string, string>, direction: "az" | "za"): string[] =>
  [...ids].sort((a, b) => (direction === "az" ? 1 : -1) * compareByTitle(titles[a] || "", titles[b] || ""));

/** Folder renames rewrite paths; order maps are keyed by those paths, so both
 * the folder buckets and the per-folder item buckets must follow. */
export const remapFolderOrder = (maps: LibraryOrderMaps | undefined, folderKind: LibraryOrderKind, itemKind: LibraryOrderKind, oldPath: string, newPath: string): LibraryOrderMaps | undefined => {
  if (!maps) return maps;
  const remapPath = (path: string) => path === oldPath || path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
  const remapBucket = (bucket: Record<string, string[]> | undefined) => bucket
    ? Object.fromEntries(Object.entries(bucket).map(([key, ids]) => [remapPath(key), ids.map(remapPath)]))
    : undefined;
  const result: LibraryOrderMaps = { ...maps };
  const folders = remapBucket(maps[folderKind]);
  if (folders && Object.keys(folders).length) result[folderKind] = folders; else delete result[folderKind];
  const items = remapBucket(maps[itemKind]);
  if (items && Object.keys(items).length) result[itemKind] = items; else delete result[itemKind];
  return result;
};

/** Removes an item from a container bucket (call on delete to avoid leaks). */
export const removeFromOrder = (maps: LibraryOrderMaps | undefined, kind: LibraryOrderKind, key: string, id: string): LibraryOrderMaps | undefined => {
  if (!maps) return maps;
  const bucket = maps[kind];
  if (!bucket || !bucket[key]) return maps;
  const nextIds = bucket[key].filter((entry) => entry !== id);
  const nextBucket: Record<string, string[]> = { ...bucket };
  if (nextIds.length > 1) nextBucket[key] = nextIds; else delete nextBucket[key];
  const result: LibraryOrderMaps = { ...maps };
  if (Object.keys(nextBucket).length) result[kind] = nextBucket; else delete result[kind];
  return result;
};
