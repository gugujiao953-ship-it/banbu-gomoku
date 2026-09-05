import { BookOpen, Check, ChevronRight, Clock3 } from "lucide-react";
import type { RecentPuzzleItem } from "./recent-puzzles";

const formatDate = (value: string) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "日期未知";
};

export function RecentPuzzleSection({ items, onOpen }: { items: RecentPuzzleItem[]; onOpen: (item: RecentPuzzleItem) => void }) {
  return <section className="recent-puzzle-section" aria-label="最近棋题">
    <div className="recent-puzzle-heading"><span><Clock3/><b>最近棋题</b></span><small>{items.length ? "一键继续练习" : "完成过的题目会显示在这里"}</small></div>
    {items.length ? <div className="recent-puzzle-list">{items.map((item) => <button key={`${item.collectionId}/${item.puzzleId}`} onClick={() => onOpen(item)}><span className="recent-puzzle-icon">{item.solved ? <Check/> : <BookOpen/>}</span><span className="recent-puzzle-copy"><b>{item.puzzleTitle}</b><small>{item.collectionTitle} · {item.solved ? "已完成" : `${item.attempts} 次尝试`} · {formatDate(item.updatedAt)} 更新</small></span><ChevronRight/></button>)}</div> : <p className="recent-puzzle-empty">从题库打开并尝试题目后，可以从这里快速继续。</p>}
  </section>;
}
