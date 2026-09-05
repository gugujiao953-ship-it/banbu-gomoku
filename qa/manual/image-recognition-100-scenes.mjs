import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5182/";
const artifactDir = resolve(process.env.IMAGE_RECOGNITION_ARTIFACT_DIR || "artifacts/image-recognition-100-scenes");
const concurrency = Math.max(1, Math.min(6, Number(process.env.IMAGE_RECOGNITION_WORKERS || 4)));
const boardSize = 15;
await mkdir(artifactDir, { recursive: true });

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

const randomFor = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const makeMoves = (caseIndex, count) => {
  const random = randomFor(0x51f15e + caseIndex * 7919);
  const cells = Array.from({ length: boardSize * boardSize }, (_, index) => [Math.floor(index / boardSize), index % boardSize]);
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [cells[index], cells[swapIndex]] = [cells[swapIndex], cells[index]];
  }
  return cells.slice(0, count);
};

const coordinateName = ([row, col]) => `${String.fromCharCode(65 + col)}${boardSize - row}`;

const makeCase = (index) => {
  const moveCount = 10 + ((index * 13) % 41);
  const moves = makeMoves(index, moveCount);
  return {
    index,
    id: String(index + 1).padStart(3, "0"),
    boardTheme: boardThemes[index % boardThemes.length],
    stoneTheme: stoneThemes[(index * 7) % stoneThemes.length],
    viewportWidth: viewportWidths[index % viewportWidths.length],
    moveCount,
    moves,
  };
};

const makeDocument = (testCase) => {
  const nodes = {
    root: { id: "root", parentId: null, children: [], move: null, comment: "", marks: [] },
  };
  let parentId = "root";
  testCase.moves.forEach(([row, col], moveIndex) => {
    const id = `m${moveIndex + 1}`;
    const player = moveIndex % 2 === 0 ? "black" : "white";
    nodes[id] = { id, parentId, children: [], move: { row, col, player }, comment: "", marks: [] };
    nodes[parentId].children.push(id);
    nodes[parentId].preferredChildId = id;
    parentId = id;
  });
  const occupied = new Set(testCase.moves.map(([row, col]) => `${row},${col}`));
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
    id: `recognition-100-${testCase.id}`,
    version: 1,
    rootId: "root",
    savedCurrentId: parentId,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    metadata: {
      title: `图片识谱百局测试 ${testCase.id}`,
      black: "黑方",
      white: "白方",
      event: "图片识谱100局矩阵",
      date: "2026-09-02",
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

const expectedPieces = (moves) => new Map(moves.map((move, index) => [coordinateName(move), index % 2 === 0 ? "black" : "white"]));

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

const requestedIds = new Set((process.env.IMAGE_RECOGNITION_CASES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => value.padStart(3, "0")));
const allCases = Array.from({ length: 100 }, (_, index) => {
  const testCase = makeCase(index);
  return {
    ...testCase,
    dark: darkBoards.has(testCase.boardTheme),
    showCoordinates: index % 3 !== 0,
  };
});
const cases = requestedIds.size ? allCases.filter((testCase) => requestedIds.has(testCase.id)) : allCases;
if (!cases.length) throw new Error("IMAGE_RECOGNITION_CASES 没有匹配到 001–100 的测试编号");

const browser = await chromium.launch({ headless: true });
const results = Array(cases.length);
const startedAt = Date.now();

const runCase = async (testCase) => {
  const document = makeDocument(testCase);
  const context = await browser.newContext({
    viewport: { width: testCase.viewportWidth, height: 844 },
    deviceScaleFactor: testCase.index % 4 === 0 ? 2 : 1,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.setDefaultTimeout(20_000);
  try {
    await page.addInitScript(seed, { document, testCase });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.locator(".renju-board").waitFor();
    await page.waitForTimeout(80);
    const sourcePath = resolve(artifactDir, `${testCase.id}-${testCase.boardTheme}-${testCase.stoneTheme}-${testCase.moveCount}.png`);
    await page.locator(".renju-board").screenshot({ path: sourcePath });
    const sourceSize = await page.locator(".renju-board").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }));

    await page.getByRole("button", { name: "打开导入方式" }).click();
    const importDialog = page.getByRole("dialog", { name: "选择导入方式" });
    await importDialog.getByRole("button", { name: "图片识谱" }).click();
    await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(sourcePath);
    let toast = "";
    try {
      await page.locator(".app-toast-message").waitFor({ timeout: 25_000 });
      toast = (await page.locator(".app-toast-message").textContent()) || "";
    } catch {
      errors.push("图片识谱没有产生提示");
    }
    await page.waitForTimeout(60);

    const expected = expectedPieces(testCase.moves);
    const rendered = await readRenderedPieces(page);
    const detected = new Map(rendered.map((piece) => [piece.coordinate, piece.player]));
    const missing = [...expected.keys()].filter((coordinate) => !detected.has(coordinate));
    const unexpected = [...detected.keys()].filter((coordinate) => !expected.has(coordinate));
    const colorMismatches = [...expected.entries()]
      .filter(([coordinate, player]) => detected.has(coordinate) && detected.get(coordinate) !== player)
      .map(([coordinate, expectedPlayer]) => ({ coordinate, expected: expectedPlayer, actual: detected.get(coordinate) }));
    const matched = [...expected.entries()].filter(([coordinate, player]) => detected.get(coordinate) === player).length;
    const passed = errors.length === 0
      && /路图片识谱完成/.test(toast)
      && missing.length === 0
      && unexpected.length === 0
      && colorMismatches.length === 0;
    const result = {
      id: testCase.id,
      boardTheme: testCase.boardTheme,
      stoneTheme: testCase.stoneTheme,
      moveCount: testCase.moveCount,
      viewportWidth: testCase.viewportWidth,
      deviceScaleFactor: testCase.index % 4 === 0 ? 2 : 1,
      showCoordinates: testCase.showCoordinates,
      sourcePath,
      sourceSize,
      expectedCount: expected.size,
      detectedCount: detected.size,
      matched,
      missing,
      unexpected,
      colorMismatches,
      toast,
      errors,
      passed,
    };
    console.log(`[${testCase.id}/100] ${passed ? "PASS" : "FAIL"} ${testCase.boardTheme}/${testCase.stoneTheme} ${testCase.moveCount}手`);
    return result;
  } catch (error) {
    errors.push(`runner: ${error instanceof Error ? error.message : String(error)}`);
    return {
      id: testCase.id,
      boardTheme: testCase.boardTheme,
      stoneTheme: testCase.stoneTheme,
      moveCount: testCase.moveCount,
      viewportWidth: testCase.viewportWidth,
      deviceScaleFactor: testCase.index % 4 === 0 ? 2 : 1,
      showCoordinates: testCase.showCoordinates,
      expectedCount: testCase.moves.length,
      detectedCount: 0,
      matched: 0,
      missing: testCase.moves.map(coordinateName),
      unexpected: [],
      colorMismatches: [],
      toast: "",
      errors,
      passed: false,
    };
  } finally {
    await context.close();
  }
};

try {
  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < cases.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await runCase(cases[index]);
    }
  });
  await Promise.all(workers);
} finally {
  await browser.close();
}

const passed = results.filter((item) => item.passed).length;
const totalExpected = results.reduce((sum, item) => sum + item.expectedCount, 0);
const totalMatched = results.reduce((sum, item) => sum + item.matched, 0);
const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  durationMs: Date.now() - startedAt,
  concurrency,
  total: results.length,
  passed,
  exactCaseAccuracy: passed / results.length,
  totalExpectedStones: totalExpected,
  totalMatchedStones: totalMatched,
  stoneAccuracy: totalExpected ? totalMatched / totalExpected : 0,
  moveCountRange: [Math.min(...cases.map((item) => item.moveCount)), Math.max(...cases.map((item) => item.moveCount))],
  uniqueThemePairs: new Set(cases.map((item) => `${item.boardTheme}/${item.stoneTheme}`)).size,
  results,
};
await writeFile(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({
  total: report.total,
  passed: report.passed,
  exactCaseAccuracy: report.exactCaseAccuracy,
  totalExpectedStones: report.totalExpectedStones,
  totalMatchedStones: report.totalMatchedStones,
  stoneAccuracy: report.stoneAccuracy,
  moveCountRange: report.moveCountRange,
  uniqueThemePairs: report.uniqueThemePairs,
  durationMs: report.durationMs,
  failures: results.filter((item) => !item.passed).map((item) => ({
    id: item.id,
    boardTheme: item.boardTheme,
    stoneTheme: item.stoneTheme,
    moveCount: item.moveCount,
    missing: item.missing,
    unexpected: item.unexpected,
    colorMismatches: item.colorMismatches,
    toast: item.toast,
    errors: item.errors,
  })),
}, null, 2));
if (passed < 90) process.exitCode = 1;
