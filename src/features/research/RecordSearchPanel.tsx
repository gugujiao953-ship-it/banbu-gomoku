import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { coordinateName, depthOf } from "../../game";
import type { GameDocument, RecordNode } from "../../types";

const nodeLabel = (node: RecordNode) => node.move ? coordinateName(node.move) : node.passPlayer ? `${node.passPlayer === "black" ? "黑" : "白"}方过手` : node.setup ? "设置局面" : node.parentId ? "注释节点" : "起始局面";
const markLabel = (node: RecordNode) => (node.marks || []).map((mark) => `${coordinateName(mark)}${mark.label ? `：${mark.label}` : mark.kind === "circle" ? "：圆圈" : mark.kind === "triangle" ? "：三角" : "：叉号"}`).join("，");

export function RecordSearchPanel({ document, query, results, onQueryChange, onJump, partial = false }: {
  document: GameDocument;
  query: string;
  results: RecordNode[];
  onQueryChange: (query: string) => void;
  onJump: (nodeId: string) => void;
  /**
   * 这份文档是不是「懒加载源的一部分」（DP/DB 局面库、RenLib 网页核心读的 .lib、
   * 按需窗口的大型棋谱）。是的话查找只能覆盖**已加载**的节点，
   * 说明与空态就必须如实讲，不能让「没有找到匹配节点」看起来像「这份棋谱里真没有」
   * （2026-10-10 排查：与分支树那条同属一类问题——拿子集当全谱）。
   */
  partial?: boolean;
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
    {query && !results.length && <div className="sheet-empty"><Search/><b>没有找到匹配节点</b><span>{partial ? "这份棋谱只加载了一部分——未加载的分支里可能还有，在分支树里点「展开下一层」读回来再搜。" : "可以试试 H8、2、A、圆圈，或注释中的关键词。"}</span></div>}
    {results.length > 0 && <div className="find-results">{results.map((node, index) => <button key={node.id} className={index === activeIndex ? "active" : ""} onClick={() => jump(index)}><span className={`branch-stone ${node.move?.player || node.passPlayer || "black"}`}>{node.move || node.passPlayer ? depthOf(document, node.id) : node.parentId ? "·" : "起"}</span><div><b>{nodeLabel(node)}</b><small>{node.boardText || node.comment || markLabel(node) || "无局面文字、注释或标注"}</small></div><ChevronRight/></button>)}</div>}
    <p className="helper">{partial ? "查找覆盖已加载的那部分棋谱（主线、变化与棋盘标注）——这份棋谱按局面读取，未加载的分支不在查找范围内；在分支树里点「展开下一层」可把它读回来。使用“上一个 / 下一个”可连续核对结果。" : "查找覆盖当前棋谱的主线、所有变化和棋盘标注；使用“上一个 / 下一个”可连续核对结果，关闭面板后仍停留在所选局面。"}</p>
  </div>;
}
