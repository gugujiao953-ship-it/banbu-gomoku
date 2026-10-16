import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";

/**
 * 「变化列表」（用户 09-19：把记谱流做成列表流，放在图谱画布的右边）。
 *
 * 一手一行、分支缩进成子级；行与画布共用同一棵可视树（画布里展开/收起，列表跟着变），
 * 所以两边说的是同一件事：左边看形状，右边读手数与注解。行不换行、文字 100% 大小，
 * 长谱靠滚动读——这是「缩进列表」这条路对付大树的老办法（文件树、大纲工具都这么干）。
 */
export interface TreeListRow {
  id: string;
  label: string;
  /** 手数（0 = 起始局面/摆局面这类没有着法的节点）。 */
  turn: number;
  player: "black" | "white" | null;
  /** 分支层级：0 = 主行，往后每岔开一层 +1。 */
  level: number;
  childCount: number;
  onPath: boolean;
  isCurrent: boolean;
  hasBookmark: boolean;
  onMainLine: boolean;
  /** 盘面文字（注解）：DP 库的开局名都在这里。 */
  note: string;
}

export interface TreeListViewProps {
  rows: TreeListRow[];
  /** 当前手是否在主分支上。 */
  onMainLine: boolean;
  /** 不在主分支上时，「切回主分支」要跳到第几手。 */
  mainLineTurn: number | null;
  onActivate: (id: string) => void;
  onBackToMainLine: () => void;
}

export function TreeListView(props: TreeListViewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(360);
  const virtual = props.rows.length > 100;
  const rowHeight = 34;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowHeight) - 8) : 0;
  const end = virtual ? Math.min(props.rows.length, Math.ceil((scrollTop + height) / rowHeight) + 8) : props.rows.length;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(viewport.clientHeight || 360));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // 打开/走子时把当前手滚进视线：大树里「我在哪」不该靠找。
  // 只滚列表自己的容器——scrollIntoView 会连祖先（bottom-sheet）一起滚，
  // 把面板的标签栏和工具栏顶出屏幕（手机实测）。
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    if (virtual) {
      const current = props.rows.findIndex((row) => row.isCurrent);
      if (current >= 0) {
        const next = Math.max(0, current * rowHeight - ((element.clientHeight || height) - rowHeight) / 2);
        element.scrollTop = next;
        setScrollTop(next);
      }
      return;
    }
    const target = element.querySelector<HTMLElement>(".tree-list-row.current");
    if (!target) return;
    const elementBox = element.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    if (targetBox.top >= elementBox.top && targetBox.bottom <= elementBox.bottom) return;
    element.scrollTop += targetBox.top - elementBox.top - (elementBox.height - targetBox.height) / 2;
  }, [props.rows]);

  return <div className="tree-list" aria-label="变化列表">
    <div className="tree-list-toolbar">
      <span className="tree-list-count">{props.rows.length} 行</span>
      <span className="tree-list-mainline" title="主分支＝棋谱自己那条主线（SGF 第一支变化 / RenLib、DP 的主线 / 你「设为主分支」的线）">主分支</span>
      {props.onMainLine
        ? <span className="tree-list-onmain">当前在主分支上</span>
        : props.mainLineTurn !== null && <button type="button" onClick={props.onBackToMainLine}>切回主分支（第 {props.mainLineTurn} 手）</button>}
    </div>
    <div className="tree-list-rows" ref={viewportRef} role="list" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      {virtual && <div aria-hidden="true" style={{ height: start * rowHeight }}/>}
      {props.rows.slice(start, end).map((row, offset) => <button
        key={row.id}
        type="button"
        role="listitem"
        className={`tree-list-row ${row.player || "neutral"} ${row.onPath ? "path" : ""} ${row.isCurrent ? "current" : ""} ${row.onMainLine ? "on-mainline" : ""}`}
        style={{ paddingLeft: 6 + Math.min(row.level, 20) * 14, ...(virtual ? { height: rowHeight } : {}) }}
        aria-setsize={props.rows.length}
        aria-posinset={start + offset + 1}
        onClick={() => props.onActivate(row.id)}
        aria-label={`${row.turn > 0 ? `第 ${row.turn} 手 ` : ""}${row.label}${row.isCurrent ? "，当前局面" : ""}${row.childCount > 1 ? `，这里分出 ${row.childCount} 支` : ""}`}
      >
        {row.level > 0 && <i className="tree-list-elbow" aria-hidden="true"/>}
        {row.turn > 0 && <b>{row.turn}.</b>}
        <span className="tree-list-label">{row.label}</span>
        {row.note && <em className="tree-list-note">{row.note}</em>}
        {row.hasBookmark && <Bookmark className="tree-list-bookmark"/>}
        {row.childCount > 1 && <span className="tree-list-branch">{row.childCount} 支</span>}
      </button>)}
      {virtual && <div aria-hidden="true" style={{ height: (props.rows.length - end) * rowHeight }}/>}
    </div>
  </div>;
}
