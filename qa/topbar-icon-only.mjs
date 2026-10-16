import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(4200);
for (const t of ["先自己试试", "跳过"]) {
  await p.evaluate((l) => {
    const el = [...document.querySelectorAll("button,[role=button]")].find((e) => (e.textContent || "").trim() === l && e.getBoundingClientRect().width > 0);
    el?.click();
  }, t);
  await p.waitForTimeout(700);
}
const m = () => p.evaluate(() => {
  const t = document.querySelector(".topbar-mode-toggle");
  const bar = document.querySelector(".topbar");
  const btn = t.querySelector("button");
  const span = btn.querySelector("span");
  const svg = btn.querySelector("svg");
  return { 文字宽: Math.round(span.getBoundingClientRect().width), 文字maxW: getComputedStyle(span).maxWidth,
    按钮高: Math.round(btn.getBoundingClientRect().height), 图标: Math.round(svg.getBoundingClientRect().width),
    控件越出顶栏底: Math.round(t.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom),
    aria: btn.getAttribute("aria-label") };
});
console.log("默认（可用 68）:", JSON.stringify(await m()));
for (const inset of [24, 40, 47]) {
  await p.addStyleTag({ content: `.topbar{--topbar-usable:${68 - inset}px!important;padding-top:${inset}px!important}` });
  await p.waitForTimeout(350);
  console.log(`模拟 inset=${inset}（可用 ${68 - inset}）:`, JSON.stringify(await m()));
}
await b.close();
