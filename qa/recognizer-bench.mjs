// recognizer-bench.mjs — 本地识谱/复原的量化评测台。
// 起 vite dev server → 真浏览器里 import 应用识别器源码 → 渲染各种风格的
// 带号棋盘基准 → 跑 recognizeBoardImage → 报 StoneIoU / 完整手序成功率 /
// 逐号命中率。先量准再修，避免瞎猜失败模式。
// 用法: node qa/recognizer-bench.mjs [每组试验数=12]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = 4197;
const BASE = `http://localhost:${PORT}/`;
const TRIALS = Number(process.argv[2] ?? 12);

const preview = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  shell: true, stdio: "pipe",
});
preview.stdout.on("data", () => {});
preview.stderr.on("data", () => {});

const waitForServer = async () => {
  for (let i = 0; i < 90; i += 1) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server 起不来");
};

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleLines = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("banbu-image-digit") || text.includes("MOVEORDER")) consoleLines.push(text);
  });
  await page.goto(BASE + "?bench", { waitUntil: "commit" });
  await page.waitForTimeout(2500); // 等应用模块可被 vite 按需转换

  if (process.argv[2] === "diag") {
    // 诊断模式: 单张最简单的带号图, 倾倒数字级调试记录。
    const diag = await page.evaluate(async () => {
      globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
      globalThis.__BANBU_MOVEORDER_TRACE__ = [];
      const mod = await import("/src/image-recognition.ts");
      let seed = 20261002;
      const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const stones = [];
      const used = new Set();
      while (stones.length < 9) {
        const row = Math.floor(rng() * 15), col = Math.floor(rng() * 15);
        if (used.has(row * 15 + col)) continue;
        used.add(row * 15 + col);
        stones.push({ row, col, player: stones.length % 2 === 0 ? "black" : "white", number: stones.length + 1 });
      }
      const cell = 40, margin = 24, size = margin * 2 + cell * 14;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 1;
      for (let i = 0; i < 15; i += 1) {
        ctx.beginPath(); ctx.moveTo(margin, margin + i * cell); ctx.lineTo(size - margin, margin + i * cell); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(margin + i * cell, margin); ctx.lineTo(margin + i * cell, size - margin); ctx.stroke();
      }
      for (const s of stones) {
        const x = margin + s.col * cell, y = margin + (14 - s.row) * cell, r = cell * 0.46;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (s.player === "black") { ctx.fillStyle = "#111"; ctx.fill(); ctx.fillStyle = "#fff"; }
        else { ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = "#111"; }
        ctx.font = `bold ${Math.round(cell * 0.52)}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(s.number), x, y + cell * 0.02);
      }
      const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
      const file = new File([blob], "diag.png", { type: "image/png" });
      const result = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false });
      return {
        numbered: result.numberedMoves,
        read: result.readMoveNumbers,
        occupied: result.board.flat().filter(Boolean).length,
        confidence: result.confidence,
      };
    }, undefined, { timeout: 120000 });
    console.log("=== DIAG 结果 ===");
    console.log("局面子数(diag.occupied):", diag.occupied, " 置信度:", diag.confidence);
    console.log("numberedMoves:", JSON.stringify(diag.numbered));
    console.log("readMoveNumbers:", JSON.stringify(diag.read));
    console.log("=== 数字级调试记录（前 25 条）===");
    for (const line of consoleLines.slice(0, 25)) console.log(line.replace(/^\[banbu-image-digit\]\s*/, ""));
    console.log("DIAG_DONE");
    await browser.close();
    process.exit(0);
  }

  await page.waitForTimeout(2500); // 等应用模块可被 vite 按需转换
  const report = await page.evaluate(async (trials) => {
    const mod = await import("/src/image-recognition.ts");
    // 可复现随机
    let seed = 20261002;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];

    // 渲染一张带号棋盘。风格: photo(实心白子) | book(空心白子+米色底)
    const drawBoard = (stones, style, fontScale, cell, margin, fontFamily) => {
      const size = margin * 2 + cell * 14;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = style === "book" ? "#f5efdf" : "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "#222"; ctx.lineWidth = style === "book" ? 2 : 1;
      for (let i = 0; i < 15; i += 1) {
        ctx.beginPath();
        ctx.moveTo(margin, margin + i * cell); ctx.lineTo(size - margin, margin + i * cell); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(margin + i * cell, margin); ctx.lineTo(margin + i * cell, size - margin); ctx.stroke();
      }
      for (const s of stones) {
        const x = margin + s.col * cell, y = margin + (14 - s.row) * cell, r = cell * 0.46;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (s.player === "black") { ctx.fillStyle = "#111"; ctx.fill(); ctx.fillStyle = "#fff"; }
        else if (style === "book") { ctx.fillStyle = "#f5efdf"; ctx.fill(); ctx.strokeStyle = "#111"; ctx.lineWidth = 2.2; ctx.stroke(); ctx.fillStyle = "#111"; }
        else { ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = "#111"; }
        ctx.font = `bold ${Math.round(cell * fontScale)}px ${fontFamily}`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(s.number), x, y + cell * 0.02);
      }
      return canvas;
    };

    // 生成基准: 从随机星型局面铺 N 颗子(黑白交替), 1..N 编号
    const genCase = (style, fontScale, cell, margin, n, fontFamily) => {
      const stones = [];
      const used = new Set();
      let guard = 0;
      while (stones.length < n && guard < 4000) {
        guard += 1;
        const row = Math.floor(rng() * 15), col = Math.floor(rng() * 15);
        const key = row * 15 + col;
        if (used.has(key)) continue;
        used.add(key);
        stones.push({ row, col, player: stones.length % 2 === 0 ? "black" : "white", number: stones.length + 1 });
      }
      return { stones, canvas: drawBoard(stones, style, fontScale, cell, margin, fontFamily) };
    };

    const canvasToBlob = (canvas) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));

    const variants = [
      { name: "截图风-一位数(1..9)", style: "photo", fontScale: 0.52, cell: 40, margin: 24, n: 9, font: "sans-serif" },
      { name: "截图风-两位数(1..20)", style: "photo", fontScale: 0.44, cell: 40, margin: 24, n: 20, font: "sans-serif" },
      { name: "App比例字体(1..20)", style: "photo", fontScale: 0.44, cell: 40, margin: 24, n: 20, font: "'Segoe UI', system-ui, sans-serif" },
      { name: "书谱风-两位数(1..40)", style: "book", fontScale: 0.40, cell: 34, margin: 20, n: 40, font: "sans-serif" },
      { name: "书谱宋体(1..40)", style: "book", fontScale: 0.40, cell: 34, margin: 20, n: 40, font: "'Times New Roman', 'Noto Serif CJK SC', SimSun, serif" },
      { name: "小图-两位数(1..60)", style: "book", fontScale: 0.38, cell: 26, margin: 16, n: 60, font: "sans-serif" },
    ];

    const out = [];
    for (const v of variants) {
      let iouSum = 0, seqOk = 0, numHit = 0, numTotal = 0, stoneOk = 0, readPartial = 0;
      let blackTotal = 0, blackHit = 0, whiteTotal = 0, whiteHit = 0;
      for (let t = 0; t < trials; t += 1) {
        const gt = genCase(v.style, v.fontScale, v.cell, v.margin, v.n, v.font);
        const blob = await canvasToBlob(gt.canvas);
        const file = new File([blob], "bench.png", { type: "image/png" });
        let result;
        try {
          result = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false });
        } catch (e) {
          out.push({ ...v, error: String(e && e.message || e) });
          continue;
        }
        // 石子 IoU（带颜色一致才算交集）。识别器 row 0 = 图顶部；gt 的 row 0
        // 画在图底部（renju 行号自下而上），比较前先翻成图像空间。
        const img = (s) => `${14 - s.row},${s.col},${s.player}`;
        const gtSet = new Set(gt.stones.map(img));
        const gotSet = new Set();
        result.board.forEach((line, r) => line.forEach((p, c) => { if (p) gotSet.add(`${r},${c},${p}`); }));
        let inter = 0;
        for (const key of gtSet) if (gotSet.has(key)) inter += 1;
        const union = new Set([...gtSet, ...gotSet]).size;
        iouSum += union ? inter / union : 0;
        if (gtSet.size === gotSet.size && inter === gtSet.size) stoneOk += 1;
        // 按颜色拆召回：确认漏检是否集中在空心白子
        for (const s of gt.stones) {
          if (s.player === "black") { blackTotal += 1; if (gotSet.has(img(s))) blackHit += 1; }
          else { whiteTotal += 1; if (gotSet.has(img(s))) whiteHit += 1; }
        }
        // 手序: 完整 1..N 成功率 + 逐号命中（部分读出在 readMoveNumbers，
        // 完整序列才进 numberedMoves——两个口径分开报）。
        const gotNums = new Map([...result.numberedMoves, ...result.readMoveNumbers].map((m) => [`${m.row},${m.col}`, m.number]));
        for (const s of gt.stones) {
          numTotal += 1;
          if (gotNums.get(`${14 - s.row},${s.col}`) === s.number) numHit += 1;
        }
        const complete = result.numberedMoves.length === gt.stones.length
          && result.numberedMoves.every((m, i) => m.number === i + 1)
          && gt.stones.every((s) => gotNums.get(`${14 - s.row},${s.col}`) === s.number);
        if (complete) seqOk += 1;
        readPartial += result.readMoveNumbers.length;
      }
      out.push({
        name: v.name, n: v.n, trials,
        stoneIoU: Math.round((iouSum / trials) * 1000) / 1000,
        stoneExact: Math.round((stoneOk / trials) * 100) + "%",
        blackRecall: blackTotal ? Math.round((blackHit / blackTotal) * 100) + "%" : "-",
        whiteRecall: whiteTotal ? Math.round((whiteHit / whiteTotal) * 100) + "%" : "-",
        seqComplete: Math.round((seqOk / trials) * 100) + "%",
        perNumberHit: numTotal ? Math.round((numHit / numTotal) * 100) + "%" : "-",
        readPartialPerImage: Math.round((readPartial / trials) * 10) / 10,
      });
    }
    return out;
  }, TRIALS, { timeout: 420000 });
  console.log("=== 本地识谱/复原评测（应用识别器原图通道）===");
  for (const row of report) console.log(JSON.stringify(row));
  console.log("BENCH_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[bench] 失败:", error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync("netstat -ano | findstr :4197").toString();
    const pids = [...new Set(out.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* 没监听就算了 */ }
}
