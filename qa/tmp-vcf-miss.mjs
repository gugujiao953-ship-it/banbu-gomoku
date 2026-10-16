import { chromium } from "playwright";
const BASE = "http://127.0.0.1:5202/?qa=1";
const b = await chromium.launch({ headless: true });
async function run(R, attacker, n) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim());
  const waitP = async (w, ms=90000) => { const t=Date.now(); for(;;){ if(await primary()===w) return true; if(Date.now()-t>ms) return false; await page.waitForTimeout(150);} };
  const txt=(s)=>page.evaluate(x=>document.querySelector(x)?.textContent?.replace(/\s+/g," ").trim()??null,s);
  const clickSheet=(t)=>page.evaluate(x=>{const bar=document.querySelector(".vcfch-sheet-actions");Array.from(bar.querySelectorAll("button")).find(y=>y.textContent.trim()===x)?.click();},t);
  await page.goto(BASE,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(2000);
  await page.evaluate((r)=>{localStorage.setItem("vcfch-state-v1",JSON.stringify({rating:r,solvedIds:[],seenIds:[],solved:0,failed:0,streak:0,bestStreak:0,daily:{},history:[],settings:{pace:"default",genDeep:true}}));},R);
  await page.reload({waitUntil:"domcontentloaded"}); await page.waitForTimeout(2000);
  await page.evaluate(()=>{const nv=document.querySelector('nav[aria-label="主导航"]');Array.from(nv.querySelectorAll("button")).find(x=>(x.textContent||"").trim()==="对弈")?.click();}); await page.waitForTimeout(400);
  await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click(); await page.locator(".vcfch-board").waitFor({timeout:30000}); await page.waitForTimeout(600);
  const label = attacker==="white"?"白先":"黑先";
  await page.evaluate(()=>document.querySelector(".vcfch-top-actions button")?.click()); await page.waitForTimeout(350);
  await page.evaluate((l)=>{const rows=Array.from(document.querySelectorAll(".vcfch-sheet-row"));const r=rows.find(x=>(x.querySelector("span")?.textContent||"").includes("你执子"));Array.from(r.querySelectorAll("button")).find(y=>y.textContent.trim()===l)?.click();},label);
  await clickSheet("确定"); await page.waitForTimeout(350);
  const out=[];
  for (let i=0;i<n;i++){
    await page.evaluate(()=>document.querySelector(".vcfch-bottom .vcfch-primary").click());
    const ok=await waitP("认输（判负）",90000);
    if (!ok) { const m=await txt(".vcfch-message"); const p=await primary(); out.push({fail:true, p, m}); await page.evaluate(()=>{const bb=document.querySelector(".vcfch-bottom .vcfch-primary");bb&&bb.click();}); await page.waitForTimeout(400); await waitP("下一题",10000); continue; }
    out.push({meta:await txt(".vcfch-meta"), msg:await txt(".vcfch-message")});
    await page.evaluate(()=>document.querySelector(".vcfch-bottom .vcfch-primary").click()); await waitP("下一题",20000);
  }
  await ctx.close();
  return out;
}
for (const [R,atk] of [[4800,"white"]]) {
  const r = await run(R,atk,4);
  const fails = r.filter(x=>x.fail).length;
  console.log(`R=${R} ${atk}: ${6-fails}/6 出题成功`); r.forEach((x,i)=>console.log(`   ${i}: ${x.fail?("FAIL "+x.p+" | "+x.m):(x.meta+" | "+x.msg)}`));
}
await Promise.race([b.close(), new Promise((r)=>setTimeout(r,4000))]);
