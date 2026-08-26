import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const file = process.argv[2];
if (!file) throw new Error("用法：node qa/renlib-display-blackbox.mjs 雨.lib");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(process.env.QA_BASE_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    localStorage.clear();
    if (!indexedDB.databases) return;
    const databases = await indexedDB.databases();
    await Promise.all(databases.map((database) => database.name ? new Promise((done) => {
      const request = indexedDB.deleteDatabase(database.name);
      request.onsuccess = request.onerror = request.onblocked = () => done();
    }) : Promise.resolve()));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForFunction(() => !document.querySelector(".import-progress"), null, { timeout: 600_000 });
  await page.waitForFunction(() => window.__banbuImportDiagnostic?.hasCompact === true, null, { timeout: 600_000 });
  await page.waitForFunction(() => {
    const findBranch = window.__banbuFindBranch;
    return typeof findBranch === "function" && findBranch().hasCompact;
  }, null, { timeout: 30_000 });
  const diagnostic = await page.evaluate(() => window.__banbuFindBranch?.());
  await page.locator(".renlib-variation").first().waitFor({ timeout: 30_000 });

  const display = await page.locator(".renlib-variation").evaluateAll((groups) => groups.map((group) => {
    const text = group.querySelector(".renlib-variation-label");
    const dot = group.querySelector(".renlib-variation-dot");
    return {
      ariaLabel: group.getAttribute("aria-label"),
      text: text?.textContent || "",
      hasDot: Boolean(dot),
      hasExplicitMark: Boolean(group.querySelector(".renlib-explicit-mark")),
      textFontSize: text ? getComputedStyle(text).fontSize : null,
      textFill: text ? getComputedStyle(text).fill : null,
      dotFill: dot ? getComputedStyle(dot).fill : null,
    };
  }));
  const styleMatrix = await page.evaluate(() => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.style.position = "fixed";
    svg.style.left = "-1000px";
    const samples = [
      ["black-dot", "white"],
      ["white-dot", "black"],
      ["blue-dot", "white"],
      ["neutral-dot", "black"],
    ];
    const result = samples.map(([displayKind, player]) => {
      const group = document.createElementNS(namespace, "g");
      group.setAttribute("class", `renlib-variation ${player} ${displayKind}`);
      const dot = document.createElementNS(namespace, "circle");
      dot.setAttribute("class", "renlib-variation-dot");
      group.append(dot);
      svg.append(group);
      return { displayKind, player, fill: "" };
    });
    document.body.append(svg);
    [...svg.querySelectorAll("circle")].forEach((dot, index) => { result[index].fill = getComputedStyle(dot).fill; });
    svg.remove();
    return result;
  });
  const textRows = display.filter((item) => item.text);
  const acceptance = {
    textHasNoDot: textRows.every((item) => !item.hasDot),
    textAtLeast20Px: textRows.every((item) => Number.parseFloat(item.textFontSize || "0") >= 20),
    blackDotUsesDisplayColor: styleMatrix.find((item) => item.displayKind === "black-dot")?.fill === "rgb(29, 28, 25)",
    whiteDotUsesDisplayColor: styleMatrix.find((item) => item.displayKind === "white-dot")?.fill === "rgb(250, 247, 239)",
    blueDotUsesDisplayColor: styleMatrix.find((item) => item.displayKind === "blue-dot")?.fill === "rgb(63, 120, 200)",
  };
  await mkdir(resolve("artifacts"), { recursive: true });
  const screenshot = resolve("artifacts", "renlib-display-rain-412x915.png");
  await page.screenshot({ path: screenshot, fullPage: false });
  console.log(JSON.stringify({ file, diagnostic, display, styleMatrix, acceptance, errors, screenshot }, null, 2));
  if (errors.length || Object.values(acceptance).some((passed) => !passed)) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
