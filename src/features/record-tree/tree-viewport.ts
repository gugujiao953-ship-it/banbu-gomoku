export interface TreeBounds { left: number; top: number; right: number; bottom: number }
export interface TreePoint { x: number; y: number; w: number }
export interface TreeEdgeVertex { x: number; y: number }
export type TreeEdgeRoute = readonly TreeEdgeVertex[];

export function treeViewportBounds(pan: { x: number; y: number }, scale: number, width: number, height: number, margin = 80): TreeBounds {
  return { left: (-pan.x - margin) / scale, top: (-pan.y - margin) / scale,
    right: (width - pan.x + margin) / scale, bottom: (height - pan.y + margin) / scale };
}

/** Depth columns with a balanced interval index. Long fork stems can cross a
 * viewport while both endpoint nodes are off screen, so indexing points alone is insufficient. */
export function createTreeSpatialIndex<T>(items: readonly T[], boundsOf: (item: T) => TreeBounds) {
  const grouped = new Map<number, { item: T; box: TreeBounds }[]>();
  for (const item of items) {
    const box = boundsOf(item), column = grouped.get(box.left) ?? [];
    column.push({ item, box }); grouped.set(box.left, column);
  }
  const columns = [...grouped].sort((a, b) => a[0] - b[0]).map(([left, items]) => {
    items.sort((a, b) => a.box.top - b.box.top);
    const maxBottom = new Float64Array(items.length);
    const build = (start: number, end: number): number => {
      if (start >= end) return -Infinity;
      const mid = (start + end) >>> 1;
      return maxBottom[mid] = Math.max(items[mid].box.bottom, build(start, mid), build(mid + 1, end));
    };
    build(0, items.length);
    return { left, right: items.reduce((max, item) => Math.max(max, item.box.right), left), items, maxBottom };
  });
  const prefixRight = new Float64Array(columns.length);
  columns.forEach((column, i) => { prefixRight[i] = Math.max(column.right, i ? prefixRight[i - 1] : -Infinity); });
  return (bounds: TreeBounds): T[] => {
    let lo = 0, hi = columns.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (prefixRight[mid] < bounds.left) lo = mid + 1; else hi = mid; }
    const result: T[] = [];
    for (let i = lo; i < columns.length && columns[i].left <= bounds.right; i += 1) {
      const column = columns[i];
      if (column.right < bounds.left) continue;
      const visit = (start: number, end: number) => {
        if (start >= end) return;
        const mid = (start + end) >>> 1;
        if (column.maxBottom[mid] < bounds.top || column.items[start].box.top > bounds.bottom) return;
        visit(start, mid);
        const { item, box } = column.items[mid];
        if (box.top <= bounds.bottom && box.bottom >= bounds.top && box.right >= bounds.left) result.push(item);
        if (box.top <= bounds.bottom) visit(mid + 1, end);
      };
      visit(0, column.items.length);
    }
    return result;
  };
}

/** One route is shared by drawing, clipping, the spatial index and the minimap. */
export function treeEdgeRoute(parent: TreePoint, child: TreePoint, railY?: number, gap = 30): TreeEdgeRoute {
  const x1 = parent.x + parent.w, y1 = parent.y + 22, x2 = child.x, y2 = child.y + 22;
  if (railY === undefined) {
    const mid = (x1 + x2) / 2;
    return [{ x: x1, y: y1 }, { x: mid, y: y1 }, { x: mid, y: y2 }, { x: x2, y: y2 }];
  }
  const gutter = Math.min(Math.max(12, gap), x2 - x1);
  const fanX = x1 + gutter / 3, approachX = x2 - gutter / 3;
  return [{ x: x1, y: y1 }, { x: fanX, y: y1 }, { x: fanX, y: railY },
    { x: approachX, y: railY }, { x: approachX, y: y2 }, { x: x2, y: y2 }];
}

export function treeEdgeBounds(route: TreeEdgeRoute): TreeBounds {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of route) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
  }
  return { left, top, right, bottom };
}

export function treeEdgePath(route: TreeEdgeRoute): string {
  return route.map((point, index) => index === 0 ? `M ${point.x} ${point.y}`
    // Routes alternate horizontal and vertical segments. Keep that direction
    // for zero-length turns too (a parent and its primary child share a lane).
    : index % 2 ? `H ${point.x}` : `V ${point.y}`).join(" ");
}

/** Clip orthogonal segments in either direction, even if both nodes are off screen. */
export function clippedTreeRoute(route: TreeEdgeRoute, bounds: TreeBounds): string[] {
  const paths: string[] = [];
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1], to = route[index];
    if (from.y === to.y) {
      const left = Math.max(Math.min(from.x, to.x), bounds.left), right = Math.min(Math.max(from.x, to.x), bounds.right);
      if (from.y >= bounds.top && from.y <= bounds.bottom && left <= right) paths.push(`M ${left} ${from.y} H ${right}`);
    } else {
      const top = Math.max(Math.min(from.y, to.y), bounds.top), bottom = Math.min(Math.max(from.y, to.y), bounds.bottom);
      if (from.x >= bounds.left && from.x <= bounds.right && top <= bottom) paths.push(`M ${from.x} ${top} V ${bottom}`);
    }
  }
  return paths;
}

export function clippedTreeEdge(parent: TreePoint, child: TreePoint, bounds: TreeBounds): string[] {
  return clippedTreeRoute(treeEdgeRoute(parent, child), bounds);
}

/** At distant zoom use screen-sized bins. Every node still has an exact position
 * in the layout; clicking a dense bin zooms into that region instead of hiding data. */
export function treeStructureBins<T extends { id: string }>(entries: readonly T[], points: ReadonlyMap<string, TreePoint>, scale: number, anchors: ReadonlySet<string>) {
  const bins = new Map<string, { entry: T; point: TreePoint; count: number }>();
  const result: { entry: T; point: TreePoint; count: number }[] = [];
  for (const entry of entries) {
    const point = points.get(entry.id)!;
    if (anchors.has(entry.id)) { result.push({ entry, point, count: 1 }); continue; }
    const key = `${Math.floor((point.x + point.w / 2) * scale / 12)}:${Math.floor((point.y + 22) * scale / 12)}`;
    const bin = bins.get(key);
    if (bin) bin.count += 1;
    else bins.set(key, { entry, point, count: 1 });
  }
  return [...bins.values(), ...result];
}
