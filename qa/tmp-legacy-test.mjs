import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
const read = () => p.evaluate(() => {
  const sc = document.querySelector(".theme-scene");
  const far = document.querySelector(".ts-far");
  const parts = document.querySelector(".ts-parts");
  const bn = document.querySelector(".bottom-nav");
  return {
    legacy: document.documentElement.classList.contains("legacy-webview"),
    sceneDisplay: sc ? getComputedStyle(sc).display : "无",
    partsDisplay: parts ? getComputedStyle(parts).display : "无",
    sceneBg: far ? getComputedStyle(far).backgroundImage.slice(0, 30) : "无",
    navBg: bn ? getComputedStyle(bn).backgroundColor : "无",
  };
});
console.log("── 现状（现代内核，不加 legacy）:");
console.log("  " + JSON.stringify(await read()));
// 模拟老内核：手动加 legacy-webview 类
await p.evaluate(() => document.documentElement.classList.add("legacy-webview"));
await p.waitForTimeout(300);
console.log("── 加了 legacy-webview 类（模拟 K20 走的路径）:");
console.log("  " + JSON.stringify(await read()));
// 再模拟"同时是 reduce"
await p.emulateMedia({ reducedMotion: "reduce" });
await p.waitForTimeout(300);
console.log("── 再叠加 prefers-reduced-motion: reduce:");
console.log("  " + JSON.stringify(await read()));
await p.screenshot({ path: "qa/tmp-studio/legacy-sim.png" });
await b.close();
