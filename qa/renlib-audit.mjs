import { chromium } from "playwright";
const files = process.argv.slice(2);
if (!files.length) throw new Error("用法：node qa/renlib-audit.mjs 雨.lib 松月.lib");
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
for (const file of files) {
  const page = await browser.newPage();
  await page.goto(base);
  const url = process.env.RENLIB_BASE_URL ? `${process.env.RENLIB_BASE_URL}/${encodeURIComponent(file.split(/[\\/]/).pop())}` : file;
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const { importRecordFile } = await import("/src/formats.ts");
    const imported = await importRecordFile(new File([blob], url.split("/").pop() || "audit.lib"));
    return { format: imported.format, warnings: imported.warnings.length, ...imported.stats };
  }, url);
  console.log(JSON.stringify({ file, ...result }));
  await page.close();
}
await browser.close();
