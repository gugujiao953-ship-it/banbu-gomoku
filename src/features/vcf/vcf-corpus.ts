// vcf-corpus.ts — 素材驱动的 VCF 出题（应用端）。
// 素材 public/puzzles/vcf-material.json：763 道已解真题强制链（黑先 518 / 白先 523 口径按奇偶，
// 含全库实测最短杀手数与制胜首手数）。三个根因修复（行棋方奇偶、whiteFourMoves 白方冲四、
// 黑方反击四禁手过滤）在 vcf-generator.ts；本模块只做“生成 + 独立复核”。
//
// 两种模式（回应“不要只会把原题换边”）：
//   transform —— 真题变形：D4 旋转/镜像 + 整体平移，严格保持连续冲四链结构与手数（题源不同朝向）；
//   novel —— 原创作曲：在真题骨架上对“保护区外”做删子/成对加子等变异并全量重解，
//     产出题库里不存在的全新局面（canonical 比对全部素材），新局面通常带新解线。
//     深档(≥12)原创产率极低（长链对变异敏感）→ 自动用真题变形补足并标注 fallback。
import { VCF_BLACK as BLACK, VCF_WHITE as WHITE, VCF_EMPTY as EMPTY, emptyVcfBoard, vcfFivePoints, solveVcf, verifyVcfLine, vcfCoordName } from "./vcf-generator";
import type { Player, Position } from "../../types";

const SIZE_N = 15;
const idx = (row: number, col: number) => row * SIZE_N + col;
const inside = (row: number, col: number) => row >= 0 && row < SIZE_N && col >= 0 && col < SIZE_N;

export type VcfTier = "short" | "middle" | "deep";
export const VCF_TIER_RANGE: Record<VcfTier, [number, number]> = { short: [4, 6], middle: [6, 12], deep: [12, 30] };
export const VCF_TIER_LABEL: Record<VcfTier, string> = { short: "短 (4–6 手)", middle: "中 (6–12 手)", deep: "深 (12–30 手)" };
export type VcfGenMode = "transform" | "novel";

// 素材文件紧凑格式（由独立工具 corpus/solved-kept.json 导出）
export interface MaterialItem { i: number; a: "black" | "white"; d: number | null; u: 0 | 1; f: number | null; b: Array<[number, number]>; w: Array<[number, number]>; l: Array<[number, number, number]> }
export interface MaterialFile { v: number; count: number; items: MaterialItem[] }
let materialCache: MaterialFile | null = null;
let materialPromise: Promise<MaterialFile | null> | null = null;

/** 载入素材库（一次 fetch，进程内缓存）。 */
export function loadVcfMaterial(): Promise<MaterialFile | null> {
  if (materialCache) return Promise.resolve(materialCache);
  if (materialPromise) return materialPromise;
  materialPromise = fetch("/puzzles/vcf-material.json").then((res) => (res.ok ? res.json() : null)).then((data) => {
    materialCache = (data as MaterialFile) || null;
    return materialCache;
  }).catch(() => null);
  return materialPromise;
}

export interface GeneratedVcfPuzzle {
  title: string;
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

const mulberry32 = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const shuffled = <T,>(arr: T[], rnd: () => number): T[] => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); const tmp = a[i]; a[i] = a[j]; a[j] = tmp; } return a; };

const dihedral = (p: Position, rot: number, mirror: boolean): Position => {
  let r = p.row, c = p.col;
  for (let i = 0; i < rot; i += 1) { const nr = c, nc = SIZE_N - 1 - r; r = nr; c = nc; }
  if (mirror) c = SIZE_N - 1 - c;
  return { row: r, col: c };
};
// canonical（8 对称最小占用串），用于去重 / “题库里不存在”判定
const canonicalKeyOf = (black: Position[], white: Position[]): string => {
  let best: string | null = null;
  for (let rot = 0; rot < 4; rot += 1) for (let mirror = 0; mirror < 2; mirror += 1) {
    const b = emptyVcfBoard();
    for (const s of black) { const q = dihedral(s, rot, !!mirror); b[idx(q.row, q.col)] = BLACK; }
    for (const s of white) { const q = dihedral(s, rot, !!mirror); b[idx(q.row, q.col)] = WHITE; }
    let str = ""; for (let i = 0; i < b.length; i += 1) str += b[i];
    if (best === null || str < best) best = str;
  }
  return best as string;
};

const toPositions = (cells: Array<[number, number]>): Position[] => cells.map(([row, col]) => ({ row, col }));

const naturalness = (black: Position[], white: Position[]): boolean => {
  const all = [...black, ...white];
  if (all.length < 12) return false;
  const br = new Set(black.map((s) => s.row)).size, bc = new Set(black.map((s) => s.col)).size;
  const bd1 = new Set(black.map((s) => s.row - s.col)).size, bd2 = new Set(black.map((s) => s.row + s.col)).size;
  return [br > 1, bc > 1, bd1 > 1, bd2 > 1].filter(Boolean).length >= 3;
};

// ---- transform 模式 ----
interface DecodedItem { item: MaterialItem; black: Position[]; white: Position[]; solution: Array<Position & { player: number; note: string }> }
const decode = (it: MaterialItem): DecodedItem => ({
  item: it,
  black: toPositions(it.b),
  white: toPositions(it.w),
  solution: it.l.map(([row, col, player]) => ({ row, col, player, note: "" })),
});

function transformGenerate(material: MaterialFile, count: number, minDepth: number, maxDepth: number, seed: number): { puzzles: GeneratedVcfPuzzle[]; attempts: number } {
  const rnd = mulberry32(seed);
  const diffOf = (it: DecodedItem) => (typeof it.item.d === "number" && it.item.d > 0 ? it.item.d : 0) || it.solution.filter((m) => m.player === (it.item.a === "white" ? 2 : 1)).length;
  const base = material.items.map(decode);
  const inBand = base.filter((m) => diffOf(m) >= minDepth && diffOf(m) <= maxDepth);
  const fallbackPool = base.filter((m) => diffOf(m) >= minDepth).sort((a, b) => diffOf(a) - diffOf(b));
  const pool = inBand.length ? inBand : fallbackPool;
  const order = shuffled(pool.map((_, i) => i), rnd);
  const puzzles: GeneratedVcfPuzzle[] = [];
  const seen = new Set<string>();
  const perSource = new Map<number, number>();
  let attempts = 0;

  const tryEmit = (m: DecodedItem, cap: number): boolean => {
    if (puzzles.length >= count) return false;
    if ((perSource.get(m.item.i) ?? 0) >= cap) return false;
    const cells = [...m.black, ...m.white, ...m.solution];
    for (let guard = 0; guard < 10; guard += 1) {
      attempts += 1;
      const rot = Math.floor(rnd() * 4), mirror = rnd() < 0.5;
      const rs = cells.map((p) => dihedral(p, rot, mirror).row), cs = cells.map((p) => dihedral(p, rot, mirror).col);
      const minR = Math.min(...rs), maxR = Math.max(...rs), minC = Math.min(...cs), maxC = Math.max(...cs);
      if (maxR - minR >= SIZE_N || maxC - minC >= SIZE_N) continue;
      const pickR = Math.floor(rnd() * ((SIZE_N - 1 - maxR) - (-minR) + 1)) + (-minR);
      const pickC = Math.floor(rnd() * ((SIZE_N - 1 - maxC) - (-minC) + 1)) + (-minC);
      const move = (p: Position): Position => { const q = dihedral(p, rot, mirror); return { row: q.row + pickR, col: q.col + pickC }; };
      const nb = m.black.map(move), nw = m.white.map(move);
      const nSol = m.solution.map((s0) => { const q = move(s0); return { row: q.row, col: q.col, player: s0.player, note: s0.note }; });
      const key = canonicalKeyOf(nb, nw);
      if (seen.has(key)) continue;
      const attacker: Player = m.item.a === "white" ? "white" : "black";
      const chk = verifyVcfLine({ rules: "renju", attacker, black: nb, white: nw, line: nSol.map((x) => ({ row: x.row, col: x.col, player: x.player })) });
      if (!chk.ok) continue;
      seen.add(key);
      perSource.set(m.item.i, (perSource.get(m.item.i) ?? 0) + 1);
      puzzles.push({
        title: `${attacker === "white" ? "白" : "黑"}先 VCF ${diffOf(m)} 手杀 · 真题变形`,
        rules: "renju", attacker,
        black: nb, white: nw,
        solution: nSol.map((x) => ({ row: x.row, col: x.col, player: (x.player === 2 ? "white" : "black") as Player, note: x.note })),
        depth: diffOf(m), uniqueFirst: m.item.f === 1, novel: false, fallback: null, sourceIndex: m.item.i,
      });
      return true;
    }
    return false;
  };
  for (const mi of order) { if (puzzles.length >= count) break; tryEmit(pool[mi], 1); }
  if (puzzles.length < count) for (let round = 0; round < 4 && puzzles.length < count; round += 1) for (const mi of order) { if (puzzles.length >= count) break; tryEmit(pool[mi], 2 + round); }
  return { puzzles, attempts };
}

// ---- novel 模式 ----
const DIRS: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
function protectedCells(solution: Array<Position & { player: number; note: string }>): Set<number> {
  const prot = new Set<number>();
  for (const m of solution) {
    prot.add(idx(m.row, m.col));
    for (const [dr, dc] of DIRS) for (let s = -4; s <= 4; s += 1) { const r = m.row + dr * s, c = m.col + dc * s; if (inside(r, c)) prot.add(idx(r, c)); }
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) { const r = m.row + dr, c = m.col + dc; if (inside(r, c)) prot.add(idx(r, c)); }
  }
  return prot;
}
function novelMutate(stones: { black: Position[]; white: Position[] }, prot: Set<number>, rnd: () => number): { black: Position[]; white: Position[] } | null {
  const black = stones.black.map((s) => ({ ...s })), white = stones.white.map((s) => ({ ...s }));
  const board = emptyVcfBoard();
  black.forEach((s) => { board[idx(s.row, s.col)] = BLACK; });
  white.forEach((s) => { board[idx(s.row, s.col)] = WHITE; });
  const op = rnd();
  if (op < 0.35 && black.length + white.length > 12) {
    const free = shuffled([...black, ...white], rnd).filter((s) => !prot.has(idx(s.row, s.col)));
    if (!free.length) return null;
    const v = free[0];
    board[idx(v.row, v.col)] = EMPTY;
    if (black.some((s) => s.row === v.row && s.col === v.col)) black.splice(black.findIndex((s) => s.row === v.row && s.col === v.col), 1);
    else white.splice(white.findIndex((s) => s.row === v.row && s.col === v.col), 1);
  } else if (op < 0.75) {
    const empties: Array<[number, number]> = [];
    for (let r = 1; r < SIZE_N - 1; r += 1) for (let c = 1; c < SIZE_N - 1; c += 1) {
      if (board[idx(r, c)] !== EMPTY || prot.has(idx(r, c))) continue;
      let near = false;
      for (let dr = -3; dr <= 3 && !near; dr += 1) for (let dc = -3; dc <= 3 && !near; dc += 1) { const rr = r + dr, cc = c + dc; if (inside(rr, cc) && board[idx(rr, cc)] !== EMPTY) near = true; }
      if (near) continue;
      empties.push([r, c]);
    }
    if (!empties.length) return null;
    const [r, c] = empties[Math.floor(rnd() * empties.length)];
    const wopts = shuffled([[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as Array<[number, number]>, rnd).filter(([rr, cc]) => inside(rr, cc) && board[idx(rr, cc)] === EMPTY && !prot.has(idx(rr, cc)));
    if (!wopts.length) return null;
    const [wr, wc] = wopts[0];
    board[idx(r, c)] = BLACK; black.push({ row: r, col: c });
    board[idx(wr, wc)] = WHITE; white.push({ row: wr, col: wc });
  } else {
    const cands: Array<[number, number]> = [];
    for (const s of [...black, ...white]) {
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
        const r = s.row + dr, c = s.col + dc;
        if (!inside(r, c)) continue;
        if (board[idx(r, c)] !== EMPTY || prot.has(idx(r, c))) continue;
        cands.push([r, c]);
      }
    }
    if (!cands.length) return null;
    const [r, c] = cands[Math.floor(rnd() * cands.length)];
    board[idx(r, c)] = WHITE; white.push({ row: r, col: c });
  }
  if (vcfFivePoints(board, BLACK, "renju").length || vcfFivePoints(board, WHITE, "renju").length) return null;
  return { black, white };
}

function novelGenerate(material: MaterialFile, count: number, minDepth: number, maxDepth: number, seed: number, seen: Set<string>, perSource: Map<number, number>): { puzzles: GeneratedVcfPuzzle[]; attempts: number } {
  const rnd = mulberry32(seed);
  const solveBudget = minDepth >= 12 ? 3000 : 800;
  const mutMax = minDepth >= 12 ? 2 : 4;
  const pool = shuffled(material.items.map(decode).filter((m) => diffOfGlobal(m) >= minDepth), rnd);
  const puzzles: GeneratedVcfPuzzle[] = [];
  let attempts = 0;
  for (const m of pool) {
    if (puzzles.length >= count) break;
    if ((perSource.get(m.item.i) ?? 0) >= 2) continue;
    const attacker: Player = m.item.a === "white" ? "white" : "black";
    const attackerNum = attacker === "white" ? 2 : 1;
    const prot = protectedCells(m.solution);
    let cur = { black: m.black.map((s) => ({ ...s })), white: m.white.map((s) => ({ ...s })) };
    let ok = false;
    for (let step = 0; step < mutMax && !ok; step += 1) {
      attempts += 1;
      const next = novelMutate(cur, prot, rnd);
      if (!next) continue;
      cur = next;
      const board = emptyVcfBoard();
      cur.black.forEach((s) => { board[idx(s.row, s.col)] = BLACK; });
      cur.white.forEach((s) => { board[idx(s.row, s.col)] = WHITE; });
      const sol = solveVcf(board, { attacker: attackerNum, rules: "renju", maxDepth: maxDepth + 2, timeBudget: solveBudget });
      if (!sol.win) continue;
      const atk = sol.line.filter((x) => x.player === attackerNum).length;
      if (atk < minDepth || atk > maxDepth) continue;
      const line = sol.line.map((x) => ({ row: x.row, col: x.col, player: x.player, note: x.note }));
      const chk = verifyVcfLine({ rules: "renju", attacker, black: cur.black, white: cur.white, line });
      if (!chk.ok) continue;
      const key = canonicalKeyOf(cur.black, cur.white);
      if (seen.has(key)) continue; // 已在题库/素材里 → 不算新题
      if (!naturalness(cur.black, cur.white)) continue;
      seen.add(key);
      perSource.set(m.item.i, (perSource.get(m.item.i) ?? 0) + 1);
      puzzles.push({
        title: `${attacker === "white" ? "白" : "黑"}先 VCF ${atk} 手杀 · 原创新题`,
        rules: "renju", attacker,
        black: cur.black, white: cur.white,
        solution: line.map((x) => ({ row: x.row, col: x.col, player: (x.player === 2 ? "white" : "black") as Player, note: x.note })),
        depth: atk, uniqueFirst: false, novel: true, fallback: null, sourceIndex: m.item.i,
      });
      ok = true;
    }
  }
  return { puzzles, attempts };
}
const diffOfGlobal = (m: DecodedItem) => (typeof m.item.d === "number" && m.item.d > 0 ? m.item.d : m.solution.filter((x) => x.player === (m.item.a === "white" ? 2 : 1)).length);

export interface VcfCollectionOptions { count: number; tier: VcfTier; mode: VcfGenMode; seed: number }
export interface VcfCollectionResult { puzzles: GeneratedVcfPuzzle[]; attempts: number; fallbackUsed: boolean; error: string | null }

/** 基于给定素材生成（可注入，便于测试）。 */
export function generateVcfCollectionWithMaterial(material: MaterialFile, options: VcfCollectionOptions): VcfCollectionResult {
  if (!material || !material.items.length) return { puzzles: [], attempts: 0, fallbackUsed: false, error: "素材库为空" };
  const [minDepth, maxDepth] = VCF_TIER_RANGE[options.tier];
  const corpus = new Set(material.items.map((it) => canonicalKeyOf(toPositions(it.b), toPositions(it.w))));
  const seen = new Set(corpus);
  const perSource = new Map<number, number>();
  if (options.mode === "novel") {
    const novel = novelGenerate(material, options.count, minDepth, maxDepth, options.seed, seen, perSource);
    const need = options.count - novel.puzzles.length;
    if (need > 0 && minDepth >= 12) {
      const tf = transformGenerate(material, options.count, minDepth, maxDepth, options.seed + 1);
      const extra = tf.puzzles.slice(0, need).map((p) => ({ ...p, fallback: "深档原创未产出，用真题变形补充" }));
      return { puzzles: [...novel.puzzles, ...extra], attempts: novel.attempts + tf.attempts, fallbackUsed: extra.length > 0, error: null };
    }
    return { ...novel, fallbackUsed: false, error: null };
  }
  const tf = transformGenerate(material, options.count, minDepth, maxDepth, options.seed);
  return { ...tf, fallbackUsed: false, error: null };
}

/** 载入素材后生成。 */
export async function generateVcfCollection(options: VcfCollectionOptions): Promise<VcfCollectionResult> {
  const material = await loadVcfMaterial();
  if (!material || !material.items.length) return { puzzles: [], attempts: 0, fallbackUsed: false, error: "素材库加载失败（/puzzles/vcf-material.json 缺失）" };
  return generateVcfCollectionWithMaterial(material, options);
}

/** 导出半步五子棋/开宝兼容的题库 JSON（自动入库用）。 */
export function toKaibaoCollectionJson(puzzles: GeneratedVcfPuzzle[], title: string): string {
  const stamp = title;
  return JSON.stringify({
    title: stamp,
    source: "VCF 生成器",
    license: "本地生成",
    puzzles: puzzles.map((p) => ({
      title: p.title,
      blackStones: p.black.map(vcfCoordName).join(""),
      whiteStones: p.white.map(vcfCoordName).join(""),
      side: p.attacker,
      rule: p.rules,
      difficulty: Math.min(5, Math.max(1, Math.round(p.depth / 2))),
      prompt: `${p.attacker === "white" ? "白" : "黑"}先，${p.depth} 手连续冲四胜（VCF）`,
      comment: `正解：${p.solution.filter((m) => m.player === p.attacker).map(vcfCoordName).join(" → ")}`,
    })),
  });
}
