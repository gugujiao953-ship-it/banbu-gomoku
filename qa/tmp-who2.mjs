import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
console.log(await p.evaluate(() => {
  const el = document.querySelector(".record-command-bar > button");
  const cs = getComputedStyle(el);
  const out = [
    `bg-color = ${cs.backgroundColor}`,
    `bg-image = ${cs.backgroundImage}`,
    `bg = ${cs.background}`,
    `--action-opacity 在 app-shell = ${getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--action-opacity")}`,
    `该元素自身 --action-opacity = 「${cs.getPropertyValue("--action-opacity")}」`,
    `--surface = ${cs.getPropertyValue("--surface")} ｜ --paper = ${cs.getPropertyValue("--paper")}`,
    `--action-surface 求值 = 「${cs.getPropertyValue("--action-surface")}」`,
  ];
  return out.join("\n");
}));
await b.close();
