import { describe, expect, it } from "vitest";
import { clippedTreeEdge, clippedTreeRoute, createTreeSpatialIndex, treeEdgeBounds, treeEdgePath, treeEdgeRoute, treeStructureBins, treeViewportBounds } from "./tree-viewport";

describe("图谱视野绘制", () => {
  it("平移缩放后的可视范围包含屏幕边缘的预绘制区", () => {
    expect(treeViewportBounds({ x: -100, y: 30 }, 2, 400, 300, 40)).toEqual({ left: 30, top: -35, right: 270, bottom: 155 });
  });

  it("索引和完整相交检查一致，包含长连线与完全在屏外的端点", () => {
    let seed = 321;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const boxes = Array.from({ length: 10000 }, (_, id) => {
      const left = Math.floor(random() * 100) * 94, top = random() * 100000;
      return { id, left, top, right: left + 64 + random() * 100, bottom: top + random() * 20000 };
    });
    const query = createTreeSpatialIndex(boxes, (box) => box);
    for (let i = 0; i < 50; i += 1) {
      const left = random() * 10000, top = random() * 100000;
      const bounds = { left, top, right: left + 390, bottom: top + 600 };
      const expected = boxes.filter((box) => box.left <= bounds.right && box.right >= bounds.left && box.top <= bounds.bottom && box.bottom >= bounds.top).map((box) => box.id).sort((a, b) => a - b);
      expect(query(bounds).map((box) => box.id).sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it("两端都在屏外的分叉连线仍在屏内连续绘制", () => {
    const parent = { x: 0, y: -1000, w: 100 }, child = { x: 200, y: 1000, w: 100 };
    expect(clippedTreeEdge(parent, child, { left: 120, top: 0, right: 180, bottom: 200 })).toEqual(["M 150 0 V 200"]);
    expect(clippedTreeEdge(parent, child, { left: 210, top: 0, right: 310, bottom: 200 })).toEqual([]);
  });

  it("宽分叉的连线走行间总线，不穿过前面的栏位", () => {
    const parent = { x: 0, y: 0, w: 100 }, child = { x: 480, y: 0, w: 100 };
    const route = treeEdgeRoute(parent, child, -7.5);
    const paths = clippedTreeRoute(route, { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
    expect(treeEdgePath(route)).toBe("M 100 22 H 110 V -7.5 H 470 V 22 H 480");
    expect(paths).toContain("M 110 -7.5 V 22");
    expect(paths).toContain("M 110 -7.5 H 470");
    expect(paths).toContain("M 470 -7.5 V 22");
    expect(paths[paths.length - 1]).toBe("M 470 22 H 480");
  });

  it("节点全在视口下方时，上方总线仍被索引并连续裁剪", () => {
    const route = treeEdgeRoute({ x: 0, y: 20, w: 100 }, { x: 480, y: 20, w: 100 }, 5);
    const bounds = { left: 200, top: 0, right: 300, bottom: 10 };
    const query = createTreeSpatialIndex([route], treeEdgeBounds);
    expect(query(bounds)).toEqual([route]);
    expect(clippedTreeRoute(route, bounds)).toEqual(["M 200 5 H 300"]);
    expect(clippedTreeRoute(route, { left: 105, top: 10, right: 115, bottom: 40 })).toEqual(["M 110 10 V 40"]);
  });

  it("远景汇总保持所选与当前节点，并计入每个节点", () => {
    const entries = Array.from({ length: 10000 }, (_, i) => ({ id: `n${i}` }));
    const points = new Map(entries.map((entry, i) => [entry.id, { x: i % 100 * 94, y: Math.floor(i / 100) * 58, w: 64 }]));
    const bins = treeStructureBins(entries, points, .01, new Set(["n9999", "n1111"]));
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(10000);
    expect(bins.some((bin) => bin.entry.id === "n9999")).toBe(true);
    expect(bins.some((bin) => bin.entry.id === "n1111")).toBe(true);
    expect(bins.length).toBeLessThan(100);
    expect(entries.length).toBe(10000);
  });
});
