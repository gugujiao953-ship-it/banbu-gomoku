import { useEffect, useState } from "react";
import { BookOpen, Check, ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import type { RecentPuzzleItem } from "./recent-puzzles";

const formatDate = (value: string) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "日期未知";
};

const RECENT_PUZZLES_EXPANDED_KEY = "banbu-recent-puzzles-expanded-v1";

export function RecentPuzzleSection({ items, onOpen }: { items: RecentPuzzleItem[]; onOpen: (item: RecentPuzzleItem) => void }) {
  // 展开/收起状态持久化：默认展开；上次收起则下次仍收起（用户 2026-09-10 要求）。
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_PUZZLES_EXPANDED_KEY);
      return stored === null ? true : stored !== "0";
    } catch { return true; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(RECENT_PUZZLES_EXPANDED_KEY, expanded ? "1" : "0"); } catch { /* optional storage */ }
  }, [expanded]);
  return <section className="recent-puzzle-section" aria-label="最近棋题">
    <div className="recent-puzzle-heading"><span><Clock3/><b>最近棋题</b></span><small>{items.length ? "一键继续练习" : "完成过的题目会显示在这里"}</small><button type="button" className="recent-puzzle-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={expanded ? "收起最近棋题" : "展开最近棋题"} title={expanded ? "收起最近棋题" : "展开最近棋题"}>{expanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}<span>{expanded ? "收起" : "展开"}</span></button></div>
    {expanded && (items.length ? <div className="recent-puzzle-list">{items.map((item) => <button key={`${item.collectionId}/${item.puzzleId}`} onClick={() => onOpen(item)}><span className="recent-puzzle-icon">{item.solved ? <Check/> : <BookOpen/>}</span><span className="recent-puzzle-copy"><b>{item.puzzleTitle}</b><small>{item.collectionTitle} · {item.solved ? "已完成" : `${item.attempts} 次尝试`} · {formatDate(item.updatedAt)} 更新</small></span><ChevronRight/></button>)}</div> : <p className="recent-puzzle-empty">从题库打开并尝试题目后，可以从这里快速继续。</p>)}
  </section>;
}
