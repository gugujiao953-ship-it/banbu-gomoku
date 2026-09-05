import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("http://127.0.0.1:4173/?qa=folders", { waitUntil: "domcontentloaded" });
  const welcome = page.getByRole("button", { name: "我知道了" });
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  await page.getByRole("button", { name: /棋谱库/ }).click();
  await page.getByRole("button", { name: /新建文件夹/ }).click();
  await page.getByLabel("文件夹名称").fill("研究");
  await page.getByRole("button", { name: "创建文件夹" }).click();
  await page.getByRole("button", { name: /在“研究”中新建子文件夹/ }).click();
  await page.getByLabel("上级文件夹").selectOption("研究");
  await page.getByLabel("文件夹名称").fill("实战");
  await page.getByRole("button", { name: "创建文件夹" }).click();
  await page.getByRole("button", { name: /在“研究\/实战”中新建子文件夹/ }).click();
  await page.getByLabel("上级文件夹").selectOption("研究/实战");
  await page.getByLabel("文件夹名称").fill("2026");
  await page.getByRole("button", { name: "创建文件夹" }).click();
  await page.getByRole("button", { name: "重命名文件夹“研究”" }).click();
  await page.getByLabel("新的名称").fill("开局研究");
  await page.getByRole("button", { name: "确认重命名" }).click();
  await page.getByRole("button", { name: "新建棋谱 从空棋盘开始" }).click();
  await page.getByRole("button", { name: "保存棋谱" }).click();
  await page.getByLabel("保存到分组").selectOption("开局研究/实战/2026");
  await page.getByRole("button", { name: "确认保存" }).click();
  await page.waitForFunction(() => {
    const folders = JSON.parse(localStorage.getItem("renju-note-library-folders-v1") || "{}");
    return folders.recordFolders?.includes("开局研究/实战/2026") && Object.values(folders.recordAssignments || {}).includes("开局研究/实战/2026");
  });
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("renju-note-library-folders-v1") || "{}"));
  if (errors.length) throw new Error(`网页错误：${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, folders: state.recordFolders }));
} finally { await browser.close(); }
