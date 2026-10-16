import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
const read = () => p.evaluate(() => {
  const i = document.querySelector(".ts-parts i");
  const cs = getComputedStyle(i);
  return { themeMotion: document.documentElement.dataset.themeMotion, name: cs.animationName, dur: cs.animationDuration };
});
console.log("开关开（默认）:", JSON.stringify(await read()));
await p.evaluate(() => { document.documentElement.dataset.themeMotion = "off"; });
await p.waitForTimeout(300);
console.log("开关关        :", JSON.stringify(await read()));
await p.evaluate(() => { document.documentElement.dataset.themeMotion = "on"; });
await p.waitForTimeout(300);
console.log("再打开        :", JSON.stringify(await read()));
await b.close();
