import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Database, Folder, Search } from "lucide-react";
import { mainLineLength } from "../../formats";
import type { LargeDocumentSummary } from "../../large-storage";
import type { GameDocument } from "../../types";
import { BottomSheet } from "../../ui/overlays/BottomSheet";
import { recordRuleDisplayName } from "../rules/rule-guide-data";
import "./record-selector.css";

interface RecordSelectorSheetProps {
  records: GameDocument[];
  largeRecords: LargeDocumentSummary[];
  currentId: string;
  folders: string[];
  assignments: Record<string, string>;
  onSelectRecord: (record: GameDocument) => void;
  onSelectLargeRecord: (record: LargeDocumentSummary) => void;
  nativeDatabase?: { title: string; hint?: string; onOpen: () => void };
  onClose: () => void;
}

const matchesQuery = (metadata: GameDocument["metadata"], query: string) =>
  [metadata.title, metadata.black, metadata.white, metadata.event, metadata.rule]
    .some((value) => value?.toLowerCase().includes(query));
const folderLabel = (folder: string) => folder.split("/").pop() || folder;
const folderParent = (folder: string) => folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
const folderChildren = (folders: string[], parent: string) => folders.filter((folder) => folderParent(folder) === parent);
const folderSegment = (label: string) => label.trim().replace(/\//g, "／") || "未命名";
const recordFolder = (record: { id: string }, assignments: Record<string, string>) => assignments[record.id] || "未分类";
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

export function RecordSelectorSheet({ records, largeRecords, currentId, folders, assignments, onSelectRecord, onSelectLargeRecord, nativeDatabase, onClose }: RecordSelectorSheetProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRecords = useMemo(() => normalizedQuery ? records.filter((record) => matchesQuery(record.metadata, normalizedQuery)) : records, [normalizedQuery, records]);
  const visibleLargeRecords = useMemo(() => normalizedQuery ? largeRecords.filter((record) => matchesQuery(record.metadata, normalizedQuery)) : largeRecords, [largeRecords, normalizedQuery]);
  const currentRecord = records.find((record) => record.id === currentId);
  const currentLargeRecord = largeRecords.find((record) => record.id === currentId);
  const currentTitle = currentRecord?.metadata.title || currentLargeRecord?.metadata.title || "当前棋谱";
  const currentFolder = currentRecord ? recordFolder(currentRecord, assignments) : currentLargeRecord ? recordFolder(currentLargeRecord, assignments) : assignments[currentId] || "未分类";
  const currentFolderPath = appendFolderLeaf(currentFolder, currentTitle);
  const currentRecordRef = useRef<HTMLButtonElement | null>(null);
  const [locateRequest, setLocateRequest] = useState(0);
  const availableFolders = useMemo(() => {
    const names = new Set(folders);
    [...records, ...largeRecords].forEach((record) => names.add(recordFolder(record, assignments)));
    [...names].forEach((folder) => {
      let parent = folderParent(folder);
      while (parent) { names.add(parent); parent = folderParent(parent); }
    });
    return [...names];
  }, [assignments, folders, largeRecords, records]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const hasRecords = (folder: string) => records.some((record) => recordFolder(record, assignments) === folder) || largeRecords.some((record) => recordFolder(record, assignments) === folder);
    const initialFolder = availableFolders.includes(currentFolder) && hasRecords(currentFolder)
      ? currentFolder
      : availableFolders.find(hasRecords);
    if (!initialFolder) return new Set();
    const expanded = new Set<string>();
    let cursor = initialFolder;
    while (cursor) { expanded.add(cursor); cursor = folderParent(cursor); }
    return expanded;
  });
  useEffect(() => {
    setExpandedFolders((current) => new Set([...current, ...folderAncestors(currentFolder)]));
    const timer = window.setTimeout(() => currentRecordRef.current?.scrollIntoView?.({ block: "start", inline: "nearest" }), 0);
    return () => window.clearTimeout(timer);
  }, [currentFolder, currentId, locateRequest]);
  const locateCurrentRecord = () => {
    setQuery("");
    setLocateRequest((current) => current + 1);
  };
  const toggleFolder = (folder: string) => setExpandedFolders((current) => {
    const next = new Set(current);
    if (next.has(folder)) next.delete(folder); else next.add(folder);
    return next;
  });
  const renderFolder = (folder: string): ReactNode => {
    const folderRecords = visibleRecords.filter((record) => recordFolder(record, assignments) === folder);
    const folderLargeRecords = visibleLargeRecords.filter((record) => recordFolder(record, assignments) === folder);
    const children = folderChildren(availableFolders, folder);
    const count = folderRecords.length + folderLargeRecords.length;
    const subtreeMatches = count > 0 || children.some((child) => [...visibleRecords, ...visibleLargeRecords].some((record) => recordFolder(record, assignments) === child || recordFolder(record, assignments).startsWith(`${child}/`)));
    if (normalizedQuery && !subtreeMatches) return null;
    const expanded = normalizedQuery.length > 0 || expandedFolders.has(folder);
    return <section className="record-selector-folder" key={folder}>
      <button type="button" className="record-selector-folder-head" onClick={() => toggleFolder(folder)} aria-expanded={expanded} aria-controls={`record-folder-${folder}`}>
        <span><Folder aria-hidden="true"/></span><b>{folderLabel(folder)}</b><small>{count} 份{children.length ? ` · ${children.length} 子目录` : ""}</small><ChevronDown aria-hidden="true"/>
      </button>
      {expanded && <div id={`record-folder-${folder}`} className="record-selector-folder-body">
        {children.length > 0 && <div className="record-selector-nested-list">{children.map(renderFolder)}</div>}
        {folderRecords.map((record) => { const active = record.id === currentId; return <button ref={active ? currentRecordRef : undefined} key={record.id} type="button" role="option" aria-selected={active} className={active ? "current" : ""} onClick={() => onSelectRecord(record)}><span className="record-selector-count">{mainLineLength(record)}</span><div><b>{record.metadata.title}</b><small>{record.metadata.black || "黑方"} vs {record.metadata.white || "白方"} · {recordRuleDisplayName(record.metadata)}</small></div>{active ? <Check size={18}/> : <ChevronRight size={18}/>}</button>; })}
        {folderLargeRecords.map((record) => { const active = record.id === currentId; return <button ref={active ? currentRecordRef : undefined} key={record.id} type="button" role="option" aria-selected={active} className={active ? "current" : ""} onClick={() => onSelectLargeRecord(record)}><span className="record-selector-count large"><Database aria-hidden="true"/></span><div><b>{record.metadata.title}</b><small>{record.metadata.black || "黑方"} vs {record.metadata.white || "白方"} · {record.mainLineLength} 手大型棋谱</small></div>{active ? <Check size={18}/> : <ChevronRight size={18}/>}</button>; })}
        {!count && !children.length && <p className="record-selector-folder-empty">这个文件夹还没有棋谱</p>}
      </div>}
    </section>;
  };

  return <BottomSheet title="选择棋谱" className="record-selector-backdrop" manageHistory onClose={onClose}>
    <div className="record-selector-sheet">
      <button type="button" className="record-selector-current" aria-label="定位到当前棋谱" onClick={locateCurrentRecord}>
        <span>{currentLargeRecord ? <Database aria-hidden="true"/> : mainLineLength(currentRecord || records[0])}</span>
        <div><small>当前文件夹 · 点击定位</small><b title={currentTitle}>{currentTitle}</b><em title={folderPathLabel(currentFolderPath)}>{folderPathLabel(currentFolderPath)} · 共 {records.length + largeRecords.length} 份</em></div>
        <ChevronRight aria-hidden="true"/>
      </button>
      <label className="record-selector-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索棋谱、棋手或赛事"/></label>
      <div className="record-selector-list" role="listbox" aria-label="棋谱文件夹与列表">
        {nativeDatabase && (!normalizedQuery || nativeDatabase.title.toLowerCase().includes(normalizedQuery) || "内置".includes(normalizedQuery) || "九天".includes(normalizedQuery)) && <button type="button" className="record-selector-native" onClick={nativeDatabase.onOpen}><span className="record-selector-native-badge"><Database aria-hidden="true"/></span><div><b>{nativeDatabase.title}</b><small>{nativeDatabase.hint || "内置局面数据库 · 分支按局面实时查询"}</small></div><ChevronRight aria-hidden="true"/></button>}
        {folderChildren(availableFolders, "").map(renderFolder)}
        {!visibleRecords.length && !visibleLargeRecords.length && !nativeDatabase && <div className="record-selector-empty"><Search/><b>没有匹配棋谱</b><span>换一个棋谱名、棋手或赛事关键词。</span></div>}
      </div>
      <button type="button" className="secondary-button record-selector-cancel" onClick={onClose}>返回棋盘</button>
    </div>
  </BottomSheet>;
}
