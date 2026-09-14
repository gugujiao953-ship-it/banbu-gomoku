/* Machine-readable audit for every board theme.
 *
 * Visual taste needs human eyes, but everything that can be decided by numbers
 * is checked here: stone/board/base/label metrics, effective legibility after
 * the adaptive rim, and text overflow in the card grid.
 *
 * Usage: node audit-report.cjs            -> prints the table
 *        node audit-report.cjs --md out.md -> also writes markdown
 */
const { chromium } = require("playwright");
const fs = require("fs");

const mdPath = process.argv.includes("--md") ? process.argv[process.argv.indexOf("--md") + 1] : null;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1180 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.goto("http://localhost:8099/gallery.html", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3600);

  const rows = await page.evaluate(() => {
    const hex = (s) => {
      const m = /#([0-9a-f]{6})/i.exec(s || "");
      return m ? m[1] : null;
    };
    const lumOf = (h) => {
      const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const ratio = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    return [...document.querySelectorAll(".card")].map((card, i) => {
      const board = card.querySelector(".board");
      const cs = getComputedStyle(board);
      const cap = card.querySelector("figcaption");
      const note = card.querySelector("small");
      const stones = [...board.querySelectorAll(".stone")];
      const blackStone = stones.find((s) => /(^|\s)black(\s|$)/.test(s.className));
      const whiteStone = stones.find((s) => /(^|\s)white(\s|$)/.test(s.className));
      const stoneInfo = (el) => {
        if (!el) return null;
        const rim = /edge-black/.test(el.className) ? "glow暗底亮圈" : /edge-white/.test(el.className) ? "浅底暗圈" : "无";
        const inner = el.querySelector(".core");
        const innerShadow = inner ? getComputedStyle(inner).boxShadow : "";
        return { rim, hasHighlight: innerShadow.length > 4 };
      };
      // board palette straight from the inline custom properties (the data source)
      const v = (k) => cs.getPropertyValue("--" + k).trim();
      const b1 = hex(v("bd-1")), b2 = hex(v("bd-2"));
      const sb = hex(v("s-black")), sw = hex(v("s-white")), gl = hex(v("glow"));
      const base = b1 && b2 ? [0, 2, 4].map((k) => Math.round((parseInt(b1.slice(k, k + 2), 16) + parseInt(b2.slice(k, k + 2), 16)) / 2)) : null;
      const baseHex = base ? base.map((n) => n.toString(16).padStart(2, "0")).join("") : null;
      return {
        i: i + 1,
        name: card.querySelector("b")?.textContent,
        family: card.dataset.fam,
        boardCls: board.className.replace("board ", "").split(" ").filter((c) => c.startsWith("bd-"))[0] || "",
        stoneCls: (stones[0]?.className || "").split(" ").filter((c) => c.startsWith("st-"))[0] || "",
        motions: board.className.split(" ").filter((c) => c.startsWith("mo-")).length,
        baseHex, blackHex: sb, whiteHex: sw, glowHex: gl,
        blackRatio: baseHex && sb ? +ratio(sb, baseHex).toFixed(2) : null,
        whiteRatio: baseHex && sw ? +ratio(sw, baseHex).toFixed(2) : null,
        glowRatio: baseHex && gl ? +ratio(gl, baseHex).toFixed(2) : null,
        blackStone: stoneInfo(blackStone),
        whiteStone: stoneInfo(whiteStone),
        // layout hygiene
        noteOverflow: note ? note.scrollHeight > note.clientHeight + 1 : false,
        capOverflow: cap ? cap.scrollWidth > cap.clientWidth + 1 : false,
        cardW: Math.round(card.getBoundingClientRect().width),
        cardH: Math.round(card.getBoundingClientRect().height),
        boardW: Math.round(board.getBoundingClientRect().width),
      };
    });
  });

  const bad = (r) => {
    const list = [];
    if (r.noteOverflow) list.push("描述文字溢出");
    if (r.capOverflow) list.push("卡片文字横向溢出");
    if (r.blackRatio != null && r.blackRatio < 2.6 && r.blackStone?.rim === "无") list.push("黑子未加描边");
    if (r.whiteRatio != null && r.whiteRatio < 1.45 && r.whiteStone?.rim === "无") list.push("白子未加描边");
    if (r.blackRatio != null && r.blackRatio < 2.6 && r.glowRatio != null && r.glowRatio < 2.0) list.push("描边对比不足");
    if (r.motions === 0) list.push("无动效");
    if (!r.blackStone?.hasHighlight || !r.whiteStone?.hasHighlight) list.push("棋子缺高光");
    return list;
  };

  const lines = [];
  lines.push("| # | 主题 | 族 | 棋盘 | 棋子 | 动效数 | 底 | 黑子比 | 白子比 | 光比 | 黑子描边 | 白子描边 | 问题 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  let flagged = 0;
  rows.forEach((r) => {
    const issues = bad(r);
    if (issues.length) flagged += 1;
    lines.push(`| ${r.i} | ${r.name} | ${r.family} | ${r.boardCls} | ${r.stoneCls} | ${r.motions} | #${r.baseHex} | ${r.blackRatio} | ${r.whiteRatio} | ${r.glowRatio} | ${r.blackStone?.rim || "-"} | ${r.whiteStone?.rim || "-"} | ${issues.join("；") || "✓"} |`);
  });

  const families = [...new Set(rows.map((r) => r.family))];
  const widths = [...new Set(rows.map((r) => r.cardW))];
  const heights = [...new Set(rows.map((r) => r.cardH))];
  const summary = [
    `主题总数：${rows.length}`,
    `风格族：${families.length} 个 —— ${families.join(" / ")}`,
    `卡片尺寸：宽 ${widths.join("/")}px，高 ${heights.join("/")}px（栅格自动等高）`,
    `棋盘缩略图：${[...new Set(rows.map((r) => r.boardW))].join("/")}px`,
    `棋子材质分布：${[...new Set(rows.map((r) => r.stoneCls))].length} 种`,
    `棋盘材质分布：${[...new Set(rows.map((r) => r.boardCls))].length} 种`,
    `带问题主题：${flagged} / ${rows.length}`,
    `运行期错误：${errors.length ? errors.join(" | ") : "无"}`,
  ];

  console.log("== SUMMARY ==");
  summary.forEach((s) => console.log(s));
  console.log("\n== PROBLEM ROWS ==");
  const problemRows = rows.filter((r) => bad(r).length);
  if (!problemRows.length) console.log("none");
  problemRows.forEach((r) => console.log(`#${r.i} ${r.name}: ${bad(r).join("；")}`));
  console.log("\n== TABLE ==");
  console.log(lines.join("\n"));

  if (mdPath) {
    fs.writeFileSync(mdPath, [
      "# 棋盘主题审计表（自动生成）", "",
      ...summary.map((s) => "- " + s), "",
      "> 对比度为「棋子主色 vs 棋盘底」的 WCAG 对比度；低于 2.6（黑子）/ 1.45（白子）时由引擎自动补描边，「光比」是描边色与底的对比，需 ≥ 2.0 才看得见。", "",
      ...lines, "",
    ].join("\n"), "utf8");
    console.log("\nMD:", mdPath);
  }
  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
