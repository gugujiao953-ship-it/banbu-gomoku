import { chromium } from "playwright";

// 常驻门禁：批量导出（用户 09-23 修：原实现只导前 20 份、其余静默丢弃）
//  B1 预置 25 份（>旧上限 20）并全选 → 产出**一个** ZIP，而不是 N 次单独下载
//  B2 ZIP 内份数 = 选中份数 + README，**没有任何静默截断**
//  B3 文件名按序号+标题，重名自动加后缀（同标题的两份不互相覆盖）
//  B4 README 写明份数与格式说明
// 用法：BANBU_URL=http://localhost:5311 node scripts/ui-batch-export-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5311/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: true });

// 预置 25 份棋谱（其中两份故意同名，用来验重名后缀）
const RECORD_COUNT = 25;
await context.addInitScript(({ count }) => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.removeItem("banbu-enhancement-settings-v1");
  const now = new Date().toISOString();
  const records = Array.from({ length: count }, (_, index) => {
    const rootId = `root-${index}`;
    // 第 2、3 份同名（"重名测试"），其余为"门禁棋谱 N"。
    const title = index === 1 || index === 2 ? "重名测试" : `门禁棋谱 ${index + 1}`;
    return {
      id: `gate-record-${index}`,
      version: 1,
      rootId,
      nodes: { [rootId]: { id: rootId, parentId: null, children: [], move: null, comment: "", marks: [] } },
      metadata: { title, black: "黑方", white: "白方", event: "", date: now.slice(0, 10), result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] },
      createdAt: now,
      updatedAt: now,
    };
  });
  localStorage.setItem("renju-note-library-v1", JSON.stringify(records));
}, { count: RECORD_COUNT });

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
const downloads = [];
page.on("download", (download) => downloads.push(download));
await page.goto(rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const clickText = async (text, selector = "button") => {
  await page.evaluate(([t, s]) => {
    [...document.querySelectorAll(s)].find((b) => (b.getAttribute("aria-label") || b.textContent || "").includes(t))?.click();
  }, [text, selector]);
  await page.waitForTimeout(500);
};

// ── 进棋谱库 → 批量处理 → 全选 ──────────────────────────
// 底部导航的「棋谱库」是 textContent 完全等于「棋谱库」的那个按钮（模式按钮"读谱"
// 也含相近字样，故用精确匹配）。
await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "棋谱库")?.click(); });
await page.waitForTimeout(1500);
const seeded = await page.evaluate(() => (JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]")).length);
// 应用还会把随包内置的人机大战棋谱合并进库，所以总数 > 我预置的 25 份；
// 断言"至少 25 份"即可，真正要验的是「导出份数 == 选中份数、零截断」。
check("前置：库里至少有 25 份棋谱（含随包内置谱）", seeded >= RECORD_COUNT, `seeded=${seeded}`);

const batchEntry = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent || "").includes("批量处理"));
  if (!button) return false;
  button.click();
  return true;
});
check("前置：进入批量处理", batchEntry);
await page.waitForTimeout(700);
await clickText("全选");
const selectedCount = await page.evaluate(() => {
  const bar = document.querySelector(".batch-selection-bar");
  const match = (bar?.textContent || "").match(/已选择\s*(\d+)\s*份/);
  return match ? Number(match[1]) : -1;
});
check("前置：已选中全部（超过旧上限 20）", selectedCount > 20, `selected=${selectedCount}`);

// ── 更多 → 批量导出 ─────────────────────────────────────
await clickText("更多");
await page.waitForTimeout(700);
const buttonCopy = await page.evaluate(() => {
  const button = [...document.querySelectorAll(".export-primary-card")].find((b) => (b.textContent || "").includes("批量导出"));
  return button ? (button.querySelector("small")?.textContent || "") : null;
});
check("B0 按钮如实说明打包份数（不再是含糊的『已选择 N 项』）", Boolean(buttonCopy) && buttonCopy.includes(String(selectedCount)) && buttonCopy.includes("ZIP"), String(buttonCopy));

await page.evaluate(() => {
  [...document.querySelectorAll(".export-primary-card")].find((b) => (b.textContent || "").includes("批量导出"))?.click();
});
await page.waitForTimeout(3500);

check("B1 只产出 1 个下载（ZIP 打包，不是 25 次单独下载）", downloads.length === 1, `downloads=${downloads.length}`);
if (downloads.length) {
  const name = downloads[0].suggestedFilename();
  check("B1 文件名是 ZIP 且带份数", /\.zip$/.test(name) && name.includes(String(selectedCount)), name);
  const path = await downloads[0].path();
  const { readFileSync } = await import("node:fs");
  const buffer = readFileSync(path);
  // 手写最小 ZIP 扫描：数 local file header 签名（PK）。不引 TS 源，
  // 免得依赖 node 下加载 .ts 的额外配置。
  let entries = 0;
  for (let i = 0; i + 3 < buffer.length; i += 1) {
    if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && buffer[i + 2] === 0x03 && buffer[i + 3] === 0x04) entries += 1;
  }
  // 关键断言：ZIP 条目数 == 选中份数 + README，即**没有任何静默截断**（旧实现只导 20 份）。
  check(`B2 ZIP 条目数 = 选中 ${selectedCount} 份 + README（零截断）`, entries === selectedCount + 1, `entries=${entries} 期望=${selectedCount + 1}`);
  const text = buffer.toString("latin1");
  check("B3 文件名按序号+标题命名（001- 起）", text.includes("001-"), `含 001- 前缀: ${text.includes("001-")}`);
  check("B3 同标题的两份自动加后缀，不互相覆盖", text.includes("(2)"), `含 (2) 后缀: ${text.includes("(2)")}`);
  check("B4 README 写明份数与格式说明", text.includes("README.txt") && text.includes(String(selectedCount)), `README: ${text.includes("README.txt")}`);
  check("B4 README 提到 FGF/REN/WZQ 与 SGF 同内容（免得用户以为缺格式）", text.includes("RENJS"), `含 RENJS 说明: ${text.includes("RENJS")}`);
}

check("B5 无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}`);
await browser.close();
process.exitCode = failed ? 1 : 0;
