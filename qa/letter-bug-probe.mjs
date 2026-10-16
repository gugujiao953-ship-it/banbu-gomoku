// letter-bug-probe.mjs — 定位书页坐标字母被误读为棋子的具体坐标。
// 用法: node qa/letter-bug-probe.mjs <图片路径>
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium } from "playwright";

const PORT = 4192;
const BASE = `http://localhost:${PORT}/`;
const IMG = process.argv[2];
if (!IMG) { console.error("用法: node qa/letter-bug-probe.mjs <图片路径>"); process.exit(1); }

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
  const b64 = readFileSync(IMG).toString("base64");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + "?letter", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  const out = await page.evaluate(async (dataUrl) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], "letter.png", { type: "image/png" });
    const result = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false });
    const ascii = [];
    result.board.forEach((line) => {
      let s = "";
      line.forEach((p) => { s += p === "black" ? "X" : p === "white" ? "O" : "."; });
      ascii.push(s);
    });
    return {
      occupied: result.board.flat().filter(Boolean).length,
      grid: result.grid, gridCanvas: result.gridCanvas,
      imageWidth: result.imageWidth, imageHeight: result.imageHeight,
      ascii,
    };
  }, `data:image/png;base64,${b64}`, { timeout: 120000 });
  console.log("子数:", out.occupied, " 原图:", out.imageWidth + "x" + out.imageHeight);
  console.log("网格:", JSON.stringify(out.grid), " 画布:", JSON.stringify(out.gridCanvas));
  console.log(out.ascii.join("\n"));
  console.log("LETTER_PROBE_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[letter-bug-probe] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const o = execSync("netstat -ano | findstr :4192").toString();
    const pids = [...new Set(o.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
