// overlay-probe.mjs — 把识别到的网格与棋子画回原图，导出 PNG 供人工核对。
// 用法: node qa/overlay-probe.mjs <图片路径> <输出PNG>
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium } from "playwright";

const PORT = 4184;
const BASE = `http://localhost:${PORT}/`;
const IMG = process.argv[2];
const OUT = process.argv[3] || "overlay.png";
if (!IMG) { console.error("用法: node qa/overlay-probe.mjs <图片路径> [输出PNG]"); process.exit(1); }

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
  const b64 = readFileSync(IMG).toString("base64");
  const mime = /\.jpe?g$/i.test(IMG) ? "image/jpeg" : "image/png";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + "?overlay", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  const dataUrl = await page.evaluate(async (src) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], "x.png", { type: "image/png" });
    const res = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
    // 用识别的工作画布尺寸重画原图 + 叠加网格与棋子
    const bitmap = await createImageBitmap(blob);
    const cw = res.gridCanvas?.width || bitmap.width;
    const ch = res.gridCanvas?.height || bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, cw, ch);
    const g = res.grid;
    if (g) {
      ctx.strokeStyle = "rgba(255,0,0,0.75)"; ctx.lineWidth = 1;
      for (let i = 0; i < 15; i += 1) {
        const x = g.originX + i * g.spacingX;
        ctx.beginPath(); ctx.moveTo(x, g.originY); ctx.lineTo(x, g.originY + 14 * g.spacingY); ctx.stroke();
        const y = g.originY + i * g.spacingY;
        ctx.beginPath(); ctx.moveTo(g.originX, y); ctx.lineTo(g.originX + 14 * g.spacingX, y); ctx.stroke();
      }
      // 框出 15x15 网格的外边界
      ctx.strokeStyle = "rgba(0,120,255,0.9)"; ctx.lineWidth = 2;
      const x0 = g.originX - g.spacingX * 0.5, y0 = g.originY - g.spacingY * 0.5;
      ctx.strokeRect(x0, y0, g.spacingX * 15, g.spacingY * 15);
      // 棋子
      res.board.forEach((line, row) => line.forEach((p, col) => {
        if (!p) return;
        const x = g.originX + col * g.spacingX, y = g.originY + row * g.spacingY;
        ctx.beginPath(); ctx.arc(x, y, g.spacingX * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = p === "black" ? "rgba(0,0,0,0.85)" : "rgba(0,200,0,0.75)";
        ctx.fill();
      }));
    }
    return canvas.toDataURL("image/png");
  }, `data:${mime};base64,${b64}`, { timeout: 120000 });
  writeFileSync(OUT, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
  console.log("已导出叠加图:", OUT);
  console.log("OVERLAY_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[overlay-probe] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const o = execSync("netstat -ano | findstr :4184").toString();
    const pids = [...new Set(o.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
