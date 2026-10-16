// vcf-corpus.ts — 题源与素材装载 + 类型（生成器已经换成 vcf-generator/lib 那台）。
// 素材 public/puzzles/vcf-material.json 等：763 道已解真题强制链（含 2026-10-04 三手素材、
// 2026-10-06 一二手素材），供挑战题池轮转与现场补题（worker）取用；本模块只负责装载素材，
// 不再在本文件里出题。
//
// 旧的素材驱动生成器已于 2026-10-06 删除，原因是"都是一道题的形变"（用户报的）：
// 它把素材里的局面做旋转/镜像/位移（transform）或在其上做小幅原创变异（novel），
// 连着出几道看着都像同一道。现在出题统一走 vcf-generator/lib/browser.mjs 的 generate()
// 从空盘重新构造（挑战页与「棋题生成器」页均已改用）。
import type { Player, Position } from "../../types";

export type VcfTier = "short" | "middle" | "deep";
export const VCF_TIER_LABEL: Record<VcfTier, string> = { short: "短 (1–6 手)", middle: "中 (7–12 手)", deep: "深 (13+ 手)" };
export type VcfGenMode = "transform" | "novel";

// 素材文件紧凑格式（由独立工具 corpus/solved-kept.json 导出）
export interface MaterialItem { i: number; a: "black" | "white"; d: number | null; u: 0 | 1; f: number | null; b: Array<[number, number]>; w: Array<[number, number]>; l: Array<[number, number, number]> }
export interface MaterialFile { v: number; count: number; items: MaterialItem[] }
let materialCache: MaterialFile | null = null;
let materialPromise: Promise<MaterialFile | null> | null = null;

/** 素材文件清单：主素材 + 三手素材（2026-10-04 从 16.5 万局 RIF 库挖出并八向去重，1014 道）
 *  + 一二手素材（2026-10-06 同一库挖出、本机重解复核，1000 道）。
 *  三个文件的 i 都从 0 起，合并时给后一个加偏移，避免 id 撞车。 */
const MATERIAL_FILES: Array<{ file: string; offset: number }> = [
  { file: "puzzles/vcf-material.json", offset: 0 },
  { file: "puzzles/vcf-material-3.json", offset: 1_000_000 },
  { file: "puzzles/vcf-material-12.json", offset: 2_000_000 },
];

/** 载入素材库（一次 fetch，进程内缓存；多文件合并）。 */
export function loadVcfMaterial(): Promise<MaterialFile | null> {
  if (materialCache) return Promise.resolve(materialCache);
  if (materialPromise) return materialPromise;
  // 按构建 base 取路径（网页版挂在子路径时站点根写法会 404）。素材只在主线程
  // 载入，worker 侧由调用方随请求传入（见 vcf-gen.worker.ts 头部注释）。
  materialPromise = Promise.all(MATERIAL_FILES.map((spec) =>
    fetch(`${import.meta.env.BASE_URL}${spec.file}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const file = data as MaterialFile | null;
        if (!file || !Array.isArray(file.items)) return [] as MaterialItem[];
        return file.items.map((it) => ({ ...it, i: it.i + spec.offset }));
      })
      .catch(() => [] as MaterialItem[]),
  )).then((lists) => {
    const items = lists.flat();
    materialCache = items.length ? { v: 1, count: items.length, items } : null;
    return materialCache;
  }).catch(() => null);
  return materialPromise;
}

export interface GeneratedVcfPuzzle {
  title: string;
  /** 题面路数。挑战页当前只接收 15 路；扩展题由生成器/查看页消费。 */
  size: number;
  rules: "renju";
  attacker: Player;
  black: Position[];
  white: Position[];
  solution: Array<Position & { player: Player; note: string }>;
  depth: number;
  uniqueFirst: boolean;
  novel: boolean;
  fallback: string | null;
  sourceIndex: number;
}

const coordNameFor = (p: Position, size: number) => `${String.fromCharCode(65 + p.col)}${size - p.row}`;

/** 导出半步五子棋/开宝兼容的题库 JSON（自动入库用）。 */
export function toKaibaoCollectionJson(puzzles: GeneratedVcfPuzzle[], title: string): string {
  const stamp = title;
  return JSON.stringify({
    title: stamp,
    source: "VCF 生成器",
    license: "本地生成",
    puzzles: puzzles.map((p) => ({
      title: p.title,
      size: p.size,
      blackStones: p.black.map((stone) => coordNameFor(stone, p.size)).join(""),
      whiteStones: p.white.map((stone) => coordNameFor(stone, p.size)).join(""),
      side: p.attacker,
      rule: p.rules,
      difficulty: Math.min(5, Math.max(1, Math.round(p.depth / 2))),
      prompt: `${p.attacker === "white" ? "白" : "黑"}先，${p.depth} 手连续冲四胜（VCF）`,
      comment: `正解：${p.solution.filter((m) => m.player === p.attacker).map((stone) => coordNameFor(stone, p.size)).join(" → ")}`,
    })),
  });
}
