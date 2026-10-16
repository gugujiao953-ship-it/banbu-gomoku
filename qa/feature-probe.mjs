// feature-probe.mjs — 画一颗书谱风白子（带序号），直接调 analyzeIntersection
// 把特征值倒出来，给阈值调参用。用法: node qa/feature-probe.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = 4194;
const BASE = `http://localhost:${PORT}/`;
const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  shell: true, stdio: "pipe",
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
  await page.goto(BASE + "?probe", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    return import("/src/image-recognition.ts").then(async (mod) => {
      const cell = 34, margin = 20;
      const size = margin * 2 + cell * 14;
      const draw = (player, label) => {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f5efdf"; ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = "#222"; ctx.lineWidth = 2;
        for (let i = 0; i < 15; i += 1) {
          ctx.beginPath(); ctx.moveTo(margin, margin + i * cell); ctx.lineTo(size - margin, margin + i * cell); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(margin + i * cell, margin); ctx.lineTo(margin + i * cell, size - margin); ctx.stroke();
        }
        const x = margin + 7 * cell, y = margin + 7 * cell, r = cell * 0.46;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (player === "black") { ctx.fillStyle = "#111"; ctx.fill(); ctx.fillStyle = "#fff"; }
        else { ctx.fillStyle = "#f5efdf"; ctx.fill(); ctx.strokeStyle = "#111"; ctx.lineWidth = 2.2; ctx.stroke(); ctx.fillStyle = "#111"; }
        ctx.font = `bold ${Math.round(cell * 0.40)}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, x, y + cell * 0.02);
        const data = ctx.getImageData(0, 0, size, size);
        const gray = new Uint8Array(size * size);
        for (let i = 0; i < size * size; i += 1) {
          gray[i] = Math.round((data.data[i * 4] * 299 + data.data[i * 4 + 1] * 587 + data.data[i * 4 + 2] * 114) / 1000);
        }
        const image = { data: data.data, gray, width: size, height: size };
        return mod.analyzeIntersection(image, x, y, cell);
      };
      const pick = (f) => ({
        stoneLike: f.stoneLike, coreShare: Math.round(f.coreShare * 100) / 100,
        middleShare: Math.round(f.middleShare * 100) / 100, outerShare: Math.round(f.outerShare * 100) / 100,
        ringShare: Math.round(f.ringShare * 100) / 100, diagonalShare: Math.round(f.diagonalShare * 100) / 100,
        interiorLightShare: Math.round(f.interiorLightShare * 100) / 100,
        fgLight: Math.round(f.foregroundLight), bgLight: Math.round(f.backgroundLight),
        sat: Math.round(f.foregroundSaturation), discShare: Math.round(f.discShare * 100) / 100,
      });
      return {
        white25: pick(draw("white", "25")),
        white5: pick(draw("white", "5")),
        whiteNoNum: pick(draw("white", "")),
        black25: pick(draw("black", "25")),
      };
    });
  }, undefined, { timeout: 120000 });
  console.log("=== 特征探针（书谱风 cell34）===");
  for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
  console.log("PROBE_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[probe] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const o = execSync("netstat -ano | findstr :4194").toString();
    const pids = [...new Set(o.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
