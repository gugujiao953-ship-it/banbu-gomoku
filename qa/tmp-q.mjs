import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(900); break; } }
await p.evaluate(() => document.querySelector(".app-shell").style.setProperty("--action-opacity", "0.25"));
await p.waitForTimeout(300);
console.log(await p.evaluate(() => {
  const btn = document.querySelector(".record-command-bar > button");
  const cs = getComputedStyle(btn);
  return [
    "按钮 bg = " + cs.backgroundColor,
    "html 有 legacy-webview = " + document.documentElement.classList.contains("legacy-webview"),
    "html 有 data-native  = " + document.documentElement.hasAttribute("data-native"),
    "按钮 class = " + btn.className,
    "命中 .command-comment.has-comment = " + btn.matches(".command-comment.has-comment"),
    "命中 .command-comment.active = " + btn.matches(".command-comment.active"),
  ].join("\n");
}));
await b.close();
