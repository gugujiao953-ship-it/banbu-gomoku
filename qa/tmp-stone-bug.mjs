import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); break; } }
await p.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await p.waitForTimeout(1200);
await p.locator("text=外观与音效").first().click();
await p.waitForTimeout(800);
const btns = p.locator("button, summary, [role=button]");
const n = await btns.count();
for (let i = 0; i < n; i++) { const t = (await btns.nth(i).textContent() || "").replace(/\s+/g, ""); if (t.startsWith("棋盘与棋子")) { await btns.nth(i).click(); break; } }
await p.waitForTimeout(1000);
await p.locator(".appearance-pane-tabs > button").nth(1).click(); // 棋子版面
await p.waitForTimeout(900);

/** 读预览中心那枚棋子的填充色（解析后的实际像素色，最能反映"残留"） */
const readCenter = async () => p.evaluate(() => {
  const svg = document.querySelector("svg.material-crop");
  if (!svg) return "无预览";
  // 预览中心附近取像素：把 svg 序列化画到 canvas 采样
  const r = svg.getBoundingClientRect();
  return { viewBox: svg.getAttribute("viewBox"), defsKeys: [...svg.querySelectorAll("defs")].map(d => (d.innerHTML.match(/id="([^"]+)"/)||[])[1]).slice(0, 4) };
});

// 连续切换 4 个棋子材质，每次切换后**立刻**读预览里的 defs（不离开版面）
const cards = p.locator(".appearance-pane-body .visual-option-grid button");
const total = await cards.count();
console.log("棋子材质卡片数:", total);
for (const idx of [0, 2, 4, 6]) {
  if (idx >= total) break;
  const name = (await cards.nth(idx).textContent() || "").replace(/\s+/g, " ").trim().slice(0, 12);
  await cards.nth(idx).click();
  await p.waitForTimeout(650);
  const info = await readCenter();
  console.log(`切到「${name}」→ 预览 defs: ${JSON.stringify(info.defsKeys)}`);
}
await b.close();
