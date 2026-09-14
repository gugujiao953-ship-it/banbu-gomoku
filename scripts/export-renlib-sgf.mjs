import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// TMP: export a .lib to SGF using the production wasm renlib core, loaded the
// same way the dev server serves it (/renlib/*). Input: lib path; output: .sgf next to it.
const [,, libPath, outPath] = process.argv;
if (!libPath || !outPath) { console.log("usage: tmp-export-lib-sgf.mjs <lib> <out.sgf>"); process.exit(1); }
const url = process.env.BANBU_URL || "http://localhost:5193/";
fs.mkdirSync("public/tmp-bookbuild", { recursive: true });
const staged = path.join("public/tmp-bookbuild", "input.lib");
fs.copyFileSync(libPath, staged);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "domcontentloaded" });
for (const f of ["IntervalPost.js", "TextCoder.js", "JFile.js", "JPoint.js", "LibraryFile.js", "MoveList.js", "MoveNode.js", "Stack.js", "RenLibDoc_wasm.js"]) {
  await page.addScriptTag({ url: `/renlib/${f}` });
}
const result = await page.evaluate(async (libUrl) => {
  self.post = (cmd, param) => { if (String(cmd) === "log") console.log("[core]", String(param).slice(0, 160)); };
  self.l = 0;
  const realFetch = self.fetch.bind(self);
  self.fetch = (u, o) => realFetch(String(u).includes("RenLib.wasm") ? "/renlib/RenLib.wasm" : u, o);
  const doc = new self.RenLibDoc();
  const buf = await realFetch(libUrl).then((r) => r.arrayBuffer());
  await doc.addLibrary(buf);
  const out = await doc.lib2sgf();
  const bytes = new Uint8Array(out.buf, 0, out.byteLen || out.buf.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  self.fetch = realFetch;
  return { b64: btoa(bin), byteLen: bytes.length };
}, "/tmp-bookbuild/input.lib");
fs.writeFileSync(outPath, Buffer.from(result.b64, "base64"));
console.log("SGF exported:", outPath, result.byteLen, "bytes");
await browser.close();
fs.rmSync("public/tmp-bookbuild", { recursive: true, force: true });
