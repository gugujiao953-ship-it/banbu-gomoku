/**
 * Layout helpers for the record tree.
 *
 * A depth-only layout makes a wide fork an extremely tall single column.  This
 * layout keeps the familiar left-to-right direction for normal branches, but
 * packs a wide fork into a small grid of complete subtrees.  The result is a
 * real position for every node, so hit testing, navigation and edge clipping
 * continue to work without a separate visual-only representation.
 */

export interface TreeLayoutPoint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreeLayoutOptions<T> {
  getWidth: (entry: T) => number;
  getHeight?: (entry: T) => number;
  xGap?: number;
  yGap?: number;
  /** A fork larger than this is packed into multiple horizontal lanes. */
  wideForkThreshold?: number;
  /** Keep the graph readable on narrow screens while still reducing height. */
  maxForkColumns?: number;
  /** Main-line children are placed first in their parent's grid. */
  isMainLine?: (entry: T) => boolean;
}

interface TreeLayoutMetric {
  width: number;
  height: number;
  nodeY: number;
  children: { id: string; x: number; y: number; railY?: number }[];
}

interface LayoutFrame {
  id: string;
  x: number;
  y: number;
}

function forkGrid(metrics: readonly TreeLayoutMetric[], columns: number, xGap: number, yGap: number, header: number) {
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: Math.ceil(metrics.length / columns) }, () => 0);
  metrics.forEach((metric, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], metric.width);
    rowHeights[row] = Math.max(rowHeights[row], metric.height);
  });
  const width = columnWidths.reduce((sum, value) => sum + value, 0) + xGap * (columns - 1);
  const height = rowHeights.reduce((sum, value) => sum + value + header, 0) + yGap * (rowHeights.length - 1);
  return { columnWidths, rowHeights, width, height };
}

export interface TreeLayoutResult {
  points: Map<string, TreeLayoutPoint>;
  width: number;
  height: number;
  wideForks: number;
  /** Parents whose direct children were packed into a horizontal grid. */
  gridParents: ReadonlySet<string>;
  /** Bus height for each child of a grid fork, above its entire subtree. */
  edgeRails: ReadonlyMap<string, number>;
}

const finitePositive = (value: number | undefined, fallback: number) => Number.isFinite(value) && (value as number) > 0 ? value as number : fallback;

/**
 * Compute a non-overlapping layout iteratively.  Iteration matters here: a
 * library record can contain thousands of consecutive moves and must not hit
 * the JavaScript call-stack limit while it is being expanded.
 */
export function assignTreeLayout<T extends { id: string; parentId: string | null }>(entries: readonly T[], options: TreeLayoutOptions<T>): TreeLayoutResult {
  const xGap = finitePositive(options.xGap, 30);
  const yGap = finitePositive(options.yGap, 14);
  const wideForkThreshold = Math.max(1, Math.floor(finitePositive(options.wideForkThreshold, 4)));
  const maxForkColumns = Math.max(1, Math.floor(finitePositive(options.maxForkColumns, 4)));
  const heightOf = options.getHeight ?? (() => 44);
  const byId = new Map<string, T>();
  const order = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    if (byId.has(entry.id)) continue;
    byId.set(entry.id, entry);
    order.set(entry.id, index);
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const entry of byId.values()) {
    if (!entry.parentId || !byId.has(entry.parentId)) roots.push(entry.id);
    else {
      const list = children.get(entry.parentId) ?? [];
      list.push(entry.id);
      children.set(entry.parentId, list);
    }
  }
  // A stable priority keeps the primary line in the first slot while preserving
  // the record's order for all other candidates.
  const priority = options.isMainLine ?? (() => false);
  for (const list of children.values()) list.sort((a, b) => Number(priority(byId.get(b)!)) - Number(priority(byId.get(a)!)) || (order.get(a)! - order.get(b)!));

  const reachable: string[] = [];
  const seen = new Set<string>();
  const visitStack = [...roots].reverse();
  while (visitStack.length) {
    const id = visitStack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    reachable.push(id);
    const list = children.get(id) ?? [];
    for (let index = list.length - 1; index >= 0; index -= 1) visitStack.push(list[index]);
  }
  // Detached/cyclic records should still be visible instead of silently
  // disappearing from the canvas.
  for (const entry of entries) if (!seen.has(entry.id)) { seen.add(entry.id); reachable.push(entry.id); }

  const metrics = new Map<string, TreeLayoutMetric>();
  let wideForks = 0;
  const gridParents = new Set<string>();
  for (let index = reachable.length - 1; index >= 0; index -= 1) {
    const id = reachable[index];
    const entry = byId.get(id)!;
    const width = finitePositive(options.getWidth(entry), 132);
    const height = finitePositive(heightOf(entry), 44);
    // Keep the small-fork rhythm used by the previous lane layout. The extra
    // breathing room makes the vertical connector visibly belong to its own
    // sibling branch, while wide forks still gain most of their savings from
    // being packed into columns.
    const forkGap = yGap + (height + yGap) * 0.35;
    const childIds = (children.get(id) ?? []).filter((childId) => metrics.has(childId));
    if (!childIds.length) {
      metrics.set(id, { width, height, nodeY: 0, children: [] });
      continue;
    }

    const childMetrics = childIds.map((childId) => ({ id: childId, metric: metrics.get(childId)! }));
    const railInset = Math.max(6, xGap / 4);
    const rowHeader = 2 * railInset;
    const subtreeMetrics = childMetrics.map(({ metric }) => metric);
    let columns = 1;
    let grid = forkGrid(subtreeMetrics, columns, xGap, forkGap, 0);
    // Compare the actual subtree shapes rather than just the child count.
    // Short candidates benefit from columns; long lines need vertical lanes
    // so their entire continuations are not repeated side by side off screen.
    let footprint = Math.max(grid.width / 1.6, grid.height);
    if (childIds.length > wideForkThreshold) for (let candidate = 2; candidate <= Math.min(maxForkColumns, childIds.length); candidate += 1) {
      const next = forkGrid(subtreeMetrics, candidate, xGap, forkGap, rowHeader);
      const nextFootprint = Math.max(next.width / 1.6, next.height);
      if (nextFootprint < footprint) { columns = candidate; grid = next; footprint = nextFootprint; }
    }
    if (columns === 1) {
      let regionHeight = 0;
      let regionWidth = 0;
      for (const { metric } of childMetrics) {
        regionHeight += metric.height;
        regionWidth = Math.max(regionWidth, metric.width);
      }
      regionHeight += forkGap * Math.max(0, childMetrics.length - 1);
      const nodeY = childMetrics[0].metric.nodeY;
      const totalHeight = Math.max(nodeY + height, regionHeight);
      const placements: { id: string; x: number; y: number }[] = [];
      let y = 0;
      for (const { id: childId, metric } of childMetrics) {
        placements.push({ id: childId, x: width + xGap, y });
        y += metric.height + forkGap;
      }
      metrics.set(id, { width: width + xGap + regionWidth, height: totalHeight, nodeY, children: placements });
      continue;
    }

    wideForks += 1;
    gridParents.add(id);
    const { columnWidths, rowHeights, width: regionWidth, height: regionHeight } = grid;
    // Include bus space in each row's bounds. Nested grids get their own
    // channel rather than sharing an ancestor's line above the same cards.
    const nodeY = rowHeader + childMetrics[0].metric.nodeY;
    const totalHeight = Math.max(nodeY + height, regionHeight);
    const columnX: number[] = [];
    let x = width + xGap;
    for (const columnWidth of columnWidths) {
      columnX.push(x);
      x += columnWidth + xGap;
    }
    const rowY: number[] = [];
    let y = 0;
    for (const rowHeight of rowHeights) {
      rowY.push(y);
      y += rowHeader + rowHeight + forkGap;
    }
    const placements = childMetrics.map(({ id: childId }, childIndex) => ({
      id: childId,
      x: columnX[childIndex % columns],
      y: rowY[Math.floor(childIndex / columns)] + rowHeader,
      // The first child is adjacent and aligned: its primary line stays straight.
      railY: childIndex === 0 ? undefined : rowY[Math.floor(childIndex / columns)] + railInset,
    }));
    metrics.set(id, { width: width + xGap + regionWidth, height: totalHeight, nodeY, children: placements });
  }

  const points = new Map<string, TreeLayoutPoint>();
  const edgeRails = new Map<string, number>();
  // Roots are normally a single record root. For malformed documents, place
  // detached roots below one another so no node is lost or overdrawn.
  let rootOffset = 0;
  for (const root of roots) {
    const rootMetric = metrics.get(root);
    if (!rootMetric) continue;
    const placeStack: LayoutFrame[] = [{ id: root, x: 0, y: rootOffset }];
    while (placeStack.length) {
      const frame = placeStack.pop()!;
      const metric = metrics.get(frame.id);
      const entry = byId.get(frame.id);
      if (!metric || !entry || points.has(frame.id)) continue;
      const width = finitePositive(options.getWidth(entry), 132);
      const height = finitePositive(heightOf(entry), 44);
      points.set(frame.id, { x: frame.x, y: frame.y + metric.nodeY, w: width, h: height });
      for (let index = metric.children.length - 1; index >= 0; index -= 1) {
        const child = metric.children[index];
        if (child.railY !== undefined) edgeRails.set(child.id, frame.y + child.railY);
        if (metrics.has(child.id)) placeStack.push({ id: child.id, x: frame.x + child.x, y: frame.y + child.y });
      }
    }
    rootOffset += rootMetric.height + yGap;
  }
  // Any node omitted because of a malformed cycle gets a safe detached slot.
  for (const entry of entries) if (!points.has(entry.id)) {
    points.set(entry.id, { x: 0, y: rootOffset, w: finitePositive(options.getWidth(entry), 132), h: finitePositive(heightOf(entry), 44) });
    rootOffset += finitePositive(heightOf(entry), 44) + yGap;
  }

  let graphWidth = 0;
  let graphHeight = 0;
  for (const point of points.values()) {
    graphWidth = Math.max(graphWidth, point.x + point.w);
    graphHeight = Math.max(graphHeight, point.y + point.h);
  }
  return { points, width: graphWidth, height: graphHeight, wideForks, gridParents, edgeRails };
}
