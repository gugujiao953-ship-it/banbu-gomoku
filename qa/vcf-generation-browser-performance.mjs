import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try {
const context=await browser.newContext({serviceWorkers:'block'}); const page=await context.newPage();
await page.goto('http://127.0.0.1:5176/',{waitUntil:'commit',timeout:15000});
await page.getByRole('button',{name:'先自己试试'}).waitFor({state:'visible',timeout:20000});
const settings={engine:'vcf',kind:'ordinary',attacker:'black',rules:'renju',depth:20,count:1,expand:false,maxSize:30,shape:'custom',shapeComplexity:false,text:'国庆',textLayout:'horizontal',seconds:15,uniqueFirst:true,qualityRoute:true,moreObstacles:false,hardSearch:false};
const mask=['0001000','0011100','0111110','0011100','0001000'];
const points=mask.flatMap((row,r)=>[...row].flatMap((bit,col)=>bit==='1'?[{row:r,col}]:[]));
settings.customShape={id:'custom',label:'自定义菱形',mask,source:'custom-mask',parts:[{id:'outline',label:'整个轮廓',points}]};
const results=await page.evaluate(async (base)=>{
const w=new Worker('/src/features/puzzle-generator/generator.worker.ts?worker_file&type=module',{type:'module'});
const results=[];
try {
for(const [kind,qualityRoute,seed] of [['ordinary',true,7],['ordinary',true,19],['shape',true,7],['shape',true,19],['shape',false,7]]){
const started=performance.now(); const progress=[];
const result=await new Promise((resolve,reject)=>{
const timer=setTimeout(()=>reject(new Error('worker exceeded hard limit')),25000);
let p=null;
w.onmessage=({data})=>{if(data.type==='progress')progress.push(data);if(data.type==='puzzle')p=data.puzzle;if(data.type==='done'||data.type==='error'){clearTimeout(timer);resolve({kind,qualityRoute,seed,elapsedMs:Math.round(performance.now()-started),message:data,puzzle:p?{id:p.id,size:p.size,depth:p.depth,valid:p.verification?.valid,shortest:p.verification?.shortest,provenance:p.provenance}:null,progressCount:progress.length})}};
w.onerror=(e)=>{clearTimeout(timer);reject(new Error(e.message))};
w.postMessage({type:'generate',settings:{...base,kind,qualityRoute,expand:kind==='shape'},seed,exclude:[]});
});results.push(result);
}
} finally { w.terminate(); }
return results;
},settings);
console.log(JSON.stringify(results,null,2));
await writeFile('qa/vcf-generation-browser-performance-20261014.json',JSON.stringify({baseSettings:settings,results},null,2));
} finally { await browser.close(); }
