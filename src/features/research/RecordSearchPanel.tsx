import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { coordinateName, depthOf } from "../../game";
import type { GameDocument, RecordNode } from "../../types";

const nodeLabel = (node: RecordNode) => node.move ? coordinateName(node.move) : node.passPlayer ? `${node.passPlayer === "black" ? "黑" : "白"}方过手` : node.setup ? "设置局面" : node.parentId ? "注释节点" : "起始局面";
const markLabel = (node: RecordNode) => (node.marks || []).map((mark) => `${coordinateName(mark)}${mark.label ? `：${mark.label}` : mark.kind === "circle" ? "：圆圈" : mark.kind === "triangle" ? "：三角" : "：叉号"}`).join("，");

export function RecordSearchPanel({ document, query, results, onQueryChange, onJump }: {
  document: GameDocument;
  query: string;
  results: RecordNode[];
  onQueryChange: (query: string) => void;
  onJump: (nodeId: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => { setActiveIndex(0); }, [query, document.id]);
  const jump = (index: number) => {
    const node = results[index];
    if (!node) return;
    setActiveIndex(index);
    onJump(node.id);
  };
  return <div className="sheet-body find-sheet">
    <label className="find-input"><Search size={17}/><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="坐标、手数、标注、注释或局面文字"/><button type="button" onClick={() => onQueryChange("")} aria-label="清除查找"><X size={15}/></button></label>
    {query && <div className="find-result-nav" aria-live="polite"><span>找到 {results.length} 个节点（最多 20 个）</span><div><button type="button" onClick={() => jump(activeIndex - 1)} disabled={!results.length || activeIndex <= 0} aria-label="上一个查找结果"><ChevronLeft/>上一个</button><b>{results.length ? `${activeIndex + 1} / ${results.length}` : "0 / 0"}</b><button type="button" onClick={() => jump(activeIndex + 1)} disabled={!results.length || activeIndex >= results.length - 1} aria-label="下一个查找结果">下一个<ChevronRight/></button></div></div>}
    {query && !results.length && <div className="sheet-empty"><Search/><b>没有找到匹配节点</b><span>可以试试 H8、2、A、圆圈，或注释中的关键词。</span></div>}
    {results.length > 0 && <div className="find-results">{results.map((node, index) => <button key={node.id} className={index === activeIndex ? "active" : ""} onClick={() => jump(index)}><span className={`branch-stone ${node.move?.player || node.passPlayer || "black"}`}>{node.move || node.passPlayer ? depthOf(document, node.id) : node.parentId ? "·" : "起"}</span><div><b>{nodeLabel(node)}</b><small>{node.boardText || node.comment || markLabel(node) || "无局面文字、注释或标注"}</small></div><ChevronRight/></button>)}</div>}
    <p className="helper">查找覆盖当前棋谱的主线、所有变化和棋盘标注；使用“上一个 / 下一个”可连续核对结果，关闭面板后仍停留在所选局面。</p>
  </div>;
}
