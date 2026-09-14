import fs from "node:fs";

// Builds the opening book JSON from the SGF exported out of 索索夫打点（妙手の淡淡整理）.lib
// (pipeline: scripts/tmp-export-lib-sgf.mjs, wasm renlib core lib2sgf).
// Book model: key = move sequence from the root ("hh,ig,hf"), value = candidate
// points at that position with their 打点 rank labels.
//   rank semantics (confirmed from the lib's own comments): smaller number = stronger
//   (1打必胜 → 大数平衡/必败); "A" = unranked; "*" suffix = 严格不平衡变体;
//   CJK labels = 开局名 (metadata only, never played).
// Usage: node scripts/build-opening-book.mjs <in.sgf> <out.json>
const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error("usage: build-opening-book.mjs <in.sgf> <out.json>"); process.exit(1); }

const text = new TextDecoder("gb18030").decode(fs.readFileSync(inPath));

// --- SGF tree parser (properties: B/W/LB/C/...) ---
let pos = 0;
function parse() {
  function node() {
    const n = { props: {}, children: [] };
    while (text[pos] === ";") {
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
    if (text[pos] === "(") { while (text[pos] === "(") { pos += 1; n.children.push(node()); if (text[pos] === ")") pos += 1; } }
    return n;
  }
  return node();
}
const root = parse();

const entries = {};
const coordOk = (s) => /^[a-o]{2}$/.test(s);
// v2 keys/points are JSON [row,col] pairs (row = 14 - sgf-y) — the worker can
// build them with JSON alone (no string concatenation to audit).
const pair = (sgf) => [14 - (sgf.charCodeAt(1) - 97), sgf.charCodeAt(0) - 97];
const walk = (node, seq) => {
  const move = node.props.B?.[0] || node.props.W?.[0];
  if (move && !coordOk(move)) throw new Error("bad coord " + move);
  const nextSeq = move ? [...seq, move] : seq;
  const labels = [];
  for (const lb of node.props.LB || []) {
    const m = lb.match(/^([a-o]{2}):([\s\S]+)$/);
    if (!m) continue;
    const raw = m[2].replace(/[\x00-\x08]/g, "").trim();
    labels.push({ p: pair(m[1]), l: raw });
  }
  if (labels.length && nextSeq.length >= 1) {
    const key = JSON.stringify(nextSeq.map(pair));
    const prev = entries[key];
    const merged = new Map((prev || []).map((e) => [JSON.stringify(e.p), e]));
    for (const label of labels) merged.set(JSON.stringify(label.p), label);
    entries[key] = [...merged.values()];
  }
  for (const child of node.children) walk(child, nextSeq);
};
for (const child of root.children) walk(child, []);

// stats
let numeric = 0, unknown = 0, opening = 0;
for (const list of Object.values(entries)) for (const e of list) {
  if (/^\d+\*?$/.test(e.l)) numeric += 1; else if (/^A\*?$/.test(e.l)) unknown += 1; else opening += 1;
}
const out = {
  version: 2,
  source: "索索夫打点（妙手の淡淡整理）.lib → lib2sgf → build-opening-book",
  builtAt: new Date().toISOString(),
  rankSemantics: "数字=打点序号，越小越强（1打必胜→大数平衡/必败）；A=未标；*=不平衡变体；汉字=开局名",
  positions: entries,
};
fs.mkdirSync(outPath.slice(0, outPath.lastIndexOf("/")) || ".", { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
const raw = fs.readFileSync(outPath);
console.log("entries:", Object.keys(entries).length, "| numeric:", numeric, "| A:", unknown, "| opening-name:", opening, "| bytes:", raw.length);
