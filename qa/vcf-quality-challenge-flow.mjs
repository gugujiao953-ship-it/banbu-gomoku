import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const baseUrl=process.env.VCF_QA_URL||'http://127.0.0.1:5176/';
const browser=await chromium.launch({headless:true});
try {
const context=await browser.newContext({serviceWorkers:'block'});
await context.addInitScript(()=>{
 localStorage.setItem('banbu-puzzle-generator-settings-v2',JSON.stringify({qualityRoute:false}));
 localStorage.setItem('vcfch-state-v1',JSON.stringify({rating:5700,settings:{pace:'default',genDeep:true}}));
 const Native=window.Worker; window.__vcfWorkers=[];
 window.Worker=class extends Native {
  constructor(url,options){super(url,options);this.record={url:String(url),options,messages:[],results:[],terminated:false};window.__vcfWorkers.push(this.record);this.addEventListener('message',e=>{if(e.data?.type==='result')this.record.results.push({puzzles:e.data.puzzles?.map(p=>({depth:p.depth,novel:p.novel,uniqueFirst:p.uniqueFirst,attacker:p.attacker})),error:e.data.error})});}
  postMessage(data,...rest){if(data?.type==='generate')this.record.messages.push({type:data.type,count:data.count,depth:data.depth,qualityRoute:data.settings?.qualityRoute});return super.postMessage(data,...rest);}
  terminate(){this.record.terminated=true;return super.terminate();}
 };
});
const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(baseUrl,{waitUntil:'commit',timeout:15000});
await page.getByRole('button',{name:'先自己试试'}).click({timeout:30000});
await page.getByRole('button',{name:'对弈',exact:true}).click();
await page.getByRole('button',{name:'开始 VCF 挑战',exact:true}).click();
const t=Date.now(); await page.getByRole('button',{name:'开始挑战',exact:true}).click({timeout:20000});
await page.getByRole('button',{name:'认输（判负）',exact:true}).waitFor({state:'visible',timeout:75000});
const meta=await page.locator('.vcfch-meta').innerText(); const firstMs=Date.now()-t;
console.log('FIRST',firstMs,meta);
await page.getByRole('button',{name:'认输（判负）',exact:true}).click();
const next=page.locator('.vcfch-end-bottom').getByRole('button',{name:'下一题'});
console.log('end buttons',await page.getByRole('button').allTextContents());
await page.getByRole('button',{name:'下一题'}).last().click();
await page.getByRole('button',{name:'认输（判负）',exact:true}).waitFor({state:'visible',timeout:75000});
console.log('NEXT',await page.locator('.vcfch-meta').innerText());
const workers=await page.evaluate(()=>window.__vcfWorkers.filter(w=>w.messages.length));
console.log('WORKERS',JSON.stringify(workers)); console.log('ERRORS',errors);
if(workers.length!==2||workers.some(w=>w.messages[0].count!==1)||errors.length)throw new Error('Challenge browser regression');
await page.screenshot({path:'qa/vcf-quality-challenge-current.png',fullPage:true});
await writeFile('qa/vcf-quality-challenge-flow-20261014.json',JSON.stringify({baseUrl,firstMs,meta,workers,errors},null,2));
} finally { await browser.close(); }
