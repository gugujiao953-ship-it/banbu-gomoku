// pool-report.test.ts — 预设题库盘点（也是防误删的回归门：预设数据文件缺失/被清空会红）。
import { describe, expect, it } from "vitest";
// @ts-expect-error Node 只在 Vitest 下可用，浏览器应用里没有这些类型（同仓库其它测试约定）。
import { readFileSync } from "node:fs";
import { importKaibaoPuzzleJson } from "../../puzzles";

const pub = (name: string) => readFileSync(new URL(`../../../public/puzzles/${name}`, import.meta.url), "utf8");

// 与挑战同一口径（2026-10-06 起一二手题入库，短档下沿到 1 手）：短 1–6 / 中 7–12 / 深 13+
const tierOf = (depth: number) => (depth < 3 ? null : depth <= 6 ? "短3-6" : depth <= 12 ? "中7-12" : depth <= 40 ? "深13+" : null);

describe("VCF 挑战预设题库盘点", () => {
  it("素材池：条数 + 档位/攻方分布", () => {
    const material = JSON.parse(pub("vcf-material.json")) as { items: Array<{ a: "black" | "white"; d: number | null; l: Array<[number, number, number]> }> };
    const buckets = new Map<string, number>();
    for (const it of material.items) {
      const code = it.a === "white" ? 2 : 1;
      const depth = typeof it.d === "number" && it.d > 0 ? it.d : it.l.filter((m) => m[2] === code).length;
      const tier = tierOf(depth);
      if (!tier) continue;
      const key = `${tier}/${it.a}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    console.log("ANSWER material=" + material.items.length + " " + JSON.stringify(Object.fromEntries([...buckets].sort())));
    expect(material.items.length).toBeGreaterThan(500);
  });

  it("验证批次：三个文件各自的题数与档位分布", () => {
    const files = ["vcf-batch-1001.json", "vcf-batch-2002.json", "vcf-batch-3003.json"];
    const buckets = new Map<string, number>();
    let total = 0;
    for (const f of files) {
      const puzzles = (JSON.parse(pub(f)) as { puzzles: Array<{ side: "black" | "white"; comment?: string; prompt?: string }> }).puzzles;
      const depthOf = (p: { comment?: string; prompt?: string }) => {
        const sol = /正解：(.+)$/m.exec(p.comment ?? "");
        if (sol) return (sol[1].match(/[A-O]\d{1,2}/g) ?? []).length;
        return Number(/(\d+)\s*手/.exec(p.prompt ?? "")?.[1] ?? 0);
      };
      for (const p of puzzles) {
        total += 1;
        const tier = tierOf(depthOf(p));
        if (!tier) continue;
        const key = `${tier}/${p.side}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    console.log("ANSWER batches=" + total + " " + JSON.stringify(Object.fromEntries([...buckets].sort())));
    expect(total).toBeGreaterThan(4000);
  });


  it("三手素材（从 16.5 万局挖出）已并入预设池", () => {
    const three = JSON.parse(pub("vcf-material-3.json")) as { count: number; items: Array<{ a: "black" | "white"; d: number | null; b: unknown[]; w: unknown[]; l: unknown[] }> };
    const blacks = three.items.filter((it) => it.a === "black").length;
    console.log("ANSWER material3=" + three.items.length + " black=" + blacks + " white=" + (three.items.length - blacks));
    expect(three.items.length).toBeGreaterThanOrEqual(1000);          // 目标 ~1000 道
    expect(three.items.every((it) => it.d === 3)).toBe(true);          // 全部三手
    expect(three.items.every((it) => it.l.length > 0)).toBe(true);     // 每条都带解线
  });

  it("一二手素材（2026-10-06 从 RIF 对局库挖出、本机重解复核；10-06 减半到各 250）已并入预设池", () => {
    const one = JSON.parse(pub("vcf-material-12.json")) as { count: number; items: Array<{ a: "black" | "white"; d: number; b: unknown[]; w: unknown[]; l: Array<[number, number, number]> }> };
    const count = (d: number, a: string) => one.items.filter((it) => it.d === d && it.a === a).length;
    console.log("ANSWER material12=" + one.items.length
      + " 1手黑=" + count(1, "black") + " 1手白=" + count(1, "white")
      + " 2手黑=" + count(2, "black") + " 2手白=" + count(2, "white"));
    // 用户 10-06：一二手太简单，各减半 → 每个手数 500 道、黑白各 250；每道都要有解线且解线首手是攻方
    expect(one.items.length).toBe(1000);
    expect(one.count).toBe(1000);
    for (const d of [1, 2]) {
      expect(count(d, "black")).toBe(250);
      expect(count(d, "white")).toBe(250);
    }
    expect(one.items.every((it) => it.l.length === it.d * 2 - 1)).toBe(true);
    expect(one.items.every((it) => it.b.length > 0 && it.w.length > 0)).toBe(true);
  });

  it("vcf-meta.json 覆盖新并入的一二手题（id 带 2_000_000 偏移、减半后 1000 条）", () => {
    const meta = JSON.parse(pub("vcf-meta.json")) as Record<string, { d: number }>;
    const mine = Object.keys(meta).filter((k) => /^m-2\d{6}$/.test(k));
    console.log("ANSWER meta m-2*=" + mine.length);
    expect(mine.length).toBe(1000);
    expect(mine.every((k) => meta[k].d === 1 || meta[k].d === 2)).toBe(true);
  });

  it("开宝题库 VCF 集：应用导入器能留下多少可做题", () => {
    const files = ["kaibao/RenjuPortalVCF.json", "kaibao/实战VCF_1052题.json", "kaibao/白先VCF_puzzle.json"];
    for (const f of files) {
      const report = importKaibaoPuzzleJson(pub(f), f);
      console.log("ANSWER kaibao " + f + " playable=" + report.collection.puzzles.length + " skipped=" + report.skipped);
      expect(report.collection.puzzles.length).toBeGreaterThan(0);
    }
  });

  it("超算修复表 vcf-repair.json：坏题标记与修复线都合法（用户 10-06 报的「答案全黑且赢不了」）", () => {
    const table = JSON.parse(pub("vcf-repair.json")) as Record<string, { bad?: true; d?: number; e?: string; line?: number[][] }>;
    const keys = Object.keys(table);
    let bad = 0, fixed = 0;
    for (const [id, v] of Object.entries(table)) {
      expect(id, `id 形状 ${id}`).toMatch(/^(m-\d+|b-\d+-\d+)$/);
      if (v.bad) { bad += 1; continue; }
      fixed += 1;
      const line = v.line ?? [];
      expect(line.length, `${id} 修复线非空`).toBeGreaterThan(1);
      for (let i = 1; i < line.length; i += 1) expect(line[i][2], `${id} 第 ${i + 1} 手应换边`).not.toBe(line[i - 1][2]);
      const cells = new Set(line.map(([r, c]) => r * 15 + c));
      expect(cells.size, `${id} 落点不重复`).toBe(line.length);
      for (const [r, c] of line) {
        expect(r >= 0 && r < 15 && c >= 0 && c < 15, `${id} 坐标在盘内`).toBe(true);
      }
      // 手数 = 攻方着数，且不超过静态池天花板（修复线只对 ≤13 手做）
      expect(v.d, `${id} 带手数`).toBe(line.filter(([, , p]) => p === line[0][2]).length);
      expect(v.d!, `${id} 手数 ≤13`).toBeLessThanOrEqual(13);
    }
    console.log(`ANSWER repair bad=${bad} fixed=${fixed}`);
    expect(keys.length).toBeGreaterThan(100);
    expect(bad).toBeGreaterThan(0);
  });
});
