// 可选开局库（P1 档① 索索夫打点簿 + 档④ 山口五手两打簿，T28）：
// 索索夫谱（.lib → lib2sgf → scripts/build-opening-book.mjs）生成 v2 JSON；
// 山口谱（山口谱.lib → lib2sgf → scripts/build-yamaguchi-book.mjs）生成 v3 JSON(.gz)。
// **运行时查询在引擎层**（public/rapfi/rapfi-worker.js 的 book 层，与弈心/智子同构）；
// 本模块是同一算法的 TS 规格实现——单测用它守护数据形状与命中语义，
// worker 改动必须与本文件行为一致。
//
// v2 rank 语义（索索夫，源自谱内注释，已人工确认）：数字=打点序号，越小越强
// （1打必胜→大数平衡/必败）；"A"=未标强弱；"*"后缀=严格不平衡变体；汉字=开局名
// （白2/黑3 的簿内开局线候选层——2026-09-10 起在无数字 rank 时作为同组可下点回退，
// 否则白2/黑3 永远书 miss 回落引擎自由摆，摆到簿外线后整局打点簿失效）。
// v2 key/点坐标一律为 JSON [row,col] 数字对。
//
// v3 rank 语义（山口，2026-09-09 由谱内 267 条注释与分支结构交叉破译）：数字仍
// 越小越强——1=唯一防 only/必胜宣布点 a1/强手!/定式#/白2 数字/裸 a/可走首选 e1，
// 2=开局名（黑第3手可直接落!）/第2打 a2/存疑打 a!?，3-9=eN 可走排序/hN 研究新手，
// 10-14=cN 打点排名表；败点层（裸 c/c?/bad）不入书（这是山口谱的负信息价值）。
// v3 key=JSON 扁平 row*15+col 数字序列，value=[point, rank, ...] 扁平数组
// （体积约为同内容 v2 编码的 40%）。

export type OpeningBookLabel = { p: [number, number]; l: string };
export type OpeningBookPositions = Record<string, OpeningBookLabel[] | number[]>;
export type OpeningBookData = { version: number; source?: string; rankSemantics?: string; positions: OpeningBookPositions };
export type OpeningBookMove = { row: number; col: number; label: string; rank: number };

/** 双书路由（worker bookKindFor 的镜像）：山口开局 + 五手两打家族查山口簿，
 * 其余（含 soosyrv-8 与未带 openingRule 的旧请求）查索索夫簿。 */
export const YAMAGUCHI_OPENING_RULES = ["yamaguchi", "five-two", "five-n", "taraguchi-10", "tarannikov"];
export function openingBookKindFor(request: { openingRule?: string }): "sosyov" | "yamaguchi" {
  const rule = typeof request.openingRule === "string" ? request.openingRule : "";
  return YAMAGUCHI_OPENING_RULES.includes(rule) ? "yamaguchi" : "sosyov";
}

/** Parse a book label into a numeric 打点 rank, or null when it is not a rank. */
export function bookRank(label: string): number | null {
  const digits = label.endsWith("*") ? label.slice(0, -1) : label;
  const value = Number(digits);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** The D4 symmetry group of the square board (rotations + reflections about
 * the center). fwd maps a real coordinate into book space; inv maps a book
 * point back to the real board. */
function openingBookTransforms(n: number): Array<{ fwd: (row: number, col: number) => [number, number]; inv: (row: number, col: number) => [number, number] }> {
  return [
    { fwd: (r, c) => [r, c], inv: (r, c) => [r, c] },
    { fwd: (r, c) => [r, n - c], inv: (r, c) => [r, n - c] },
    { fwd: (r, c) => [n - r, c], inv: (r, c) => [n - r, c] },
    { fwd: (r, c) => [n - r, n - c], inv: (r, c) => [n - r, n - c] },
    { fwd: (r, c) => [c, r], inv: (r, c) => [c, r] },
    { fwd: (r, c) => [n - c, n - r], inv: (r, c) => [n - c, n - r] },
    { fwd: (r, c) => [c, n - r], inv: (r, c) => [n - c, r] },
    { fwd: (r, c) => [n - c, r], inv: (r, c) => [c, n - r] },
  ];
}

/** Normalize one D4-rotated lookup for either key encoding (worker bookLabels 镜像）。 */
function bookLabels(data: OpeningBookData, moves: Array<{ row: number; col: number }>, size: number, transform: { fwd: (row: number, col: number) => [number, number] }): Array<{ row: number; col: number; rank: number; label: string }> {
  const out: Array<{ row: number; col: number; rank: number; label: string }> = [];
  if (data.version === 3) {
    const key = JSON.stringify(moves.map((move) => {
      const mapped = transform.fwd(move.row, move.col);
      return mapped[0] * size + mapped[1];
    }));
    const labels = data.positions[key];
    if (!Array.isArray(labels)) return out;
    const flat = labels as number[];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const code = flat[i];
      const rank = flat[i + 1];
      if (!Number.isInteger(code) || code < 0 || code >= size * size) continue;
      if (!Number.isInteger(rank) || rank <= 0) continue;
      out.push({ row: Math.floor(code / size), col: code % size, rank, label: String(rank) });
    }
    return out;
  }
  const key = JSON.stringify(moves.map((move) => transform.fwd(move.row, move.col)));
  const labels = data.positions[key];
  if (!Array.isArray(labels)) return out;
  for (const entry of labels as OpeningBookLabel[]) {
    if (!Array.isArray(entry.p) || entry.p.length !== 2) continue;
    const [bookRow, bookCol] = entry.p;
    if (bookRow < 0 || bookRow >= size || bookCol < 0 || bookCol >= size) continue;
    const rank = bookRank(entry.l);
    // 汉字开局名层（worker bookLabels 镜像）：无数字 rank 但仍是簿收录的可下点，
    // rank 记 0，queryOpeningBookRanked 在无数字 rank 时回退到这一层；"A"=未标
    // 强弱（谱内未研究/未评级），不是可下点，跳过。
    if (rank === null) {
      if (/[\u4e00-\u9fff]/.test(entry.l)) out.push({ row: bookRow, col: bookCol, rank: 0, label: entry.l });
      continue;
    }
    out.push({ row: bookRow, col: bookCol, rank, label: entry.l });
  }
  return out;
}

/**
 * All rank candidates for `moves` in book strength order (lowest 打点 rank
 * first). The book only records one board quadrant, so every D4 symmetry is
 * tried (identity first) and results map back to real coordinates. Empty when
 * the position is not in the book or carries no numeric ranks.
 * 数字 rank 层优先；仅开局名层（汉字）时全部视为同一可下组（rank=1），由
 * queryOpeningBookMove 的 top 组随机破平——白2/黑3 由此稳定走簿（worker
 * bookRanked 镜像）。
 */
export function queryOpeningBookRanked(data: OpeningBookData, moves: Array<{ row: number; col: number }>, size = 15): OpeningBookMove[] {
  if (!moves.length) return [];
  const n = size - 1;
  for (const transform of openingBookTransforms(n)) {
    const ranked: OpeningBookMove[] = [];
    for (const entry of bookLabels(data, moves, size, transform)) {
      const [realRow, realCol] = transform.inv(entry.row, entry.col);
      if (realRow < 0 || realRow >= size || realCol < 0 || realCol >= size) continue;
      ranked.push({ row: realRow, col: realCol, label: entry.label, rank: entry.rank });
    }
    if (ranked.length) {
      const rankedOnly = ranked.filter((candidate) => candidate.rank > 0);
      if (rankedOnly.length) return rankedOnly.sort((a, b) => a.rank - b.rank);
      return ranked.map((candidate) => ({ ...candidate, rank: 1 }));
    }
  }
  return [];
}

/**
 * AI 宣布打点数（T31，五手多打/索索夫-8）：把书内 rank ≤ 4（必胜宣布点/第1-2打/
 * 首选可走类）视为该局面已知的黑方「好点」数 K，宣布 K+1——多逼黑暴露一个库外
 * 劣点，白方保留其一并下第6手。K 未知（书关/未命中）退回保守 3。结果按规则
 * 区间 [minN, maxN] 钳制。研究依据：RIF 各宣言制规则的宣数无软件自适应先例
 * （锦标赛规则预设 or 引擎无开局宣告逻辑），本函数把「按谱知黑有几个好点」
 * 的人棋思路接到我们自己的书层上。
 */
export function bookDeclareCount(ranks: number[], minN = 3, maxN = 10, fallback = 3): number {
  const good = ranks.filter((rank) => Number.isFinite(rank) && rank > 0 && rank <= 4).length;
  if (!good) return Math.max(minN, Math.min(maxN, fallback));
  return Math.max(minN, Math.min(maxN, good + 1));
}

/**
 * Best book reply for `moves`: the strongest (lowest) rank group, ties broken
 * randomly so repeated games are not identical. Null on a miss.
 */
export function queryOpeningBookMove(data: OpeningBookData, moves: Array<{ row: number; col: number }>, size = 15, random: () => number = Math.random): OpeningBookMove | null {
  const ranked = queryOpeningBookRanked(data, moves, size);
  if (!ranked.length) return null;
  const best = ranked[0].rank;
  const pool = ranked.filter((candidate) => candidate.rank === best);
  return pool[Math.floor(random() * pool.length) % pool.length] || null;
}
