import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
console.log(await p.evaluate(async () => {
  const m = await import("/src/appearance/render.ts");
  const stones = ["classic", "app-classic", "classic-1", "jade", "app-jade"];
  const boards = ["wood", "app-wood", "jade"];
  const out = [];
  for (const s of stones) out.push(`findStoneMaterial("${s}") → ${m.findStoneMaterial(s) ? "有 ✓" : "null ✗"}`);
  for (const bd of boards) out.push(`findBoardMaterial("${bd}") → ${m.findBoardMaterial(bd) ? "有 ✓" : "null ✗"}`);
  // 列出材质库里所有 stone 的 src
  try {
    const mod = await import("/src/appearance/materials/app-materials.ts");
    const arr = mod.materialStones?.() ?? [];
    out.push("材质库 stone 共 " + arr.length + " 个：" + arr.slice(0, 12).map(x => x.src).join(", "));
  } catch (e) { out.push("取材质库失败: " + e.message.slice(0, 80)); }
  return out.join("\n");
}));
await b.close();
