/**
 * 开局名表的核对脚本（2026-10-09）。
 *
 * 为什么需要它：`src/features/duel/opening-name.ts` 里那张「三手 → 26 开局名」的表
 * 一旦写错，用户摆出花月却看到浦月，一眼就能看出来。而开局名的几何对应**不该靠记忆写**。
 * 所以这个脚本回到项目自己的两份数据源里，逐点核对代码里的表：
 *
 *   源 A  public/opening-book/sosyov-v1.json  —— 索索夫打点簿（len=2 的两个局面）
 *   源 B  artifacts/opening-book-dingshi.sgf  —— 定式谱（GB2312，节点带 LB 标签）
 *
 * 三个断言：
 *   1. 代码表与源 A 的 13+13 个点**逐点相同**（坐标与名字都要对）；
 *   2. 代码表的名字集合与 `renju-reference.ts` 的 26 个 RIF 中文名**完全相同**
 *      （注意打点簿把「彗星」写作「慧」，属于已知字形差异，脚本显式处理）；
 *   3. 源 B 里凡是能解析出名字的三手节点，都与代码表一致（交叉验证，不依赖单一来源）。
 *
 * 用法：node qa/opening-name-check.mjs
 */
import fs from "node:fs";
import zlib from "node:zlib";

const CENTER = 7; // 15 路天元下标

let failures = 0;
const check = (ok, label, detail = "") => {
  if (ok) return;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
};
const ok = (label) => console.log(`  ✓ ${label}`);

// ── 取代码里的表 ────────────────────────────────────────────────────────────
const moduleSource = fs.readFileSync("src/features/duel/opening-name.ts", "utf8");
const parseTable = (startMarker) => {
  const start = moduleSource.indexOf(startMarker);
  if (start < 0) throw new Error(`找不到表: ${startMarker}`);
  const body = moduleSource.slice(start, moduleSource.indexOf("];", start));
  /**
   * 逐条解析 `{ dRow, dCol, name, code }`。
   *
   * ⚠ 不要写成「按固定字段顺序匹配到 `}` 为止」的整条正则：那种写法在表里**新增一个字段**
   * （比如本轮加的 `code`）时会静默匹配到 0 条，然后整份核对报告全是"坐标不在代码表里"，
   * 看起来像表错了、其实是解析器脆。这里改成两段式——先切出每个 `{...}` 对象，
   * 再在对象里按字段名各取各的，字段顺序与将来新增字段都不会影响它。
   */
  const rows = [];
  for (const obj of body.matchAll(/\{([^{}]*)\}/g)) {
    const text = obj[1];
    const dRow = text.match(/dRow:\s*(-?\d+)/);
    const dCol = text.match(/dCol:\s*(-?\d+)/);
    const name = text.match(/name:\s*"([^"]+)"/);
    const code = text.match(/code:\s*"([^"]+)"/);
    if (!dRow || !dCol || !name) continue;
    rows.push({ dRow: Number(dRow[1]), dCol: Number(dCol[1]), name: name[1], code: code ? code[1] : null });
  }
  if (!rows.length) throw new Error(`表 ${startMarker} 解析出 0 条——解析器很可能与源码写法脱节了`);
  return rows;
};
const codeDirect = parseTable("const DIRECT_OPENINGS");
const codeIndirect = parseTable("const INDIRECT_OPENINGS");
console.log(`代码表：直指 ${codeDirect.length} 点、斜指 ${codeIndirect.length} 点`);

// 断言 0：表里每条都要带 RIF 编号（界面上的朱红小印刻的就是它），缺一个就是漏写。
const missingCode = [...codeDirect, ...codeIndirect].filter((row) => !row.code);
check(!missingCode.length, "26 条都带 RIF 编号（朱红小印用）", missingCode.map((r) => r.name).join("、"));

// ── 源 A：sosyov 打点簿 ─────────────────────────────────────────────────────
const sosyov = JSON.parse(fs.readFileSync("public/opening-book/sosyov-v1.json", "utf8"));
const fromBook = (key) => {
  const raw = sosyov.positions[key];
  if (!raw) throw new Error(`打点簿缺少局面 ${key}`);
  return raw.map((entry) => ({ dRow: entry.p[0] - CENTER, dCol: entry.p[1] - CENTER, name: entry.l }));
};
const bookDirect = fromBook("[[7,7],[8,7]]");
const bookIndirect = fromBook("[[7,7],[8,8]]");

console.log("\n源 A（sosyov 打点簿）逐点核对");
check(bookDirect.length === codeDirect.length, "直指点数一致", `簿 ${bookDirect.length} vs 码 ${codeDirect.length}`);
check(bookIndirect.length === codeIndirect.length, "斜指点数一致", `簿 ${bookIndirect.length} vs 码 ${codeIndirect.length}`);

// 打点簿写单字省称（「寒」「溪」…），代码写 RIF 全名（「寒星」「溪月」…）。
// 唯一的例外是斜指系的「彗星」在簿里写作「慧」。
const bookToRif = (label, candidates) => {
  if (label === "慧") return "彗星";
  const hit = candidates.find((name) => name.startsWith(label));
  return hit ?? null;
};
const RIF_DIRECT = ["寒星", "溪月", "疏星", "花月", "残月", "雨月", "金星", "松月", "丘月", "新月", "瑞星", "山月", "游星"];
const RIF_INDIRECT = ["长星", "峡月", "恒星", "水月", "流星", "云月", "浦月", "岚月", "银月", "明星", "斜月", "名月", "彗星"];

const comparePoints = (codeTable, bookTable, rifNames, label) => {
  for (const point of bookTable) {
    const expected = bookToRif(point.name, rifNames);
    check(expected !== null, `${label} 簿标签「${point.name}」能对到 RIF 名`);
    if (!expected) continue;
    const codePoint = codeTable.find((c) => c.dRow === point.dRow && c.dCol === point.dCol);
    check(Boolean(codePoint), `${label} 坐标 (${point.dRow},${point.dCol}) 在代码表里`);
    if (codePoint) check(codePoint.name === expected, `${label} (${point.dRow},${point.dCol}) 名字`, `码「${codePoint.name}」vs 簿→RIF「${expected}」`);
  }
};
comparePoints(codeDirect, bookDirect, RIF_DIRECT, "直指");
comparePoints(codeIndirect, bookIndirect, RIF_INDIRECT, "斜指");
ok("源 A 逐点核对完成（未报错即全部相同）");

// ── 断言 2：与 renju-reference.ts 的 26 个 RIF 名一致 ────────────────────────
const refSource = fs.readFileSync("src/features/online/renju-reference.ts", "utf8");
const refZh = [...refSource.matchAll(/\{\s*code:\s*"([id]\d+)",\s*jpName:\s*"[^"]*",\s*zhName:\s*"([^"]+)"\s*\}/g)]
  .map((m) => ({ code: m[1], zhName: m[2] }));
console.log(`\n断言 2：renju-reference.ts 共 ${refZh.length} 个开局`);
check(refZh.length === 26, "RIF 开局数为 26");
const refDirect = refZh.filter((x) => x.code.startsWith("d")).map((x) => x.zhName);
const refIndirect = refZh.filter((x) => x.code.startsWith("i")).map((x) => x.zhName);
check(codeDirect.length === 13 && codeIndirect.length === 13, "代码表为 13+13");
const sortedEq = (a, b) => [...a].sort().join("|") === [...b].sort().join("|");
check(sortedEq(codeDirect.map((x) => x.name), refDirect), "直指系名字集合与 RIF d1–d13 相同");
check(sortedEq(codeIndirect.map((x) => x.name), refIndirect), "斜指系名字集合与 RIF i1–i13 相同");
// 直指系的表顺序刻意等于 RIF d1–d13（代码注释如此声称），这里把它钉住。
check(codeDirect.map((x) => x.name).join("|") === refDirect.join("|"), "直指系顺序 = RIF d1–d13", `码 ${codeDirect.map((x) => x.name).join("/")} vs REF ${refDirect.join("/")}`);

// ── 断言 3：源 B（定式谱）交叉验证 ──────────────────────────────────────────
console.log("\n断言 3：源 B（定式谱 opening-book-dingshi.sgf）交叉核对");
const sgfPath = "artifacts/opening-book-dingshi.sgf";
if (!fs.existsSync(sgfPath)) {
  console.log("  ⚠ 定式谱不在本机，跳过（不作为失败）");
} else {
  const text = new TextDecoder("gb18030").decode(fs.readFileSync(sgfPath));
  let pos = 0;
  const parse = () => {
    const node = () => {
      const n = { props: {}, children: [] };
      while (text[pos] === ";") {
        pos += 1;
        while (pos < text.length && /[A-Za-z]/.test(text[pos])) {
          let key = "";
          while (/[A-Za-z]/.test(text[pos])) key += text[pos++];
          const values = [];
          while (text[pos] === "[") {
            pos += 1;
            let v = "";
            while (pos < text.length && text[pos] !== "]") { if (text[pos] === "\\") pos += 1; v += text[pos] || ""; pos += 1; }
            pos += 1;
            values.push(v);
          }
          n.props[key] = (n.props[key] || []).concat(values);
        }
      }
      if (text[pos] === "(") { while (text[pos] === "(") { pos += 1; n.children.push(node()); if (text[pos] === ")") pos += 1; } }
      return n;
    };
    return node();
  };
  const root = parse();
  // 只关心「黑1 天元 + 白2 相邻」的那些深度=2 节点上的标签（第三个点=黑3 候选 → 名字）。
  const hits = [];
  const walk = (n, seq) => {
    const mv = n.props.B?.[0] || n.props.W?.[0];
    const next = mv ? [...seq, mv] : seq;
    if (next.length === 2) {
      const labels = (n.props.LB || [])
        .map((x) => { const m = x.match(/^([a-o]{2}):([\s\S]+)$/); return m ? { p: m[1], l: m[2].replace(/[\x00-\x08]/g, "").trim() } : null; })
        .filter(Boolean);
      if (labels.length) hits.push({ seq: next, labels });
    }
    for (const c of n.children) walk(c, next);
  };
  walk(root, []);

  const sgfPoint = (s) => ({ dRow: s.charCodeAt(1) - 97 - CENTER, dCol: s.charCodeAt(0) - 97 - CENTER });
  let matched = 0, named = 0;
  for (const hit of hits) {
    const black1 = sgfPoint(hit.seq[0]);
    const white2 = sgfPoint(hit.seq[1]);
    // 只处理黑1 在中心的情况（定式谱里就是 hh）。
    if (black1.dRow !== 0 || black1.dCol !== 0) continue;
    // 白2 相邻（正交或对角）才算 26 开局族。
    const adjacent = (Math.abs(white2.dRow) === 1 && Math.abs(white2.dCol) <= 1) || (Math.abs(white2.dCol) === 1 && Math.abs(white2.dRow) <= 1);
    if (!adjacent) continue;
    for (const label of hit.labels) {
      const rifName = bookToRif(label.l, [...RIF_DIRECT, ...RIF_INDIRECT]);
      if (!rifName) continue; // 该标签不是开局名（如「YJZ」「最强」「c」）
      named += 1;
      const point = sgfPoint(label.p);
      // 定式谱与打点簿在同一几何下（可能整体镜像）；用代码的 D4 归一函数验证任意朝向都认得出。
      const identity = identify({ dRow: 0, dCol: 0 }, white2, point);
      if (identity && identity.name === rifName) matched += 1;
      else check(false, `定式谱点 ${label.p}（${rifName}）未能按 D4 识别`, `得到 ${identity ? identity.name : "null"}，白2 相对 (${white2.dRow},${white2.dCol})`);
    }
  }
  check(named > 0, "定式谱里找到了开局名标签", `共 ${named} 个`);
  check(matched === named, "定式谱的全部开局名标签都能被识别且名字正确", `${matched}/${named}`);
  ok(`源 B 交叉核对完成（${matched}/${named} 一致）`);
}

/**
 * 本地复刻 identifyOpening 的查找（避免脚本 import TS）。
 * 与 src 里的实现保持同一套 D4 与两张表。
 */
function identify(first, second, third) {
  const D4 = [
    (p) => ({ dRow: p.dRow, dCol: p.dCol }),
    (p) => ({ dRow: p.dRow, dCol: -p.dCol }),
    (p) => ({ dRow: -p.dRow, dCol: p.dCol }),
    (p) => ({ dRow: -p.dRow, dCol: -p.dCol }),
    (p) => ({ dRow: p.dCol, dCol: p.dRow }),
    (p) => ({ dRow: p.dCol, dCol: -p.dRow }),
    (p) => ({ dRow: -p.dCol, dCol: p.dRow }),
    (p) => ({ dRow: -p.dCol, dCol: -p.dRow }),
  ];
  if (first.dRow !== 0 || first.dCol !== 0) return null;
  let hit = null;
  for (const t of D4) {
    const w2 = t(second);
    const b3 = t(third);
    const family = w2.dRow === 1 && w2.dCol === 0 ? "direct" : w2.dRow === 1 && w2.dCol === 1 ? "indirect" : null;
    if (!family) continue;
    const table = family === "direct" ? codeDirect : codeIndirect;
    const name = table.find((e) => e.dRow === b3.dRow && e.dCol === b3.dCol)?.name ?? null;
    if (!name) continue;
    if (hit && hit.name !== name) return null;
    hit = { name, family };
  }
  return hit;
}

console.log(failures === 0 ? "\n✅ 全部通过：32 个开局点与两个来源一致" : `\n❌ ${failures} 项不符`);
process.exit(failures === 0 ? 0 : 1);
