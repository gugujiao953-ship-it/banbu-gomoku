import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const artifactDirectory = path.resolve("qa/artifacts");
const pngPath = path.join(artifactDirectory, "share-current-position.png");
const fallbackPngPath = path.join(artifactDirectory, "share-fallback-download.png");
const sheetPath = path.join(artifactDirectory, "share-export-sheet.png");

await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: "block" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}?share-qa=${Date.now()}`, { waitUntil: "domcontentloaded" });

  await page.locator('[role="gridcell"][aria-label^="H8"]').click();
  await page.locator('[role="gridcell"][aria-label^="I8"]').click();
  const openExportSheet = async () => {
    await page.getByRole("button", { name: "打开导出方式" }).click();
    await page.getByText("分享当前局面", { exact: true }).waitFor();
    await page.locator(".bottom-sheet").evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
  };
  await openExportSheet();
  await page.screenshot({ path: sheetPath, fullPage: true });

  const switches = page.locator(".board-share-options input");
  if (await switches.count() !== 4) throw new Error("分享图片选项数量不是 4");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存 PNG" }).click();
  const download = await downloadPromise;
  await download.saveAs(pngPath);

  const png = await readFile(pngPath);
  if (png.toString("hex", 1, 4) !== "504e47") throw new Error("下载结果不是 PNG");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 1200 || height !== 1400) throw new Error(`PNG 尺寸异常：${width}x${height}`);
  if (png.length < 30_000) throw new Error(`PNG 文件过小：${png.length} bytes`);

  await openExportSheet();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data) => data.files?.[0]?.type === "image/png" });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => {
      window.__boardShareProbe = { fileCount: data.files?.length || 0, type: data.files?.[0]?.type, title: data.title };
    } });
  });
  await page.getByRole("button", { name: "系统分享" }).click();
  await page.getByText("当前局面已交给系统分享").waitFor();
  const shareProbe = await page.evaluate(() => window.__boardShareProbe);
  if (shareProbe?.fileCount !== 1 || shareProbe?.type !== "image/png") throw new Error(`Web Share 文件参数异常：${JSON.stringify(shareProbe)}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await openExportSheet();
  const fallbackDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "系统分享" }).click();
  const fallbackDownload = await fallbackDownloadPromise;
  await fallbackDownload.saveAs(fallbackPngPath);
  await page.getByText("当前平台不支持文件分享，已自动下载 PNG").waitFor();
  if (pageErrors.length) throw new Error(`页面错误：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({ ok: true, width, height, bytes: png.length, suggestedFilename: download.suggestedFilename(), shareProbe, pngPath, fallbackPngPath, sheetPath }, null, 2));
} finally {
  await browser.close();
}
