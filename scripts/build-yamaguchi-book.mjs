import fs from "node:fs";
import zlib from "node:zlib";

// Builds the YAMAGUCHI opening book JSON(.gz) from the SGF exported out of
// 山口谱 (1).lib (pipeline: scripts/export-renlib-sgf.mjs → this script).
// Source SGF (40MB, gitignored): artifacts/opening-book-yamaguchi.sgf
// Output: public/opening-book/yamaguchi-v1.json.gz (~0.5MB) + uncompressed
// debug copy under artifacts/ (gitignored).
//
// Book model (annotation alphabet decoded 2026-09-09 by cross-referencing the
// lib's own 267 C-comments against branch structure — NOT the Sosyov numeric
// scheme, and NOT the same as build-opening-book.mjs):
//   a      = 必胜/宣布点（五手两打宣布位上裸 a 恰好=宣布的两打；中局=行棋方最强手）
//   a1/a2  = 第1打/第2打      a!?/a? = 存疑打点
//   e1..e9 = 能走的点（防守/可行，按强弱排序）   only = 唯一防（必走）
//   cN     = 打点排名表（N 越大对己方越差）      hN = 研究新手（常伴「XX研究」注释）
//   !      = 强手   # = 定式   数字(1/2..) = 白2 两种   汉字 = 开局名/棋手变例名
//   c(裸)/c?/bad/bak/? = 败点/坏手层 —— 一律不入书（这是本谱最有价值的负信息）。
// Rank mapping below is clamped so the worker sees 1..14 (smaller = stronger).
//
// v3 compact encoding (v2 nested-pair keys cost ~2.4x bytes; 172k positions):
//   positions key   = JSON.stringify([code, code, ...])   code = row*15+col
//   positions value = JSON flat [pointCode, rank, pointCode, rank, ...]
// Depth cap: 15 moves (user-approved budget ≤1MB; the 42-move tail is VCT
// research lines the engine handles better than a book should).
//
// Usage: node scripts/build-yamaguchi-book.mjs [in.sgf] [out.json.gz]
const [,, inPath = "artifacts/opening-book-yamaguchi.sgf", outPath = "public/opening-book/yamaguchi-v1.json.gz"] = process.argv;
const MAX_MOVES = 15;
const SIZE = 15;

const text = new TextDecoder("gb18030").decode(fs.readFileSync(inPath));

// --- SGF tree parser. NOTE: unlike build-opening-book.mjs (which merges a
// `;`-chain into one props bag), each game node is kept separate: this lib's
// root carries its own LB properties that must NOT attach to the first-move
// node's position. A chained node becomes the single child of its predecessor.
let pos = 0;
function parse() {
  function node() {
    const n = { props: {}, children: [] };
    if (text[pos] === ";") {
      pos += 1;
      while (pos < text.length && /[A-Za-z]/.test(text[pos])) {
        let key = "";
        while (/[A-Za-z]/.test(text[pos])) key += text[pos++];
        const values = [];
        while (text[pos] === "[") {
          pos += 1; let v = "";
          while (pos < text.length && text[pos] !== "]") { if (text[pos] === "\\") { pos += 1; } v += text[pos] || ""; pos += 1; }
          pos += 1; values.push(v);
        }
        n.props[key] = (n.props[key] || []).concat(values);
      }
    }
    if (text[pos] === "(") {
      while (text[pos] === "(") { pos += 1; n.children.push(node()); if (text[pos] === ")") pos += 1; }
    } else if (text[pos] === ";") {
      n.children.push(node());  // chained node = single continuation child
    }
    return n;
  }
  return node();
}
const root = parse();

const norm = (s) => s.replace(/[\x00-\x08]/g, "").trim();
// sgf "ij" -> flat board code row*15+col (row 0 = top = sgf y 'o')
const codeOf = (sgf) => {
  const x = sgf.charCodeAt(0) - 97;
  const y = sgf.charCodeAt(1) - 97;
  if (!(x >= 0 && x < SIZE && y >= 0 && y < SIZE)) throw new Error("bad coord " + sgf);
  return (14 - y) * SIZE + x;
};

// label text -> strength rank (1 strongest), or null = not a book candidate.
function labelRank(t) {
  if (/^[\u4e00-\u9fff\u3000-\u30ff\u31f0-\u31ff]/.test(t)) return 2; // 开局名/棋手变例名（黑第3手可下）
  if (t === "only") return 1;                                          // 唯一防必走
  if (t === "!" || t === "#" || /^\d+$/.test(t)) return 1;             // 强手/定式/白2两类
  if (t === "a" || t === "a1" || t === "a!") return 1;                 // 宣布点/第1打=最强手（显式枚举，勿用 /^a/ 抢 a2）
  if (t === "a2" || t === "a3" || t === "a!?" || t === "a?") return 2; // 第2打/存疑打
  if (/^a/.test(t)) return 2;                                          // 未知 a 变体保守降 2
  if (t === "e1") return 2;                                             // 首选可走
  if (/^e\d+$/.test(t)) return Math.min(2 + Number(t.slice(1)), 9);     // eN 依序
  if (t === "e?" || t === "e~" || t === "e1?") return 6;                // 勉强可走
  if (/^h\d$/.test(t)) return Math.min(2 + Number(t.slice(1)), 9);      // 研究新手
  if (/^c\d+$/.test(t)) return Math.min(2 + Number(t.slice(1)) * 2, 14);// 打点排名表
  return null; // 裸 c 与一切 c?/c~/bad/杂项 = 败点层，不入书
}

const book = new Map(); // key(string) -> Map(pointCode -> rank)
function walk(node, moves, depth) {
  const move = node.props.B?.[0] || node.props.W?.[0];
  const d = move ? depth + 1 : depth;
  const labels = new Map();
  for (const lb of node.props.LB || []) {
    const m = lb.match(/^([a-o]{2}):([\s\S]+)$/);
    if (!m) continue;
    const rank = labelRank(norm(m[2]));
    if (rank === null) continue;
    const code = codeOf(m[1]);
    if (!labels.has(code) || labels.get(code) > rank) labels.set(code, rank);
  }
  const nextMoves = move ? [...moves, codeOf(move)] : moves;
  if (nextMoves.length >= 1 && nextMoves.length <= MAX_MOVES && labels.size) {
    const key = JSON.stringify(nextMoves);
    let m = book.get(key);
    if (!m) { m = new Map(); book.set(key, m); }
    for (const [code, rank] of labels) if (!m.has(code) || m.get(code) > rank) m.set(code, rank);
  }
  for (const child of node.children) walk(child, nextMoves, d);
}
for (const child of root.children) walk(child, [], 0);

// deterministic serialization: sort positions by key, candidates by rank then code
const positions = {};
const rankHist = new Map();
for (const key of [...book.keys()].sort()) {
  const flat = [];
  for (const [code, rank] of [...book.get(key).entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    flat.push(code, rank);
    rankHist.set(rank, (rankHist.get(rank) || 0) + 1);
  }
  positions[key] = flat;
}
const out = {
  version: 3,
  encoding: "flat: key = JSON row*15+col codes of the move sequence; value = [pointCode, rank, ...]",
  rule: "yamaguchi",
  size: SIZE,
  maxMoves: MAX_MOVES,
  source: "山口谱 (1).lib → scripts/export-renlib-sgf.mjs → scripts/build-yamaguchi-book.mjs",
  rankSemantics: "越小越强：1=唯一防/必走/第1打/必胜宣布点/定式/强手/可走首选；2=开局名(黑第3手)/第2打/存疑打；3-9=可走备选 eN/研究新手 hN；10-14=打点排名 cN；败点层(裸c/bad)不入书",
  builtAt: new Date().toISOString(),
  positions,
};
const json = JSON.stringify(out);
fs.mkdirSync("public/opening-book", { recursive: true });
fs.mkdirSync("artifacts", { recursive: true });
const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
fs.writeFileSync(outPath, gz);
fs.writeFileSync("artifacts/opening-book-yamaguchi.json", json);
console.log("positions:", Object.keys(positions).length,
  "| candidates:", [...rankHist.values()].reduce((a, b) => a + b, 0),
  "| raw:", json.length, "| gz:", gz.length);
console.log("rank histogram:", [...rankHist.entries()].sort((a, b) => a[0] - b[0]).map(([r, c]) => `${r}:${c}`).join(" "));
