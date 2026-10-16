import { chromium } from "playwright";
const BASE = "http://127.0.0.1:5202/?qa=1";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim());
const waitP = async (w, ms=90000) => { const t=Date.now(); for(;;){ if(await primary()===w) return true; if(Date.now()-t>ms) return false; await page.waitForTimeout(150);} };
const txt=(s)=>page.evaluate(x=>document.querySelector(x)?.textContent?.replace(/\s+/g," ").trim()??null,s);
const clickSheet=(t)=>page.evaluate(x=>{const bar=document.querySelector(".vcfch-sheet-actions");Array.from(bar.querySelectorAll("button")).find(y=>y.textContent.trim()===x)?.click();},t);
await page.goto(BASE,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(2200);
await page.evaluate(()=>{localStorage.setItem("vcfch-state-v1",JSON.stringify({rating:1400,solvedIds:[],seenIds:[],solved:0,failed:0,streak:0,bestStreak:0,daily:{},history:[],settings:{pace:"default",genDeep:true}}));});
await page.reload({waitUntil:"domcontentloaded"}); await page.waitForTimeout(2000);
await page.evaluate(()=>{const n=document.querySelector('nav[aria-label="主导航"]');Array.from(n.querySelectorAll("button")).find(x=>(x.textContent||"").trim()==="对弈")?.click();}); await page.waitForTimeout(400);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click(); await page.locator(".vcfch-board").waitFor({timeout:30000}); await page.waitForTimeout(600);
// 出题档=深
await page.evaluate(()=>document.querySelector(".vcfch-top-actions button")?.click()); await page.waitForTimeout(350);
await page.evaluate(()=>{const rows=Array.from(document.querySelectorAll(".vcfch-sheet-row"));const r=rows.find(x=>(x.querySelector("span")?.textContent||"").includes("出题档"));Array.from(r.querySelectorAll("button")).find(y=>y.textContent.trim().startsWith("深"))?.click();});
await clickSheet("确定"); await page.waitForTimeout(350);
for (let i=0;i<3;i++){
  await page.evaluate(()=>document.querySelector(".vcfch-bottom .vcfch-primary").click()); const ok=await waitP("认输（判负）");
  const meta=await txt(".vcfch-meta"); const msg=await txt(".vcfch-message");
  const before=await page.evaluate(()=>Number(document.querySelector(".vcfch-rating-inline b")?.textContent));
  await page.evaluate(()=>document.querySelector(".vcfch-bottom .vcfch-primary").click()); await waitP("下一题",20000);
  const oc=await txt(".vcfch-outcome"); const after=await page.evaluate(()=>Number(document.querySelector(".vcfch-rating-inline b")?.textContent));
  console.log(`deep-draw ${i}: ok=${ok} ${meta} | ${msg} | ${before}->${after} ${oc}`);
}
await b.close();
