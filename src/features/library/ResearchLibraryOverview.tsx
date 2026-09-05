import { ArchiveRestore, ChevronRight, Clock3, DatabaseBackup, FileClock, Play, ShieldCheck } from "lucide-react";
import type { LargeDocumentSummary } from "../../large-storage";
import type { GameDocument } from "../../types";
import { recentResearchItems, type RecordLibraryFilter } from "./library-research";

const formatDate = (value: string) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "日期未知";
};

export function ResearchLibraryOverview({
  activeTitle,
  activeDepth,
  activeHasDraft,
  activeUpdatedAt,
  activeId,
  records,
  largeRecords,
  regularDraftIds,
  largeDraftIds,
  filter,
  onFilterChange,
  onContinue,
  onOpenRecord,
  onOpenLargeRecord,
  onOpenDataSafety,
  recycleCount,
}: {
  activeTitle: string;
  activeDepth: number;
  activeHasDraft: boolean;
  activeUpdatedAt: string;
  activeId: string;
  records: GameDocument[];
  largeRecords: LargeDocumentSummary[];
  regularDraftIds: Set<string>;
  largeDraftIds: Set<string>;
  filter: RecordLibraryFilter;
  onFilterChange: (filter: RecordLibraryFilter) => void;
  onContinue: () => void;
  onOpenRecord: (document: GameDocument) => void;
  onOpenLargeRecord: (summary: LargeDocumentSummary) => void;
  onOpenDataSafety: () => void;
  recycleCount: number;
}) {
  const recent = recentResearchItems(records, largeRecords, regularDraftIds, largeDraftIds, activeId);
  const draftCount = regularDraftIds.size + largeDraftIds.size + (activeHasDraft && !regularDraftIds.has(activeId) && !largeDraftIds.has(activeId) ? 1 : 0);
  return <section className="research-library-overview" aria-label="继续研究与资料状态">
    <button className="continue-research-card" onClick={onContinue}>
      <span className="continue-research-icon"><Play/></span>
      <span><small>继续上次研究</small><b>{activeTitle}</b><em>第 {activeDepth} 手 · {activeHasDraft ? "有未保存草稿" : "已保存"} · {formatDate(activeUpdatedAt)} 更新</em></span>
      <ChevronRight/>
    </button>
    <div className="research-overview-heading"><span><Clock3/><b>最近棋谱</b></span><button onClick={onOpenDataSafety}><ShieldCheck/>资料安全<small>{recycleCount ? `${recycleCount} 项可恢复` : "备份与恢复"}</small></button></div>
    {recent.length ? <div className="recent-research-list">{recent.map((item) => <button key={`${item.kind}-${item.id}`} onClick={() => item.kind === "record" ? onOpenRecord(item.document) : onOpenLargeRecord(item.summary)}><span className={item.kind === "large" ? "large" : "record"}>{item.kind === "large" ? <DatabaseBackup/> : <FileClock/>}</span><span><b>{item.title}</b><small>{item.kind === "large" ? "大型棋谱" : "本地棋谱"} · {item.hasDraft ? "有草稿 · " : ""}{formatDate(item.updatedAt)} 更新</small></span><ChevronRight/></button>)}</div> : <p className="research-overview-empty">保存或导入棋谱后，最近研究会显示在这里。</p>}
    <div className="record-filter-bar" role="group" aria-label="棋谱状态筛选">
      {([
        ["all", "全部", records.length + largeRecords.length],
        ["drafts", "有草稿", draftCount],
        ["recent", "近 7 天", records.filter((item) => Date.now() - (Date.parse(item.updatedAt) || 0) <= 7 * 86400000).length + largeRecords.filter((item) => Date.now() - (Date.parse(item.updatedAt) || 0) <= 7 * 86400000).length],
        ["large", "大型", largeRecords.length],
      ] as const).map(([value, label, count]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => onFilterChange(value)} aria-pressed={filter === value}>{label}<small>{count}</small></button>)}
    </div>
    <p className="record-filter-note">{filter === "drafts" ? "只显示存在未提交修改的棋谱。" : filter === "recent" ? "只显示最近 7 天更新过的棋谱。" : filter === "large" ? "只显示 IndexedDB 中的大型棋谱与数据库派生版本。" : "按文件夹展示全部本地棋谱；搜索会继续叠加在当前筛选上。"}</p>
  </section>;
}
