import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5182/";
const artifactDir = resolve(process.env.IMAGE_RECOGNITION_ARTIFACT_DIR || "artifacts/image-recognition-theme-matrix");
await mkdir(artifactDir, { recursive: true });

const cases = [
  { name: "01-木纹-经典", boardTheme: "wood", stoneTheme: "classic" },
  { name: "02-青花瓷-瓷玉", boardTheme: "porcelain", stoneTheme: "porcelain" },
  { name: "03-黑金-金钻", boardTheme: "blackgold", stoneTheme: "gold-diamond" },
  { name: "04-电路-钻石", boardTheme: "circuit", stoneTheme: "diamond" },
  { name: "05-可爱-可爱", boardTheme: "kawaii", stoneTheme: "kawaii" },
  { name: "06-极光-极光", boardTheme: "aurora", stoneTheme: "aurora" },
  { name: "07-浅灰-浅灰", boardTheme: "pale", stoneTheme: "pale" },
  { name: "08-笔记-笔记", boardTheme: "notebook", stoneTheme: "notebook" },
  { name: "09-胡桃-冰晶", boardTheme: "walnut", stoneTheme: "snow" },
  { name: "10-翡翠-终端", boardTheme: "emerald", stoneTheme: "terminal" },
];

const moveSets = [
  [[7, 7], [7, 8], [8, 7], [6, 8], [8, 8], [6, 7], [9, 6], [5, 9], [9, 8], [5, 7], [10, 7], [4, 10]],
  [[3, 3], [11, 11], [3, 11], [11, 3], [5, 6], [9, 8], [6, 5], [8, 9], [7, 7], [7, 6], [4, 8], [10, 6], [6, 10], [8, 4]],
  [[1, 13], [13, 1], [2, 11], [12, 3], [4, 9], [10, 5], [6, 7], [8, 7], [7, 6], [7, 8], [5, 5], [9, 9], [3, 7], [11, 7], [7, 3], [7, 11]],
  [[0, 0], [14, 14], [0, 14], [14, 0], [1, 7], [13, 7], [7, 1], [7, 13], [4, 4], [10, 10], [4, 10], [10, 4]],
  [[6, 6], [6, 7], [7, 6], [7, 7], [8, 8], [5, 8], [8, 5], [5, 6], [9, 7], [4, 9], [10, 5], [3, 10], [11, 4], [2, 12]],
  [[2, 7], [12, 7], [7, 2], [7, 12], [4, 6], [10, 8], [6, 4], [8, 10], [5, 5], [9, 9], [5, 9], [9, 5], [3, 8], [11, 6], [6, 11], [8, 3]],
  [[2, 2], [12, 12], [2, 12], [12, 2], [4, 7], [10, 7], [7, 4], [7, 10], [5, 6], [9, 8], [6, 5], [8, 9]],
  [[1, 5], [13, 9], [2, 8], [12, 6], [4, 4], [10, 10], [5, 9], [9, 5], [7, 7], [6, 7], [8, 7], [7, 6], [7, 8]],
  [[0, 7], [14, 7], [7, 0], [7, 14], [3, 5], [11, 9], [5, 3], [9, 11], [4, 8], [10, 6], [6, 4], [8, 10], [5, 7], [9, 7], [7, 5], [7, 9]],
  [[3, 6], [11, 8], [4, 5], [10, 9], [5, 4], [9, 10], [6, 3], [8, 11], [7, 7], [6, 8], [8, 6], [5, 9], [9, 5], [4, 10]],
];

const makeDocument = (index) => {
  const moves = moveSets[index];
  const nodes = {
    root: { id: "root", parentId: null, children: [], move: null, comment: "", marks: [] },
  };
  let parentId = "root";
  moves.forEach(([row, col], moveIndex) => {
    const id = `m${moveIndex + 1}`;
    const player = moveIndex % 2 === 0 ? "black" : "white";
    nodes[id] = { id, parentId, children: [], move: { row, col, player }, comment: "", marks: [] };
    nodes[parentId].children.push(id);
    nodes[parentId].preferredChildId = id;
    parentId = id;
  });
  nodes[parentId].marks = [
    { row: 1 + (index % 4), col: 1 + ((index * 3) % 5), kind: "circle", style: "circle", color: "#b94b3f" },
    { row: 12 - (index % 4), col: 10 - ((index * 2) % 5), kind: "label", style: "text", label: "A", color: "#2872b8" },
  ];
  return {
    id: `recognition-case-${index + 1}`,
    version: 1,
    rootId: "root",
    savedCurrentId: parentId,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    metadata: { title: `识谱测试棋局 ${index + 1}`, black: "黑方", white: "白方", event: "图片识谱矩阵", date: "2026-09-02", result: "", rule: "standard", openingRule: "free", boardSize: 15, tags: [] },
    nodes,
  };
};

const expectedCoordinates = (moves) => new Set(moves.map(([row, col]) => `${String.fromCharCode(65 + col)}${15 - row}`));
const seed = ({ document, item }) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-restore-last-position-v1", "true");
  globalThis.__BANBU_IMAGE_RECOGNITION_DEBUG__ = true;
  localStorage.setItem("renju-note-active-v1", JSON.stringify(document));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([document]));
  localStorage.setItem("banbu-board-theme-v1", item.boardTheme);
  localStorage.setItem("banbu-stone-theme-v1", item.stoneTheme);
  localStorage.setItem("banbu-theme-preference-v1", ["circuit", "aurora", "emerald"].includes(item.boardTheme) ? "dark" : "light");
  localStorage.setItem("renju-note-display-settings-v1", JSON.stringify({ showNumbers: false, showCoordinates: true, showForbidden: false }));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ tabletSplit: false, gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
};

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const document = makeDocument(index);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
      else if (message.text().startsWith("[banbu-image-")) console.log(`[${item.name}] ${message.text()}`);
    });
    page.setDefaultTimeout(15_000);
    await page.addInitScript(seed, { document, item });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.locator(".renju-board").waitFor();
    await page.waitForTimeout(80);
    const sourcePath = resolve(artifactDir, `${item.name}.png`);
    await page.locator(".renju-board").screenshot({ path: sourcePath });
    const sourceSize = await page.locator(".renju-board").evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));

    await page.getByRole("button", { name: "打开导入方式" }).click();
    const importDialog = page.getByRole("dialog", { name: "选择导入方式" });
    await importDialog.getByRole("button", { name: "图片识谱" }).click();
    await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(sourcePath);
    let toast = "";
    try {
      await page.locator(".app-toast-message").waitFor({ timeout: 20_000 });
      toast = (await page.locator(".app-toast-message").textContent()) || "";
    } catch {
      errors.push("图片识谱没有产生提示");
    }
    const detected = new Set(await page.locator('.board-hit').evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") || "").filter((label) => label.endsWith("已有棋子")).map((label) => label.replace(/已有棋子$/, ""))));
    const expected = expectedCoordinates(moveSets[index]);
    const missing = [...expected].filter((coordinate) => !detected.has(coordinate));
    const unexpected = [...detected].filter((coordinate) => !expected.has(coordinate));
    const passed = !errors.length && /路图片识谱完成/.test(toast) && missing.length === 0 && unexpected.length === 0;
    results.push({ ...item, sourcePath, sourceSize, expectedCount: expected.size, detectedCount: detected.size, missing, unexpected, toast, errors, passed });
    await context.close();
  }
} finally {
  await browser.close();
}

const passed = results.filter((item) => item.passed).length;
const report = { generatedAt: new Date().toISOString(), baseURL, total: results.length, passed, accuracy: passed / results.length, results };
await writeFile(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
if (passed < Math.ceil(results.length * 0.9)) process.exitCode = 1;
