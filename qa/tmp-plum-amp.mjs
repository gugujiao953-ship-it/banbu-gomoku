import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2400);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(700); break; } }
// ① 原样
await p.screenshot({ path: "qa/tmp-studio/plum-a-orig.png" });
// ② 场景层不透明度拉满（排除"太淡"）
await p.evaluate(() => { const s = document.createElement("style"); s.id = "amp"; s.textContent = ".theme-scene{z-index:0!important}.ts-far,.ts-mid,.ts-near{opacity:1!important}"; document.head.appendChild(s); });
await p.waitForTimeout(400);
await p.screenshot({ path: "qa/tmp-studio/plum-b-amp.png" });
// ③ 把场景层从背后提到最前（排除"被盖住"）
await p.evaluate(() => { document.getElementById("amp").textContent = ".theme-scene{z-index:99!important;opacity:1!important}.ts-far,.ts-mid,.ts-near{opacity:1!important}"; });
await p.waitForTimeout(400);
await p.screenshot({ path: "qa/tmp-studio/plum-c-front.png" });
console.log("→ plum-a-orig / plum-b-amp / plum-c-front");
await b.close();
