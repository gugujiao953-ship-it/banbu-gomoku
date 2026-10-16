import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await p.addInitScript(() => localStorage.setItem("banbu-theme-preference-v1", "plum"));
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.waitForTimeout(2200);
// 看谁真正在场景层之上
console.log(await p.evaluate(() => {
  const scene = document.querySelector(".theme-scene");
  const cs = getComputedStyle(scene);
  const shell = getComputedStyle(document.querySelector(".app-shell"));
  const main = document.querySelector(".app-main");
  const out = [
    `.theme-scene: z=${cs.zIndex} pos=${cs.position}`,
    `.app-shell: pos=${shell.position} z=${shell.zIndex} bg=${shell.backgroundColor} iso=${shell.isolation} opacity=${shell.opacity} filter=${shell.filter} transform=${shell.transform}`,
  ];
  if (main) { const cm = getComputedStyle(main); out.push(`.app-main: pos=${cm.position} z=${cm.zIndex} bg=${cm.backgroundColor}`); }
  // 是否同一个层叠上下文：
  out.push("壳是否建立层叠上下文 = " + [shell.position !== "static", shell.isolation !== "auto", shell.opacity !== "1", shell.transform !== "none", shell.filter !== "none", shell.zIndex !== "auto"].some(Boolean));
  // 命中 .app-shell 的规则，看谁设了 isolation/transform
  const hits = [];
  for (const ss of document.styleSheets) { let r; try { r = ss.cssRules; } catch { continue; }
    const w = (l) => { for (const x of l) { if (x.cssRules && !x.selectorText) { w(x.cssRules); continue; } if (!x.selectorText) continue;
      try { if (document.querySelector(".app-shell").matches(x.selectorText) && /isolation|transform|filter|opacity|z-index/.test(x.style.cssText||"")) hits.push(x.selectorText.slice(0,60)+" {"+(x.style.cssText||"").slice(0,70)+"}"); } catch {} } };
    w(r); }
  out.push("── 影响壳层叠的规则：", ...hits.map(h=>"   "+h));
  return out.join("\n");
}));
await b.close();
