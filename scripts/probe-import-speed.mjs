import { chromium } from "playwright";
import { readdirSync, writeFileSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

/**
 * 导入棋谱耗时探针（只量不改）。
 *
 * 已确认的事实（决定了场景怎么设）：
 *  · `<input type="file">` **没有 multiple** → 一次只能选一份，多份只能走 ZIP；
 *  · 单份导入时 <4MB 走**主线程**同步解析（parseRecordFile），≥4MB 才进 worker；
 *  · ZIP 里的文本棋谱走 handleFiles 的「每批 2 个」循环，而 <4MB 的解析也在主线程，
 *    所以那个「并行」是假的（两段同步 CPU 在同一个线程上排队）；
 *  · 入库 saveManyToLibrary 会对**库里每一条已有棋谱**重算 documentSignature，
 *    紧接着还有一遍 documentFingerprint 全库扫描。
 *
 * 场景：
 *   A 1 份小 SGF（1KB）
 *   B 1 份中等 SGF（2.7MB → 卡在 4MB 门槛之下，主线程）
 *   C 1 份大 SGF（6.3MB → worker 通道）
 *   D ZIP 内含 200 份小 SGF（唯一的多份入口）
 *   E 库里已有 200 份棋谱时再导入 1 份（去重签名的固定开销）
 *
 * 用法：BANBU_URL=http://localhost:5399/ node scripts/probe-import-speed.mjs
 */
const url = process.env.BANBU_URL || "http://localhost:5399/";
const base = url.includes("?") ? url : `${url}?qa=1`;
const CORPUS = process.env.IMPORT_CORPUS || "D:/Projects/经济学知识/15_半步五子棋/棋谱/gomocup-renju-sgf/2025";
const TMP = "D:/Projects/五子棋2/.tmp-import-corpus";
const PER_SCENARIO_MS = Number(process.env.PROBE_LIMIT_MS || 150_000);

// SGF 坐标是小写（aa = 左上角）；大写字母会被导入器判成「无法识别的落子坐标」。
const coord = (row, col) => `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`;

/** 造一份大 SGF：二叉树变化树 + 注释，按目标体积控制节点数。 */
const writeLargeSgf = (targetBytes) => {
  mkdirSync(TMP, { recursive: true });
  const path = join(TMP, `large-${Math.round(targetBytes / 1024)}kb.sgf`);
  const parts = ["(;GM[1]FF[4]SZ[15]CA[UTF-8]AP[probe]PB[probe]PW[probe]"];
  let written = 0;
  const budget = Math.ceil(targetBytes / 96);
  // 坐标必须沿路径唯一：同一条路径上重复落子会被导入器当成非法着法拒收
  // （第一版按 index*7+depth*3 取点，2.5MB 那份直接被拒，探针量到的是「失败」）。
  // 预算用尽时不能再补一对空括号：空变化 "()" 会让解析器直接判定「SGF 中没有节点」。
  const build = (depth, seed) => {
    if (written >= budget || depth > 200) return false;
    const point = (depth + seed) % 225;
    parts.push(`;${depth % 2 === 0 ? "B" : "W"}[${coord(Math.floor(point / 15), point % 15)}]C[probe node ${written} depth ${depth} 用于测量解析吞吐的注释文本]`);
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
  writeFileSync(path, parts.join(""), "utf8");
  return { path, bytes: statSync(path).size, nodes: written };
};

/** store（method 0）方式打包 ZIP：应用 readZip 支持 method 0/8，store 不需要压缩器。 */
const buildZip = (files) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
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

const smallFiles = readdirSync(CORPUS).filter((name) => name.endsWith(".sgf")).slice(0, 200).map((name) => join(CORPUS, name));
if (smallFiles.length < 200) {
  console.log(`语料不足：${CORPUS} 只有 ${smallFiles.length} 个 sgf`);
  process.exit(1);
}
const medium = writeLargeSgf(3_400_000);
const large = writeLargeSgf(8_000_000);
const zipPath = join(TMP, "batch-200.zip");
writeFileSync(zipPath, buildZip(smallFiles.map((path, index) => ({ name: `${String(index).padStart(3, "0")}.sgf`, data: readFileSync(path) }))));
console.log(`中等 ${(medium.bytes / 1048576).toFixed(2)}MB/${medium.nodes} 节点 · 大 ${(large.bytes / 1048576).toFixed(2)}MB/${large.nodes} 节点 · ZIP ${(statSync(zipPath).size / 1024).toFixed(0)}KB/200 份`);

/** 造一份「库里已有 N 份棋谱」的 localStorage 快照，用来量去重的固定开销。 */
const seedLibrary = (count) => {
  const documents = [];
  for (let index = 0; index < count; index += 1) {
    const rootId = `seed-${index}-root`;
    const childId = `seed-${index}-1`;
    const nodes = {
      [rootId]: { id: rootId, move: null, children: [childId], comment: `种子棋谱 ${index}`, marks: [] },
      [childId]: { id: childId, move: { row: 7, col: 7, player: "black" }, children: [], comment: "", marks: [] },
    };
    documents.push({
      id: `seed-${index}`, version: 1, rootId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { title: `种子棋谱 ${index}`, black: "黑", white: "白", boardSize: 15, rule: "freestyle", sourceFormat: "sgf" },
      nodes,
    });
  }
  return JSON.stringify(documents);
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const rows = [];

const runScenario = async (label, files, { seededLibrary = 0, expectedRecords = 1 } = {}) => {
  // 生产构建会注册 Service Worker（补 COOP/COEP 并可能刷新一次页面），
// 刷新会把导入中途掐断——探针里必须像其它门禁一样屏蔽 SW，否则量到的是「卡住」。
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const seed = seededLibrary ? seedLibrary(seededLibrary) : "";
  await context.addInitScript(([library]) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    if (library) localStorage.setItem("renju-note-library-v1", library);
  }, [seed]);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);

  await page.evaluate(() => {
    window.__banbuLongTasks = [];
    try {
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__banbuLongTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ["longtask"] });
    } catch { /* 不支持 longtask 就不记 */ }
  });
  const metric = async (name) => (await client.send("Performance.getMetrics")).metrics.find((item) => item.name === name)?.value ?? 0;
  // 库里本来就有内置棋谱，所以「到位」必须相对导入前计数，不能用绝对数。
  const libraryCount = () => page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]").length; } catch { return -1; }
  });
  const libraryBefore = await libraryCount();
  const before = { script: await metric("ScriptDuration"), task: await metric("TaskDuration"), wall: Date.now() };

  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("导入"))?.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("导入棋谱文件"))?.click(); });
  await page.waitForTimeout(400);
  await page.locator('input[type="file"][accept*=".sgf"]').first().setInputFiles(files);

  const deadline = Date.now() + PER_SCENARIO_MS;
  let signal = "超时";
  while (Date.now() < deadline) {
    const state = await page.evaluate((target) => {
      let library = -1;
      try { library = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]").length; } catch { /* ignore */ }
      return {
        complete: Boolean(document.querySelector(".import-progress--complete")),
        diagnostic: Boolean(window.__banbuImportDiagnostic || window.__banbuWorkerMessage),
        library,
        target,
      };
    }, libraryBefore + expectedRecords);
    if (state.complete) { signal = "进度卡完成"; break; }
    if (state.library >= state.target) { signal = "库条目到位"; break; }
    if (state.diagnostic) { signal = "worker 回执"; break; }
    await page.waitForTimeout(120);
  }
  const wall = Date.now() - before.wall;
  const after = { script: await metric("ScriptDuration"), task: await metric("TaskDuration") };
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("renju-note-library-v1") || "[]";
    let count = -1;
    try { count = JSON.parse(raw).length; } catch { /* ignore */ }
    return { count, kb: Math.round(raw.length / 1024) };
  });
  const longTasks = await page.evaluate(() => (window.__banbuLongTasks || []).filter((ms) => ms >= 50));
  const toast = await page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent || "").join(" | "));
  rows.push({
    label, files: files.length, signal, wallMs: wall, toast: toast.slice(0, 120), errors: pageErrors.slice(0, 2).join(" | "),
    longTaskCount: longTasks.length, longTaskMax: longTasks.length ? Math.max(...longTasks) : 0, longTaskTotal: longTasks.reduce((sum, ms) => sum + ms, 0),
    scriptMs: Math.round((after.script - before.script) * 1000),
    taskMs: Math.round((after.task - before.task) * 1000),
    libraryCount: stored.count, libraryKb: stored.kb,
  });
  console.log(`  ${label}: ${wall}ms（${signal}）主线程 ${rows[rows.length - 1].scriptMs}ms`);
  await context.close();
};

await runScenario("A 1 份小 SGF", smallFiles.slice(0, 1), { expectedRecords: 1 });
await runScenario("B 1 份中等 SGF（2.7MB 主线程）", [medium.path], { expectedRecords: 1 });
await runScenario("C 1 份大 SGF（6.3MB worker）", [large.path], { expectedRecords: 1 });
await runScenario("D ZIP 200 份小 SGF", [zipPath], { expectedRecords: 200 });
await runScenario("E 库 200 份时再导 1 份", smallFiles.slice(0, 1), { seededLibrary: 200, expectedRecords: 201 });

await browser.close();
console.log("\n场景 | 文件数 | 信号 | 墙钟ms | 主线程脚本ms | 任务ms | 库条目 | 库KB");
for (const row of rows) {
  console.log(`${row.label} | ${row.files} | ${row.signal} | ${row.wallMs} | 长任务 ${row.longTaskCount} 个/最长 ${row.longTaskMax}ms/合计 ${row.longTaskTotal}ms | 库 ${row.libraryCount} | ${row.toast}${row.errors ? ` | ERR ${row.errors}` : ""}`);
}
