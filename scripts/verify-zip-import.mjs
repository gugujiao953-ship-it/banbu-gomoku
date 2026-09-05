import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const encoder = new TextEncoder();
const crcTable = (() => { const table = new Uint32Array(256); for (let i = 0; i < 256; i += 1) { let v = i; for (let b = 0; b < 8; b += 1) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; table[i] = v >>> 0; } return table; })();
const crc32 = (bytes) => { let v = 0xffffffff; for (const b of bytes) v = crcTable[(v ^ b) & 255] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
const zipStore = (entries) => {
  const locals = [], central = []; let offset = 0;
  const put16 = (v, n, o) => new DataView(v.buffer).setUint16(o, n, true);
  const put32 = (v, n, o) => new DataView(v.buffer).setUint32(o, n, true);
  for (const [name, text] of entries) { const n = encoder.encode(name), d = encoder.encode(text), packed = new Uint8Array(deflateRawSync(d)), sum = crc32(d); const h = new Uint8Array(30 + n.length); put32(h, 0x04034b50, 0); put16(h, 20, 4); put16(h, 0x800, 6); put16(h, 8, 8); put32(h, sum, 14); put32(h, packed.length, 18); put32(h, d.length, 22); put16(h, n.length, 26); h.set(n, 30); locals.push(h, packed); const c = new Uint8Array(46 + n.length); put32(c, 0x02014b50, 0); put16(c, 20, 4); put16(c, 20, 6); put16(c, 0x800, 8); put16(c, 8, 10); put32(c, sum, 16); put32(c, packed.length, 20); put32(c, d.length, 24); put16(c, n.length, 28); put32(c, offset, 42); c.set(n, 46); central.push(c); offset += h.length + packed.length; }
  const length = [...locals, ...central].reduce((n, x) => n + x.length, 0) + 22; const out = new Uint8Array(length); let at = 0; for (const part of [...locals, ...central]) { out.set(part, at); at += part.length; } const cd = central.reduce((n, x) => n + x.length, 0); put32(out, 0x06054b50, at); put16(out, central.length, at + 8); put16(out, central.length, at + 10); put32(out, cd, at + 12); put32(out, offset, at + 16); return out;
};

const temp = path.join(os.tmpdir(), `banbu-zip-qa-${Date.now()}.zip`);
const zip = zipStore([
  ["records/test.sgf", "(;GM[1]FF[4]SZ[15];B[hh];W[ii])"],
  ["puzzles/test.json", JSON.stringify({ puzzles: [{ title: "ZIP 测试题", stones: "H8", side: "white" }] })],
]);
await fs.writeFile(temp, zip);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("http://127.0.0.1:4173/?qa=zip", { waitUntil: "domcontentloaded" });
  const input = page.locator('input[type="file"][accept*=".zip"]').first();
  await input.setInputFiles(temp);
  await page.waitForFunction(() => {
    const library = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
    const puzzles = JSON.parse(localStorage.getItem("renju-note-puzzle-collections-v1") || "[]");
    return library.length > 0 && puzzles.some((item) => item.puzzles?.some((puzzle) => puzzle.title === "ZIP 测试题"));
  }, null, { timeout: 15000 });
  const welcome = page.getByRole("button", { name: "我知道了" });
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  await page.getByRole("button", { name: /棋谱库/ }).click({ timeout: 5000 });
  await page.getByRole("button", { name: /资料安全/ }).click({ timeout: 5000 });
  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出完整备份/ }).click();
  const downloaded = await exportDownload;
  if (!/\.zip$/i.test(downloaded.suggestedFilename())) throw new Error(`备份导出扩展名不是 ZIP：${downloaded.suggestedFilename()}`);
  const exportedPath = await downloaded.path();
  if (!exportedPath || (await fs.stat(exportedPath)).size < 100) throw new Error("备份 ZIP 下载内容为空");
  const signature = exportedPath ? await fs.readFile(exportedPath) : Buffer.alloc(0);
  if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04) throw new Error("导出的备份不是有效 ZIP 文件头");
  const state = await page.evaluate(() => ({ library: JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]").length, puzzles: JSON.parse(localStorage.getItem("renju-note-puzzle-collections-v1") || "[]").length }));
  if (errors.length) throw new Error(`网页错误：${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, ...state }));
} finally { await browser.close(); await fs.rm(temp, { force: true }); }
