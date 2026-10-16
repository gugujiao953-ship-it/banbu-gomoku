import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

export interface TreeBranchRegion {
  id: string;
  count: number;
  firstTurn: number;
  lastTurn: number;
  forks: number;
  unloaded: number;
}

interface TreeBranchAtlasProps {
  regions: readonly TreeBranchRegion[];
  selectedPath: ReadonlySet<string>;
  mainLine: ReadonlySet<string>;
  label: (id: string) => string;
  onEnter: (region: TreeBranchRegion) => void;
  onDetail: () => void;
}

/** Directory-style drilldown keeps branch names readable even when a full tree
 * has an extreme aspect ratio. Tiles summarise whole subtrees, with no data cap. */
export function TreeBranchAtlas(props: TreeBranchAtlasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 360, height: 400 });
  const [scrollTop, setScrollTop] = useState(0);
  const columns = Math.max(1, Math.floor((size.width - 20) / 130));
  const rowHeight = 100;
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const lastRow = Math.min(Math.ceil(props.regions.length / columns), Math.ceil((scrollTop + size.height) / rowHeight) + 2);
  const start = firstRow * columns, end = lastRow * columns;
  const largest = props.regions.reduce((max, region) => Math.max(max, region.count), 1);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth || 360, height: element.clientHeight || 400 });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [props.regions]);

  return <div ref={viewportRef} className="tree-branch-atlas" aria-label="分区总览，点按变化深入查看" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    {props.regions.length ? <>
      <div className="tree-atlas-intro">{props.regions.length} 条变化 · 点按分区深入；没有分叉时进入逐手图谱</div>
      <div aria-hidden="true" style={{ height: firstRow * rowHeight }}/>
      <div className="tree-atlas-grid" style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}>
        {props.regions.slice(start, end).map((region, offset) => <button key={region.id} type="button" className={`tree-atlas-region ${props.selectedPath.has(region.id) ? "selected" : ""}`} aria-label={`深入变化 ${start + offset + 1}，${props.label(region.id)}，${region.count} 个已读取节点`} onClick={() => props.onEnter(region)}>
          <span className="tree-atlas-region-head"><i>{start + offset + 1}</i><b>{props.label(region.id)}</b><ChevronRight/></span>
          <span>{region.count} 个节点 · {region.forks} 个分叉{props.mainLine.has(region.id) && <em>主线</em>}</span>
          <small>{region.firstTurn ? `第 ${region.firstTurn}–${region.lastTurn} 手` : "含注释与设置局面"}{region.unloaded ? " · 后续待读取" : ""}</small>
          <span className="tree-atlas-weight" aria-hidden="true"><i style={{ width: `${Math.max(3, region.count / largest * 100)}%` }}/></span>
        </button>)}
      </div>
      <div aria-hidden="true" style={{ height: (Math.ceil(props.regions.length / columns) - lastRow) * rowHeight }}/>
    </> : <div className="tree-atlas-empty"><b>这一段没有已展开的分叉</b><span>可在逐手图谱查看坐标、注释和待读取的后续。</span><button type="button" onClick={props.onDetail}>查看逐手图谱</button></div>}
  </div>;
}
