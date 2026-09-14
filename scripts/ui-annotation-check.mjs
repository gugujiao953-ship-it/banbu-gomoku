import { chromium } from "playwright";

// Regression gate for the 2026-09-08 annotation fixes:
//  V1 record：点已有标注 = 一步取消（不论文字/样式，任何已有标注都被移除；再点放置新标注）
//  V2 review(研读)：点棋谱原有标注 → 自动切编辑模式并删除该标注，保存后库内物理消失
//  V3 review(研读)：空点本机标注 → 「把本机标注写入棋谱」→ 保存后库内物理存在
// Three fresh profiles keep drafts/reviewMarks from bleeding across scenarios.
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-annotation-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });

let failed = 0;
const check = (name, condition, detail) => { console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!condition) failed += 1; };

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 392, height: 852 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const ui = {
    errors,
    toast: () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).slice(-1)[0] || ""),
    labels: () => page.evaluate(() => [...document.querySelectorAll(".board-label-text, .renlib-variation-label")].map((e) => e.textContent?.trim()).join(",") || "(none)"),
    clickPoint: async (name) => { await page.evaluate((pt) => { const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(pt)); cell?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, name); await page.waitForTimeout(450); },
    clickText: (text) => page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === t || e.getAttribute("aria-label") === t); if (b) { b.click(); return true; } return false; }, text),
    libMarks: (title) => page.evaluate((t) => {
      const lib = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
      const doc = lib.find((d) => d.metadata?.title === t);
      if (!doc) return "NO-DOC";
      const nodes = Object.values(doc.nodes).filter((n) => (n.marks || []).length);
      return nodes.length ? nodes.map((n) => n.marks.map((m) => `${m.row},${m.col}:${m.label || m.kind}`).join("+")).join(" ") : "no-marks";
    }, title),
    saveAs: async (title) => {
      await ui.clickText("保存棋谱"); await page.waitForTimeout(500);
      await page.evaluate((t) => { const i = document.querySelector(".save-sheet input"); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, t); i.dispatchEvent(new Event("input", { bubbles: true })); } }, title);
      await ui.clickText("确认保存"); await page.waitForTimeout(900);
    },
    openFromLibrary: async (title) => {
      await ui.clickText("棋谱库"); await page.waitForTimeout(600);
      await page.evaluate((t) => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes(t))?.click(); }, title);
      await page.waitForTimeout(1000);
    },
    pickContent: (value) => page.evaluate((v) => {
      const btn = [...document.querySelectorAll(".mark-studio-box")].find((b) => (b.textContent || "").startsWith("内容"));
      btn?.click();
      setTimeout(() => { const o = [...document.querySelectorAll(".mark-studio-options.values button")].find((e) => (e.textContent || "").trim() === v); o?.click(); }, 250);
    }, value),
  };
  return { page, context, ui };
}

// ===== V1 record：点已有标注一步取消 =====
{
  const { page, context, ui } = await newPage();
  await ui.clickPoint("H8"); await ui.clickPoint("I9");
  await ui.clickText("标注"); await page.waitForTimeout(400);
  await ui.clickPoint("H10");
  const placed = await ui.labels();
  await ui.pickContent("2"); await page.waitForTimeout(600);
  await ui.clickPoint("H10");
  const first = await ui.labels(); const firstToast = await ui.toast();
  await ui.clickPoint("H10");
  const second = await ui.labels();
  check("V1 放置标注", placed === "1", `labels=${placed}`);
  check("V1 点已有标注=一步移除（任意内容）", first === "(none)" && firstToast.includes("已移除标注"), `labels=${first} toast=${firstToast}`);
  check("V1 再点空位=放置新标注", second === "2", `labels=${second}`);
  check("V1 无页面错误", ui.errors.length === 0, ui.errors.slice(0, 2).join(";"));
  await context.close();
}

// ===== V2 review：点棋谱原有标注 → 切编辑+删除 → 保存落盘 =====
{
  const { page, context, ui } = await newPage();
  await ui.clickPoint("H8"); await ui.clickPoint("I9");
  await ui.clickText("标注"); await page.waitForTimeout(400);
  await ui.clickPoint("H10");
  await ui.clickText("标注"); // 收起标注面板
  await ui.saveAs("V2谱");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  await ui.openFromLibrary("V2谱");
  await ui.clickText("读谱"); await page.waitForTimeout(800);
  await ui.clickText("标注"); await page.waitForTimeout(400);
  await ui.clickPoint("H10");
  const toast2 = await ui.toast(); const labels2 = await ui.labels();
  check("V2 点原有标注：本机浮层不覆盖，直接删除并提示切编辑", labels2 === "(none)" && toast2.includes("已删除棋谱原有标注"), `labels=${labels2} toast=${toast2}`);
  await ui.saveAs("V2谱");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  const lib = await ui.libMarks("V2谱");
  check("V2 保存后库内物理无该标注", lib === "no-marks", `lib=${lib}`);
  check("V2 无页面错误", ui.errors.length === 0, ui.errors.slice(0, 2).join(";"));
  await context.close();
}

// ===== V3 review：本机标注一键写入棋谱 =====
{
  const { page, context, ui } = await newPage();
  await ui.clickPoint("H8"); await ui.clickPoint("I9");
  await ui.saveAs("V3谱");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  await ui.openFromLibrary("V3谱");
  await ui.clickText("读谱"); await page.waitForTimeout(800);
  await ui.clickText("标注"); await page.waitForTimeout(400);
  await ui.clickPoint("F5");
  check("V3 空点放本机标注", (await ui.labels()).includes("1"), `labels=${await ui.labels()}`);
  const hasCommit = await page.evaluate(() => { const b = document.querySelector(".mark-studio-commit"); if (b) { b.click(); return true; } return false; });
  await page.waitForTimeout(600);
  check("V3 「写入棋谱」按钮存在并合入草稿", hasCommit && (await ui.toast()).includes("已并入草稿"), `toast=${await ui.toast()}`);
  await ui.saveAs("V3谱");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  const lib = await ui.libMarks("V3谱");
  check("V3 保存后库内物理存在该标注", /:1$/.test(lib) || lib.includes(":1"), `lib=${lib}`);
  check("V3 无页面错误", ui.errors.length === 0, ui.errors.slice(0, 2).join(";"));
  await context.close();
}

// ===== V4 自定义文字清空时：点已有标注仍一步删除；放置新标注才要求文字（P2-1 回归） =====
{
  const { page, context, ui } = await newPage();
  await ui.clickPoint("H8"); await ui.clickPoint("I9");
  await ui.clickText("标注"); await page.waitForTimeout(400);
  await ui.clickPoint("H10");
  check("V4 放置默认标注", (await ui.labels()) === "1", `labels=${await ui.labels()}`);
  // 切到「自定义」类型并把输入框清空
  await page.evaluate(() => { const b = [...document.querySelectorAll(".mark-studio-box")].find((x) => (x.textContent || "").startsWith("类型")); b?.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll(".mark-studio-options.types button")].find((x) => (x.textContent || "").includes("自定义")); b?.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const i = document.querySelector('input[aria-label="自定义标注文字"]'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); } });
  await page.waitForTimeout(300);
  await ui.clickPoint("H10");
  const removed = await ui.labels(); const removeToast = await ui.toast();
  check("V4 空文字点已有标注=仍可删除", removed === "(none)" && removeToast.includes("已移除标注"), `labels=${removed} toast=${removeToast}`);
  await ui.clickPoint("F5");
  const placed = await ui.labels(); const placeToast = await ui.toast();
  check("V4 空文字点空位=提示输入文字且不放置", placed === "(none)" && placeToast.includes("输入自定义文字"), `labels=${placed} toast=${placeToast}`);
  check("V4 无页面错误", ui.errors.length === 0, ui.errors.slice(0, 2).join(";"));
  await context.close();
}

// ===== V5 变化点原生标注（DP/分页数据形态：子节点 boardText+renLibNativeLabel）=====
// 九天指南类数据库谱的原生标注渲染在变化点上——去标注与普通模式点击都必须能删除，
// 保存后库内物理消失（2026-09-11 用户「去标注依旧对原生标注无效」的常驻回归）。
{
  const context = await browser.newContext({ viewport: { width: 392, height: 852 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await context.addInitScript(() => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    const library = [{ id: "dp-1", rootId: "n0", metadata: { title: "V5原生标注谱", black: "甲", white: "乙", boardSize: 15 }, nodes: {
      n0: { id: "n0", parentId: null, children: ["br1"], move: null, comment: "", marks: [], boardText: "" },
      br1: { id: "br1", parentId: "n0", children: [], move: { row: 7, col: 9, player: "black" }, comment: "", marks: [], boardText: "冲四", renLibNativeLabel: true },
    }, updatedAt: new Date().toISOString() }];
    localStorage.setItem("renju-note-library-v1", JSON.stringify(library));
  });
  await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { [...document.querySelectorAll(".bottom-nav button")].find((b) => (b.textContent || "").includes("棋谱库"))?.click(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const el = [...document.querySelectorAll("article")].find((a) => (a.textContent || "").includes("V5原生标注谱")); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await page.waitForTimeout(1400);
  const v5labels = () => page.evaluate(() => [...document.querySelectorAll(".board-label-text, .renlib-variation-label")].map((e) => e.textContent?.trim()).filter((t) => t && t !== "1").join(",") || "(none)");
  const v5toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).slice(-1)[0] || "");
  // 变化点 J8 的命中格 aria-label 以「切换到变化」开头，需专用匹配
  const clickVar = async (name) => { const ok = await page.evaluate((pt) => { const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").includes(pt)); if (cell) { cell.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; } return false; }, name); await page.waitForTimeout(1100); return ok; };
  check("V5 棋盘显示原生变化标注", (await v5labels()) === "冲四", `labels=${await v5labels()}`);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").startsWith("标注")); b?.click(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("去标注") || (e.textContent || "").includes("去标注")); b?.click(); });
  await page.waitForTimeout(600);
  const cellFound = await clickVar("J8");
  check("V5 去标注擦变化点原生标注", cellFound && (await v5labels()) === "(none)" && (await v5toast()).includes("已擦除原生标注"), `cellFound=${cellFound} labels=${await v5labels()} toast=${await v5toast()}`);
  await ui0(page);
  const goneInLib = await page.evaluate(() => { const lib = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]"); return lib.some((doc) => doc.nodes.br1 && !doc.nodes.br1.boardText); });
  check("V5 保存后库内 boardText 已清空", goneInLib);
  check("V5 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));
  await context.close();
}
async function ui0(page) {
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("保存棋谱")); b?.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("确认保存")); b?.click(); });
  await page.waitForTimeout(1200);
}

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
