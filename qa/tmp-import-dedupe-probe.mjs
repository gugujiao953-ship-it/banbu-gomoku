import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = process.argv[2] || "http://localhost:5301/";
const DB_B64 = readFileSync("D:/Tencent/download/残曾.db").toString("base64");
const SGF_TEXT = "(;GM[5]FF[4]SZ[15];B[h8];W[i9];B[h9];W[i8];B[h10])";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e.message).slice(0, 200)));

const dropFiles = async (specs) => page.evaluate(({ dbB64, sgfText, want }) => {
  const dt = new DataTransfer();
  for (const kind of want) {
    if (kind === "db") {
      const bin = atob(dbB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], "残曾.db", { type: "application/octet-stream" }));
    } else {
      dt.items.add(new File([sgfText], "probe.sgf", { type: "application/x-go-sgf" }));
    }
  }
  window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  return dt.items.length;
}, { dbB64: DB_B64, sgfText: SGF_TEXT, want: specs });

const collect = async (label, specs) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2200);
  if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) {
    await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("先自己试试"))?.click());
    await page.waitForTimeout(500);
  }
  const n = await dropFiles(specs);
  console.log(`[${label}] 投入 ${n} 份`);
  const seen = new Set();
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(700);
    const texts = await page.evaluate(() => {
      const out = [];
      for (const sel of [".toast", "[class*=toast]", "[role=alert]", "[class*=import]"]) {
        document.querySelectorAll(sel).forEach((el) => {
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (t && t.length < 260) out.push(t);
        });
      }
      return [...new Set(out)];
    });
    for (const t of texts) { if (!seen.has(t)) { seen.add(t); console.log(`  [${label}]`, t); } }
    if (i > 5 && seen.size >= 2) break;
  }
};

await collect("重复两份 db", ["db", "db"]);
await collect("混批 db+sgf", ["db", "sgf"]);
console.log("--- 页面错误 ---");
errors.slice(0, 6).forEach((l) => console.log(l));
if (!errors.length) console.log("（无页面错误）");
await browser.close();
