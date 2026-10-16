import { launch, boot, settle, safeClick } from "./lib.mjs";
const { browser, context, page } = await launch();
try {
  await boot(page);
  await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
  await settle(page, 800);
  const sec = page.locator("details.settings-collapsible").filter({ hasText: /引擎|AI/ }).first();
  if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
  await settle(page, 600);
  // 摸清「分析持续」控件真实形态：全文匹配「持续」
  const info = await sec.evaluate((el) => {
    const hits = [];
    const walk = (node, depth) => {
      if (depth > 4) return;
      for (const c of node.children) {
        const t = (c.textContent || "").trim().replace(/\s+/g, " ");
        if (t.includes("持续") && c.offsetWidth > 0) {
          const self = c.matches("select,button,input,summary,[class*=row],[class*=item]");
          if (self || (c.children.length <= 2)) {
            hits.push(`<${c.tagName.toLowerCase()}> aria=${c.getAttribute("aria-label") || "-"} text=${t.slice(0, 60)}`);
          }
        }
        walk(c, depth + 1);
      }
    };
    walk(el, 0);
    return hits.slice(0, 16).join("\n");
  });
  console.log("===== 含「持续」的元素 =====");
  console.log(info);
  // select 全量
  const selects = await sec.evaluate((el) => [...el.querySelectorAll("select")].map(s =>
    [...s.options].map(o => o.textContent.trim()).join(" | ")));
  console.log("===== select =====", selects.join("\n"));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}
