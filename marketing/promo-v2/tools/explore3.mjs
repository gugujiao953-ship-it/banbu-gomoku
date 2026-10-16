import { launch, boot, settle, safeClick, resolveDraftModal } from "./lib.mjs";
const { browser, context, page } = await launch();
page.on("response", r => { if (r.status() >= 400) console.log("HTTP", r.status(), r.url().slice(0, 140)); });
await boot(page);
await settle(page, 1500);
// 打开棋谱库（可能触发引擎下载检查）再进打谱
await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
await settle(page, 800);
await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 }).catch(() => {});
await settle(page, 4000);
await context.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
