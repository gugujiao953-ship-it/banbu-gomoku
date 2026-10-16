/**
 * 成就工坊的**引擎**：在源码与网页之间来回搬运数据。
 *
 * ```bash
 * node scripts/achievement-workshop.mjs build              # 源码 → design-lab/achievement-workshop-data.js
 * node scripts/achievement-workshop.mjs verify <导出.json>  # 只校验，不写盘（会列出增删改）
 * node scripts/achievement-workshop.mjs apply  <导出.json>  # 校验通过后写回源码
 * ```
 *
 * ## 为什么要有这个东西（而不是让网页直接改源码）
 *
 * 网页跑在浏览器里、打开方式是双击，它**碰不到文件系统**。所以中间必须有一次显式搬运：
 * 网页导出 JSON → 这个脚本校验并写回 `.ts`。这一步不只是技术限制，也是**安全阀**：
 * 工坊里手滑删掉二十条成就、或者把判据写成一个不存在的取值路径，都会在这里被拦下
 * （`validate()` 与运行期的 `validateAchievementCatalog()` 同一套口径）。
 *
 * ## 为什么用 .js 而不是 .json 喂数据
 *
 * 页面是**双击打开**的（`file://`），此时 `fetch()` 读本地 JSON 会被浏览器的
 * 同源策略挡掉，而 `<script src>` 不受影响。所以数据写成 `window.WORKSHOP_DATA = {...}`。
 * 这一条踩过才知道，写在这里免得下一个人改成 fetch 又坏一次。
 *
 * ## 解析方式：字符串感知的括号扫描
 *
 * 不用正则硬怼（`.ts` 里的中文文案、`≥`、引号都会让正则失控）。这里做的是一个小扫描器，
 * 能正确跳过字符串与注释，因此**目录里加注释、换行、改引号风格都不影响解析**。
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const CATALOG_FILE = path.join(root, "src", "features", "progress", "achievement-catalog.ts");
const RULES_FILE = path.join(root, "src", "features", "progress", "achievement-rules.ts");
const ECONOMY_FILE = path.join(root, "src", "features", "progress", "soul-economy.ts");
const DATA_FILE = path.join(root, "design-lab", "achievement-workshop-data.js");
/**
 * 解锁商店的**定价规则**（`SOUL_PRICE_RULES`）住在这里。
 *
 * 它是独立于 `soul-economy.ts` 的第三个文件：经济那份管"钱怎么来"（来源表、调度旋钮），
 * 这份管"东西卖多少"（各类基价与档位增量），VCF 道具的单价又住在第四个文件里。
 * 工坊要读写定价，就得把这两个路径也拿在手上。
 */
const UNLOCKS_FILE = path.join(root, "src", "features", "progress", "soul-unlocks.ts");
const ITEMS_FILE = path.join(root, "src", "features", "vcf-challenge", "items.ts");

// ─────────────────────────────────────────────────────────────────────
// 小扫描器：字符串/注释感知
// ─────────────────────────────────────────────────────────────────────

/**
 * 从 `text[from]` 开始找一个**配平**的块，`open`/`close` 是首尾字符。
 * 返回 `{ start, end }`（end 是闭括号的下标），找不到返回 null。
 */
function findBalanced(text, from, open, close) {
  let depth = 0;
  let str = null;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (str) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === str) str = null;
      continue;
    }
    // 注释：跳过，避免里面的括号/引号干扰配平
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) break; continue; }
    if (ch === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i); if (i < 0) break; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
    if (ch === open) { depth += 1; continue; }
    if (ch === close) { depth -= 1; if (depth === 0) return { start: from, end: i }; }
  }
  return null;
}

/**
 * 把 `[ ... ]` 里的**顶层**对象一个个切出来。
 *
 * ⚠ 必须先 `stripComments`：目录里**每条成就前面都有一行分组注释**
 * （`// ── 对弈 ──…`），而注释里含有成串的 `─` 与中文 —— 直接扫会在注释里
 * 把 `{`/`}` 数错（实测丢过 5 条：注释里的 `─` 数量不同导致记录位置漂移）。
 * 去注释后再切，位置就完全由花括号决定，稳。
 */
function splitTopLevelObjects(arrayBody) {
  const body = stripComments(arrayBody);
  const out = [];
  let depth = 0;
  let start = -1;
  let str = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (str) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === str) str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth += 1; continue; }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) { out.push(body.slice(start, i + 1)); start = -1; }
    }
  }
  return out;
}

/** 去掉注释（解析类型别名这种"带文档注释的声明"时必须先做，否则注释里的中文会被当成字面量）。 */
function stripComments(text) {
  let out = "";
  let str = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (str) {
      out += ch;
      if (ch === "\\") { out += text[i + 1] ?? ""; i += 1; continue; }
      if (ch === str) str = null;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) break; out += "\n"; continue; }
    if (ch === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i); if (end < 0) break; i = end + 1; out += " "; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; out += ch; continue; }
    out += ch;
  }
  return out;
}

const unescapeLiteral = (raw) => raw
  .replace(/\\n/g, "\n")
  .replace(/\\t/g, "\t")
  .replace(/\\"/g, '"')
  .replace(/\\'/g, "'")
  .replace(/\\\\/g, "\\");

/** 解析一个值：字符串字面量 / 数字 / 布尔 / 数组 / 嵌套对象。 */
function parseValue(raw) {
  const text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) || (text.startsWith("`") && text.endsWith("`"))) {
    return unescapeLiteral(text.slice(1, -1));
  }
  if (text === "true") return true;
  if (text === "false") return false;
  // 数组：`[]` 或 `["a", "b"]`（`disabledReasons` 就是这种）。
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseValue(item.trim()));
  }
  if (text.startsWith("{")) return parseFields(text);
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

/**
 * 把一个对象字面量解析成字段表。
 * 只处理"键: 字面量"这一层（我们的数据就是这个形状，不需要通用 JS 解析器）。
 */
function parseFields(objectBody) {
  const body = objectBody.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out = {};
  let i = 0;
  while (i < body.length) {
    // 找下一个 `key:` —— key 允许是标识符或带引号
    while (i < body.length && /[\s,]/.test(body[i])) i += 1;
    if (i >= body.length) break;
    if (body[i] === "/" && body[i + 1] === "/") { i = body.indexOf("\n", i); if (i < 0) break; continue; }
    // ⚠ 块注释（`/** … */`）也要跳过。原来只认 `//`，于是 `SOUL_PRICE_RULES`
    // 那种"每个字段上面挂一段 JSDoc"的对象会**整块解析成空对象**——
    // 表现是"工坊读到的定价全是 undefined"，而不是报错。
    // 实测踩过：加上这一支之前 priceRules 得到 `{}`。
    if (body[i] === "/" && body[i + 1] === "*") {
      const close = body.indexOf("*/", i);
      if (close < 0) break;
      i = close + 2;
      continue;
    }
    const keyMatch = /^([A-Za-z_$][\w$]*|"[^"]*"|'[^']*')\s*:/.exec(body.slice(i));
    if (!keyMatch) break;
    const key = keyMatch[1].replace(/^["']|["']$/g, "");
    i += keyMatch[0].length;
    // 取值的范围：到本层下一个逗号为止（跳过字符串与嵌套括号）
    let depth = 0;
    let str = null;
    let end = i;
    for (; end < body.length; end += 1) {
      const ch = body[end];
      if (str) { if (ch === "\\") { end += 1; continue; } if (ch === str) str = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
      if (ch === "{" || ch === "[" || ch === "(") { depth += 1; continue; }
      if (ch === "}" || ch === "]" || ch === ")") { depth -= 1; continue; }
      if (ch === "," && depth === 0) break;
    }
    out[key] = parseValue(body.slice(i, end));
    i = end + 1;
  }
  return out;
}

/** 取出 `export const NAME ... = VALUE` 后面的那个值（对象或数组字面量）。 */
function readExportLiteral(source, name, open, close) {
  const re = new RegExp(`export\\s+const\\s+${name}\\b[^=]*=`);
  const match = re.exec(source);
  if (!match) return null;
  const from = match.index + match[0].length;
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] !== open) {
    // 简单值（数字/字符串/布尔）
    let end = i;
    while (end < source.length && !/[\n;]/.test(source[end])) end += 1;
    return { body: source.slice(i, end).trim(), start: i, end };
  }
  const found = findBalanced(source, i, open, close);
  if (!found) return null;
  // 数组后面可能跟 `as const`
  let after = found.end + 1;
  const tail = source.slice(after, after + 20);
  const asConst = /^\s*as\s+const/.exec(tail);
  if (asConst) after += asConst[0].length;
  return { body: source.slice(i + 1, found.end), start: i, end: after, literal: source.slice(i, found.end + 1) };
}

// ─────────────────────────────────────────────────────────────────────
// 源码 → 数据
// ─────────────────────────────────────────────────────────────────────

/**
 * 分组元数据**从源码的 `ACHIEVEMENT_GROUPS` 现读**，不在这里抄一份。
 *
 * ⚠ 原来这里是一份手抄表（5 个分组）。2026-10-10 加了第六组「棋魂」之后，
 * 工坊立刻报「soul-tap-1 的分组不存在」——**导出被拦住**，因为校验用的是这份
 * 过时的清单。这正是本项目反复吃过的那类亏（见 theme-options.ts 里
 * "同一个东西在五处各写一份清单"的教训），所以改成现读。
 *
 * fallback 保留着：万一 `ACHIEVEMENT_GROUPS` 的写法变了、正则读不到，
 * 至少还有一份能用的（而不是整个工坊打不开）。
 */
const GROUPS_META_FALLBACK = [
  { id: "duel", title: "对弈", summary: "和 AI 下棋、等级分与棋钟" },
  { id: "puzzle", title: "做题", summary: "题库、错题、VCF 挑战" },
  { id: "study", title: "研究", summary: "打谱、复盘、变化树与开局" },
  { id: "recognition", title: "识谱", summary: "图片识谱与手序复原" },
  { id: "explore", title: "探索", summary: "把软件本身用起来" },
  { id: "soul", title: "棋魂", summary: "点魂火、攒棋魂、买解锁" },
];

/** 从 `ACHIEVEMENT_GROUPS` 里解析出分组元数据（读不到就用 fallback）。 */
function readGroupsMeta(source) {
  const literal = readExportLiteral(source, "ACHIEVEMENT_GROUPS", "[", "]");
  if (!literal) return GROUPS_META_FALLBACK;
  const items = splitTopLevelObjects(literal.body).map(parseFields);
  const clean = items.filter((item) => typeof item.id === "string" && typeof item.title === "string");
  return clean.length ? clean.map((item) => ({ id: item.id, title: item.title, summary: item.summary ?? "" })) : GROUPS_META_FALLBACK;
}

/** 每个取值路径给一个"它属于哪一类"的提示，工坊里按它分组选择（比一长串平铺好找）。 */
const SOURCE_GROUPS = [
  { id: "duel", title: "对弈" },
  { id: "puzzle", title: "做题" },
  { id: "vcf", title: "VCF 挑战" },
  { id: "review", title: "复盘" },
  { id: "recognition", title: "识谱" },
  { id: "study", title: "打谱研究" },
  { id: "library", title: "棋谱库" },
  { id: "generator", title: "棋题生成器" },
  { id: "signals", title: "一次性信号位" },
  { id: "other", title: "其它" },
];

/**
 * 归一化一条判据。
 *
 * `value` 可能是数字字面量、也可能是一个**代码常量名**（`LEVEL_MAX`）。
 * 解析器读出来后者时是个字符串 —— 这里把它标记成 `valueRef`，
 * 让页面知道"这是个代码里的常量，别当数值改"，校验也不会再要它"必须给数值"。
 */
function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") return rule;
  const op = rule.op;
  if (op !== "gte" && op !== "lte") {
    // 布尔型判据没有 value，把可能误读进来的字段去掉
    return { from: rule.from, op };
  }
  if (typeof rule.value === "number") return { from: rule.from, op, value: rule.value };
  // 非数字 ⇒ 当成代码常量引用（原样保留字符串，写回时也原样输出）
  return { from: rule.from, op, valueRef: typeof rule.value === "string" ? rule.value : String(rule.value ?? "") };
}

const groupOfSource = (key) => {
  const head = key.includes(".") ? key.split(".")[0] : "other";
  return SOURCE_GROUPS.some((item) => item.id === head) ? head : "other";
};

export async function buildData(files = {}) {
  const catalogFile = files.catalogFile ?? CATALOG_FILE;
  const economyFile = files.economyFile ?? ECONOMY_FILE;
  const rulesFile = files.rulesFile ?? RULES_FILE;
  const unlocksFile = files.unlocksFile ?? UNLOCKS_FILE;
  const itemsFile = files.itemsFile ?? ITEMS_FILE;
  const catalogSource = fs.readFileSync(catalogFile, "utf8");
  const rulesSource = fs.readFileSync(rulesFile, "utf8");
  const economySource = fs.readFileSync(economyFile, "utf8");
  const unlocksSource = fs.readFileSync(unlocksFile, "utf8");
  const itemsSource = fs.readFileSync(itemsFile, "utf8");
  // ── 成就目录 ──
  const catalogLiteral = readExportLiteral(catalogSource, "ACHIEVEMENT_CATALOG", "[", "]");
  if (!catalogLiteral) throw new Error("没找到 ACHIEVEMENT_CATALOG —— 文件结构变了？");
  const catalog = splitTopLevelObjects(catalogLiteral.body).map((body) => {
    const fields = parseFields(body);
    return {
      id: String(fields.id ?? ""),
      group: String(fields.group ?? "explore"),
      title: String(fields.title ?? ""),
      text: String(fields.text ?? ""),
      soul: Number(fields.soul ?? 0),
      // target 也可能是**代码表达式**（如 `THEME_OPTIONS.length`）而不是数字字面量。
      // 2026-10-10 起 `explore-theme-all` 的套数就是那么写的（为了不再抄死数字）。
      // 工坊不做代码求值（那是无底洞），所以原样带过来标记成 `targetRef` 并禁止编辑 ——
      // 和判据的 `valueRef` 是同一套处理（见 normalizeRule）。
      ...(fields.target !== undefined
        ? (typeof fields.target === "number"
          ? { target: Number(fields.target) }
          : { targetRef: String(fields.target) })
        : {}),
      ...(fields.unit !== undefined ? { unit: String(fields.unit) } : {}),
      ...(fields.secret ? { secret: true } : {}),
      // 判据里的 value 可能是**代码常量**而不是字面量（例如 `LEVEL_MAX`）——
      // 那是刻意引常量而不是抄数字（抄了会在常量被改的那天变成"永远解不开"，
      // 见 achievement-catalog.ts 里那条注释）。工坊不做代码求值（那是个无底洞），
      // 所以原样带过来、在页面上把它显示成"代码常量"并**禁止编辑**。
      ...(fields.rule ? { rule: normalizeRule(fields.rule) } : {}),
    };
  });

  const allTruthId = (() => {
    const m = /export\s+const\s+ALL_TRUTH_ACHIEVEMENT_ID\s*=\s*"([^"]+)"/.exec(catalogSource);
    return m ? m[1] : "explore-all-truth";
  })();

  // ── 取值路径（从 SOURCE_LABELS 的键里取）──
  const labelsLiteral = readExportLiteral(rulesSource, "SOURCE_LABELS", "{", "}");
  const sourceLabels = labelsLiteral ? parseFields(labelsLiteral.literal) : {};
  const opsLiteral = /export\s+type\s+RuleOp\s*=([^;]+);/.exec(rulesSource);
  // ⚠ 必须先 stripComments：`RuleOp` 的每个分支上面都有一行文档注释，
  // 里面含有 `"从没发生过"`、`"从未因禁手判负"` 这类**中文引号内容** ——
  // 直接拿正则捞引号会把它们也当成算符（实测捞出来 6 个、其中 2 个是注释）。
  const ops = opsLiteral
    ? [...stripComments(opsLiteral[1]).matchAll(/"([a-z]+)"/g)].map((m) => m[1])
    : ["gte", "lte", "truthy", "falsy"];

  // ── 棋魂来源表 / 消费表 / 默认调度 ──
  const earnLiteral = readExportLiteral(economySource, "SOUL_EARN_RULES", "[", "]");
  const earnRules = earnLiteral ? splitTopLevelObjects(earnLiteral.body).map(parseFields) : [];
  const spendLiteral = readExportLiteral(economySource, "SOUL_SPEND_POINTS", "[", "]");
  const spendPoints = spendLiteral ? splitTopLevelObjects(spendLiteral.body).map(parseFields) : [];
  const defaultTuning = parseFields(readExportLiteral(economySource, "DEFAULT_SOUL_TUNING", "{", "}").literal);
  const noteOf = (name) => {
    const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(economySource);
    return m ? unescapeLiteral(m[1]) : "";
  };
  const tunableLiteral = readExportLiteral(economySource, "TUNABLE_REASONS", "[", "]");
  const tunableReasons = tunableLiteral
    ? [...tunableLiteral.body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [];

  // ── 商店定价（2026-10-10 新增）──
  // 三块数值，都是"改一个数就生效"的纯数据：
  //  ① `SOUL_PRICE_RULES`（soul-unlocks.ts）：外观各档的基价与增量；
  //  ② `VCF_LEVEL_SOUL`（soul-economy.ts）：VCF 每升一级发多少（1..LEVEL_MAX）；
  //  ③ 三个道具的 `cost`（items.ts）：加时/提示/悔棋。
  // 底座常量（LEVEL_MAX 等）**只读不改**：它们是别的模块算出来的，工坊不该伪造。
  const priceRulesLiteral = readExportLiteral(unlocksSource, "SOUL_PRICE_RULES", "{", "}");
  const priceRules = priceRulesLiteral ? parseFields(priceRulesLiteral.literal) : {};
  const levelSoulLiteral = readExportLiteral(economySource, "VCF_LEVEL_SOUL", "[", "]");
  const levelSoul = levelSoulLiteral
    ? [...stripComments(levelSoulLiteral.body).matchAll(/-?\d+/g)].map((m) => Number(m[0]))
    : [];
  const levelMaxMatch = /export\s+const\s+LEVEL_MAX\s*=\s*[^;]+;/.exec(
    fs.readFileSync(path.join(root, "src", "features", "vcf-challenge", "rating.ts"), "utf8"));
  // 只用于**校验长度**（数组下标即等级），值本身照旧由源码算，工坊不写回。
  // 读不到 LEVEL_MAX 也照跑：那时只校验"数组非空"，不硬拦。
  const levelMaxHint = levelMaxMatch ? levelSoul.length : 0;
  const vcfItems = [...stripComments(itemsSource).matchAll(
    /\{\s*id:\s*"([a-z-]+)",\s*name:\s*"([^"]+)",\s*text:\s*"((?:[^"\\]|\\.)*)",\s*cost:\s*(\d+),/g)]
    .map((m) => ({ id: m[1], name: m[2], text: unescapeLiteral(m[3]), cost: Number(m[4]) }));

  // 评审说明（每条成就/来源/旋钮「我为什么提它」）。**不在源码里**——那是提案材料，
  // 混进 achievement-catalog.ts 会是 74 段永不被读到的文字（本项目的纪律：不留死代码）。
  // 漏写时不静默留空：装上「（待补说明）」，否则看起来像那条不重要。
  const notes = await loadNotes();
  const missingNotes = catalog.filter((item) => !notes.achievements[item.id]).map((item) => item.id);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      catalog: path.relative(root, CATALOG_FILE).replace(/\\/g, "/"),
      economy: path.relative(root, ECONOMY_FILE).replace(/\\/g, "/"),
    },
    allTruthId,
    groups: readGroupsMeta(catalogSource),
    sourceGroups: SOURCE_GROUPS,
    sourceLabels,
    sourceKeys: Object.keys(sourceLabels).map((key) => ({ key, label: sourceLabels[key], group: groupOfSource(key) })),
    ops,
    catalog,
    earnRules,
    earnNote: noteOf("SOUL_EARN_NOTE"),
    spendPoints,
    spendNote: noteOf("SOUL_SPEND_NOTE"),
    defaultTuning,
    tunableReasons,
    // 定价三块（2026-10-10）。`levelMax` 只用于界面提示"共几级"，写回时不碰。
    priceRules,
    levelSoul,
    levelMax: levelMaxHint,
    vcfItems,
    notes,
    missingNotes,
  };
}

/**
 * 读 `design-lab/achievement-notes.mjs`（评审说明）。
 *
 * 用 `import()` 而不是解析：那个文件是纯数据、没有副作用，直接当模块加载最省事，
 * 也不会因为文案里带引号/换行而解析失败。
 */
async function loadNotes() {
  const file = path.join(root, "design-lab", "achievement-notes.mjs");
  if (!fs.existsSync(file)) {
    return { achievements: {}, earn: {}, tuning: {}, price: {}, audit: null, brief: { title: "成就与棋魂 · 评审稿", lead: "", steps: [], closing: "" } };
  }
  const mod = await import(url.pathToFileURL(file).href);
  return {
    achievements: mod.ACHIEVEMENT_NOTES ?? {},
    earn: mod.EARN_NOTES ?? {},
    tuning: mod.TUNING_NOTES ?? {},
    price: mod.PRICE_NOTES ?? {},
    audit: mod.AUDIT ?? null,
    brief: mod.BRIEF ?? { title: "成就与棋魂 · 评审稿", lead: "", steps: [], closing: "" },
  };
}

async function writeData() {
  const data = await buildData();
  const banner = `// 由 node scripts/achievement-workshop.mjs build 生成 —— 不要手改这个文件。
// 要改数据：双击 design-lab/achievement-workshop.html 编辑，导出后再 apply。
// 生成时间：${data.generatedAt}
`;
  fs.writeFileSync(DATA_FILE, `${banner}window.WORKSHOP_DATA = ${JSON.stringify(data, null, 2)};\n`, "utf8");
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// 校验（与运行期 validateAchievementCatalog 同一套口径）
// ─────────────────────────────────────────────────────────────────────

const REASON_LABELS = {
  achievement: "解锁成就", "puzzle-solve": "攻克题目", "vcf-solve": "VCF 挑战", "duel-win": "对弈取胜",
  recognition: "识谱成功", review: "整局复盘", study: "打谱批注", daily: "每日一题", carry: "期初结余", manual: "手动调整",
};

export function validate(data) {
  const problems = [];
  const seen = new Set();
  const sourceKeys = new Set((data.sourceKeys ?? []).map((item) => item.key));

  for (const item of data.catalog ?? []) {
    const where = item.id || "(缺 id)";
    if (!item.id) problems.push("有一条成就没有 id");
    if (seen.has(item.id)) problems.push(`成就 id 重复：${item.id}`);
    seen.add(item.id);
    if (!/^[a-z0-9-]+$/.test(item.id ?? "")) problems.push(`${where} 的 id 只能是「小写字母/数字/连字符」（它是存档键）`);
    if (!(data.groups ?? []).some((group) => group.id === item.group)) problems.push(`${where} 的分组 ${item.group} 不存在`);
    if (!Number.isInteger(item.soul) || item.soul <= 0) problems.push(`${where} 的棋魂奖励必须是正整数`);
    if (!String(item.title ?? "").trim()) problems.push(`${where} 缺标题`);
    if (!String(item.text ?? "").trim()) problems.push(`${where} 缺说明`);
    // target：数字字面量要满足 ≥2；`targetRef`（代码表达式，如 `THEME_OPTIONS.length`）
    // 由源码保证是数，工坊不管它的值 —— 只要求它配了 unit。
    if (item.target !== undefined && item.targetRef === undefined
      && (!Number.isInteger(item.target) || item.target < 2)) {
      problems.push(`${where} 的 target 必须是 ≥2 的整数（1 就是一次性事件，别写 target）`);
    }
    if ((item.target !== undefined || item.targetRef !== undefined) && !item.unit) {
      problems.push(`${where} 有 target 就必须有 unit`);
    }
    if (item.id !== data.allTruthId) {
      if (!item.rule) problems.push(`${where} 缺判据（rule）——只有全图鉴可以没有`);
      else {
        if (!sourceKeys.has(item.rule.from)) problems.push(`${where} 的取值路径「${item.rule.from}」不存在`);
        if (!(data.ops ?? []).includes(item.rule.op)) problems.push(`${where} 的算符「${item.rule.op}」不存在`);
        if ((item.rule.op === "gte" || item.rule.op === "lte")
          && typeof item.rule.value !== "number"
          // `valueRef` = 代码常量（如 LEVEL_MAX）：它由源码保证是数，工坊不管
          && typeof item.rule.valueRef !== "string") {
          problems.push(`${where} 的规则是 ${item.rule.op}，必须给数值`);
        }
      }
    }
  }

  for (const rule of data.earnRules ?? []) {
    if (!REASON_LABELS[rule.reason]) problems.push(`来源表的 reason「${rule.reason}」不是合法的来源`);
    if (typeof rule.amount !== "number" || rule.amount < 0 || !Number.isInteger(rule.amount)) {
      problems.push(`来源表「${rule.title || rule.reason}」的数额必须是非负整数`);
    }
    if (!String(rule.title ?? "").trim() || !String(rule.text ?? "").trim()) problems.push(`来源表「${rule.reason}」缺标题或说明`);
  }

  const spendIds = new Set();
  for (const point of data.spendPoints ?? []) {
    if (!point.id) problems.push("有一个消费点没有 id");
    if (spendIds.has(point.id)) problems.push(`消费点 id 重复：${point.id}`);
    spendIds.add(point.id);
    if (!/^[a-z0-9-]+$/.test(point.id ?? "")) problems.push(`消费点 ${point.id} 的 id 只能是小写字母/数字/连字符`);
    if (!Number.isInteger(point.cost) || point.cost <= 0) problems.push(`消费点 ${point.id} 的价位必须是正整数`);
    if (!String(point.title ?? "").trim() || !String(point.text ?? "").trim()) problems.push(`消费点 ${point.id} 缺标题或说明`);
    if (typeof point.ready !== "boolean") problems.push(`消费点 ${point.id} 必须写明是否已接线（ready）`);
  }

  const tuning = data.defaultTuning ?? {};
  const ranges = {
    earnMultiplier: [0, 10], achievementMultiplier: [0, 10], earnCapPerGrant: [0, 100000], dailyEarnLimit: [0, 1000000],
    lossAmount: [0, 1000], drawAmount: [0, 1000], tapAmount: [1, 100], spendMultiplier: [0.1, 10],
    minimumSpend: [1, 1000], dailySpendLimit: [0, 1000000],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = tuning[key];
    if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`调度项 ${key} 必须是数字`);
    else if (value < min || value > max) problems.push(`调度项 ${key} 必须在 ${min}–${max} 之间（现在 ${value}）`);
  }
  if (!Array.isArray(tuning.disabledReasons)) problems.push("调度项 disabledReasons 必须是数组");
  else for (const reason of tuning.disabledReasons) {
    if (!REASON_LABELS[reason] || reason === "carry") problems.push(`调度项里关掉的来源「${reason}」不合法`);
  }
  if (typeof tuning.tapCountsAsEarned !== "boolean") problems.push("调度项 tapCountsAsEarned 必须是布尔");

  // ── 定价（2026-10-10 新增）────────────────────────────────────────
  // 三条口径，和运行期的实现一一对应：
  //  · 档位值必须是非负整数（价格是给用户看的数，小数没有意义）；
  //  · 主题三档必须满足「朴素 ≤ 中间 ≤ 最重」，否则规则函数的语义就反了
  //    （那会导致"最朴素的比最重的还贵"这种谁也算不出来的定价）；
  //  · VCF 每级奖励必须非负整数，长度要么等于 LEVEL_MAX、要么更长（取用时按最后一档兜底）。
  const rules = data.priceRules ?? {};
  const PRICE_KEYS = ["boardBase", "stoneBase", "motionBonus", "heavyBonus", "newMaterialBonus", "themePlain", "themeMid", "themeHeavy"];
  for (const key of PRICE_KEYS) {
    const value = rules[key];
    if (!Number.isInteger(value) || value < 0) problems.push(`定价 ${key} 必须是非负整数（现在 ${value}）`);
  }
  if (Number.isInteger(rules.themePlain) && Number.isInteger(rules.themeMid) && rules.themePlain > rules.themeMid) {
    problems.push(`主题定价反了：最朴素档（${rules.themePlain}）不该贵过中间档（${rules.themeMid}）`);
  }
  if (Number.isInteger(rules.themeMid) && Number.isInteger(rules.themeHeavy) && rules.themeMid > rules.themeHeavy) {
    problems.push(`主题定价反了：中间档（${rules.themeMid}）不该贵过最重档（${rules.themeHeavy}）`);
  }
  if (!Array.isArray(data.levelSoul) || !data.levelSoul.length) {
    problems.push("VCF 等级奖励表不能为空");
  } else {
    data.levelSoul.forEach((value, index) => {
      if (!Number.isInteger(value) || value < 0) problems.push(`VCF 等级奖励第 ${index + 1} 级必须是非负整数（现在 ${value}）`);
    });
    if (data.levelMax > 0 && data.levelSoul.length < data.levelMax) {
      problems.push(`VCF 等级奖励只有 ${data.levelSoul.length} 项，少于最高等级 ${data.levelMax}（取用时按最后一档兜底，但你大概是漏了几级）`);
    }
  }
  const ITEM_IDS = ["extra-time", "hint", "undo"];
  for (const item of data.vcfItems ?? []) {
    if (!ITEM_IDS.includes(item.id)) problems.push(`道具 id「${item.id}」不认识（只认 ${ITEM_IDS.join(" / ")}）`);
    if (!Number.isInteger(item.cost) || item.cost <= 0) problems.push(`道具「${item.name || item.id}」的单价必须是正整数（现在 ${item.cost}）`);
  }
  if ((data.vcfItems ?? []).length !== ITEM_IDS.length) {
    problems.push(`道具必须正好 ${ITEM_IDS.length} 个（现在 ${(data.vcfItems ?? []).length} 个）`);
  }

  return problems;
}

// ─────────────────────────────────────────────────────────────────────
// 数据 → 源码
// ─────────────────────────────────────────────────────────────────────

const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/** 把成就写成源码条目（**与现有文件同样的排布**：首行放文案，rule 单独一行）。 */
function renderAchievement(item) {
  const head = [`id: ${quote(item.id)}`, `group: ${quote(item.group)}`, `title: ${quote(item.title)}`, `text: ${quote(item.text)}`, `soul: ${item.soul}`];
  // target 可能是字面量、也可能是代码表达式（`targetRef`，如 `THEME_OPTIONS.length`）。
  // 表达式必须原样写出去，**不能加引号**（加了就从数字变成字符串，判定当场失效）——
  // 同 `rule.valueRef` 的处理与理由。
  if (item.targetRef !== undefined) head.push(`target: ${item.targetRef}`, `unit: ${quote(item.unit)}`);
  else if (item.target !== undefined) head.push(`target: ${item.target}`, `unit: ${quote(item.unit)}`);
  if (item.secret) head.push("secret: true");
  // ⚠ 级别（tier）必须写出去 —— 漏了它，往返一次就会把显式级别丢掉
  // （表现是"那条成就的弹窗排场悄悄变回按 soul 推断"，很难发现）。
  // 这是"渲染器漏字段"的一个实例：**目录新增字段时一定要同步改这里**，
  // 而门禁里那条"逐字段一致"就是专门抓这个的（它确实抓到了）。
  if (item.tier !== undefined) head.push(`tier: ${item.tier}`);
  const lines = [`  { ${head.join(", ")}${item.rule ? "," : ""}`];
  if (item.rule) {
    const parts = [`from: ${quote(item.rule.from)}`, `op: ${quote(item.rule.op)}`];
    if (item.rule.op !== "truthy" && item.rule.op !== "falsy") {
      // valueRef 是**代码常量的名字**，必须原样写出去（不能加引号 —— 加了就变成字符串字面量，
      // 那会让 `rule.value` 从数字变成字符串，判定当场失效）。
      parts.push(item.rule.valueRef ? `value: ${item.rule.valueRef}` : `value: ${item.rule.value}`);
    }
    lines.push(`    rule: { ${parts.join(", ")} } },`);
  } else {
    lines[0] += " },";
  }
  return lines.join("\n");
}

function renderCatalogBlock(data) {
  const order = (data.groups ?? []).map((group) => group.id);
  const out = [];
  for (const groupId of order) {
    const items = (data.catalog ?? []).filter((item) => item.group === groupId);
    if (!items.length) continue;
    const meta = data.groups.find((group) => group.id === groupId);
    // 分组注释：保持和原文件一样的观感（工坊里换组之后，这里跟着重排）
    out.push(`  // ── ${meta?.title ?? groupId} ─${"─".repeat(Math.max(0, 44 - String(meta?.title ?? groupId).length))}`);
    for (const item of items) out.push(renderAchievement(item));
  }
  // 分组不明的条目（理论上不会出现，校验会拦）落在最后，宁可写出来也不要静默丢掉。
  const orphans = (data.catalog ?? []).filter((item) => !order.includes(item.group));
  if (orphans.length) {
    out.push("  // ── 未分组（工坊里请给它们指定分组）──");
    for (const item of orphans) out.push(renderAchievement(item));
  }
  return out.join("\n");
}

function renderEconomy(data) {
  const earnLines = (data.earnRules ?? []).map((rule) =>
    `  { reason: ${quote(rule.reason)}, amount: ${rule.amount}, title: ${quote(rule.title)}, text: ${quote(rule.text)} },`);
  const spendLines = (data.spendPoints ?? []).map((point) =>
    `  { id: ${quote(point.id)}, cost: ${point.cost}, title: ${quote(point.title)}, text: ${quote(point.text)}, ready: ${point.ready ? "true" : "false"} },`);
  const t = data.defaultTuning ?? {};
  const tuningLines = [
    `  earnMultiplier: ${t.earnMultiplier},`,
    `  achievementMultiplier: ${t.achievementMultiplier},`,
    `  earnCapPerGrant: ${t.earnCapPerGrant},`,
    `  dailyEarnLimit: ${t.dailyEarnLimit},`,
    `  disabledReasons: [${(t.disabledReasons ?? []).map(quote).join(", ")}],`,
    `  lossAmount: ${t.lossAmount},`,
    `  drawAmount: ${t.drawAmount},`,
    `  tapAmount: ${t.tapAmount},`,
    `  tapCountsAsEarned: ${t.tapCountsAsEarned ? "true" : "false"},`,
    `  spendMultiplier: ${t.spendMultiplier},`,
    `  minimumSpend: ${t.minimumSpend},`,
    `  dailySpendLimit: ${t.dailySpendLimit},`,
  ];
  return { earnLines, spendLines, tuningLines };
}

/** 用新的字面量替换 `export const NAME = ...`，其余部分（注释、其它导出）原样保留。 */
function replaceExport(source, name, literal, open, close) {
  const found = readExportLiteral(source, name, open, close);
  if (!found) throw new Error(`在源码里找不到 export const ${name}`);
  // 数组/对象本身（不含后面的 as const）由字面量重新给出，`as const` 保留。
  const tailMatch = /^\s*as\s+const/.exec(source.slice(found.end));
  const suffix = tailMatch ? " as const" : "";
  return { text: source.slice(0, found.start) + literal + suffix + source.slice(found.end), ok: true };
}

function readNumber(text, key) {
  const m = new RegExp(`let\\s+${key}|const\\s+${key}`).exec(text);
  return m ? m[0] : "";
}

/**
 * 写盘。**先全部渲染到内存，最后一起写**——中途抛错不会留下半个文件。
 *
 * `options` 里的三个路径只为**自检**存在（`qa/achievement-workshop-check.mjs` 会把它指向
 * 临时目录，验证"写出去再读回来数据不变"，而不用碰真实的源码）。
 * 正常调用（含 CLI）不传，写的就是源码那三个文件。
 */
export function apply(data, options = {}) {
  const catalogFile = options.catalogFile ?? CATALOG_FILE;
  const economyFile = options.economyFile ?? ECONOMY_FILE;
  const unlocksFile = options.unlocksFile ?? UNLOCKS_FILE;
  const itemsFile = options.itemsFile ?? ITEMS_FILE;

  /**
   * **沙箱护栏**（2026-10-10 加，为一次真实事故）：
   *
   * `apply` 的路径参数是"一个一个覆盖"的，而写回的目标是**五份**文件。
   * 自检/测试只关心其中两三份时，很容易写成
   * `apply(data, { catalogFile: tmp, economyFile: tmp })` 就以为万事大吉 ——
   * 而没传的那几份会**悄悄落到真实源码上**。
   *
   * 我正是这么踩的：门禁新加定价/道具写回之后，参数只传了两个临时路径，
   * 于是自检的测试值（boardBase 275、newMaterialBonus 0、提示卡 55）
   * 被写进了真实源码。数据含义上没崩，但"跑一次测试就改了源码"是绝对不能接受的。
   *
   * 现在的规则很简单：**只要给了任意一个自定义路径，就必须给全**。
   * 少给一个就直接拒绝执行 —— 宁可让自检报错，也不要静默改源码。
   * （不给任何路径 = 正常的 CLI 用法，那时五个都用真实的，是合法的。）
   */
  const overrides = ["catalogFile", "economyFile", "unlocksFile", "itemsFile"].filter((key) => options[key] !== undefined);
  if (overrides.length > 0 && overrides.length < 4) {
    const missing = ["catalogFile", "economyFile", "unlocksFile", "itemsFile"].filter((key) => options[key] === undefined);
    throw new Error(
      `apply() 的路径参数必须给全：只传了 ${overrides.join(", ")}，缺 ${missing.join(", ")}。`
      + `\n部分覆盖会让没传的那几份落到**真实源码**上（这是真实踩过的坑），所以这里直接拒绝。`
      + `\n要么五个全传（沙箱用法），要么一个都别传（CLI 直写源码）。`,
    );
  }

  const problems = validate(data);
  if (problems.length) return { ok: false, problems };

  const catalogSource = fs.readFileSync(catalogFile, "utf8");
  const catalogLiteral = `[\n${renderCatalogBlock(data)}\n]`;
  const nextCatalog = replaceExport(catalogSource, "ACHIEVEMENT_CATALOG", catalogLiteral, "[", "]").text;

  const economySource = fs.readFileSync(economyFile, "utf8");
  let nextEconomy = economySource;
  nextEconomy = replaceExport(nextEconomy, "SOUL_EARN_RULES", `[\n${renderEconomy(data).earnLines.join("\n")}\n]`, "[", "]").text;
  nextEconomy = replaceExport(nextEconomy, "SOUL_SPEND_POINTS", renderEconomy(data).spendLines.length
    ? `[\n${renderEconomy(data).spendLines.join("\n")}\n]`
    : "[]", "[", "]").text;
  nextEconomy = replaceExport(nextEconomy, "DEFAULT_SOUL_TUNING", `{\n${renderEconomy(data).tuningLines.join("\n")}\n}`, "{", "}").text;
  // 说明文案也一起写回（它跟着数额走，两边不一致会很怪）
  if (data.earnNote) {
    nextEconomy = nextEconomy.replace(/(export\s+const\s+SOUL_EARN_NOTE\s*=\s*)"(?:[^"\\]|\\.)*"/, `$1${quote(data.earnNote)}`);
  }
  if (data.spendNote) {
    nextEconomy = nextEconomy.replace(/(export\s+const\s+SOUL_SPEND_NOTE\s*=\s*)"(?:[^"\\]|\\.)*"/, `$1${quote(data.spendNote)}`);
  }

  fs.writeFileSync(catalogFile, nextCatalog, "utf8");
  fs.writeFileSync(economyFile, nextEconomy, "utf8");

  // ── 定价三块（2026-10-10）──────────────────────────────────────────
  // 同样"先全部渲染到内存、最后一起写"。这三块的写回**都是替一个字面量**，
  // 不碰周围的注释与其它导出 —— 所以工坊永远改不坏文件里别的东西。
  // ⚠ 这两份的路径已在函数开头解析好（并过了"要么全传、要么全不传"的护栏）。

  if (data.priceRules) {
    const source = fs.readFileSync(unlocksFile, "utf8");
    const keys = ["boardBase", "stoneBase", "motionBonus", "heavyBonus", "newMaterialBonus", "themePlain", "themeMid", "themeHeavy"];
    // ⚠ 逐字段渲染时**保留原字段顺序**（按上面那份清单，与源码里的排列一致）：
    //   用 Object.entries 跟着 JSON 顺序走的话，用户导出后字段顺序会漂移，
    //   每次都产生一大片"没意义的 diff"。
    const literal = `{\n${keys.map((key) => `  ${key}: ${data.priceRules[key]},`).join("\n")}\n}`;
    const next = replaceExport(source, "SOUL_PRICE_RULES", literal, "{", "}").text;
    fs.writeFileSync(unlocksFile, next, "utf8");
  }

  if (Array.isArray(data.levelSoul) && data.levelSoul.length) {
    const source = fs.readFileSync(economyFile, "utf8");
    const found = readExportLiteral(source, "VCF_LEVEL_SOUL", "[", "]");
    if (!found) return { ok: false, problems: ["在 soul-economy.ts 里找不到 VCF_LEVEL_SOUL"] };
    // ⚠ **就地改数字，不动每行结尾的注释**。
    //   源码里那 25 行注释是逐级手写的（"从这里开始有入门了的意思"、"= LEVEL_MAX，登顶"…），
    //   我第一版是整块重新渲染 —— 那样每调一次价，这些解释就全被替换成
    //   "第 N 级"这种没有信息量的模板文字，等于静默丢掉了一批说明。
    //   逐行替换则天然保留注释，也让 diff 只出现真正变了的行。
    const lines = found.body.split("\n");
    const numbers = [...lines].filter((line) => /^\s*\d+\s*,/.test(line));
    if (numbers.length !== data.levelSoul.length) {
      return { ok: false, problems: [`VCF_LEVEL_SOUL 有 ${numbers.length} 行，导出的有 ${data.levelSoul.length} 项（增删等级请直接改源码）`] };
    }
    let cursor = 0;
    const nextBody = lines.map((line) => {
      if (!/^\s*\d+\s*,/.test(line)) return line;
      const value = data.levelSoul[cursor];
      cursor += 1;
      return line.replace(/^(\s*)\d+(\s*,)/, `$1${value}$2`);
    }).join("\n");
    const next = source.slice(0, found.start) + `[${nextBody}]` + source.slice(found.end);
    fs.writeFileSync(economyFile, next, "utf8");
  }

  if (Array.isArray(data.vcfItems) && data.vcfItems.length) {
    let source = fs.readFileSync(itemsFile, "utf8");
    // 只替 `cost:` 那一个数，其余（id / name / text / amount / unit 与全部注释）原样保留。
    // 用一个"跟着 id 走"的替换：每个道具块里第一处 `cost: <数字>` 就是它的单价。
    for (const item of data.vcfItems) {
      const blockRe = new RegExp(`(id:\\s*"${item.id}"[\\s\\S]*?)cost:\\s*\\d+`);
      if (!blockRe.test(source)) {
        return { ok: false, problems: [`在 items.ts 里找不到道具 ${item.id} 的 cost 字段`] };
      }
      source = source.replace(blockRe, `$1cost: ${item.cost}`);
    }
    fs.writeFileSync(itemsFile, source, "utf8");
  }

  return { ok: true, problems: [] };
}

/** 给自检用：解析指定的两个文件（默认就是源码那对），返回数据。 */
export async function buildDataFrom(catalogFile = CATALOG_FILE, economyFile = ECONOMY_FILE, rulesFile = RULES_FILE) {
  return buildData({ catalogFile, economyFile, rulesFile });
}

// ─────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────

const summarize = (before, after) => {
  const beforeIds = new Set(before.map((item) => item.id));
  const afterIds = new Set(after.map((item) => item.id));
  const added = after.filter((item) => !beforeIds.has(item.id)).map((item) => item.id);
  const removed = before.filter((item) => !afterIds.has(item.id)).map((item) => item.id);
  const kept = before.filter((item) => afterIds.has(item.id));
  const changed = kept.filter((item) => {
    const next = after.find((candidate) => candidate.id === item.id);
    return JSON.stringify(item) !== JSON.stringify(next);
  }).map((item) => item.id);
  return { added, removed, changed };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url));

if (isMain) {
  const [command, arg] = process.argv.slice(2);
  if (command === "build") {
    const data = await writeData();
    process.stdout.write(`已生成 ${path.relative(root, DATA_FILE)}：${data.catalog.length} 条成就、${data.earnRules.length} 条来源、${data.spendPoints.length} 个消费点。\n`);
    if (data.missingNotes.length) {
      process.stdout.write(`⚠ ${data.missingNotes.length} 条成就还没写评审说明（评审稿上会显示「待补说明」）：${data.missingNotes.join(", ")}\n`);
      process.stdout.write("  补在 design-lab/achievement-notes.mjs 的 ACHIEVEMENT_NOTES 里。\n");
    }
    process.stdout.write("现在双击 design-lab/achievement-workshop.html 即可打开评审稿。\n");
  } else if (command === "verify" || command === "apply") {
    if (!arg) {
      process.stderr.write("用法：node scripts/achievement-workshop.mjs verify|apply <导出.json>\n");
      process.exit(2);
    }
    const payload = JSON.parse(fs.readFileSync(path.resolve(arg), "utf8"));
    const data = payload.data ?? payload;
    const problems = validate(data);
    if (problems.length) {
      process.stderr.write(`校验没过，${problems.length} 个问题：\n`);
      for (const problem of problems) process.stderr.write(`  · ${problem}\n`);
      process.exit(1);
    }
    const current = await buildData();
    const diff = summarize(current.catalog, data.catalog);
    process.stdout.write(`成就：${current.catalog.length} → ${data.catalog.length} 条\n`);
    if (diff.added.length) process.stdout.write(`  新增 ${diff.added.length}：${diff.added.join(", ")}\n`);
    if (diff.removed.length) process.stdout.write(`  删除 ${diff.removed.length}：${diff.removed.join(", ")}\n`);
    if (diff.changed.length) process.stdout.write(`  修改 ${diff.changed.length}：${diff.changed.join(", ")}\n`);
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) process.stdout.write("  成就部分没有变化\n");
    process.stdout.write(`棋魂来源：${current.earnRules.length} → ${data.earnRules.length} 条；消费点：${current.spendPoints.length} → ${data.spendPoints.length} 个\n`);
    if (command === "verify") {
      process.stdout.write("（verify 模式：只校验，没有写盘。要落地请用 apply）\n");
    } else {
      const result = apply(data);
      if (!result.ok) {
        process.stderr.write(`写盘前校验失败：${result.problems.join("；")}\n`);
        process.exit(1);
      }
      process.stdout.write("已写回源码。下一步：npx tsc -b --force 与 npm test 确认没问题。\n");
    }
  } else {
    process.stdout.write([
      "成就工坊引擎。用法：",
      "  node scripts/achievement-workshop.mjs build              # 源码 → 网页数据",
      "  node scripts/achievement-workshop.mjs verify <导出.json>  # 只校验并列出增删改",
      "  node scripts/achievement-workshop.mjs apply  <导出.json>  # 校验通过后写回源码",
      "",
    ].join("\n"));
  }
}
