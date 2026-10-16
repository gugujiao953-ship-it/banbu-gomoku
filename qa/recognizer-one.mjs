// recognizer-one.mjs — 单图识别测试: 把本地图片喂给应用识别器, 打印局面/序号详情。
// 用法: node qa/recognizer-one.mjs <图片路径>
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium } from "playwright";

const PORT = 4195;
const BASE = `http://localhost:${PORT}/`;
const IMG = process.argv[2];
if (!IMG) { console.error("用法: node qa/recognizer-one.mjs <图片路径>"); process.exit(1); }

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
  const ext = basename(IMG).toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + "?one", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  const result = await page.evaluate(async (dataUrl) => {
    globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = false;
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], "one.png", { type: "image/png" });
    const result = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false });
    const stones = [];
    result.board.forEach((line, r) => line.forEach((p, c) => { if (p) stones.push(`${String.fromCharCode(65 + c)}${15 - r}:${p === "black" ? "黑" : "白"}`); }));
    return {
      occupied: stones.length,
      confidence: Math.round(result.confidence * 100) / 100,
      stones: stones.join(" "),
      numberedMoves: result.numberedMoves.map((m) => `${m.number}:${String.fromCharCode(65 + m.col)}${15 - m.row}`),
      readMoveNumbers: result.readMoveNumbers.map((m) => `${m.number}:${String.fromCharCode(65 + m.col)}${15 - m.row}${m.player === "black" ? "黑" : "白"}`),
    };
  }, `data:${ext};base64,${b64}`, { timeout: 180000 });
  console.log("=== 单图识别结果 ===");
  console.log("局面子数:", result.occupied, " 置信度:", result.confidence);
  console.log("局面:", result.stones);
  console.log("完整手序(numberedMoves):", JSON.stringify(result.numberedMoves));
  console.log("部分读出(readMoveNumbers):", JSON.stringify(result.readMoveNumbers));
  console.log("ONE_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[recognizer-one] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync("netstat -ano | findstr :4195").toString();
    const pids = [...new Set(out.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
