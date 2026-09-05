import { chromium } from "playwright";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Builds the evidence bundle for the two real user screenshots: copies the
// originals next to the recognized boards and renders a side-by-side
// comparison sheet per image. Runs fully headless.
const roundDir = resolve(process.env.IMAGE_RECOGNITION_ARTIFACT_DIR || "qa-artifacts/image-recognition-glm-2026-09-03/gate-two-images");
const report = JSON.parse(await readFile(resolve(roundDir, "report.json"), "utf8"));
await mkdir(resolve(roundDir, "original"), { recursive: true });
await mkdir(resolve(roundDir, "comparisons"), { recursive: true });

const browser = await chromium.launch({ headless: true });
for (const item of report.results) {
  await copyFile(item.source, resolve(roundDir, "original", `${item.id}.jpg`));
  const original = await readFile(item.source, "base64");
  const recognized = await readFile(item.recognizedPath, "base64");
  const exact = item.missing.length === 0 && item.unexpected.length === 0 && item.colorMismatches.length === 0;
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin: 0; font: 14px/1.5 sans-serif; background: #1e1e20; color: #eee; }
      .head { padding: 8px 12px; }
      .wrap { display: flex; gap: 10px; padding: 0 10px 10px; }
      img { display: block; height: 560px; border: 1px solid #555; }
      .bad { color: #ff8a80; } .ok { color: #9be29b; }
    </style></head><body>
      <div class="head">${item.id}: expected ${item.expectedCount}, detected ${item.detectedCount}, matched ${item.matched} —
        <span class="${exact ? "ok" : "bad"}">${exact ? "EXACT (100%)" : `miss=${item.missing.length} extra=${item.unexpected.length} color=${item.colorMismatches.length}`}</span></div>
      <div class="wrap"><img src="data:image/jpeg;base64,${original}"><img src="data:image/png;base64,${recognized}"></div>
    </body></html>`, { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(roundDir, "comparisons", `${item.id}-compare.png`), fullPage: true });
  await page.close();
}
await browser.close();
const summary = {
  generatedAt: new Date().toISOString(),
  round: roundDir,
  gate: "two-user-images",
  passed: report.results.every((item) => item.missing.length === 0 && item.unexpected.length === 0 && item.colorMismatches.length === 0),
  results: report.results.map((item) => ({
    id: item.id,
    expectedCount: item.expectedCount,
    detectedCount: item.detectedCount,
    matched: item.matched,
    precision: item.matched / item.detectedCount,
    recall: item.matched / item.expectedCount,
    exactScene: item.missing.length === 0 && item.unexpected.length === 0 && item.colorMismatches.length === 0,
  })),
};
await writeFile(resolve(roundDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
