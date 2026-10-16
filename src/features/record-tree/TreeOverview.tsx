import { useMemo } from "react";
import type { TreeEntry } from "./visible-tree";
import type { TreeEdgeRoute } from "./tree-viewport";

interface TreeOverviewProps {
  entries: readonly TreeEntry[];
  points: ReadonlyMap<string, { x: number; y: number; w: number }>;
  routes: ReadonlyMap<string, TreeEdgeRoute>;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
  pan: { x: number; y: number };
  scale: number;
  selectedId: string;
  onCenter: (x: number, y: number) => void;
}

/** A schematic overview: keep text at readable zoom and move through a large graph. */
export function TreeOverview(props: TreeOverviewProps) {
  const sx = 128 / props.width, sy = 72 / props.height;
  // Rasterise the schematic into a tiny grid, then emit horizontal SVG runs.
  // The overview covers the entire expanded layout without one DOM element per node.
  const schematic = useMemo(() => {
    const grid = new Uint8Array(128 * 72);
    const mark = (x: number, y: number, value: number) => {
      x = Math.max(0, Math.min(127, Math.round(x))); y = Math.max(0, Math.min(71, Math.round(y)));
      grid[y * 128 + x] = Math.max(grid[y * 128 + x], value);
    };
    for (const entry of props.entries) {
      const child = props.points.get(entry.id);
      if (!child) continue;
      const x2 = Math.round(child.x * sx), y2 = Math.round((child.y + 22) * sy);
      const route = props.routes.get(entry.id);
      for (let index = 1; route && index < route.length; index += 1) {
        const from = route[index - 1], to = route[index];
        if (from.y === to.y) {
          const y = Math.round(from.y * sy);
          for (let x = Math.round(Math.min(from.x, to.x) * sx); x <= Math.round(Math.max(from.x, to.x) * sx); x += 1) mark(x, y, 1);
        } else {
          const x = Math.round(from.x * sx);
          for (let y = Math.round(Math.min(from.y, to.y) * sy); y <= Math.round(Math.max(from.y, to.y) * sy); y += 1) mark(x, y, 1);
        }
      }
      for (let x = x2; x <= Math.round((child.x + child.w) * sx); x += 1) mark(x, y2, entry.onPath ? 3 : 2);
    }
    const paths = ["", "", "", ""];
    for (let y = 0; y < 72; y += 1) for (let x = 0; x < 128;) {
      const value = grid[y * 128 + x], start = x;
      while (x < 128 && grid[y * 128 + x] === value) x += 1;
      if (value) paths[value] += `M ${start} ${y} h ${x - start} v 1 h ${start - x} z `;
    }
    return paths;
  }, [props.entries, props.points, props.routes, sx, sy]);
  const selected = props.points.get(props.selectedId);
  const left = Math.max(0, -props.pan.x / props.scale), top = Math.max(0, -props.pan.y / props.scale);
  const right = Math.min(props.width, (props.viewWidth - props.pan.x) / props.scale);
  const bottom = Math.min(props.height, (props.viewHeight - props.pan.y) / props.scale);
  return <svg className="tree-overview" viewBox="0 0 140 84" role="button" tabIndex={0} aria-label="图谱小地图，点按移动视野，方向键平移" onClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    props.onCenter(Math.max(0, Math.min(props.width, (140 * (event.clientX - rect.left) / rect.width - 6) / sx)), Math.max(0, Math.min(props.height, (84 * (event.clientY - rect.top) / rect.height - 6) / sy)));
  }} onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const point = props.points.get(props.selectedId);
      if (point) props.onCenter(point.x + point.w / 2, point.y + 22);
      return;
    }
    const x = (props.viewWidth / 2 - props.pan.x) / props.scale, y = (props.viewHeight / 2 - props.pan.y) / props.scale;
    const dx = props.viewWidth / props.scale / 2, dy = props.viewHeight / props.scale / 2;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      props.onCenter(Math.max(0, Math.min(props.width, x + (event.key === "ArrowLeft" ? -dx : event.key === "ArrowRight" ? dx : 0))), Math.max(0, Math.min(props.height, y + (event.key === "ArrowUp" ? -dy : event.key === "ArrowDown" ? dy : 0))));
    }
  }}>
    <rect className="tree-overview-bg" width="140" height="84" rx="8"/>
    <g transform="translate(6 6)">
      <path className="tree-overview-density" d={schematic[1]}/>
      <path className="tree-overview-node" d={schematic[2]}/>
      <path className="tree-overview-node path" d={schematic[3]}/>
      {selected && <rect className="tree-overview-node selected" x={selected.x * sx} y={(selected.y + 10) * sy} width={Math.max(2, selected.w * sx)} height={Math.max(2, 24 * sy)} rx=".6"/>}
      {right >= left && bottom >= top && <rect className="tree-overview-window" x={left * sx} y={top * sy} width={Math.max(2, (right - left) * sx)} height={Math.max(2, (bottom - top) * sy)}/>}
    </g>
  </svg>;
}
