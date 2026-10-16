import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3200);
for (const t of ["先自己试试", "我知道了"]) { const x = p.getByRole("button", { name: t }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(900); break; } }

/** 一键把功能区透明度设成 v（直接写 CSS 变量，等价于拖滑杆） */
const setOp = (v) => p.evaluate((val) => document.querySelector(".app-shell").style.setProperty("--action-opacity", String(val)), v);

const probe = () => p.evaluate(() => {
  const pick = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) return `${label}: 无`;
    const cs = getComputedStyle(el);
    return `${label}: ${cs.backgroundColor}`;
  };
  return [
    pick(".record-command-bar > button", "常驻区按钮"),
    pick(".moves-row > button.workspace-action", "手数行按钮"),
    pick(".dock-panel", "当前面板容器"),
    pick(".dock-panel > button", "面板内按钮"),
    pick(".bottom-nav", "底部导航"),
  ].join("\n");
});

await setOp(1); await p.waitForTimeout(250);
console.log("=== 100% ==="); console.log(await probe());
await setOp(0.35); await p.waitForTimeout(250);
console.log("=== 35% ==="); console.log(await probe());
await p.screenshot({ path: "qa/tmp-studio/op-35.png" });
await b.close();
