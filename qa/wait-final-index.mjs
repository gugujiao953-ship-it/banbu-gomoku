import { chromium } from "playwright";
const file=process.argv[2]; const base=process.env.QA_BASE_URL||"http://localhost:5173/";
const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:412,height:915},serviceWorkers:"block"});
const errors=[],tasks=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push(String(e)));
await page.exposeFunction('lt',e=>tasks.push({duration:e.duration,at:Date.now()})); await page.addInitScript(()=>new PerformanceObserver(l=>l.getEntries().forEach(e=>window.lt({duration:e.duration}))).observe({type:'longtask',buffered:true}));
await page.goto(base,{waitUntil:'domcontentloaded'}); await page.locator('input[type="file"]').first().setInputFiles(file); const started=Date.now();
const samples=[]; for(let i=0;i<18;i++){await page.waitForTimeout(10000); samples.push(await page.evaluate(()=>({elapsed:Date.now(),title:document.querySelector('.workspace-current b')?.textContent||'',status:document.querySelector('.workspace-status')?.textContent?.trim()||'',diag:window.__banbuImportDiagnostic||null,worker:window.__banbuWorkerMessage||null,state:window.__banbuImportState||null,storage:window.__banbuStorageDiagnostic||null,progress:Boolean(document.querySelector('.import-progress')),dom:document.querySelectorAll('*').length})));}
console.log(JSON.stringify({file,started,samples,tasks,errors},null,2)); await browser.close();
