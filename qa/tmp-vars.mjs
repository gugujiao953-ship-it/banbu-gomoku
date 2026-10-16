import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
await p.evaluate(() => document.querySelector(".app-shell").style.setProperty("--action-opacity", "0.3"));
await p.waitForTimeout(300);
console.log(await p.evaluate(() => {
  const btn = document.querySelector(".record-command-bar > button");
  const shell = document.querySelector(".app-shell");
  const out = [];
  const chain = [["app-shell", shell], ["按钮", btn]];
  for (const [name, el] of chain) {
    const cs = getComputedStyle(el);
    out.push(`${name}: --action-opacity=「${cs.getPropertyValue("--action-opacity")}」 --surface=「${cs.getPropertyValue("--surface")}」 --action-surface=「${cs.getPropertyValue("--action-surface")}」`);
  }
  out.push(`按钮 bg = ${getComputedStyle(btn).backgroundColor}`);
  // 手工算一遍 color-mix，看期望值
  out.push(`期望(30%) ≈ rgb(248,250,248) 用了 30% 不透明度 → color(srgb ... / 0.3)`);
  return out.join("\n");
}));
await b.close();
