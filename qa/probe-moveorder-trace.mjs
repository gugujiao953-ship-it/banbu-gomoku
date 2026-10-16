// Export application geometry and number candidates without loading the UI.
// QA_BASE_URL=http://localhost:5301/ node qa/probe-moveorder-trace.mjs --out report.json image...
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values, positionals } = parseArgs({
  options: { out: { type: "string" }, fast: { type: "boolean", default: false }, debug: { type: "boolean", default: false } },
  allowPositionals: true,
});
if (!positionals.length) throw new Error("Usage: node qa/probe-moveorder-trace.mjs [--fast] [--out report.json] image...");
const base = process.env.QA_BASE_URL || "http://localhost:5301/";
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });

try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  if (values.debug) {
    page.on("console", (message) => console.error(`[browser:${message.type()}] ${message.text()}`));
  }
  await page.route("**/qa-moveorder-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
  }));
  await page.goto(new URL("qa-moveorder-host.html", base).href, { waitUntil: "domcontentloaded" });
  const entries = [];
  for (const filename of positionals) {
    const imagePath = resolve(filename);
    const bytes = readFileSync(imagePath);
    const mime = /\.jpe?g$/i.test(filename) ? "image/jpeg" : /\.webp$/i.test(filename) ? "image/webp" : "image/png";
    let timer;
    const result = await Promise.race([
      page.evaluate(async ({ dataUrl, name, fast, debug }) => {
        globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = Boolean(debug);
        globalThis.__BANBU_MOVEORDER_TRACE__ = [];
        const mod = await import("/src/image-recognition.ts");
        const blob = await (await fetch(dataUrl)).blob();
        const started = performance.now();
        const output = await mod.recognizeBoardImage(new File([blob], name, { type: blob.type }), 15, { skipMoveOrder: fast, parallel: false });
        const stones = [];
        output.board.forEach((line, row) => line.forEach((player, col) => { if (player) stones.push({ row, col, player }); }));
        return { ...output, stones, elapsedMs: performance.now() - started, trace: globalThis.__BANBU_MOVEORDER_TRACE__ };
      }, { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, name: basename(filename), fast: values.fast, debug: values.debug }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Recognition timed out: ${filename}`)), 180000); }),
    ]).finally(() => clearTimeout(timer));
    entries.push({ image: imagePath, sha256: createHash("sha256").update(bytes).digest("hex"), ...result });
    console.error(`${basename(filename)}: stones=${result.stones.length}, restored=${result.numberedMoves.length}, read=${result.readMoveNumbers.length}, ${Math.round(result.elapsedMs)}ms`);
  }
  const report = JSON.stringify({ schemaVersion: 1, entries }, null, 2);
  if (values.out) writeFileSync(values.out, report + "\n", "utf8");
  else console.log(report);
} finally {
  await browser.close();
}
