import { useMemo, useRef, useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, GitBranch, LocateFixed } from "lucide-react";
import { coordinateName } from "../../game";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "../../types";
import { treeAncestorPath, treeChildPage, treeSiblingChoices } from "./tree-navigation";
import { TreePreview } from "./TreePreview";

const PAGE_SIZE = 16;

interface TreeNavigatorProps {
  document: GameDocument;
  node: RecordNode;
  currentId: string;
  compactIndex?: CompactRenLibIndex;
  mainLineIds: ReadonlySet<string>;
  bookmarkIds: ReadonlyMap<string, unknown>;
  branchNames?: Record<string, string>;
  busy?: boolean;
  onSelect: (id: string) => void;
  onGraph: () => void;
  onLoadBranch?: (id: string) => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onLocate: () => void;
}

/** Browse one decision at a time. Sibling pages are independent of the canvas node budget. */
export function TreeNavigator(props: TreeNavigatorProps) {
  const { document, node } = props;
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(() => new Map());
  const rowsRef = useRef<HTMLDivElement>(null);
  const path = useMemo(() => treeAncestorPath(document, node.id), [document, node.id]);
  const siblings = useMemo(() => treeSiblingChoices(document, node.id, props.compactIndex), [document, node.id, props.compactIndex]);
  const fork = useMemo(() => [...path].reverse().slice(1).find((item) => treeChildPage(document, item.id, 0, 0, props.compactIndex).total > 1), [document, path, props.compactIndex]);
  const info = treeChildPage(document, node.id, 0, 0, props.compactIndex);
  const offset = Math.min(pages.get(node.id) ?? 0, Math.max(0, Math.ceil(info.loaded / PAGE_SIZE) - 1) * PAGE_SIZE);
  const page = treeChildPage(document, node.id, offset, PAGE_SIZE, props.compactIndex);
  const boardSize = document.metadata.boardSize || 15;
  const label = (item: RecordNode) => item.move ? coordinateName(item.move, boardSize) : item.passPlayer ? "过手" : item.setup ? "设置局面" : item.parentId ? "注释" : "起始局面";
  const title = (item: RecordNode) => props.branchNames?.[item.id]?.trim() || item.boardText?.trim() || "";
  let turn = 0;
  const turns = path.map((item, index) => {
    if (index > 0 && (item.move || item.passPlayer)) turn += 1;
    return turn;
  });
  const start = Math.max(1, path.length - 6);
  const select = (id: string) => { props.onSelect(id); rowsRef.current?.scrollTo?.({ top: 0 }); };
  const compare = (id: string, position: number) => {
    if (node.parentId) setPages((value) => new Map(value).set(node.parentId!, Math.floor(position / PAGE_SIZE) * PAGE_SIZE));
    select(id);
  };
  const turnPage = (next: number) => { setPages((value) => new Map(value).set(node.id, next)); rowsRef.current?.scrollTo?.({ top: 0 }); };

  return <section className="tree-navigator" aria-label="逐层分支导航">
    <div className="tree-navigator-tools">
      <button type="button" onClick={() => select(node.parentId!)} disabled={!node.parentId || props.busy}><ChevronLeft/>上一层</button>
      <button type="button" onClick={() => select(fork!.id)} disabled={!fork || props.busy}><GitBranch/>返回分叉</button>
      <button type="button" onClick={() => select(props.currentId)} disabled={node.id === props.currentId || props.busy}><LocateFixed/>回到当前手</button>
      <button type="button" onClick={props.onGraph}><GitBranch/>在图谱查看</button>
    </div>
    <nav className="tree-navigator-path" aria-label="所选分支路径">
      {path[0] && <button type="button" onClick={() => select(path[0].id)} aria-current={path.length === 1 ? "location" : undefined} disabled={props.busy}>起始局面</button>}
      {start > 1 && <button type="button" onClick={() => select(path[start - 1].id)} disabled={props.busy} aria-label={`返回较早路径，第 ${turns[start - 1]} 手`}>… {start - 1} 层</button>}
      {path.slice(start).map((item, index) => <button key={item.id} type="button" onClick={() => select(item.id)} disabled={props.busy} aria-current={item.id === node.id ? "location" : undefined} title={title(item)}>{turns[start + index]}. {label(item)}</button>)}
    </nav>
    <div className="tree-navigator-heading">
      <div><b>{title(node) || label(node)}</b><small>第 {turn} 手{props.mainLineIds.has(node.id) ? " · 主分支" : " · 变化分支"}</small></div>
      <div className="tree-navigator-location"><span>{page.total} 个后续</span><button type="button" onClick={props.onLocate} disabled={props.busy}><LocateFixed/>定位到主棋盘</button></div>
    </div>
    {siblings.total > 1 && <div className="tree-navigator-compare" aria-label="比较同层走法">
      <button type="button" onClick={() => compare(siblings.previous!, siblings.position - 1)} disabled={!siblings.previous || props.busy}><ChevronLeft/>上一支</button>
      <span>同层 {siblings.position + 1} / {siblings.total} 支</span>
      <button type="button" onClick={() => compare(siblings.next!, siblings.position + 1)} disabled={!siblings.next || props.busy}>下一支<ChevronRight/></button>
    </div>}
    <p className="tree-navigator-hint">点棋盘编号或候选查看后续；上一支、下一支可比较同层走法。</p>
    <div className="tree-navigator-content">
    <TreePreview document={document} node={node} compactIndex={props.compactIndex} open={props.previewOpen} onToggle={props.onTogglePreview} candidates={page.ids.flatMap((id, i) => document.nodes[id] ? [{ node: document.nodes[id], number: offset + i + 1 }] : [])} onCandidate={select} busy={props.busy}/>
    <div className="tree-navigator-candidates">
    <div className="tree-navigator-candidate-heading"><b>后续走法</b><small>编号与棋盘对应</small></div>
    <div className="tree-navigator-rows" ref={rowsRef} role="list" aria-label="本层全部候选">
      {page.ids.map((id, i) => {
        const child = document.nodes[id];
        if (!child) return null;
        const children = treeChildPage(document, id, 0, 0, props.compactIndex);
        const player = child.move?.player || child.passPlayer || "neutral";
        return <div role="listitem" key={id}>
          <button type="button" className={`tree-navigator-row ${id === props.currentId ? "current" : ""}`} onClick={() => select(id)} disabled={props.busy} aria-label={`查看分支 ${label(child)}${title(child) ? ` ${title(child)}` : ""}`}>
            <span className={`tree-action-stone ${player}`} aria-hidden="true"/>
            <span className="tree-navigator-number">{offset + i + 1}</span>
            <span className="tree-navigator-row-text"><span><b>{label(child)}</b>{title(child) && <strong>{title(child)}</strong>}</span>{child.comment?.trim() && <small>{child.comment.trim()}</small>}<em>{props.mainLineIds.has(id) ? "主分支 · " : ""}{children.total ? `${children.total} 个后续${children.unloaded ? " · 待读取" : ""}` : "分支末端"}</em></span>
            {props.bookmarkIds.has(id) && <Bookmark aria-label="有书签"/>}<ChevronRight aria-hidden="true"/>
          </button>
        </div>;
      })}
      {!page.total && <p className="tree-navigator-empty">这一手已到分支末端，可返回上一层比较其他走法。</p>}
      {page.unloaded > 0 && <div className="tree-navigator-load"><p>还有 {page.unloaded} 支待读取。</p>{props.onLoadBranch ? <button type="button" onClick={() => props.onLoadBranch?.(node.id)} disabled={props.busy}>{props.busy ? "读取中…" : "读取后续分支"}</button> : <p>定位到这个局面后再读取后续。</p>}</div>}
    </div>
    {page.loaded > PAGE_SIZE && <div className="tree-navigator-paging" aria-label="候选分支分页">
      <button type="button" onClick={() => turnPage(offset - PAGE_SIZE)} disabled={!offset || props.busy}><ChevronLeft/>上一页</button>
      <span role="status">{offset + 1}–{Math.min(page.loaded, offset + PAGE_SIZE)} / {page.loaded} 支</span>
      <button type="button" onClick={() => turnPage(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= page.loaded || props.busy}>下一页<ChevronRight/></button>
    </div>}
    </div>
    </div>
  </section>;
}
