import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();

try {
  await page.addInitScript(() => {
    globalThis.__banbuForceRenderError = true;
  });
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  const card = page.getByRole("alert");
  await card.getByRole("heading", { name: "半步五子棋打谱遇到异常" }).waitFor();
  if (!(await card.getByText("人为注入的渲染异常（ErrorBoundary 验收）", { exact: true }).isVisible())) {
    throw new Error("ErrorBoundary 未显示开发注入的异常内容");
  }

  const downloadPromise = page.waitForEvent("download");
  await card.getByRole("button", { name: "导出诊断信息" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("诊断导出没有返回文件流");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  if (!download.suggestedFilename().startsWith("半步五子棋打谱诊断-")) throw new Error("诊断文件名不符合约定");
  if (report.app !== "banbu-gomoku") throw new Error("诊断报告缺少应用标识");
  if (report.error?.message !== "人为注入的渲染异常（ErrorBoundary 验收）") throw new Error("诊断报告缺少异常信息");
  if (!Array.isArray(report.recentActions)) throw new Error("诊断报告缺少最近操作记录");
  if (report.url.includes("?") || report.url.includes("#")) throw new Error("诊断报告不应携带 URL 查询参数或锚点");

  console.log(JSON.stringify({
    passed: true,
    filename: download.suggestedFilename(),
    recentActions: report.recentActions.length,
    hasStack: Boolean(report.error?.stack),
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
