import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try {
const context=await browser.newContext({serviceWorkers:'block'});
await context.addInitScript(()=>{const Native=window.Worker; window.__genWorkers=[]; window.Worker=class extends Native { constructor(url,options){super(url,options);window.__genWorkers.push({url:String(url),t:performance.now()});} };});
const page=await context.newPage();
page.on('pageerror',e=>console.log('pageerror',e.message));
await page.goto('http://127.0.0.1:5176/',{waitUntil:'commit',timeout:15000});
await page.getByRole('button',{name:'先自己试试'}).click({timeout:15000});
await page.getByRole('button',{name:'对弈',exact:true}).click({timeout:5000});
await page.getByRole('button',{name:'打开棋题生成器'}).click({timeout:15000});
await page.getByLabel('目标手数',{exact:true}).fill('20',{timeout:15000});
await page.getByLabel('目标手数',{exact:true}).press('Tab');
await page.getByLabel('每题时间预算',{exact:true}).selectOption('30');
console.log('settings', (await page.locator('.generator-settings').innerText()).slice(-1000));
await page.screenshot({path:'qa/vcf-generator-route-settings.png',fullPage:true});
for (let i=0;i<2;i++) {
const t=Date.now(); await page.getByRole('button',{name:'生成新题',exact:true}).click();
await page.getByRole('button',{name:'生成新题',exact:true}).waitFor({state:'visible',timeout:35000});
console.log('GENERATED',i+1,Date.now()-t, await page.locator('.generator-inline-status').innerText());
}
await page.getByRole('button',{name:'调整设置',exact:true}).click();
await page.getByRole('checkbox',{name:/高质量路线/}).uncheck();
const t=Date.now(); await page.getByRole('button',{name:'生成新题',exact:true}).click();
await page.getByRole('button',{name:'生成新题',exact:true}).waitFor({state:'visible',timeout:35000});
console.log('FAST',Date.now()-t,await page.locator('.generator-inline-status').innerText());
console.log('WORKERS',await page.evaluate(()=>window.__genWorkers));
console.log('HISTORY',await page.evaluate(()=>JSON.parse(localStorage.getItem('banbu-puzzle-generator-history-v1')||'[]').map(b=>b.puzzles.map(p=>({depth:p.depth,valid:p.verification.valid,shortest:p.verification.shortest,provenance:p.provenance})))));
} finally { await browser.close(); }
