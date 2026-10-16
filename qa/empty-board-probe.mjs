// empty-board-probe.mjs — 空棋盘交叉点误判检测: 网格线交叉点会不会被判成棋子。
// 小图（格子≈13px）上如果误判，就是 lightHollowStone 通路的环闭合门失效。
// 用法: node qa/empty-board-probe.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = 4185;
const BASE = `http://localhost:${PORT}/`;
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
  await page.goto(BASE + "?empty", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  const out = await page.evaluate(async () => {
    const mod = await import("/src/image-recognition.ts");
    const results = [];
    // 三种格子间距（对应小图放大前后），线宽均 1px（书页印刷线）
    for (const cell of [13, 20, 26, 34]) {
      const margin = Math.round(cell * 0.6);
      const size = margin * 2 + cell * 14;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 1;
      for (let i = 0; i < 15; i += 1) {
        ctx.beginPath(); ctx.moveTo(margin, margin + i * cell); ctx.lineTo(size - margin, margin + i * cell); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(margin + i * cell, margin); ctx.lineTo(margin + i * cell, size - margin); ctx.stroke();
      }
      const data = ctx.getImageData(0, 0, size, size);
      const gray = new Uint8Array(size * size);
      for (let i = 0; i < size * size; i += 1) {
        gray[i] = Math.round((data.data[i * 4] * 299 + data.data[i * 4 + 1] * 587 + data.data[i * 4 + 2] * 114) / 1000);
      }
      const image = { data: data.data, gray, width: size, height: size };
      // 检查 (7,7) 与 (5,5) 两个空交叉点
      let falsePos = 0;
      const samples = [];
      for (const [r0, c0] of [[7, 7], [5, 5], [9, 3]]) {
        const x = margin + c0 * cell, y = margin + r0 * cell;
        const f = mod.analyzeIntersection(image, x, y, cell);
        if (f.stoneLike) falsePos += 1;
        samples.push({ at: `${r0},${c0}`, stoneLike: f.stoneLike,
          interior: Math.round(f.interiorLightShare * 100) / 100,
          sec: Math.round(f.ringSectorCoverage * 100) / 100,
          outer: Math.round(f.outerShare * 100) / 100,
          ring: Math.round(f.ringShare * 100) / 100,
          darkDisc: Math.round(f.darkDiscShare * 100) / 100,
          diag: Math.round(f.diagonalShare * 100) / 100 });
      }
      results.push({ cell, size, falsePos, samples });
    }
    return results;
  }, undefined, { timeout: 180000 });
  console.log("=== 空交叉点误判检测 ===");
  for (const r of out) {
    console.log(`格子间距 ${r.cell}px（画布 ${r.size}）: 3个空点里 ${r.falsePos} 个被判成棋子`);
    for (const s of r.samples) console.log("   ", JSON.stringify(s));
  }
  console.log("EMPTY_PROBE_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[empty-board-probe] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const o = execSync("netstat -ano | findstr :4190").toString();
    const pids = [...new Set(o.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
