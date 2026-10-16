import { launch, boot, settle, safeClick } from "./lib.mjs";
const { browser, context, page } = await launch();
try {
  await boot(page);
  // 设置 → 引擎区 → 找「下载」
  await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
  await settle(page, 800);
  const sec = page.locator("details.settings-collapsible").filter({ hasText: /引擎|AI/ }).first();
  if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
  await settle(page, 600);
  const btns = await sec.evaluate((el) =>
    [...el.querySelectorAll("button")].filter(b => b.offsetWidth > 0).map(b => (b.textContent || "").trim()).slice(0, 14));
  console.log("引擎区按钮:", JSON.stringify(btns));
  const dl = sec.getByRole("button").filter({ hasText: /下载/ }).first();
  if (await dl.isVisible().catch(() => false)) {
    console.log("下载按钮文案:", (await dl.textContent()).trim());
    await safeClick(dl);
    await settle(page, 1000);
    for (let i = 0; i < 20; i++) {
      const t = await sec.evaluate((el) => el.textContent.match(/[\d.]+%/)?.[0] || el.textContent.includes("已下载") ? "done?" : "wait");
      const dl2 = sec.getByRole("button").filter({ hasText: /下载|重试|完成/ }).first().textContent().catch(() => "");
      if (i % 3 === 0) console.log(`t+${i * 3}s`, t);
      await settle(page, 3000);
    }
  } else console.log("无下载按钮");
  const after = await sec.evaluate((el) => el.textContent.trim().replace(/\s+/g, " ").slice(0, 120));
  console.log("引擎区状态:", after);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}
