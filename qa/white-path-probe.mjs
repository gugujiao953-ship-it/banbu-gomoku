// white-path-probe.mjs — heavyborder.png 上新白子通路的触发诊断。
// 用法: node qa/white-path-probe.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const PORT = 4193;
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
  const b64 = readFileSync(resolve("qa/fixtures/recognition/heavyborder.png")).toString("base64");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + "?white", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  const out = await page.evaluate(async (dataUrl) => {
    globalThis.__BANBU_WHITEPATH__ = [];
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], "hb.png", { type: "image/png" });
    const result = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true });
    let black = 0, white = 0;
    const ascii = [];
    result.board.forEach((line) => {
      let row = "";
      line.forEach((p) => { if (p === "black") { black += 1; row += "X"; } else if (p === "white") { white += 1; row += "O"; } else row += "."; });
      ascii.push(row);
    });
    return { black, white, ascii, fires: globalThis.__BANBU_WHITEPATH__ };
  }, `data:image/png;base64,${b64}`, { timeout: 120000 });
  console.log("黑:", out.black, " 白:", out.white, " 新通路触发:", out.fires.length, "次");
  console.log(out.ascii.join("\n"));
  console.log(JSON.stringify(out.fires.slice(0, 6)));
  console.log("WP_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[white-path-probe] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const o = execSync("netstat -ano | findstr :4193").toString();
    const pids = [...new Set(o.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
