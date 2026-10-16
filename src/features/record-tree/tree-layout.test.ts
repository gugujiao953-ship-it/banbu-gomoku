import { describe, expect, it } from "vitest";
import { assignTreeLayout } from "./tree-layout";
import { treeEdgeRoute } from "./tree-viewport";

type Entry = { id: string; parentId: string | null };
const layout = (entries: readonly Entry[]) => assignTreeLayout(entries, {
  getWidth: () => 100,
  getHeight: () => 40,
  xGap: 20,
  yGap: 10,
  wideForkThreshold: 4,
  maxForkColumns: 4,
});

describe("assignTreeLayout", () => {
  it("keeps a normal continuation horizontal", () => {
    const result = layout([
      { id: "root", parentId: null },
      { id: "a", parentId: "root" },
      { id: "b", parentId: "a" },
    ]);
    expect(result.points.get("root")).toMatchObject({ x: 0, y: 0 });
    expect(result.points.get("a")).toMatchObject({ x: 120, y: 0 });
    expect(result.points.get("b")).toMatchObject({ x: 240, y: 0 });
    expect(result.wideForks).toBe(0);
  });

  it("packs a wide fork into several horizontal lanes", () => {
    const entries: Entry[] = [{ id: "root", parentId: null }];
    for (let index = 0; index < 12; index += 1) entries.push({ id: `b${index}`, parentId: "root" });
    const result = layout(entries);
    const children = entries.slice(1).map((entry) => result.points.get(entry.id)!);
    expect(result.wideForks).toBe(1);
    expect(result.gridParents.has("root")).toBe(true);
    expect(new Set(children.map((point) => point.x)).size).toBe(4);
    expect(new Set(children.map((point) => point.y)).size).toBe(3);
    expect(result.height).toBeLessThan(12 * 50);
    for (const point of children) expect(point.x).toBeGreaterThan(100);
  });

  it("lays out complete child subtrees without overlap", () => {
    const entries: Entry[] = [{ id: "root", parentId: null }];
    for (let index = 0; index < 8; index += 1) {
      const child = `b${index}`;
      entries.push({ id: child, parentId: "root" }, { id: `${child}-1`, parentId: child }, { id: `${child}-2`, parentId: `${child}-1` });
    }
    const result = layout(entries);
    expect(result.wideForks).toBe(1);
    for (const entry of entries.filter((item) => item.parentId === "root")) {
      const child = result.points.get(entry.id)!;
      const continuation = result.points.get(`${entry.id}-1`);
      expect(continuation?.x).toBeGreaterThan(child.x);
      expect(continuation?.y).toBe(child.y);
    }
    const points = [...result.points.values()];
    for (let index = 0; index < points.length; index += 1) for (const other of points.slice(index + 1)) {
      const point = points[index];
      expect(point.x + point.w <= other.x || other.x + other.w <= point.x || point.y + point.h <= other.y || other.y + other.h <= point.y).toBe(true);
    }
  });

  it("handles deep chains without recursion", () => {
    const entries: Entry[] = [];
    for (let index = 0; index < 12000; index += 1) entries.push({ id: `n${index}`, parentId: index ? `n${index - 1}` : null });
    const result = layout(entries);
    expect(result.points.size).toBe(entries.length);
    expect(result.points.get("n11999")).toMatchObject({ x: 11999 * 120, y: 0 });
  });

  it("keeps long continuations in lanes instead of multiplying their width", () => {
    const entries: Entry[] = [{ id: "root", parentId: null }];
    for (let branch = 0; branch < 12; branch += 1) for (let move = 0; move < 30; move += 1) {
      entries.push({ id: `b${branch}-${move}`, parentId: move ? `b${branch}-${move - 1}` : "root" });
    }
    const result = layout(entries);
    expect(result.points.size).toBe(entries.length);
    expect(result.width).toBe(31 * 100 + 30 * 20);
    const heads = entries.filter((entry) => entry.parentId === "root").map((entry) => result.points.get(entry.id)!);
    expect(new Set(heads.map((point) => point.x)).size).toBe(1);
    expect(new Set(heads.map((point) => point.y)).size).toBe(12);
  });

  it("主线优先且水平，嵌套宽分叉的节点与连线均不穿过其他节点", () => {
    const entries: Entry[] = [{ id: "root", parentId: null }];
    const main = new Set(["root", "b5", "b5-5"]);
    for (let i = 0; i < 8; i += 1) {
      const id = `b${i}`;
      entries.push({ id, parentId: "root" });
      for (let j = 0; j < 6; j += 1) {
        const child = `${id}-${j}`;
        entries.push({ id: child, parentId: id });
        if ((i + j) % 3 === 0) entries.push({ id: `${child}-end`, parentId: child });
      }
    }
    const result = assignTreeLayout(entries, { getWidth: (entry) => entry.id.endsWith("end") ? 64 : 132, isMainLine: (entry) => main.has(entry.id) });
    expect(result.points.size).toBe(entries.length);
    const primaryY = result.points.get("root")!.y;
    for (const id of main) expect(result.points.get(id)!.y).toBe(primaryY);
    expect(result.points.get("b5")!.x).toBeLessThan(result.points.get("b0")!.x);
    expect(result.edgeRails.has("b5")).toBe(false);
    expect(result.edgeRails.has("b5-5")).toBe(false);
    const boxes = [...result.points.values()];
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i], b = boxes[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    for (const entry of entries) {
      if (!entry.parentId) continue;
      const parent = result.points.get(entry.parentId)!, child = result.points.get(entry.id)!;
      const route = treeEdgeRoute(parent, child, result.edgeRails.get(entry.id));
      for (let i = 1; i < route.length; i += 1) {
        const a = route[i - 1], b = route[i];
        for (const box of boxes) {
          const crosses = a.y === b.y
            ? a.y > box.y && a.y < box.y + box.h && Math.min(a.x, b.x) < box.x + box.w && Math.max(a.x, b.x) > box.x
            : a.x > box.x && a.x < box.x + box.w && Math.min(a.y, b.y) < box.y + box.h && Math.max(a.y, b.y) > box.y;
          expect(crosses, `${entry.parentId} → ${entry.id}`).toBe(false);
        }
      }
    }
  });
});
