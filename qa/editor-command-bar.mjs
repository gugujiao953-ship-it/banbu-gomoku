import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, acceptDownloads: true, serviceWorkers: "block" });
const page = await context.newPage();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    localStorage.clear();
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(databases.map((database) => database.name
        ? new Promise((resolve) => { const request = indexedDB.deleteDatabase(database.name); request.onsuccess = request.onerror = request.onblocked = resolve; })
        : Promise.resolve()));
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  assert(await page.getByRole("button", { name: "分析" }).count() === 0, "分析入口仍然存在");
  assert(await page.getByRole("button", { name: "更多" }).count() === 1, "更多入口缺失");
  await page.getByRole("button", { name: "更多" }).click();
  assert(await page.getByRole("button", { name: "查找", exact: true }).count() === 1, "更多面板中缺少查找入口");
  assert(await page.locator(".command-save").count() === 1, "常驻保存按钮缺失");
  assert(await page.getByRole("button", { name: "删除当前一步及后续变化" }).count() === 1, "常驻删除按钮缺失");

  await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
  await page.waitForTimeout(700);
  assert(await page.locator(".renju-board .move-number.black").count() === 1, "跟随模式没有从黑棋开始落子");
  assert(await page.getByRole("radio", { name: "白" }).getAttribute("aria-checked") === "true", "跟随模式落子后没有自动切换到白棋");
  assert((await page.locator(".topbar .brand small").innerText()).includes("未保存草稿"), "落子后未进入草稿状态");

  // “保存到题库”是复制当前局面，不能顺带清除源棋谱草稿。
  await page.getByRole("button", { name: "保存棋谱" }).click();
  await page.getByRole("tab", { name: "题库" }).click();
  await page.getByRole("button", { name: "确认保存" }).click();
  await page.waitForTimeout(300);
  assert((await page.locator(".topbar .brand small").innerText()).includes("未保存草稿"), "另存为题库错误清除了源棋谱草稿");

  await page.getByRole("radio", { name: "白" }).click();
  await page.locator(".command-save").click();
  await page.waitForTimeout(700);
  assert(await page.locator(".renju-board .stone").count() === 1, "保存后棋子消失");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  assert(await page.locator(".renju-board .move-number.black").count() === 1, "保存并刷新后首手棋丢失");

  await page.getByRole("radio", { name: "黑" }).click();
  assert(await page.locator(".lock-toggle").getAttribute("aria-pressed") === "true", "选择黑棋后没有进入锁定模式");
  await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
  await page.waitForTimeout(500);
  assert(await page.locator(".renju-board .stone").count() === 2, "第二步没有加入草稿");
  const blackCount = await page.locator(".renju-board .move-number.black").count();
  const whiteCount = await page.locator(".renju-board .move-number.white").count();
  const debug = await page.evaluate(() => ({
    switchMode: document.querySelector(".lock-toggle")?.getAttribute("aria-pressed"),
    selected: document.querySelector(".stone-color-switch button.selected")?.textContent?.trim(),
    draft: Object.keys(localStorage).filter((key) => key.includes("draft")).map((key) => JSON.parse(localStorage.getItem(key) || "{}").operations?.map((operation) => operation.node?.move?.player || operation.type)),
  }));
  assert(blackCount === 2, `锁定黑棋后没有连续落黑：black=${blackCount}, white=${whiteCount}, debug=${JSON.stringify(debug)}`);
  await page.getByRole("button", { name: "删除当前一步及后续变化" }).click();
  await page.waitForTimeout(300);
  assert(await page.locator(".renju-board .stone").count() === 1, "删除后没有回到父节点局面");
  await page.locator(".command-save").click();
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  assert(await page.locator(".renju-board .stone").count() === 1, "删除保存后刷新，已删变化重新出现");

  await page.getByRole("button", { name: "打开导出方式" }).click();
  await page.getByRole("button", { name: "选择格式导出" }).click();
  const exportStart = performance.now();
  const [sgfDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /SGF 标准棋谱/ }).click(),
  ]);
  const sgfMs = Math.round(performance.now() - exportStart);
  assert((await sgfDownload.suggestedFilename()).endsWith(".sgf"), "SGF 导出文件名错误");

  await page.getByRole("button", { name: "打开导出方式" }).click();
  if (await page.getByRole("button", { name: /JSON（半步完整棋谱）/ }).count() === 0) {
    await page.getByRole("button", { name: "选择格式导出" }).click();
  }
  const jsonStart = performance.now();
  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /JSON（半步完整棋谱）/ }).click(),
  ]);
  const jsonMs = Math.round(performance.now() - jsonStart);
  assert((await jsonDownload.suggestedFilename()).endsWith(".json"), "JSON 导出文件名错误");

  console.log(JSON.stringify({
    pass: true,
    mobileViewport: "375x812",
    whitePlacement: true,
    saveReload: true,
    deleteSubtreeSaveReload: true,
    exportMs: { sgf: sgfMs, json: jsonMs },
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
