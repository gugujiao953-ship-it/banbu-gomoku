// renjunet-test.mjs — 单页测试: renju.net 对局页的棋盘长什么样、识别器吃不吃得动。
// 仅用于用户指定的单页人工测试；不做批量抓取（站点条款限制，见手册"在线来源"说明）。
// 用法: node qa/renjunet-test.mjs <对局页URL>
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4196;
const BASE = `http://localhost:${PORT}/`;
const TARGET = process.argv[2] ?? "https://www.renju.net/people/101443/game/99843/";
if (!/^https:\/\//i.test(TARGET)) { console.error("仅允许 https 页面"); process.exit(1); }
let host;
try { host = new URL(TARGET).hostname; } catch { console.error("URL 不合法"); process.exit(1); }
if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host) || host === "0.0.0.0") {
  console.error("拒绝内网/环回地址"); process.exit(1);
}

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
  mkdirSync("../15_半步五子棋/_research/renjunet", { recursive: true });
  const browser = await chromium.launch();
  // 第一步: 打开目标页, 摸清棋盘元素, 截图存盘
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  const elems = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("img,canvas,iframe").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 120) {
        out.push({ tag: el.tagName, w: Math.round(rect.width), h: Math.round(rect.height),
          x: Math.round(rect.x + window.scrollX), y: Math.round(rect.y + window.scrollY),
          src: el.tagName === "IMG" ? (el.currentSrc || el.src) : el.tagName === "IFRAME" ? el.src : "" });
      }
    });
    return out;
  });
  console.log("页面上的大图/画布/iframe:");
  for (const e of elems) console.log(JSON.stringify(e));
  await page.screenshot({ path: "../15_半步五子棋/_research/renjunet/page.png", fullPage: true });
  let index = 0;
  for (const e of elems) {
    index += 1;
    e.shot = `elem-${index}.png`;
    await page.screenshot({ path: `../15_半步五子棋/_research/renjunet/${e.shot}`,
      clip: { x: e.x, y: e.y, width: e.w, height: e.h } });
  }
  // 第二步: 本地页里跑识别器, 候选元素截图以 base64 注入
  const local = await browser.newPage();
  await local.goto(BASE + "?renjunet", { waitUntil: "commit" });
  await local.waitForTimeout(2000);
  const results = [];
  for (const e of elems) {
    const b64 = readFileSync(`../15_半步五子棋/_research/renjunet/${e.shot}`).toString("base64");
    const r = await local.evaluate(async (dataUrl) => {
      const mod = await import("/src/image-recognition.ts");
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "elem.png", { type: "image/png" });
      try {
        const result = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false });
        return { occupied: result.board.flat().filter(Boolean).length,
          confidence: Math.round(result.confidence * 100) / 100,
          numbered: result.numberedMoves.length, read: result.readMoveNumbers.length };
      } catch (e) { return { error: String(e && e.message || e).slice(0, 90) }; }
    }, `data:image/png;base64,${b64}`, { timeout: 120000 });
    results.push({ shot: e.shot, tag: e.tag, w: e.w, h: e.h, ...r });
  }
  console.log("=== 识别器结果 ===");
  for (const r of results) console.log(JSON.stringify(r));
  console.log("RENJUNET_TEST_DONE");
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error("[renjunet-test] 失败:", error && error.message || error);
  process.exit(1);
} finally {
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync("netstat -ano | findstr :4196").toString();
    const pids = [...new Set(out.split("\n").flatMap((l) => (l.includes("LISTENING") ? [l.trim().split(/\s+/).pop()] : [])))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* ok */ }
}
