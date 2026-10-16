import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo.html");
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport:{width:1920,height:1080}, deviceScaleFactor:1, locale:"zh-CN" });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror", e=>errs.push(e.message));
await page.goto(pathToFileURL(HTML).href, { waitUntil:"load", timeout:60000 });
await page.waitForFunction(()=>{const i=[...document.images];return i.length&&i.every(x=>x.complete);},null,{timeout:60000}).catch(()=>{});
await page.waitForFunction(()=>!!window.__promo,{timeout:30000});
const checks = [
  [2,  s1sub => /开源免费/.test(s1sub), "片头字幕含『开源免费』"],
  [17, null, "S4(第3手)"],
  [20, null, "S4(第4/5手)"],
  [23, null, "S4(第6手)"],
  [52, null, "S9 分支树"],
  [55, null, "S9 书签页"],
];
for (const [t] of checks) {
  const r = await page.evaluate((tt)=>{
    window.__promo.renderFrame(tt);
    const sub = document.getElementById("subText").textContent;
    const on = (id)=>{const e=document.getElementById(id); return e?e.classList.contains("on"):false;};
    return {
      sub,
      seg: ["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10"].find(on),
      p4: (document.getElementById("p4a")||{}).src?.split("/").slice(-2).join("/"),
      p9: (document.getElementById("p9a")||{}).src?.split("/").slice(-1)[0],
      mv: (document.getElementById("mvNum")||{}).textContent,
      an: (document.getElementById("annoNum")||{}).textContent,
      chip: document.querySelector(".ver-chip")?.textContent,
      cap4: (document.getElementById("cap4")||{}).textContent,
    };
  }, t);
  console.log(`t=${t}`, JSON.stringify(r));
}
console.log("pageerrors:", errs.length? errs : "none");
await ctx.close().catch(()=>{}); await browser.close().catch(()=>{}); process.exit(0);
