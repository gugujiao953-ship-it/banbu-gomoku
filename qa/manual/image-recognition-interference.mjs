import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5182/";
const artifactDir = resolve(process.env.IMAGE_RECOGNITION_ARTIFACT_DIR || "artifacts/image-recognition-interference");
await mkdir(artifactDir, { recursive: true });

const allCases = [
  {
    id: "01-banbu-ui",
    // WeChat temp originals were purged; identical copies live in the
    // gate-two-images artifact (byte-for-byte uploads from the first run).
    source: "D:/Projects/五子棋2/qa-artifacts/image-recognition-glm-2026-09-03/gate-two-images/original/01-banbu-ui.jpg",
    black: ["H11", "K10", "L9", "H8", "J8", "L8", "I7", "I6", "K6", "H5", "I4"],
    white: ["I10", "I9", "J9", "K9", "K8", "H7", "K7", "J6", "M6", "I5", "K5"],
  },
  {
    id: "02-ai-analysis-ui",
    source: "D:/Projects/五子棋2/qa-artifacts/image-recognition-glm-2026-09-03/gate-two-images/original/02-ai-analysis-ui.jpg",
    black: [
      "F12", "G12", "F11", "H11", "I11", "J11", "E10", "H10", "D9", "E9", "J9",
      "B8", "F8", "H8", "J8", "F7", "G7", "I7", "C6", "I6", "F5", "G5",
    ],
    white: [
      "H13", "G11", "L11", "D10", "G10", "I10", "J10", "F9", "G9", "H9", "I9",
      "C8", "D8", "E8", "G8", "I8", "D7", "H7", "F6", "H6", "G4", "H4",
    ],
  },
].map((item) => ({
  ...item,
  expected: new Map([
    ...item.black.map((coordinate) => [coordinate, "black"]),
    ...item.white.map((coordinate) => [coordinate, "white"]),
  ]),
}));
const requestedCases = new Set((process.env.IMAGE_RECOGNITION_INTERFERENCE_CASES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const cases = requestedCases.size
  ? allCases.filter((item) => requestedCases.has(item.id) || requestedCases.has(item.id.slice(0, 2)))
  : allCases;

const readRenderedPieces = async (page) => page.locator(".stone-piece").evaluateAll((pieces, size) => {
  const result = [];
  for (const piece of pieces) {
    const colored = piece.querySelector(".black, .white");
    const player = colored?.classList.contains("black") ? "black" : colored?.classList.contains("white") ? "white" : "";
    let x = Number.NaN;
    let y = Number.NaN;
    const circle = piece.querySelector("circle[cx][cy]");
    if (circle) {
      x = Number(circle.getAttribute("cx"));
      y = Number(circle.getAttribute("cy"));
    } else {
      const transformed = piece.querySelector("[transform^='translate(']");
      const match = transformed?.getAttribute("transform")?.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
      if (match) {
        x = Number(match[1]);
        y = Number(match[2]);
      }
    }
    if (!player || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const gap = 504 / (size - 1);
    const col = Math.round((x - 34) / gap);
    const row = Math.round((y - 34) / gap);
    if (row < 0 || col < 0 || row >= size || col >= size) continue;
    result.push({ coordinate: `${String.fromCharCode(65 + col)}${size - row}`, player });
  }
  return result;
}, 15);

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const item of cases) {
    const context = await browser.newContext({
      viewport: { width: 430, height: 900 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
      else if (message.text().startsWith("[banbu-image-grid]")
        || message.text().startsWith("[banbu-image-fits]")
        || message.text().startsWith("[banbu-image-phases]")
        || message.text().startsWith("[banbu-image-mesh]")
        || message.text().startsWith("[banbu-image-rejected]")
        || message.text().startsWith("[banbu-image-phase-window]")
        || message.text().startsWith("[banbu-image-phase-scores]")
        || message.text().startsWith("[banbu-image-selected]")) console.log(message.text());
    });
    page.setDefaultTimeout(45_000);
    try {
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("banbu-first-run-welcome-v1", "true");
        globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
      });
      await page.goto(baseURL, { waitUntil: "domcontentloaded" });
      await page.locator(".renju-board").waitFor();
      await page.getByRole("button", { name: "打开导入方式" }).click();
      const dialog = page.getByRole("dialog", { name: "选择导入方式" });
      await dialog.getByRole("button", { name: "图片识谱" }).click();
      await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(item.source);
      let toast = "";
      try {
        await page.locator(".app-toast-message").waitFor({ timeout: 45_000 });
        toast = (await page.locator(".app-toast-message").textContent()) || "";
      } catch {
        errors.push("图片识谱没有产生提示");
      }
      await page.waitForTimeout(200);
      const detected = new Map((await readRenderedPieces(page)).map((piece) => [piece.coordinate, piece.player]));
      const missing = [...item.expected.keys()].filter((coordinate) => !detected.has(coordinate));
      const unexpected = [...detected.keys()].filter((coordinate) => !item.expected.has(coordinate));
      const colorMismatches = [...item.expected.entries()]
        .filter(([coordinate, player]) => detected.has(coordinate) && detected.get(coordinate) !== player)
        .map(([coordinate, expected]) => ({ coordinate, expected, actual: detected.get(coordinate) }));
      const matched = [...item.expected.entries()].filter(([coordinate, player]) => detected.get(coordinate) === player).length;
      const recognizedPath = resolve(artifactDir, `${item.id}-recognized.png`);
      await page.locator(".renju-board").screenshot({ path: recognizedPath });
      results.push({
        id: item.id,
        source: item.source,
        expectedCount: item.expected.size,
        detectedCount: detected.size,
        matched,
        stoneAccuracy: matched / item.expected.size,
        missing,
        unexpected,
        colorMismatches,
        toast,
        errors,
        recognizedPath,
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const totalExpected = results.reduce((sum, item) => sum + item.expectedCount, 0);
const totalMatched = results.reduce((sum, item) => sum + item.matched, 0);
const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  total: results.length,
  totalExpected,
  totalMatched,
  stoneAccuracy: totalExpected ? totalMatched / totalExpected : 0,
  results,
};
await writeFile(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
