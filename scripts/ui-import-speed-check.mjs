import { chromium } from "playwright";
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";
import zlib from "node:zlib";

/**
 * 常驻门禁：导入棋谱的两个真实缺陷（2026-09-19 实测定位）。
 *
 * 为什么单独立门禁：这一对问题**只在真实体积/真实库量下出现**，小语料永远测不到——
 *   ① 中等体积棋谱（约 1.5–4MB、节点数不足 4 万）既没被判定为「大型棋谱」、又装不进
 *      localStorage（约 5MB 上限），导入直接抛 QuotaExceededError，用户看到
 *      「本机存储空间不足，棋谱已解析但尚未保存」——**整次导入失败**。
 *      实测 2.56MB / 3.5 万节点的 SGF 必挂；同一份文件 ≥4MB 时反而正常（走大型库）。
 *   ② 同一区间的文件在主线程解析（旧阈值 4MB），实测长任务 524ms，界面明显卡住。
 *
 * 断言：
 *   I1 中等体积棋谱（2.5MB 级）导入成功，且落到了某个库里（本机库或大型库）
 *   I2 真实导入 worker 返回完整文档；主线程长任务仅报告趋势
 *   I3 库里已有 200 份时再导入一份小棋谱也要成功（同一配额问题）
 *   I4 逐位等价：导入结果与「直接调用 importRecordFile」的结果指纹一致
 *   I5 ZIP 批量：每份都入库，且逐份与直接解析结果指纹一致
 *   I6 全程无页面报错
 *
 * dev 与 production preview 均可。参考解析器由 Node 在内存中编译当前源码；
 * 浏览器只读取真实 localStorage / IndexedDB 内容，不依赖 /src/*.ts 路由。
 * 用法：BANBU_URL=http://localhost:5399/ node scripts/ui-import-speed-check.mjs
 */
const url = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5399/";
const qaUrl = new URL(url);
qaUrl.searchParams.set("qa", "1");
const base = qaUrl.href;
const CORPUS = process.env.IMPORT_CORPUS || "D:/Projects/经济学知识/15_半步五子棋/棋谱/gomocup-renju-sgf/2025";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const TMP = join(projectRoot, ".tmp-import-corpus");

// 只编译参考解析器，不加载项目构建插件，不改 dist，也不另起网页服务。
const compiled = await build({
  configFile: false, logLevel: "silent",
  build: { write: false, lib: { entry: join(projectRoot, "src/formats.ts"), formats: ["es"] } },
});
const bundle = Array.isArray(compiled) ? compiled[0] : compiled;
const referenceCode = bundle.output.find((item) => item.type === "chunk" && item.isEntry)?.code;
if (!referenceCode) throw new Error("无法编译导入参考解析器");
const reference = await import(`data:text/javascript;base64,${Buffer.from(referenceCode).toString("base64")}`);

// 独立于产品的去重签名：完整节点内容按文件分支顺序做 SHA256，排除随机 ID。
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => [key, canonical(value[key])]));
};
const treeHash = (document) => {
  const hash = createHash("sha256");
  const pending = [{ id: document.rootId, parentId: null }];
  const visited = new Set();
  hash.update(String(document.metadata.boardSize));
  while (pending.length) {
    const { id, parentId } = pending.pop();
    const node = document.nodes?.[id];
    if (!node || visited.has(id) || node.parentId !== parentId) throw new Error(`入库节点 ${id} 缺失、重复或父子关系不一致`);
    visited.add(id);
    const { id: _id, parentId: _parentId, children, preferredChildId, ...content } = node;
    hash.update(JSON.stringify(canonical({ ...content, childCount: children.length,
      preferredChildIndex: preferredChildId ? children.indexOf(preferredChildId) : -1 })) + "\n");
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ id: children[index], parentId: id });
  }
  if (visited.size !== Object.keys(document.nodes).length) throw new Error("入库文档含孤立节点");
  return hash.digest("hex");
};
const recordHash = (document) => {
  // GUI 补的来源字段与随机文档 ID 不属于 SGF 内容；对弈双方/结果/日期等信息必须保留。
  const { sourceFormat: _sourceFormat, sourceFileName: _sourceFileName, ...metadata } = document.metadata;
  return createHash("sha256").update(JSON.stringify(canonical({ metadata, tree: treeHash(document) }))).digest("hex");
};
const directParse = async (data, name) => {
  const started = performance.now();
  const result = await reference.importRecordFile(new File([data], name, { type: "application/x-go-sgf" }));
  return { document: result.document, parseMs: Math.round(performance.now() - started) };
};

const coord = (row, col) => `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`;

/** 造一份「中等体积」SGF：二叉树 + 注释，坐标沿路径唯一（重复落子会被导入器拒收）。 */
const makeMediumSgf = (targetBytes) => {
  const parts = ["(;GM[1]FF[4]SZ[15]CA[UTF-8]AP[gate]PB[gate]PW[gate]"];
  let written = 0;
  const budget = Math.ceil(targetBytes / 96);
  const build = (depth, seed) => {
    if (written >= budget || depth > 200) return false;
    const point = (depth + seed) % 225;
    parts.push(`;${depth % 2 === 0 ? "B" : "W"}[${coord(Math.floor(point / 15), point % 15)}]C[gate node ${written} depth ${depth} 用于验证中等体积导入的注释文本]`);
    written += 1;
    build(depth + 1, seed);
    const mark = parts.length;
    parts.push("(");
    if (build(depth + 1, (seed + 37) % 225)) parts.push(")");
    else parts.splice(mark, 1);
    return true;
  };
  build(0, 0);
  parts.push(")");
  return { text: parts.join(""), nodes: written };
};

const buildZip = (files) => {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt16LE(0, 14);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBytes, end]);
};

/** 种子棋谱必须字段齐全：缺 marks 会让 documentFingerprint 抛错（曾把探针自己的 bug 当成应用 bug）。 */
const seedLibrary = (count) => {
  const documents = [];
  for (let index = 0; index < count; index += 1) {
    const rootId = `seed-${index}-root`;
    const childId = `seed-${index}-1`;
    documents.push({
      id: `seed-${index}`, version: 1, rootId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { title: `种子棋谱 ${index}`, black: "黑", white: "白", boardSize: 15, rule: "freestyle", sourceFormat: "sgf" },
      nodes: {
        [rootId]: { id: rootId, parentId: null, move: null, children: [childId], preferredChildId: childId, comment: `种子棋谱 ${index}`, marks: [] },
        [childId]: { id: childId, parentId: rootId, move: { row: 7, col: 7, player: "black" }, children: [], comment: "", marks: [] },
      },
    });
  }
  return JSON.stringify(documents);
};

mkdirSync(TMP, { recursive: true });
const medium = makeMediumSgf(3_400_000);
const mediumPath = join(TMP, "gate-medium.sgf");
writeFileSync(mediumPath, medium.text, "utf8");
const smallPaths = readdirSync(CORPUS).filter((name) => name.endsWith(".sgf")).slice(0, 30).map((name) => join(CORPUS, name));
if (smallPaths.length !== 30) throw new Error(`导入语料需要 30 份真实 SGF，目前只有 ${smallPaths.length} 份：${CORPUS}`);
const zipPath = join(TMP, "gate-batch-30.zip");
writeFileSync(zipPath, buildZip(smallPaths.map((path, index) => ({ name: `gate-${String(index).padStart(2, "0")}.sgf`, data: readFileSync(path) }))));
console.log(`中等棋谱 ${(statSync(mediumPath).size / 1048576).toFixed(2)}MB / ${medium.nodes} 节点；批量 ZIP 30 份`);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

/**
 * 等应用自己的启动写入停下再数数。
 *
 * 为什么必须等：App.tsx 用 useEffect 异步 `loadNativeMatchRecords()`，它抓内置的
 * 《祁观vs弈心 人机大战五局》并**追加 5 份棋谱**进 renju-note-library-v1（另加 1 份
 * 默认「新建棋谱」，共 6 份）。这几份是**后到**的。
 *
 * 本脚本 I7 断的是 `after.total - before.total === 30`。如果 `before` 恰好采样在
 * 内置棋谱还没落库的窗口里（比如 before.local = 1），那么导入 30 份之后总数是
 * 1 + 5(内置) + 30 = 36，差值就成了 **35** —— 看起来像「多导入了 5 份」，其实
 * 那 5 份是内置棋谱，ZIP 本身一份不多（隔离复现：before=6 → after=36，差 30）。
 *
 * ⚠ 稳定性窗口必须**大于两波写入之间的间隔**，否则会早停。
 * 实测时间线（12 核机器，?qa=1）：
 *   4115ms → 1 份（默认草稿）
 *   5717ms → 6 份（+5 份内置棋谱）
 * 两波相距约 **1.6 秒**。原来用「连续 5 次 = 500ms 不变」，在 4115ms 那一波之后
 * 就会认定「稳了」并带着 count=1 返回，5771ms 的内置棋谱随后落库，于是 I7 偶发
 * 报 +35（这台机器上实测复现过；低并发也可能中）。所以改成 **2.5 秒**不动才收工，
 * 并对「仍停在 1 份」这件事额外宽限——那是已知的中间态，不是终态。
 */
const SETTLE_STABLE_MS = 2500;
const settleLibrary = async (page, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let previous = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]").length; } catch { return -1; }
    });
    if (count !== previous) { stableSince = Date.now(); previous = count; }
    const stableFor = Date.now() - stableSince;
    // count<=1 是已知的中间态（只有默认草稿、内置棋谱还没到），不许它触发收工。
    if (count > 1 && stableFor >= SETTLE_STABLE_MS) return count;
    await page.waitForTimeout(100);
  }
  return previous;
};

const openApp = async ({ seeded = 0, watchLongTasks = false } = {}) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const seed = seeded ? seedLibrary(seeded) : "";
  await context.addInitScript(([library, watch]) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    if (library) localStorage.setItem("renju-note-library-v1", library);
    const OriginalWorker = window.Worker;
    window.__gateImportReplies = [];
    window.Worker = function (url, options) {
      const worker = new OriginalWorker(url, options);
      if (String(url).includes("record-import")) worker.addEventListener("message", ({ data }) => {
        if (data.result) window.__gateImportReplies.push({ ok: data.ok,
          hasCompact: Boolean(data.compactIndex), nodeCount: Object.keys(data.result.document?.nodes || {}).length });
      });
      return worker;
    };
    window.Worker.prototype = OriginalWorker.prototype;
    if (watch) {
      window.__gateLongTasks = [];
      try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__gateLongTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ["longtask"] }); } catch { /* 不支持就不记 */ }
    }
  }, [seed, watchLongTasks]);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2400);
  await settleLibrary(page);
  return { context, page, errors };
};

const pickFile = async (page, files) => {
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("导入"))?.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("导入棋谱文件"))?.click(); });
  await page.waitForTimeout(400);
  await page.locator('input[type="file"][accept*=".sgf"]').first().setInputFiles(files);
};

/** 等导入结束：进度卡进完成态，或超时。返回状态文本用于诊断。 */
const waitImport = async (page, timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const card = document.querySelector("[class*='import-progress']");
      return { className: card?.className || "", text: (card?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) };
    });
    if (state.className.includes("import-progress--complete")) return { ok: true, text: state.text };
    if (state.className.includes("import-progress--error")) return { ok: false, text: state.text };
    await page.waitForTimeout(150);
  }
  return { ok: false, text: "等待超时" };
};

/** 直接读已经存在的库：缺数据库算空库，读失败必须报错，不用 -1 掩盖错误。 */
const readStored = (page, includeDocuments = false) => page.evaluate(async (include) => {
  const local = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
  if (!Array.isArray(local)) throw new Error("本机棋谱库不是数组");
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("banbu-gomoku-large-library");
    let missing = false;
    request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => missing ? resolve(null) : reject(request.error);
    request.onblocked = () => reject(new Error("大型棋谱库读取被阻塞"));
  });
  let summaries = [], documents = [];
  if (database) {
    try {
      const transaction = database.transaction(include ? ["summaries", "documents"] : ["summaries"], "readonly");
      const completed = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("大型棋谱库读取失败"));
      });
      const read = (store) => new Promise((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const requests = [read("summaries")];
      if (include) requests.push(read("documents"));
      [summaries, documents = []] = await Promise.all(requests);
      await completed;
    } finally { database.close(); }
  }
  return include ? { local, summaries, documents } : { local: local.length, large: summaries.length, total: local.length + summaries.length };
}, includeDocuments);
const storedCount = (page) => readStored(page);
const storedDocuments = (records) => {
  const byId = new Map(records.documents.map((item) => [item.id, item]));
  const large = records.summaries.map((summary) => {
    const document = byId.get(summary.id);
    if (!document) throw new Error(`大型库摘要 ${summary.id} 没有对应文档`);
    return document;
  });
  return [...records.local, ...large];
};

// ── I1/I2/I4：中等体积棋谱（旧实现必失败 + 主线程长任务 524ms）──────────
try {
{
  const { context, page, errors } = await openApp({ watchLongTasks: true });
  const before = await storedCount(page);
  await page.evaluate(() => { window.__gateLongTasks = []; window.__gateImportReplies = []; });
  await pickFile(page, [mediumPath]);
  const outcome = await waitImport(page);
  const after = await storedCount(page);
  const longTasks = await page.evaluate(() => (window.__gateLongTasks || []).filter((ms) => ms >= 50));
  const maxTask = longTasks.length ? Math.max(...longTasks) : 0;

  const records = await readStored(page, true);
  const matches = storedDocuments(records).filter((document) => document.metadata?.sourceFileName === "gate-medium.sgf");
  const stored = matches.length === 1 ? matches[0] : null;
  check("I1 中等体积棋谱（2.5MB 级）导入成功并真的入库（本机库或大型库）",
    outcome.ok && after.total === before.total + 1 && Boolean(stored?.nodes?.[stored.rootId]),
    `${outcome.text} · 本机 ${before.local}→${after.local} / 大型 ${before.large}→${after.large}`);
  // I2 断「解析确实走了 worker 通道」这个结构事实（worker 回执 + 文档完整），
  // 而不是挑一个耗时阈值：实测解析本身约 350ms，而克隆节点树 + 去重签名 + 落库
  // 也在主线程，量级相当——把耗时写成阈值只会得到一个随时会飘的数字。
  // 耗时仍然打印出来供人看趋势。
  const workerUsed = await page.evaluate(() => {
    const replies = window.__gateImportReplies || [];
    return { used: replies.length === 1 && replies[0].ok === true,
      hasCompact: Boolean(replies[0]?.hasCompact), nodeCount: replies[0]?.nodeCount || 0 };
  });
  const parsed = await directParse(medium.text, "gate-medium.sgf");
  const expectedNodes = Object.keys(parsed.document.nodes).length;
  check("I2 中等体积棋谱确实走了后台解析线程（不是主线程解析）",
    workerUsed.used && !workerUsed.hasCompact && workerUsed.nodeCount === expectedNodes,
    `worker 回执 ${JSON.stringify(workerUsed)} · 主线程最长任务 ${maxTask}ms（长任务 ${longTasks.length} 个）· Node 参考解析 ${parsed.parseMs}ms`);

  // 文档本体必须真的读得到，摘要数量与完整树逐颗、逐注释、逐支比较。
  const expected = treeHash(parsed.document);
  const actual = stored ? treeHash(stored) : null;
  const summary = records.summaries.find((item) => item.id === stored?.id);
  const parity = { expected, actual, expectedNodes,
    actualNodes: stored ? Object.keys(stored.nodes).length : 0,
    ...(summary ? { storedNodeCount: summary.nodeCount } : {}) };
  check("I4 逐位等价：真实入库文档与直接解析完整树 SHA256 一致",
    actual === expected && parity.actualNodes === expectedNodes && (!summary || summary.nodeCount === expectedNodes), JSON.stringify(parity));
  check("I5 页面无报错（中等棋谱）", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ── I3：库里已有 200 份时再导入一份小棋谱（同一配额问题）──────────────
{
  const { context, page, errors } = await openApp({ seeded: 200 });
  const before = await storedCount(page);
  await pickFile(page, [smallPaths[0]]);
  const outcome = await waitImport(page);
  const after = await storedCount(page);
  const records = storedDocuments(await readStored(page, true));
  const imported = records.filter((document) => document.metadata?.sourceFileName === smallPaths[0].split(/[\\/]/).pop());
  const parsed = await directParse(readFileSync(smallPaths[0]), smallPaths[0].split(/[\\/]/).pop());
  check("I3 大库（200 份）时再导入一份小棋谱也成功，内容与原文件一致",
    before.local >= 200 && outcome.ok && after.total === before.total + 1
      && imported.length === 1 && recordHash(imported[0]) === recordHash(parsed.document), `${outcome.text} · 库 ${before.total}→${after.total}`);
  check("I6 页面无报错（大库导入）", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ── I5：ZIP 批量 30 份全部入库且逐份等价 ────────────────────────────
{
  const { context, page, errors } = await openApp();
  const before = await storedCount(page);
  await pickFile(page, [zipPath]);
  const outcome = await waitImport(page);
  const after = await storedCount(page);
  check("I7 ZIP 批量 30 份全部入库", outcome.ok && after.total - before.total === 30, `${outcome.text} · 新增 ${after.total - before.total}`);
  const imported = storedDocuments(await readStored(page, true))
    .filter((item) => /^gate-\d{2}\.sgf$/.test(item.metadata?.sourceFileName || ""));
  const actualByName = new Map(imported.map((item) => [item.metadata.sourceFileName, recordHash(item)]));
  const expectedHashes = new Set();
  const mismatches = [];
  for (let index = 0; index < smallPaths.length; index += 1) {
    const name = `gate-${String(index).padStart(2, "0")}.sgf`;
    const parsed = await directParse(readFileSync(smallPaths[index]), name);
    const expected = recordHash(parsed.document);
    expectedHashes.add(expected);
    if (actualByName.get(name) !== expected) mismatches.push(name);
  }
  const batchParity = { count: imported.length, distinct: new Set(actualByName.values()).size,
    expectedDistinct: expectedHashes.size, mismatches };
  check("I8 批量30份逐份完整树和对弈信息 SHA256 与原文件一致且互不重复",
    batchParity.count === 30 && batchParity.distinct === 30 && batchParity.expectedDistinct === 30 && !mismatches.length, JSON.stringify(batchParity));
  check("I9 页面无报错（批量）", errors.length === 0, errors.join(" | "));
  await context.close();
}

} finally { await browser.close(); }
console.log(failed ? `\nFAIL ${failed} 项` : "\n导入棋谱：中等体积、大库、批量全部通过");
process.exit(failed ? 1 : 0);
