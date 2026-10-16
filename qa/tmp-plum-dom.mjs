import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2500);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
console.log(await p.evaluate(() => {
  const out = [];
  out.push("html data-theme = " + document.documentElement.getAttribute("data-theme"));
  out.push(".theme-scene 存在 = " + !!document.querySelector(".theme-scene"));
  out.push(".ts-layer 数量 = " + document.querySelectorAll(".ts-layer").length);
  document.querySelectorAll(".ts-layer").forEach((e, i) => {
    const cs = getComputedStyle(e);
    out.push(`  [${i}] class="${e.className}" display=${cs.display} opacity=${cs.opacity} bg=${(cs.backgroundImage||"none").slice(0,50)} size=${cs.backgroundSize}`);
  });
  out.push(".ts-far 存在 = " + !!document.querySelector(".ts-far"));
  out.push(".ts-mid 存在 = " + !!document.querySelector(".ts-mid"));
  out.push(".ts-parts i 数量 = " + document.querySelectorAll(".ts-parts i").length);
  return out.join("\n");
}));
await b.close();
