// batch-recognize.mjs — 用**应用识谱器**批量识别书页（本地跑，产出干净局面）。
// 用途：超算挖掘管线用的是 v3/v4 ONNX，污染率高（白>黑 56%）；应用识谱器
// 2026-10-02 修好后（白子 4%→100%）用它重提取书谱，再回传超算做 solver 验证。
// 用法: node qa/batch-recognize.mjs <图片目录> [max=50]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { chromium } from "playwright";

const PORT = 4191;
const BASE = `http://localhost:${PORT}/`;
const DIR = process.argv[2];
const MAX = Number(process.argv[3] || 50);
if (!DIR) { console.error("用法: node qa/batch-recognize.mjs <图片目录> [max=50]"); process.exit(1); }

const files = readdirSync(DIR).filter((f) => /\.(png|jpe?g)$/i.test(f)).slice(0, MAX);
if (!files.length) { console.error("目录里没有图片:", DIR); process.exit(1); }
console.error(`批量识别 ${files.length} 张（目录: ${DIR}）`);

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)), shell: true, stdio: "pipe",
});
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
  await page.goto(BASE + "?batch", { waitUntil: "commit" });
  await page.waitForTimeout(2000);

  const out = [];
  let illegal = 0;
  for (const f of files) {
    const p = join(DIR, f);
    const b64 = readFileSync(p).toString("base64");
    const mime = /\.jpe?g$/i.test(f) ? "image/jpeg" : "image/png";
    const r = await page.evaluate(async (dataUrl) => {
      const mod = await import("/src/image-recognition.ts");
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "x.png", { type: "image/png" });
      try {
        const res = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false, parallel: true });
        const black = [], white = [];
        res.board.forEach((line, row) => line.forEach((v, col) => {
          if (v === "black") black.push({ row, col });
          else if (v === "white") white.push({ row, col });
        }));
        return { black, white, grid: res.board.map((l) => l.map((v) => (v === "black" ? 1 : v === "white" ? 2 : 0)).join("")).join("") };
      } catch (e) { return { error: String(e && e.message || e).slice(0, 80) }; }
    }, `data:${mime};base64,${b64}`, { timeout: 120000 });
    if (r.error) { console.error(`  ${f}: ${r.error}`); continue; }
    const nb = r.black.length, nw = r.white.length;
    const ok = nw - nb <= 1;
    if (!ok) illegal += 1;
    out.push({ image: f, black: r.black, white: r.white, n_black: nb, n_white: nw, legal: ok });
  }
  writeFileSync("batch-result.jsonl", out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const legal = out.length - illegal;
  console.log(JSON.stringify({
    总数: out.length, 合法: legal, 非法: illegal,
    合法率: out.length ? Math.round((100 * legal) / out.length) + "%" : "n/a",
    平均黑子: out.length ? Math.round((out.reduce((s, r) => s + r.n_black, 0) / out.length) * 10) / 10 : 0,
    平均白子: out.length ? Math.round((out.reduce((s, r) => s + r.n_white, 0) / out.length) * 10) / 10 : 0,
  }));
  console.log("BATCH_DONE → batch-result.jsonl");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[batch-recognize] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const o = execSync("netstat -ano | findstr :4191").toString();
    const pids = [...new Set(o.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
