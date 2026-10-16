import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

const browser=await chromium.launch({headless:true});
const base=process.env.QA_BASE_URL || 'http://127.0.0.1:4382/';
const qaURL=new URL(base);qaURL.searchParams.set('qa','1');
const results=[];
try {
  for (const native of [true,false]) {
    const viewport=native?{width:392,height:822}:{width:1100,height:850};
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('banbu-first-run-welcome-v1','true');
      localStorage.setItem('banbu-theme-preference-v1','blackgold');
      localStorage.setItem('banbu-board-theme-v1','app-blackgold');
      localStorage.setItem('banbu-stone-theme-v1','app-blackgold');
      localStorage.setItem('banbu-motion-enabled-v2','true');
      localStorage.setItem('banbu-enhancement-settings-v1',JSON.stringify({coachMarks:false,analysisAuto:false}));
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(qaURL.href,{waitUntil:'domcontentloaded',timeout:90000});
    if(process.env.QA_OVERLAY_CSS)await page.addStyleTag({path:process.env.QA_OVERLAY_CSS});
    await page.locator('.board-material-surface').waitFor({timeout:90000});
    console.log('overlay QA: page ready', {native});
    await page.evaluate(isNative=>{
      if(isNative)document.documentElement.dataset.native='true';
      else delete document.documentElement.dataset.native;
      const spacer=document.createElement('div');spacer.id='qa-page-spacer';spacer.style.height='1000px';
      document.querySelector('.app-shell').append(spacer);
      window.scrollTo(0,0);
      const surface=document.querySelector('.board-material-surface');
      window.__overlayRegression={surface,animations:surface.getAnimations({subtree:true}),bodyOverflow:getComputedStyle(document.body).overflow};
    },native);
    await page.waitForTimeout(100);
    const before=await page.evaluate(()=>({scrollY,top:document.querySelector('.topbar').getBoundingClientRect().top}));
    await page.locator('.unified-status-title').click();
    await page.locator('.sheet-backdrop').waitFor();
    // Wait for the actual entrance, not a wall-clock estimate: under load a
    // newly mounted web dialog may start its transform animation a frame later.
    await page.locator('.bottom-sheet').evaluate(async el=>{
      const animations=[...el.getAnimations(),...el.parentElement.getAnimations()];
      await Promise.all(animations.filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    });
    const opened=await page.evaluate(()=>{const scrim=document.querySelector('.sheet-backdrop');return{
      scrollY,top:document.querySelector('.topbar').getBoundingClientRect().top,
      rootOverflow:getComputedStyle(document.documentElement).overflowY,bodyOverflow:getComputedStyle(document.body).overflow,
      backdrop:getComputedStyle(scrim).backdropFilter,animation:getComputedStyle(scrim).animationName,
      scrimBackground:getComputedStyle(scrim).backgroundColor,
      scrimIsolation:getComputedStyle(scrim).isolation,
      scrimAnimation:getComputedStyle(scrim,'::before').animationName,
      scrimLayer:getComputedStyle(scrim,'::before').willChange,
      scrimPointerEvents:getComputedStyle(scrim,'::before').pointerEvents,
      toolbarLayer:getComputedStyle(document.querySelector('.topbar')).willChange,
      panelAnimation:getComputedStyle(document.querySelector('.bottom-sheet')).animationName,
      panelLayer:getComputedStyle(document.querySelector('.bottom-sheet')).willChange,
      panelTransform:getComputedStyle(document.querySelector('.bottom-sheet')).transform,
    }});
    assert.equal(opened.scrollY,before.scrollY);
    assert.equal(opened.top,before.top);
    assert.equal(opened.rootOverflow,'hidden');
    assert.equal(opened.bodyOverflow,await page.evaluate(()=>window.__overlayRegression.bodyOverflow));
    assert.equal(opened.backdrop,native?'none':'blur(5px)');
    assert.equal(opened.animation,native?'none':'overlay-scrim-in');
    if(native){
      assert.equal(opened.panelAnimation,'native-overlay-panel-in');assert.equal(opened.panelLayer,'opacity');assert.equal(opened.panelTransform,'none');
      assert.equal(opened.scrimBackground,'rgba(0, 0, 0, 0)');assert.equal(opened.scrimIsolation,'isolate');
      assert.equal(opened.scrimAnimation,'native-overlay-scrim-in');assert.equal(opened.scrimLayer,'opacity');
      assert.equal(opened.scrimPointerEvents,'none');assert.equal(opened.toolbarLayer,'opacity');
    }
    const fixedPosition=await page.evaluate(()=>{const child=document.createElement('div');child.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none';document.querySelector('.bottom-sheet').append(child);const r=child.getBoundingClientRect();child.remove();return{x:r.x,y:r.y}});
    assert.deepEqual(fixedPosition,{x:0,y:0},'nested fixed dialogs stay positioned relative to viewport');
    await page.mouse.move(2,90);await page.mouse.wheel(0,320);await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>scrollY),before.scrollY,'background stays locked');
    await page.evaluate(()=>{const el=document.createElement('div');el.style.cssText='height:1000px;flex-shrink:0';document.querySelector('.record-selector-list').append(el)});
    await page.locator('.record-selector-list').hover();await page.mouse.wheel(0,280);await page.waitForTimeout(200);
    assert.ok(await page.locator('.record-selector-list').evaluate(el=>el.scrollTop)>0,'dialog list remains scrollable');
    await page.keyboard.press('Escape');await page.locator('.sheet-backdrop').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
    assert.equal(await page.evaluate(()=>scrollY),before.scrollY);
    await page.locator('.unified-status-title').click();
    await page.locator('.sheet-backdrop').waitFor();
    await page.locator('.sheet-head h2').click();
    assert.equal(await page.locator('.sheet-backdrop').count(),1,'panel clicks do not close the sheet');
    const panelBox=await page.locator('.bottom-sheet').boundingBox();
    assert.ok(panelBox.y>2,'test requires a visible backdrop above the sheet');
    // Fresh browser profiles can show an achievement toast over the center
    // of the backdrop. Use an exposed corner and verify the actual hit target.
    assert.equal(await page.evaluate(()=>document.elementFromPoint(2,2)?.classList.contains('sheet-backdrop')),true);
    await page.mouse.click(2,2);
    await page.locator('.sheet-backdrop').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'','backdrop still dismisses and unlocks');
    console.log('overlay QA: sheet scroll passed', {native});
    await page.evaluate(()=>window.scrollTo(0,80));
    const drawerScroll=await page.evaluate(()=>scrollY);
    // Keep the deliberately scrolled fixture in place; locator.click would
    // first scroll an offscreen opener into view and invalidate this assertion.
    await page.evaluate(()=>document.querySelector('[aria-label^="打开快捷中心"]').click());
    await page.locator('.quick-drawer-panel').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'hidden');
    console.log('overlay QA: drawer scroll', {before:drawerScroll,after:await page.evaluate(()=>scrollY)});
    await page.locator('.quick-drawer-head [aria-label="关闭快捷中心"]').click();
    await page.locator('.quick-drawer-panel').waitFor({state:'detached'});
    const stable=await page.evaluate(()=>{const a=window.__overlayRegression;return{
      sameSurface:a.surface===document.querySelector('.board-material-surface'),
      sameAnimations:a.animations.every(animation=>a.surface.getAnimations({subtree:true}).includes(animation)),
      rootOverflow:document.documentElement.style.overflow,scrollY,
    }});
    assert.ok(stable.sameSurface && stable.sameAnimations);assert.equal(stable.rootOverflow,'');
    assert.equal(stable.scrollY,drawerScroll,'drawer focus must not move the page');
    console.log('overlay QA: drawer passed', {native});
    await page.evaluate(()=>{document.getElementById('qa-page-spacer').remove();window.scrollTo(0,0)});
    if(native){
      const classes=['sheet-backdrop','first-run-backdrop','ai-float-backdrop','quick-drawer-scrim','clock-setup-overlay','duel-confirm-scrim','engine-switch-backdrop','wait-overlay','manual-lightbox','soul-buy-backdrop','board-fs'];
      await page.evaluate(classes=>{const host=document.createElement('div');host.id='qa-scrims';for(const name of classes){const el=document.createElement('div');el.className=name;host.append(el)}document.body.append(host)},classes);
      await page.evaluate(()=>{const host=document.getElementById('qa-scrims');for(const name of ['bottom-sheet','first-run-dialog','ai-float-panel','quick-drawer-panel','clock-setup-card','duel-confirm','engine-switch-dialog','panel-select-menu','library-sort-menu','mark-studio-popover','soul-buy-card','achievement-unlock']){const panel=document.createElement('section');panel.className=name;panel.dataset.qaOverlayPanel='true';(name==='bottom-sheet'?host.querySelector('.sheet-backdrop'):host).append(panel)}});
      const panelStyles=()=>page.evaluate(()=>Array.from(document.querySelectorAll('[data-qa-overlay-panel]'),el=>({cls:el.className,animation:getComputedStyle(el).animationName,layer:getComputedStyle(el).willChange,frames:el.getAnimations().flatMap(a=>a.effect.getKeyframes()).map(frame=>Object.keys(frame))})));
      const styles=()=>page.evaluate(()=>Array.from(document.querySelector('#qa-scrims').children).filter(el=>!el.dataset.qaOverlayPanel).map(el=>({cls:el.className,blur:getComputedStyle(el).backdropFilter,animation:getComputedStyle(el).animationName,scrimAnimation:getComputedStyle(el,'::before').animationName,scrimLayer:getComputedStyle(el,'::before').willChange,scrimColor:getComputedStyle(el,'::before').backgroundColor,scrimPointerEvents:getComputedStyle(el,'::before').pointerEvents,frames:el.getAnimations().flatMap(a=>a.effect.getKeyframes()).map(frame=>Object.keys(frame))})));
      const animated=await styles();
      for(const row of animated){
        assert.equal(row.blur,'none');assert.equal(row.animation,'none');
        assert.equal(row.scrimAnimation,'native-overlay-scrim-in');assert.equal(row.scrimLayer,'opacity');
        assert.notEqual(row.scrimColor,'rgba(0, 0, 0, 0)');assert.equal(row.scrimPointerEvents,'none');
        assert.ok(row.frames.every(keys=>!keys.includes('backgroundColor')&&!keys.includes('transform')));
      }
      for(const row of await panelStyles()){assert.equal(row.animation,'native-overlay-panel-in');assert.equal(row.layer,'opacity');assert.ok(row.frames.every(keys=>!keys.includes('transform')))}
      await page.evaluate(()=>document.documentElement.dataset.motion='off');
      assert.ok((await styles()).every(row=>row.animation==='none'&&row.scrimAnimation==='none'&&row.scrimLayer==='auto'));
      assert.ok((await panelStyles()).every(row=>row.animation==='none' && row.layer==='auto'));
      await page.evaluate(()=>delete document.documentElement.dataset.motion);
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.ok((await styles()).every(row=>row.animation==='none'&&row.scrimAnimation==='none'&&row.scrimLayer==='auto'));
      assert.ok((await panelStyles()).every(row=>row.animation==='none' && row.layer==='auto'));
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(()=>document.getElementById('qa-scrims').remove());
      console.log('overlay QA: native motion preferences passed');
      await page.locator('.bottom-nav button',{hasText:'对弈'}).first().click();
      await page.locator('button',{hasText:'开始对局'}).first().click();
      await page.locator('[data-ai-custom-opening="on"]').click();
      await page.locator('[role="dialog"] button',{hasText:'开始人机对战'}).click();
      await page.locator('[data-duel-setup-load-file]').click();
      await page.locator('.sheet-backdrop').waitFor();
      assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.sheet-backdrop')).backdropFilter),'none');
      assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'hidden');
      await page.locator('.sheet-backdrop [aria-label="关闭"]').click();
      await page.locator('.sheet-backdrop').waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
      assert.ok(await page.locator('[data-duel-setup-load-file]').isVisible());
      console.log('overlay QA: custom opening load dialog passed');
    }
    assert.deepEqual(errors,[]);
    results.push({native,viewport,cssOverride:process.env.QA_OVERLAY_CSS || null,opened,stable,errors});
    await context.close();
  }
  writeFileSync('artifacts/flicker-audit/native-overlay-check.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:true,results},null,2));
}finally{await browser.close()}
