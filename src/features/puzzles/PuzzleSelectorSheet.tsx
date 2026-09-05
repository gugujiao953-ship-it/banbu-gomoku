import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Folder, Search } from "lucide-react";
import type { PuzzleCollection, PuzzleProgress } from "../../puzzles";
import { puzzleProgressKey } from "../../puzzles";
import { BottomSheet } from "../../ui/overlays/BottomSheet";

interface PuzzleSelectorSheetProps {
  collections: PuzzleCollection[];
  progress: PuzzleProgress;
  currentCollectionIndex: number;
  currentPuzzleIndex: number;
  /** Folder names use the same slash-separated paths as the library. */
  folders?: string[];
  assignments?: Record<string, string>;
  onSelect: (collectionIndex: number, puzzleIndex: number) => void;
  onNext: () => void;
  onClose: () => void;
}

interface VisibleCollection {
  collection: PuzzleCollection;
  collectionIndex: number;
  puzzles: PuzzleCollection["puzzles"];
}

const folderLabel = (folder: string) => folder.split("/").pop() || folder;
const folderParent = (folder: string) => folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
const folderChildren = (folders: string[], parent: string) => folders.filter((folder) => folderParent(folder) === parent);
const folderSegment = (label: string) => label.trim().replace(/\//g, "／") || "未命名";
const collectionFolder = (collection: PuzzleCollection, assignments: Record<string, string>) => assignments[collection.id] || (collection.id.startsWith("native-") ? "内置题库" : "我的题库");
const appendFolderLeaf = (parent: string, leafLabel: string) => {
  const leaf = folderSegment(leafLabel);
  return parent === leaf || parent.endsWith(`/${leaf}`) ? parent : `${parent}/${leaf}`;
};
const folderPathLabel = (folder: string) => folder ? folder.split("/").join(" / ") : "未分类";
const folderAncestors = (folder: string) => {
  const ancestors = new Set<string>();
  let cursor = folder;
  while (cursor) { ancestors.add(cursor); cursor = folderParent(cursor); }
  return ancestors;
};

export function PuzzleSelectorSheet({ collections, progress, currentCollectionIndex, currentPuzzleIndex, folders = [], assignments = {}, onSelect, onNext, onClose }: PuzzleSelectorSheetProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const currentCollection = collections[currentCollectionIndex];
  const currentPuzzle = currentCollection?.puzzles[currentPuzzleIndex];
  const currentFolder = currentCollection ? collectionFolder(currentCollection, assignments) : "";
  const currentFolderPath = currentCollection ? appendFolderLeaf(currentFolder, currentCollection.title) : "";
  const currentCollectionRef = useRef<HTMLElement | null>(null);
  const [locateRequest, setLocateRequest] = useState(0);

  const availableFolders = useMemo(() => {
    const names = new Set(folders);
    collections.forEach((collection) => names.add(collectionFolder(collection, assignments)));
    [...names].forEach((folder) => {
      let parent = folderParent(folder);
      while (parent) { names.add(parent); parent = folderParent(parent); }
    });
    return [...names];
  }, [assignments, collections, folders]);

  const visibleCollections = useMemo<VisibleCollection[]>(() => collections.flatMap((collection, collectionIndex) => {
    if (!normalizedQuery) return [{ collection, collectionIndex, puzzles: collection.puzzles }];
    const collectionMatches = [collection.title, collection.source, collection.license].some((value) => value.toLowerCase().includes(normalizedQuery));
    const puzzles = collectionMatches
      ? collection.puzzles
      : collection.puzzles.filter((puzzle, index) => [puzzle.title, puzzle.prompt, puzzle.id, String(index + 1), puzzle.player === "black" ? "黑先" : "白先"].some((value) => value.toLowerCase().includes(normalizedQuery)));
    return puzzles.length ? [{ collection, collectionIndex, puzzles }] : [];
  }), [collections, normalizedQuery]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => folderAncestors(currentFolder));
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(() => new Set(currentCollection ? [currentCollection.id] : []));
  useEffect(() => {
    if (!currentCollection) return undefined;
    setExpandedFolders((current) => new Set([...current, ...folderAncestors(currentFolder)]));
    setExpandedCollections((current) => new Set(current).add(currentCollection.id));
    const timer = window.setTimeout(() => currentCollectionRef.current?.scrollIntoView?.({ block: "start", inline: "nearest" }), 0);
    return () => window.clearTimeout(timer);
  }, [currentCollection?.id, currentFolder, locateRequest]);
  const locateCurrentCollection = () => {
    if (!currentCollection) return;
    setQuery("");
    setLocateRequest((current) => current + 1);
  };
  const toggleFolder = (folder: string) => setExpandedFolders((current) => {
    const next = new Set(current);
    if (next.has(folder)) next.delete(folder); else next.add(folder);
    return next;
  });
  const toggleCollection = (collectionId: string) => setExpandedCollections((current) => {
    const next = new Set(current);
    if (next.has(collectionId)) next.delete(collectionId); else next.add(collectionId);
    return next;
  });

  const solvedCount = currentCollection?.puzzles.filter((puzzle) => progress[puzzleProgressKey(currentCollection.id, puzzle.id)]?.solved).length || 0;
  const renderFolder = (folder: string): ReactNode => {
    const folderCollections = visibleCollections.filter(({ collection }) => collectionFolder(collection, assignments) === folder);
    const children = folderChildren(availableFolders, folder);
    const childHasMatch = children.some((child) => visibleCollections.some(({ collection }) => {
      const assigned = collectionFolder(collection, assignments);
      return assigned === child || assigned.startsWith(`${child}/`);
    }));
    if (normalizedQuery && !folderCollections.length && !childHasMatch) return null;
    const expanded = normalizedQuery.length > 0 || expandedFolders.has(folder);
    return <section className="puzzle-selector-folder" key={folder}>
      <button type="button" className="puzzle-selector-folder-head" onClick={() => toggleFolder(folder)} aria-expanded={expanded} aria-controls={`puzzle-folder-${folder}`}>
        <span><Folder aria-hidden="true"/></span><b>{folderLabel(folder)}</b><small>{folderCollections.length} 个题库{children.length ? ` · ${children.length} 个子目录` : ""}</small><ChevronDown aria-hidden="true"/>
      </button>
      {expanded && <div id={`puzzle-folder-${folder}`} className="puzzle-selector-folder-body">
        {children.length > 0 && <div className="puzzle-selector-nested-list">{children.map(renderFolder)}</div>}
        {folderCollections.map(({ collection, collectionIndex, puzzles }) => {
          const collectionExpanded = normalizedQuery.length > 0 || expandedCollections.has(collection.id);
          const solved = collection.puzzles.filter((puzzle) => progress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length;
          const currentFolderCollection = collection.id === currentCollection?.id;
          return <section ref={currentFolderCollection ? currentCollectionRef : undefined} className={`puzzle-selector-collection${currentFolderCollection ? " current-folder" : ""}`} key={collection.id}>
            <button type="button" className="puzzle-selector-collection-head" onClick={() => toggleCollection(collection.id)} aria-expanded={collectionExpanded} aria-controls={`puzzle-collection-${collection.id}`}>
              <span className="puzzle-folder-icon">题</span><div><b>{collection.title}</b><small>{solved} / {collection.puzzles.length} 已完成 · {collection.source}{normalizedQuery && puzzles.length !== collection.puzzles.length ? ` · 匹配 ${puzzles.length} 题` : ""}</small></div>{collectionExpanded ? <ChevronDown size={17}/> : <ChevronRight size={17}/>} 
            </button>
            {collectionExpanded && <div id={`puzzle-collection-${collection.id}`} className="puzzle-selector-puzzle-list" role="listbox" aria-label={`${collection.title}题目列表`}>
              {puzzles.map((puzzle) => {
                const puzzleIndex = collection.puzzles.indexOf(puzzle);
                const active = collectionIndex === currentCollectionIndex && puzzleIndex === currentPuzzleIndex;
                const solvedPuzzle = progress[puzzleProgressKey(collection.id, puzzle.id)]?.solved;
                return <button key={puzzle.id} type="button" role="option" aria-selected={active} className={active ? "current" : ""} onClick={() => onSelect(collectionIndex, puzzleIndex)}>
                  <span className={solvedPuzzle ? "solved" : ""}>{solvedPuzzle ? <Check size={14}/> : puzzleIndex + 1}</span><div><b>{puzzle.title || `第 ${puzzleIndex + 1} 题`}</b><small>{puzzle.player === "black" ? "黑先" : "白先"} · {puzzle.prompt}</small></div><ChevronRight size={17}/>
                </button>;
              })}
            </div>}
          </section>;
        })}
        {!folderCollections.length && !children.length && <p className="puzzle-selector-folder-empty">这个文件夹还没有题库</p>}
      </div>}
    </section>;
  };

  const currentFolderLabel = folderPathLabel(currentFolderPath);
  return <BottomSheet title="选择题目与题集" className="puzzle-selector-backdrop" manageHistory onClose={onClose}>
    <div className="puzzle-selector-sheet">
      <button type="button" className="puzzle-selector-current" aria-label="定位到当前题库" onClick={locateCurrentCollection}><span className="puzzle-selector-current-index"><Folder aria-hidden="true"/></span><div><small>当前文件夹 · 点击定位</small><b title={currentCollection?.title || "尚未选择题库"}>{currentCollection?.title || "尚未选择题库"}</b><span title={currentFolderLabel}>{currentFolderLabel} · 第 {currentPuzzleIndex + 1} 题 · {progress[puzzleProgressKey(currentCollection?.id || "", currentPuzzle?.id || "")]?.solved ? "已完成" : "进行中"}</span></div><ChevronRight aria-hidden="true"/></button>
      {currentCollection && <div className="puzzle-selector-progress"><span><b title={`所在文件夹：${currentFolderLabel}`}>所在文件夹：{currentFolderLabel}</b><small>{currentCollection.title} · {solvedCount} / {currentCollection.puzzles.length} 已完成</small></span><progress max={currentCollection.puzzles.length || 1} value={solvedCount}/></div>}
      <label className="puzzle-selector-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件夹、题库、题号或题面"/></label>
      <p className="puzzle-selector-hint">先打开文件夹，再打开题库，最后选择题目。题目很多时不会一次全部展开。</p>
      <div className="puzzle-selector-list" role="listbox" aria-label="题库文件夹与题目列表">{folderChildren(availableFolders, "").map(renderFolder)}{!visibleCollections.length && <div className="puzzle-selector-empty"><Search/><b>没有匹配的题库或题目</b><span>换一个文件夹、题库名、题号或题面关键词。</span></div>}</div>
      <footer className="puzzle-selector-footer"><button type="button" className="secondary-button" onClick={onClose}>返回棋盘</button><button type="button" className="primary-button" disabled={!currentCollection?.puzzles.length} onClick={onNext}>继续下一题<ChevronRight size={17}/></button></footer>
    </div>
  </BottomSheet>;
}
