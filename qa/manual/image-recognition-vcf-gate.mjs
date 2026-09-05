import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Full-viewport image-recognition gate over the puzzle bank's VCF problems
// (public/puzzles/kaibao/实战VCF_1052题.json, first 100 problems in file
// order — the app loads them through importKaibaoPuzzleJson with the same
// coordinate/color conventions). Every input is a complete viewport
// screenshot containing the app header, status bars, cards and buttons.
//
// Theme distribution per request: the app defaults (wood board + classic
// stones) are the largest group at 20 cases; the remaining 80 rotate through
// the same board/stone theme matrix as image-recognition-fullscreen-gate.
//
// Env:
//   QA_BASE_URL                        app base URL (default http://127.0.0.1:5182/)
//   IMAGE_RECOGNITION_ARTIFACT_DIR     output directory (required)
//   IMAGE_RECOGNITION_VCF_CASES        comma-separated case ids; default: all
//   IMAGE_RECOGNITION_VCF_COUNT        how many puzzles to take (default 100)

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5182/";
const artifactDir = resolve(process.env.IMAGE_RECOGNITION_ARTIFACT_DIR || "artifacts/image-recognition-vcf");
const puzzleFile = "D:/Projects/五子棋2/public/puzzles/kaibao/实战VCF_1052题.json";
const puzzleCount = Number(process.env.IMAGE_RECOGNITION_VCF_COUNT || 100);
const boardSize = 15;
await mkdir(artifactDir, { recursive: true });
for (const sub of ["original", "recognized", "comparisons", "logs"]) {
  await mkdir(resolve(artifactDir, sub), { recursive: true });
}

const sha256 = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex").toUpperCase();

const boardThemes = [
  "wood", "jade", "notebook", "emerald", "porcelain", "whitejade", "walnut",
  "frosted", "circuit", "minimal", "blackgold", "pale", "kawaii", "aurora",
];
const stoneThemes = [
  "classic", "jade", "yun", "ink", "mono", "notebook", "porcelain", "snow",
  "terminal", "gold-diamond", "gold", "diamond", "blackgold", "pale", "kawaii", "aurora",
];
const darkBoards = new Set(["emerald", "walnut", "circuit", "blackgold", "aurora"]);
const viewportWidths = [360, 375, 390, 412, 430];
// The app's out-of-box look (Board defaults and backup fallback).
const defaultBoardTheme = "wood";
const defaultStoneTheme = "classic";
const defaultThemeCases = 20;

// "H12,1" -> { row: 3, col: 7, player: "black" } — Renju coordinates count
// rows from the bottom (A1 bottom-left), matching parseCoordinate in game.ts.
const parseKaibaoEntry = (value) => {
  if (typeof value !== "string" || !value.includes(",")) return null;
  const [coord, color] = value.split(",");
  if (color !== "1" && color !== "2") return null;
  const columnLetter = coord[0];
  const rowNumber = Number(coord.slice(1));
  if (!/^[A-O]$/.test(columnLetter) || !Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > boardSize) return null;
  return {
    col: columnLetter.charCodeAt(0) - 65,
    row: boardSize - rowNumber,
    player: color === "1" ? "black" : "white",
  };
};

const buildCases = async () => {
  const raw = JSON.parse(await readFile(puzzleFile, "utf8"));
  if (!Array.isArray(raw)) throw new Error("题库 JSON 顶层需要题目数组");
  const cases = [];
  for (let entryIndex = 0; entryIndex < raw.length && cases.length < puzzleCount; entryIndex += 1) {
    const entry = raw[entryIndex];
    if (!Array.isArray(entry) || !entry.length) continue;
    const seen = new Set();
    const moves = [];
    for (const value of entry) {
      const move = parseKaibaoEntry(value);
      if (!move) continue;
      const key = `${move.row},${move.col}`;
      if (seen.has(key)) continue; // the app drops duplicate setup stones
      seen.add(key);
      moves.push(move);
    }
    if (moves.length < 2) continue;
    const index = cases.length;
    const useDefault = index < defaultThemeCases;
    cases.push({
      index,
      id: String(index + 1).padStart(3, "0"),
      sourceFile: `实战VCF_1052题.json#第${entryIndex + 1}题`,
      moves,
      moveCount: moves.length,
      boardTheme: useDefault ? defaultBoardTheme : boardThemes[index % boardThemes.length],
      stoneTheme: useDefault ? defaultStoneTheme : stoneThemes[(index * 7) % stoneThemes.length],
      viewportWidth: viewportWidths[index % viewportWidths.length],
      deviceScaleFactor: index % 3 === 0 ? 2 : 1,
      showCoordinates: index % 3 !== 0,
      dark: darkBoards.has(useDefault ? defaultBoardTheme : boardThemes[index % boardThemes.length]),
    });
  }
  if (cases.length < puzzleCount) throw new Error(`题库可解析题目不足：${cases.length}/${puzzleCount}`);
  return cases;
};

const cases = await buildCases();
const requestedIds = new Set((process.env.IMAGE_RECOGNITION_VCF_CASES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const selected = requestedIds.size
  ? cases.filter((item) => requestedIds.has(item.id))
  : cases;
if (!selected.length) throw new Error("IMAGE_RECOGNITION_VCF_CASES 没有匹配到任何用例");

const coordinateName = (move) => `${String.fromCharCode(65 + move.col)}${boardSize - move.row}`;

const makeDocument = (testCase) => {
  const nodes = {
    root: { id: "root", parentId: null, children: [], move: null, comment: "", marks: [] },
  };
  let parentId = "root";
  testCase.moves.forEach((move, moveIndex) => {
    const id = `m${moveIndex + 1}`;
    nodes[id] = { id, parentId, children: [], move: { row: move.row, col: move.col, player: move.player }, comment: "", marks: [] };
    nodes[parentId].children.push(id);
    nodes[parentId].preferredChildId = id;
    parentId = id;
  });
  const occupied = new Set(testCase.moves.map((move) => `${move.row},${move.col}`));
  const empty = [];
  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      if (!occupied.has(`${row},${col}`)) empty.push([row, col]);
    }
  }
  const markerA = empty[(testCase.index * 17) % empty.length];
  const markerB = empty[(testCase.index * 29 + 7) % empty.length];
  nodes[parentId].marks = [
    { row: markerA[0], col: markerA[1], kind: "circle", style: "circle", color: "#b94b3f" },
    { row: markerB[0], col: markerB[1], kind: "label", style: "text", label: "A", color: "#2872b8" },
  ];
  return {
    id: `recognition-vcf-${testCase.id}`,
    version: 1,
    rootId: "root",
    savedCurrentId: parentId,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    metadata: {
      title: `VCF 识谱门禁 ${testCase.id}`,
      black: "黑方",
      white: "白方",
      event: "题库 VCF 整屏截图门禁",
      date: "2026-09-03",
      result: "",
      rule: "standard",
      openingRule: "free",
      boardSize,
      tags: [],
    },
    nodes,
  };
};

const seed = ({ document, testCase }) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-restore-last-position-v1", "true");
  globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
  localStorage.setItem("renju-note-active-v1", JSON.stringify(document));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([document]));
  localStorage.setItem("banbu-board-theme-v1", testCase.boardTheme);
  localStorage.setItem("banbu-stone-theme-v1", testCase.stoneTheme);
  localStorage.setItem("banbu-theme-preference-v1", testCase.dark ? "dark" : "light");
  localStorage.setItem("renju-note-display-settings-v1", JSON.stringify({
    showNumbers: false,
    showCoordinates: testCase.showCoordinates,
    showForbidden: false,
  }));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({
    tabletSplit: false,
    gestureZoom: false,
    gestureSwipe: false,
    recentImports: false,
    aiBoardHints: false,
    coachMarks: false,
  }));
};

const expectedPieces = (moves) => {
  const map = new Map();
  for (const move of moves) {
    const coordinate = coordinateName(move);
    const existing = map.get(coordinate);
    if (existing) throw new Error(`真值坐标冲突: ${coordinate}`);
    map.set(coordinate, move.player);
  }
  return map;
};

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
}, boardSize);

// Comparison sheet: original viewport screenshot beside the re-rendered board,
// with markers for missing (red), unexpected (blue) and recolored (orange)
// intersections drawn on the board geometry (34px margin, 504px span).
const buildComparison = async (browser, testCase, result) => {
  const markers = [
    ...result.missing.map((coordinate) => ({ coordinate, color: "#d43a2f", label: "MISS" })),
    ...result.unexpected.map((coordinate) => ({ coordinate, color: "#2872b8", label: "EXTRA" })),
    ...result.colorMismatches.map((item) => ({ coordinate: item.coordinate, color: "#e08a1e", label: "COLOR" })),
  ];
  const original = await readFile(result.originalPath, "base64");
  const recognized = result.recognizedPath ? await readFile(result.recognizedPath, "base64") : null;
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  try {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin: 0; font: 13px/1.4 sans-serif; background: #202124; color: #eee; }
      .wrap { display: flex; gap: 8px; padding: 8px; align-items: flex-start; }
      .col { position: relative; }
      img { display: block; border: 1px solid #555; }
      .head { padding: 6px 10px; }
      .bad { color: #ff8a80; }
      .ok { color: #9be29b; }
    </style></head><body>
      <div class="head">case ${testCase.id} · ${testCase.boardTheme}/${testCase.stoneTheme} · ${testCase.moveCount}手 · ${testCase.viewportWidth}px dpr${testCase.deviceScaleFactor}
        · expected ${result.expectedCount} detected ${result.detectedCount} matched ${result.matched}
        · <span class="${result.exactScene ? "ok" : "bad"}">${result.exactScene ? "EXACT" : `miss=${result.missing.length} extra=${result.unexpected.length} color=${result.colorMismatches.length}`}</span></div>
      <div class="wrap">
        <div class="col"><img src="data:image/png;base64,${original}"></div>
        ${recognized ? `<div class="col"><canvas id="board" width="580" height="580"></canvas></div>` : ""}
      </div>
      ${recognized ? `<script>
        const img = new Image();
        img.onload = () => {
          const canvas = document.getElementById("board");
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, 580, 580);
          const gap = 504 / 14;
          const markers = ${JSON.stringify(markers)};
          for (const marker of markers) {
            const col = marker.coordinate.charCodeAt(0) - 65;
            const row = 15 - Number(marker.coordinate.slice(1));
            const x = 34 + col * gap * (580 / 572) + 3;
            const y = 34 + row * gap * (580 / 572) + 3;
            ctx.strokeStyle = marker.color;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(x, y, 18, 0, Math.PI * 2);
            ctx.stroke();
          }
        };
        img.src = "data:image/png;base64,${recognized}";
      <\/script>` : ""}
    </body></html>`, { waitUntil: "networkidle" });
    const frame = page.locator("body");
    const outPath = resolve(artifactDir, "comparisons", `${testCase.id}-compare.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    return outPath;
  } finally {
    await page.close();
  }
};

const sourceHash = await sha256(resolve(process.cwd(), "src/image-recognition.ts"));
const scriptHash = await sha256(resolve(process.cwd(), "qa/manual/image-recognition-vcf-gate.mjs"));
const browser = await chromium.launch({ headless: true });
const results = [];
const startedAt = Date.now();

const runCase = async (testCase) => {
  const document = makeDocument(testCase);
  const context = await browser.newContext({
    viewport: { width: testCase.viewportWidth, height: 844 },
    deviceScaleFactor: testCase.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
    else if (message.text().startsWith("[banbu-image-")) console.log(`[${testCase.id}] ${message.text()}`);
  });
  page.setDefaultTimeout(30_000);
  const result = {
    id: testCase.id,
    sourceFile: testCase.sourceFile,
    boardTheme: testCase.boardTheme,
    stoneTheme: testCase.stoneTheme,
    viewportWidth: testCase.viewportWidth,
    deviceScaleFactor: testCase.deviceScaleFactor,
    showCoordinates: testCase.showCoordinates,
    dark: testCase.dark,
    moveCount: testCase.moveCount,
  };
  try {
    await page.addInitScript(seed, { document, testCase });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.locator(".renju-board").waitFor();
    await page.waitForTimeout(120);
    // FULL-VIEWPORT screenshot: header, cards, toolbars and everything the
    // phone would really capture stay in the frame as interference.
    const originalPath = resolve(artifactDir, "original", `${testCase.id}.png`);
    await page.screenshot({ path: originalPath });
    result.originalPath = originalPath;
    result.originalSha256 = await sha256(originalPath);

    await page.getByRole("button", { name: "打开导入方式" }).click();
    const importDialog = page.getByRole("dialog", { name: "选择导入方式" });
    await importDialog.getByRole("button", { name: "图片识谱" }).click();
    const recognitionStarted = Date.now();
    await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(originalPath);
    let toast = "";
    try {
      await page.locator(".app-toast-message").waitFor({ timeout: 45_000 });
      toast = (await page.locator(".app-toast-message").textContent()) || "";
    } catch {
      errors.push("图片识谱没有产生提示");
    }
    result.recognitionMs = Date.now() - recognitionStarted;
    await page.waitForTimeout(120);
    const recognizedPath = resolve(artifactDir, "recognized", `${testCase.id}.png`);
    await page.locator(".renju-board").screenshot({ path: recognizedPath });
    result.recognizedPath = recognizedPath;

    const expected = expectedPieces(testCase.moves);
    const detected = new Map((await readRenderedPieces(page)).map((piece) => [piece.coordinate, piece.player]));
    const missing = [...expected.keys()].filter((coordinate) => !detected.has(coordinate));
    const unexpected = [...detected.keys()].filter((coordinate) => !expected.has(coordinate));
    const colorMismatches = [...expected.entries()]
      .filter(([coordinate, player]) => detected.has(coordinate) && detected.get(coordinate) !== player)
      .map(([coordinate, expectedPlayer]) => ({ coordinate, expected: expectedPlayer, actual: detected.get(coordinate) }));
    const matched = [...expected.entries()].filter(([coordinate, player]) => detected.get(coordinate) === player).length;
    const precision = detected.size ? matched / detected.size : 0;
    const recall = expected.size ? matched / expected.size : 0;
    result.expectedCount = expected.size;
    result.detectedCount = detected.size;
    result.matched = matched;
    result.missing = missing;
    result.unexpected = unexpected;
    result.colorMismatches = colorMismatches;
    result.precision = precision;
    result.recall = recall;
    result.stoneF1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    result.exactScene = missing.length === 0 && unexpected.length === 0 && colorMismatches.length === 0;
    result.toast = toast;
    result.errors = errors;
    result.comparisonPath = await buildComparison(browser, testCase, result);
    console.log(`[${testCase.id}] ${result.exactScene ? "EXACT" : "FAIL"} matched=${matched}/${expected.size} miss=${missing.length} extra=${unexpected.length} color=${colorMismatches.length} ${result.recognitionMs}ms`);
  } catch (error) {
    result.errors = [...errors, `runner: ${error instanceof Error ? error.message : String(error)}`];
    result.expectedCount = testCase.moves.length;
    result.detectedCount = 0;
    result.matched = 0;
    result.missing = testCase.moves.map(coordinateName);
    result.unexpected = [];
    result.colorMismatches = [];
    result.precision = 0;
    result.recall = 0;
    result.stoneF1 = 0;
    result.exactScene = false;
    console.log(`[${testCase.id}] RUNNER-FAIL ${result.errors[0]}`);
  } finally {
    await context.close();
  }
  return result;
};

try {
  for (const testCase of selected) {
    results.push(await runCase(testCase));
  }
} finally {
  await browser.close();
}

const totalExpected = results.reduce((sum, item) => sum + item.expectedCount, 0);
const totalDetected = results.reduce((sum, item) => sum + item.detectedCount, 0);
const totalMatched = results.reduce((sum, item) => sum + item.matched, 0);
const microPrecision = totalDetected ? totalMatched / totalDetected : 0;
const microRecall = totalExpected ? totalMatched / totalExpected : 0;
const microF1 = microPrecision + microRecall ? 2 * microPrecision * microRecall / (microPrecision + microRecall) : 0;
const exactScenes = results.filter((item) => item.exactScene).length;
const recognitionTimes = results.map((item) => item.recognitionMs || 0).filter((value) => value > 0);
const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  puzzleFile,
  puzzleCount,
  defaultThemeCases: results.filter((item) => item.boardTheme === defaultBoardTheme && item.stoneTheme === defaultStoneTheme).length,
  total: results.length,
  exactScenes,
  exactSceneRatio: results.length ? exactScenes / results.length : 0,
  totalExpected,
  totalDetected,
  totalMatched,
  microPrecision,
  microRecall,
  microStoneF1: microF1,
  recognitionMsMin: recognitionTimes.length ? Math.min(...recognitionTimes) : 0,
  recognitionMsMax: recognitionTimes.length ? Math.max(...recognitionTimes) : 0,
  sourceSha256: sourceHash,
  scriptSha256: scriptHash,
  browserVersion: browser.version(),
  results,
};
await writeFile(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(`VCF-GATE total=${results.length} exact=${exactScenes}/${results.length} F1=${microF1.toFixed(4)} (${totalMatched}/${totalExpected})`);
