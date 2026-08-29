import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.stack || String(error)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const library = () => page.evaluate(() => JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]"));

try {
  await page.goto(baseUrl, { waitUntil: "commit" });
  await page.getByText("半步五子棋", { exact: true }).waitFor();
  await page.evaluate(async () => {
    localStorage.clear();
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(databases.map((database) => database.name ? new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(database.name);
        request.onsuccess = request.onerror = request.onblocked = resolve;
      }) : Promise.resolve()));
    }
  });
  await page.reload({ waitUntil: "commit" });
  await page.getByText("半步五子棋", { exact: true }).waitFor();

  const collection = "(;GM[4]FF[4]SZ[15]GN[高级语义一]AB[hh][ii]AW[jj]PL[W];W[]C[白过手];AE[ii]PL[B];B[kk])(;GM[4]FF[4]SZ[15]GN[高级语义二];B[gg])";
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: "advanced-collection.sgf", mimeType: "application/x-go-sgf", buffer: Buffer.from(collection) });
  await page.waitForFunction(() => {
    const records = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
    return records.some((item) => item.metadata?.title === "高级语义一") && records.some((item) => item.metadata?.title === "高级语义二");
  });
  const firstImport = await library();
  const importedRecords = firstImport.filter((item) => item.metadata.title.startsWith("高级语义"));
  assert(importedRecords.length === 2, `SGF Collection 没有保存为两份棋谱：${importedRecords.length}`);
  assert(await page.locator(".renju-board .stone").count() === 3, "打开首盘根节点时没有显示 AB/AW 设置局面");

  await page.getByRole("button", { name: "下一手" }).click();
  assert((await page.locator(".workspace-current small").innerText()).includes("第 1 手"), "过手没有计入手数");
  assert(await page.locator(".renju-board .stone").count() === 3, "过手错误改变了棋盘");
  await page.getByRole("button", { name: "下一手" }).click();
  assert((await page.locator(".workspace-current small").innerText()).includes("第 1 手"), "设置局面节点错误增加手数");
  assert(await page.locator(".renju-board .stone").count() === 2, "AE 没有清除指定棋子");
  await page.getByRole("button", { name: "下一手" }).click();
  assert(await page.locator(".renju-board .stone").count() === 3, "设置局面后的落子没有显示");

  await page.getByRole("button", { name: "打开导出方式" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".export-primary-card.direct").click()]);
  const path = await download.path();
  const exported = path ? await readFile(path, "utf8") : "";
  assert(exported.includes("AB[hh][ii]AW[jj]PL[W]"), "SGF 导出丢失设置局面");
  assert(exported.includes("W[]"), "SGF 导出丢失过手");
  assert(exported.includes("AE[ii]PL[B]"), "SGF 导出丢失清子或行棋方");

  await input.setInputFiles({ name: "advanced-collection.sgf", mimeType: "application/x-go-sgf", buffer: Buffer.from(collection) });
  await page.waitForFunction(() => !document.querySelector(".import-progress"));
  const secondImport = await library();
  assert(secondImport.filter((item) => item.metadata.title.startsWith("高级语义")).length === 2, "重复导入集合时没有正确去重");
  assert(errors.length === 0, `浏览器运行错误：${errors.join("\n")}`);

  console.log(JSON.stringify({ pass: true, collectionDocuments: 2, setup: true, passMove: true, exportRoundTrip: true, duplicateImport: true }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
