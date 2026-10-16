// 自家渲染语料·规模化版：用应用自己的渲染器造大量带精确真值的棋盘图，作为
// 「真·自家风格」的验收集（也是将来给更小模型用的训练/验证素材）。
//
// 为什么要多档格距：同一张盘在不同格距下数字占裁剪窗口的比例不同，而实测「读号」
// 对尺度敏感（密盘小字靠更紧的裁剪才读得动）。这里每盘出 3 档（格距≈66/45/33px），
// 覆盖「原始分享图 / 缩放后的截图 / 缩略图」三种真实输入。
//
// 真值：局面就是喂进去的手（行=0 从上、列=0 从左），手数=落子次序，黑白=奇偶。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/gen-self-boards.mjs [盘数]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const count = Number(process.argv[2] || 60);
/**
 * 输出目录（2026-10-09 改成可配）。
 *
 * 为什么必须可配：这个脚本会**整体重写** `index.json`。早先它写死指向
 * `self-render/`，用它生成高段位数据时把既有 180 张语料的索引覆盖成了 18 条
 * （图片文件还在、索引丢了；靠 `makeMoves` 的确定性重新生成 1–6 盘并重建索引才复原）。
 * 现在默认仍是 `self-render/`（保持既有语料可复现），造别的数据时**必须**用
 * `OUT_DIR=...` 指到独立目录，避免再踩：
 *   OUT_DIR=qa/fixtures/materials/self-hi-ply PLY_MIN=180 PLY_MAX=225 node qa/gen-self-boards.mjs 60
 */
const outDir = resolve(process.env.OUT_DIR || "qa/fixtures/materials/self-render");
mkdirSync(outDir, { recursive: true });
const WIDTHS = [1200, 820, 600]; // 分享图原宽 / 0.68× / 0.5×

/**
 * 每盘的手数范围（2026-10-09 加）。
 *
 * 为什么可配：原先这里写死 `6 + rnd()*75`（即 6–80 手），于是**训练数据里根本
 * 没有 81 手以上的样本**——数字头模型的类别数只能到数据标签的上限，读 180+ 手
 * 在结构上不可能。实测现役 iter8 = 171 类（数据集 label 上限 170）、候选 iter17 = 178 类
 * （merged 集上限 177），而 15 路满盘是 225 手。这不是模型容量问题，是**数据没覆盖**。
 *
 * 默认值保持 6–80，以便既有语料（self-render 180 张，被多个门禁引用）可复现；
 * 要造高段位数据时用环境变量打开，例如：
 *   PLY_MIN=6 PLY_MAX=225 node qa/gen-self-boards.mjs 60
 */
const PLY_MIN = Math.max(1, Number(process.env.PLY_MIN || 6));
const PLY_MAX = Math.min(225, Number(process.env.PLY_MAX || 80));

/** 造一局：随机游走式落子，手数在 [PLY_MIN, PLY_MAX] 之间。 */
const makeMoves = (seed) => {
  let state = seed * 2654435761 % 2147483647;
  const rnd = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const span = Math.max(1, PLY_MAX - PLY_MIN + 1);
  const target = Math.min(225, PLY_MIN + Math.floor(rnd() * span));
  const picks = [];
  const seen = new Set();
  let row = 7;
  let col = 7;
  /**
   * 迭代预算 + 兜底（2026-10-13）。**这里曾经会死循环**：某些种子下随机游走永远填不满目标手数
   * （实测 seed 7009 目标 223 手、20 万次迭代只走到 171；seed 7033 目标 193 手只走到 104），
   * 于是生成脚本在某一批静默挂住、整轮语料作废。
   *
   * 根因是随机数的**精度溢出**：`state * 1103515245` 最大约 2.4e18，超过 JS 安全整数上限
   * （2^53≈9.0e15），乘法丢精度后 `& 0x7fffffff` 得到的序列退化，游走卡在同一小片区域里打转。
   *
   * 修法刻意**不换随机数**（换成 Math.imul 会让 self-big / self-render / self-hi-ply 的
   * 每一盘都变样，既有语料就无法逐字节复现了）：只给「走不完」的种子兜底——超预算就把剩下的
   * 空格按行列顺序补满。走不完的种子本来就产不出任何东西，所以这次修改对既有语料零影响。
   */
  let guard = 0;
  const GUARD_MAX = 20000;
  while (picks.length < target && guard < GUARD_MAX) {
    guard += 1;
    // 邻域随机游走（像真实对局那样成团），偶尔跳到别处。
    // 手数大时邻域游走会很快撞满一片，加一条「疏化」：手数过半后提高跳转概率，
    // 否则密盘（>200 手）会长时间在同一区域空转、生成变慢。
    const crowded = picks.length > 120 ? 0.45 : 0.12;
    if (rnd() < crowded) { row = Math.floor(rnd() * 15); col = Math.floor(rnd() * 15); }
    else { row = Math.max(0, Math.min(14, row + Math.round((rnd() - 0.5) * 2))); col = Math.max(0, Math.min(14, col + Math.round((rnd() - 0.5) * 2))); }
    const key = `${row},${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push([row, col]);
  }
  if (picks.length < target) {
    // 兜底填充：按行列顺序补满（确定性，不依赖随机数，便于复现与排查）
    for (let r = 0; r < 15 && picks.length < target; r += 1) {
      for (let c = 0; c < 15 && picks.length < target; c += 1) {
        const key = `${r},${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picks.push([r, c]);
      }
    }
  }
  return picks;};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block", deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
// 超时（2026-10-13 加）：长时间批量渲染时页面会积压内存，某批 evaluate 可能永远不返回
// （实测跑到第 29 批卡死、10 分钟零输出）。设超时让它抛错，由下面的批次循环跳过并继续。
page.setDefaultTimeout(Number(process.env.RENDER_TIMEOUT_MS || 120000));
await page.route("**/qa-self-render-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-self-render-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const index = [];
const BATCH = 6;
// 种子偏移（2026-10-11 加）：`makeMoves` 由序号确定性推导（seed = 序号），所以两次
// `node gen-self-boards.mjs N` 会产出**逐字节相同**的图——想靠「多跑几批再合并」
// 扩容是无效的（实测三批 md5 完全一致）。用 SEED_OFFSET 把种子往后推，各批才是不同
// 局面：`SEED_OFFSET=1000 OUT_DIR=... node qa/gen-self-boards.mjs 1200`。
// 命名仍按本批序号（便于与既有语料并存），只有种子加偏移。
const SEED_OFFSET = Math.max(0, Number(process.env.SEED_OFFSET || 0));
/** 单批渲染的**真**超时（毫秒）：见批次循环里的 Promise.race。 */
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 120000);
/** 渲染失败被跳过的批次（收尾如实报出，别让缺盘的语料看着正常）。 */
const skippedBatches = [];
for (let start = 0; start < count; start += BATCH) {
  const specs = [];
  for (let i = start; i < Math.min(count, start + BATCH); i += 1) {
    const serial = i + 1;
    specs.push({ name: `self-${String(serial).padStart(3, "0")}`, moves: makeMoves(serial + SEED_OFFSET) });
  }
  // 渲染这一批（2026-10-13：包一层**真**超时——满盘 220+ 手的局面渲染很重，长跑时页面
  // 会积压内存，某批可能永远不返回（实测 240 盘跑到第 29 批、以及另一块的第 2 批卡死）。
  // ⚠ 注意 `page.setDefaultTimeout` **管不到 evaluate**（它只作用于带 timeout 选项的方法），
  // 所以这里自己 race：超时后 reload 页面继续下一批。本轮少几盘可以补，整轮挂住不行；
  // 跳过的批次会在收尾时如实报出，不产出「看着正常但缺盘」的语料。
  let rendered;
  try {
    rendered = await Promise.race([
      page.evaluate(async ({ specs, widths }) => {
    const exportMod = await import("/src/board-image-export.ts");
    const out = [];
    for (const spec of specs) {
      const nodes = {};
      const rootId = "root";
      nodes[rootId] = { id: rootId, parentId: null, children: [], move: null, comment: "", marks: [] };
      let parent = rootId;
      spec.moves.forEach(([row, col], plies) => {
        const id = `n${plies + 1}`;
        nodes[parent].children.push(id);
        nodes[id] = { id, parentId: parent, children: [], move: { row, col, player: plies % 2 === 0 ? "black" : "white" }, comment: "", marks: [] };
        parent = id;
      });
      // ⚠ 变量名不能叫 document：在页面里会**遮蔽 DOM 的 document**，
      // 后面 canvas 那步就报 "document.createElement is not a function"（踩过）。
      const gameDocument = {
        id: spec.name, version: 1, rootId, nodes, savedCurrentId: parent,
        metadata: { title: spec.name, boardSize: 15 },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const svg = exportMod.createBoardShareSvg(gameDocument, parent, {
        showMoveNumbers: true, showCoordinates: true, showAnnotations: false, showWatermark: false,
        rotation: 0, mirrored: false,
      });
      const perWidth = [];
      for (const width of widths) {
        const image = await new Promise((res, rej) => {
          const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const el = new Image();
          el.onload = () => { URL.revokeObjectURL(url); res(el); };
          el.onerror = rej;
          el.src = url;
        });
        const scale = width / exportMod.BOARD_SHARE_WIDTH;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.round(exportMod.BOARD_SHARE_HEIGHT * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f8f6f1";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        // 存 JPEG（真实输入多是截图/再压缩过的图）
        perWidth.push(canvas.toDataURL("image/jpeg", 0.92));
      }
      out.push({ name: spec.name, moves: spec.moves, images: perWidth });
    }
    return out;
  }, { specs, widths: WIDTHS }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`渲染超时（${RENDER_TIMEOUT_MS}ms）`)), RENDER_TIMEOUT_MS)),
    ]);
  } catch (error) {
    // 卡死/崩溃的批次：记账 + 索引落盘 + 重载页面继续——**不静默跳过**，收尾会报出缺哪几盘。
    const range = `${start + 1}-${Math.min(count, start + BATCH)}`;
    skippedBatches.push(range);
    console.error(`\n✗ 第 ${range} 盘渲染失败/超时：${String(error).slice(0, 140)}`);
    writeFileSync(resolve(outDir, "index.json"), JSON.stringify(index, null, 1));
    try {
      await page.goto(new URL("qa-self-render-host.html", base).toString(), { waitUntil: "domcontentloaded" });
    } catch {
      /* 页面连重载都失败：下一批仍会尝试，真不行在收尾时如实报出 */
    }
    continue;
  }
  for (const board of rendered) {
    WIDTHS.forEach((width, slot) => {
      const file = `${board.name}@${width}.jpg`;
      writeFileSync(resolve(outDir, file), Buffer.from(board.images[slot].split(",")[1], "base64"));
      writeFileSync(resolve(outDir, `${board.name}@${width}.truth.json`), JSON.stringify({
        boardSize: 15,
        stones: board.moves.map(([row, col], plies) => ({ row, col, player: plies % 2 === 0 ? "black" : "white", number: plies + 1 })),
      }, null, 1));
      index.push({ file, stones: board.moves.length, width });
    });
  }
  process.stdout.write(`\r已生成 ${Math.min(count, start + BATCH)}/${count} 盘`);
}
writeFileSync(resolve(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log(`\n共 ${index.length} 张（${count} 盘 × ${WIDTHS.length} 档格距）→ ${outDir}`);
if (skippedBatches.length) {
  console.error(`⚠ 有 ${skippedBatches.length} 批渲染失败被跳过（盘号 ${skippedBatches.join("、")}）——这份语料**不完整**，`);
  console.error("  补法：换个 SEED_OFFSET 重跑到别的目录，或缩小批量重跑这些序号。");
}
await browser.close();
