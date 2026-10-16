import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless:true});
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4382/';
const context = await browser.newContext({viewport:{width:392,height:822},serviceWorkers:'block'});
await context.addInitScript(() => {
  localStorage.setItem('banbu-first-run-welcome-v1','true');
  localStorage.setItem('banbu-board-theme-v1','app-blackgold');
  localStorage.setItem('banbu-stone-theme-v1','app-blackgold');
  localStorage.setItem('banbu-theme-preference-v1','blackgold');
  localStorage.setItem('banbu-motion-enabled-v2','true');
  localStorage.setItem('banbu-enhancement-settings-v1',JSON.stringify({gestureZoom:true,coachMarks:false,analysisMaxMemoryMb:128,analysisAuto:false}));
  const NativeWorker = window.Worker;
  window.__mockAnalysis = {requests:[],frames:0,latest:null};
  class EngineWorker extends EventTarget {
    emit(data) { const event=new MessageEvent('message',{data});this.onmessage?.(event);this.dispatchEvent(event); }
    postMessage(data) {
      if(data.type==='warmup') queueMicrotask(()=>this.emit({type:'ready',variant:'fallback'}));
      if(data.type==='stop') {clearInterval(this.timer);return;}
      if(data.type!=='analyze')return;
      clearInterval(this.timer);this.data=data;
      window.__mockAnalysis.requests.push(data);window.__mockAnalysis.latest=this;
      let tick=0;
      this.timer=setInterval(()=>{
        tick++;window.__mockAnalysis.frames++;
        this.emit({type:'progress',requestId:data.requestId,generation:data.generation,variant:'fallback',depth:tick,nodes:tick*2000,speed:32000,winRate:0.5,candidates:[{move:{row:2+(tick%3),col:4,player:data.player},score:tick,winRate:0.51},{move:{row:5,col:8,player:data.player},score:tick-1,winRate:0.5}]});
      },60);
    }
    terminate(){clearInterval(this.timer);}
    fail(){clearInterval(this.timer);this.emit({type:'error',requestId:this.data.requestId,generation:this.data.generation,message:'QA synthetic Rapfi failure'});}
  }
  window.Worker = function(url,options) {return String(url).includes('rapfi-worker') ? new EngineWorker() : new NativeWorker(url,options);};
});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
  await page.goto(base+'?qa=1',{waitUntil:'domcontentloaded'});
  await page.locator('.board-material-surface').waitFor({timeout:30000});
  await page.getByRole('gridcell',{name:'H8空位',exact:true}).click();
  await page.locator('.stone-piece').waitFor();
  if(!await page.locator('.analysis-toggle input').count()) await page.locator('[data-action-id="analysis"]').click();
  await page.locator('.analysis-toggle').first().click();
  await page.waitForFunction(()=>window.__mockAnalysis.frames>5);
  await page.evaluate(()=>{
    const surface=document.querySelector('.board-material-surface');
    window.__surfaceAudit={surface,nodes:[...surface.querySelectorAll('*')],animations:surface.getAnimations({subtree:true}),style:surface.querySelector('style').firstChild,frames:window.__mockAnalysis.frames};
  });
  for(const coord of ['H9','I9','I8','J8']){
    await page.getByRole('gridcell',{name:coord+'空位',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.analysis-candidate-point').length>0);
  }
  await page.waitForFunction(()=>window.__mockAnalysis.frames>window.__surfaceAudit.frames+20);
  const state=await page.evaluate(()=>{
    const a=window.__surfaceAudit,s=document.querySelector('.board-material-surface'),b=document.querySelector('#board');
    const sr=s.getBoundingClientRect(),br=b.getBoundingClientRect();
    return {same:a.surface===s&&a.nodes.every(n=>s.contains(n)),styleSame:a.style===s.querySelector('style').firstChild,animationsSame:a.animations.every(x=>s.getAnimations({subtree:true}).includes(x)),animated:a.animations.length,isolated:!b.contains(s),rects:[sr.toJSON(),br.toJSON()],stones:b.querySelectorAll('.stone-piece').length,frames:window.__mockAnalysis.frames};
  });
  assert(state.same&&state.styleSame&&state.animationsSame,'Analysis/moves must preserve material DOM and animation objects');
  assert(state.isolated&&state.animated>0,'The animated surface must be outside the updating board SVG');
  assert.equal(state.stones,5);
  const aligned=async()=>page.evaluate(()=>{const a=document.querySelector('.board-material-surface').getBoundingClientRect(),b=document.querySelector('#board').getBoundingClientRect();return ['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<0.6)});
  assert(await aligned(),'background and hit grid must align');
  const before=await page.locator('#board').boundingBox();
  await page.locator('#board').hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0,-500);
  await page.keyboard.up('Control');
  await page.waitForFunction(w=>document.querySelector('#board').getBoundingClientRect().width>w+10,before.width);
  await page.waitForFunction(()=>!document.querySelector('.board-canvas').style.transform);
  assert(await aligned(),'zoom must scale both layers together');
  await page.getByRole('button',{name:'重置棋盘缩放',exact:true}).click();
  await page.setViewportSize({width:844,height:390});
  assert(await aligned(),'landscape must keep layers aligned');
  await page.setViewportSize({width:392,height:822});
  await page.evaluate(()=>window.__mockAnalysis.latest.fail());
  await page.waitForFunction(()=>document.querySelector('.app-toast')?.textContent.includes('rapfi 计算失败'));
  const toast=await page.locator('.app-toast').textContent();
  assert(!toast.includes('KataGo'),'Rapfi failure must not be reported as KataGo failure');
  const choice=await page.getByRole('button',{name:'切换引擎',exact:true}).textContent();
  assert(choice.includes('rapfi'),'Rapfi selection must be preserved');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',...state,failureToast:toast,zoomAndLandscape:'aligned'},null,2));
}finally{await browser.close();}
