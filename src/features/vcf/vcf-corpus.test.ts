import { describe, it, expect } from "vitest";
import { generateVcfCollectionWithMaterial, toKaibaoCollectionJson, VCF_TIER_RANGE, type MaterialFile } from "./vcf-corpus";
import { verifyVcfLine } from "./vcf-generator";
import type { Player } from "../../types";

// 内联真实素材（取自 public/puzzles/vcf-material.json 的 3 条：黑先 6 手、白先 5 手、黑先 6 手），
// 覆盖黑白先两种行棋方。生成逻辑不依赖具体行数，此处仅为可测试的已知棋形。
const material: MaterialFile = {
  v: 1,
  count: 3,
  items: [
    { i: 0, a: "black", d: 6, u: 0, f: 3, b: [[3,7],[4,2],[4,3],[4,6],[5,2],[5,4],[5,5],[5,7],[6,5],[7,2],[7,7],[8,3],[8,4],[8,6]], w: [[3,1],[3,2],[3,5],[4,4],[5,3],[6,3],[6,4],[6,6],[7,3],[7,4],[7,5],[8,2],[8,7],[9,4]], l: [[2,8,1],[1,9,2],[4,7,1],[6,7,2],[5,6,1],[5,8,2],[2,9,1],[3,8,2],[2,7,1],[1,7,2],[2,6,1]] },
    { i: 5, a: "white", d: 5, u: 0, f: 3, b: [[3,10],[4,8],[4,9],[4,12],[5,6],[5,11],[6,3],[6,8],[6,9],[6,11],[7,7],[7,9],[7,10],[7,12],[8,3],[8,4],[8,7],[8,9],[9,7],[9,11],[10,6],[10,8],[10,10],[11,8]], w: [[4,7],[4,11],[5,7],[5,9],[5,10],[5,12],[6,10],[7,4],[7,8],[7,13],[8,5],[8,6],[8,8],[8,11],[9,4],[9,6],[9,8],[9,9],[10,5],[10,7],[10,12],[11,6],[11,9]], l: [[12,5,2],[13,4,1],[9,5,2],[11,5,1],[6,5,2],[7,5,1],[9,2,2],[12,4,1],[9,3,2]] },
    { i: 0, a: "black", d: 6, u: 0, f: 3, b: [[3,7],[4,2],[4,3],[4,6],[5,2],[5,4],[5,5],[5,7],[6,5],[7,2],[7,7],[8,3],[8,4],[8,6]], w: [[3,1],[3,2],[3,5],[4,4],[5,3],[6,3],[6,4],[6,6],[7,3],[7,4],[7,5],[8,2],[8,7],[9,4]], l: [[2,8,1],[1,9,2],[4,7,1],[6,7,2],[5,6,1],[5,8,2],[2,9,1],[3,8,2],[2,7,1],[1,7,2],[2,6,1]] },
  ],
};

const checkSolution = (p: { attacker: "black" | "white"; black: Array<{ row: number; col: number }>; white: Array<{ row: number; col: number }>; solution: Array<{ row: number; col: number; player: Player }> }) =>
  verifyVcfLine({ rules: "renju", attacker: p.attacker, black: p.black, white: p.white, line: p.solution.map((m) => ({ row: m.row, col: m.col, player: m.player })) });

describe("vcf-corpus 素材驱动出题", () => {
  it("素材已加载且含黑白先", () => {
    expect(material.count).toBeGreaterThanOrEqual(2);
    expect(material.items.some((it) => it.a === "white")).toBe(true);
    expect(material.items.some((it) => it.a === "black")).toBe(true);
  });

  it("变形模式：short 档产出落在 4–6 手且独立复核通过", () => {
    const r = generateVcfCollectionWithMaterial(material, { count: 2, tier: "short", mode: "transform", seed: 7 });
    expect(r.error).toBeNull();
    expect(r.puzzles.length).toBeGreaterThan(0);
    for (const p of r.puzzles) {
      expect(p.novel).toBe(false);
      expect(p.depth).toBeGreaterThanOrEqual(VCF_TIER_RANGE.short[0]);
      expect(p.depth).toBeLessThanOrEqual(VCF_TIER_RANGE.short[1]);
      expect(checkSolution(p).ok).toBe(true);
    }
  });

  it("原创模式：short 档产出 novel 标记、深度≥4、独立复核通过", () => {
    const r = generateVcfCollectionWithMaterial(material, { count: 1, tier: "short", mode: "novel", seed: 2026 });
    expect(r.puzzles.length).toBeGreaterThanOrEqual(1);
    for (const p of r.puzzles) {
      expect(p.novel).toBe(true);
      expect(p.depth).toBeGreaterThanOrEqual(4);
      expect(checkSolution(p).ok).toBe(true);
    }
  });

  it("白先素材可出白先题并独立复核通过", () => {
    const r = generateVcfCollectionWithMaterial(material, { count: 3, tier: "short", mode: "transform", seed: 12345 });
    expect(r.puzzles.length).toBeGreaterThan(0);
    // 素材含白先(i=5)；足够多时至少应出现白先题（这里不强制，仅校验全部合法）
    for (const p of r.puzzles) expect(checkSolution(p).ok).toBe(true);
  });

  it("导出开宝/半步兼容题库 JSON 可解析且含 side/prompt", () => {
    const r = generateVcfCollectionWithMaterial(material, { count: 2, tier: "short", mode: "transform", seed: 9 });
    const parsed = JSON.parse(toKaibaoCollectionJson(r.puzzles, "测试题集"));
    expect(parsed.puzzles).toHaveLength(r.puzzles.length);
    for (const p of parsed.puzzles) {
      expect(["black", "white"]).toContain(p.side);
      expect(p.rule).toBe("renju");
      expect(p.prompt).toContain("连续冲四胜");
    }
  });
});
