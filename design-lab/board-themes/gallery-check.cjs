/* Board gallery render check + screenshots.
 * Usage: node gallery-check.cjs [outPrefix] */
const { chromium } = require("playwright");
const fs = require("fs");

const OUT = process.argv[2] || "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/gallery";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1180 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGE-EXC: " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 200)); });
  await page.goto("http://localhost:8099/gallery.html", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3600); // let one-shot landing animations settle

  const report = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".card")];
    const items = cards.map((c) => {
      const board = c.querySelector(".board");
      const b = board.getBoundingClientRect();
      const layer = board.querySelector(".bd-layer");
      const stoneEls = [...board.querySelectorAll(".stone")];
      const cs = getComputedStyle(layer);
      const anims = [board, ...board.querySelectorAll("*")]
        .map((el) => getComputedStyle(el).animationName)
        .filter((n) => n && n !== "none");
      const stones = stoneEls.map((s) => ({
        cls: s.className,
        cssWidth: parseFloat(getComputedStyle(s).width) || 0,
        hasCore: !!s.querySelector(".core"),
        edge: /edge-black/.test(s.className) ? "black" : /edge-white/.test(s.className) ? "white" : null,
      }));
      return {
        name: c.querySelector("b")?.textContent,
        family: c.querySelector(".fam")?.textContent,
        boardCls: board.className.replace("board ", ""),
        boardSize: Math.round(b.width) + "x" + Math.round(b.height),
        stoneCount: stones.length,
        stoneCssWidth: [...new Set(stones.map((s) => Math.round(s.cssWidth)))],
        edgeBlack: stones.filter((s) => s.edge === "black").length,
        edgeWhite: stones.filter((s) => s.edge === "white").length,
        coreCount: stones.filter((s) => s.hasCore).length,
        animations: [...new Set(anims)],
      };
    });
    return {
      title: document.title,
      total: cards.length,
      counter: document.getElementById("counter")?.textContent,
      families: [...new Set(cards.map((c) => c.dataset.fam))],
      items,
    };
  });

  console.log("TOTAL:", report.total, "|", report.counter);
  console.log("FAMILIES:", report.families.join(" / "));
  const problems = [];
  let edgeBlack = 0, edgeWhite = 0;
  report.items.forEach((it) => {
    if (it.stoneCount < 4) problems.push(`${it.name}: 棋子太少 ${it.stoneCount}`);
    if (it.coreCount !== it.stoneCount) problems.push(`${it.name}: 有棋子缺 .core`);
    if (it.animations.length === 0) problems.push(`${it.name}: 无动效`);
    if (Math.min(...it.stoneCssWidth) < 14) problems.push(`${it.name}: 棋子过小 ${it.stoneCssWidth.join("/")}px`);
    edgeBlack += it.edgeBlack; edgeWhite += it.edgeWhite;
  });
  console.log("ADAPTIVE-EDGE:", "黑子描边", edgeBlack, "| 白子描边", edgeWhite);
  console.log("PROBLEMS:", problems.length ? problems.join("\n  ") : "none");
  console.log("ERRORS:", errors.length ? errors.join("\n  ") : "none");

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: OUT + "-full.png", fullPage: true });
  // grid shots: 3 sections of the page for detail review
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < 3; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round((h - 1180) * (i / 2)));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}-part${i + 1}.png` });
  }
  console.log("SHOTS:", OUT + "-full.png", OUT + "-part1..3.png");
  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
