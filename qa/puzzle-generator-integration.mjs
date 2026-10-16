import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verify } from '../vcf-generator/lib/verify.mjs';
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5197/?qa=1';
const output = 'artifacts/puzzle-generator-integration'; await mkdir(output,{ recursive:true });
const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({ viewport:{ width:390,height:844 },isMobile:true,hasTouch:true,serviceWorkers:'block' });
// Fixed RNG input gives reproducible acceptance checks; the actual browser
// Worker still performs synthesis, exhaustive solving and independent checks.
await context.addInitScript(() => {
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(request, ...rest) {
    if (request?.type === 'generate') request = { ...request, seed: 7 };
    return post.call(this, request, ...rest);
  };
});
const page = await context.newPage(), errors = [], results=[];
page.on('pageerror',error=>errors.push(error.message));
// 生成结果不再自动入库：题库里只该有明确保存过的。
const stored = () => page.evaluate(()=>JSON.parse(localStorage.getItem('renju-note-puzzle-collections-v1')||'[]').flatMap(c=>c.puzzles).filter(p=>p.generated).map(p=>p.generated));
// 页面上这一批（未保存也在，来自本机历史）
const listed = () => page.locator('.generator-result-select select option').count();
const settings = async () => { const toggle=page.getByRole('button', { name:'调整设置',exact:true }); if(await toggle.isVisible())await toggle.click(); };
const generated = async () => { await page.getByRole('button',{name:'生成新题',exact:true}).waitFor({state:'visible',timeout:75000}); assert.match(await page.locator('.generator-status').textContent(),/已完成|本次生成/); };
// 「保存本批到题库」现在会先问保存到哪个文件夹
const saveBatch = async (folder) => {
  await page.getByRole('button',{name:/保存本批到题库|已保存到题库/}).click();
  const dialog = page.getByRole('dialog',{ name:'保存到题库文件夹' });
  await dialog.waitFor({ state:'visible' });
  if (folder) await dialog.getByLabel('新建题库文件夹名',{exact:true}).fill(folder);
  await dialog.getByRole('button',{name:/保存到「/}).click();
  await dialog.waitFor({ state:'hidden' });
};
// 答案游标按「看得见的落子」计数，停着（at:null）不占一步
const visibleSteps = solution => solution.filter(move => move.at !== null).length;
try {
  await page.goto(base,{ waitUntil:'domcontentloaded' }); await page.getByRole('button',{name:'对弈',exact:true}).click();
  await page.getByRole('button',{name:'打开棋题生成器'}).click();
  assert.equal(await page.getByRole('button',{name:'VCF 生成器',exact:true}).count(),0);
  await page.getByRole('button',{name:'生成新题',exact:true}).click(); await generated();
  assert.equal((await stored()).length, 0, '未点保存就不该出现在题库里');
  await saveBatch();
  const ordinary=(await stored()).at(-1); assert.equal(ordinary.size,15); assert.equal(ordinary.depth,8); assert.equal(verify(ordinary).valid,true);
  assert.equal(await page.locator('.generator-settings fieldset').isVisible(),false);
  results.push('ordinary: browser worker -> independent proof -> explicit save into the default folder, 15x15 / D8');
  // Play the complete answer through the app's move-validation Worker.
  await page.getByRole('button',{name:'开始做题',exact:true}).click();
  for(const move of ordinary.solution.filter(m=>m.player===1)) {
    const col=move.at%15,row=Math.floor(move.at/15);
    await page.getByLabel('落子坐标',{exact:true}).fill(String.fromCharCode(65+col)+(15-row));
    await page.getByRole('button',{name:/^落子 ·/}).click();
    await page.getByRole('button',{name:'重新做题',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('.generator-result-actions button')?.disabled);
  }
  assert.match(await page.locator('.generator-results > .generator-help').textContent(),/解题成功/); results.push('complete interactive challenge reaches actual five');
  await page.getByRole('button',{name:'查看答案',exact:true}).click();
  await page.getByLabel('答案进度',{exact:true}).fill(String(visibleSteps(ordinary.solution)));
  assert.match(await page.locator('.generator-replay p').textContent(),/连五获胜/);
  // 用户报的老 bug：退一步只把上一步盖掉、当前那一步的棋子没动。逐步退必须每步都少一颗子。
  const stoneCount = () => page.locator('[data-generator-stone]').count();
  await page.getByRole('button',{name:'回到做题',exact:true}).click();
  await page.getByRole('button',{name:'查看答案',exact:true}).click();
  await page.getByLabel('答案进度',{exact:true}).fill(String(visibleSteps(ordinary.solution)));
  const full = await stoneCount();
  for (let step = visibleSteps(ordinary.solution); step > 0; step -= 1) {
    const before = await stoneCount();
    await page.getByLabel('答案上一步',{exact:true}).click();
    const after = await stoneCount();
    assert.equal(after, before - 1, `第 ${step} 步退回后棋盘该少一颗子（${before}→${after}）`);
  }
  assert.equal(await stoneCount(), ordinary.stones.black.length + ordinary.stones.white.length, '退到题面只剩题面子');
  assert.ok(full > await stoneCount()); results.push('answer replay: every step back removes exactly one stone (no pass-sized dead steps)');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出当前题目'}).click()]);
  const exportPath=await download.path(); const exported=JSON.parse(await readFile(exportPath,'utf8'));
  assert.deepEqual(exported.puzzles[0].generated.proof,ordinary.proof); results.push('answer replay and full-certificate JSON export');
  // Reload exercises persisted collections and a fresh independent check.
  await page.reload({ waitUntil:'domcontentloaded' }); await page.getByRole('button',{name:'对弈',exact:true}).click(); await page.getByRole('button',{name:'打开棋题生成器'}).click();
  await page.getByRole('button',{name:'开始做题',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>{const button=document.querySelector('.generator-results .generator-primary');return button&&!button.disabled;});
  assert.match(await page.locator('.generator-status').textContent(),/独立验题通过/);
  assert.ok(await listed() >= 1, '重进页面要默认展示最后一次生成的那批'); results.push('saved proof survives reload, is reverified, and the last batch comes back from local history');
  await page.screenshot({path:`${output}/phone-ordinary.png`,fullPage:true});
  await settings(); await page.locator('.generator-kinds button',{hasText:'抓禁手'}).click(); await page.getByLabel('目标手数',{exact:true}).fill('5');
  assert.equal(await page.getByLabel('先手',{exact:true}).inputValue(),'white'); assert.equal(await page.getByLabel('先手',{exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'生成新题',exact:true}).click(); await generated();
  const beforeForbiddenSave = (await stored()).length; await saveBatch('节日特辑');
  const forbidden=(await stored()).at(-1); assert.equal(forbidden.ending,'forbidden'); assert.equal(verify(forbidden).valid,true);
  assert.ok((await stored()).length > beforeForbiddenSave);
  const folders = await page.evaluate(()=>JSON.parse(localStorage.getItem('renju-note-library-folders-v1')||'{}').puzzleFolders||[]);
  assert.ok(folders.includes('节日特辑'), '保存到新文件夹时要把文件夹建出来');
  const assignments = await page.evaluate(()=>JSON.parse(localStorage.getItem('renju-note-library-folders-v1')||'{}').puzzleAssignments||{});
  assert.equal(Object.values(assignments).filter(folder=>folder==='节日特辑').length, 1, '这批题该挂在选定的文件夹下');
  results.push('white forbidden-block generation, locked rules and saving into a chosen (auto-created) folder');
  await page.getByRole('button',{name:'查看答案',exact:true}).click();
  const passIndex = forbidden.solution.findIndex(move=>move.note==='pass');
  // 停着的说明挂在它后面那一步上，所以要退到"跨过停着的那一步"才看得到
  const stepsToPass = forbidden.solution.slice(0, passIndex + 2).filter(move=>move.at!==null).length;
  await page.getByLabel('答案进度',{exact:true}).fill(String(stepsToPass));
  assert.match(await page.locator('.generator-replay p').textContent(),/禁手/); results.push('the skipped forbidden defence is still explained at the step that follows it');
  await settings(); await page.locator('.generator-kinds button',{hasText:'图案题'}).click(); await page.getByLabel('目标手数',{exact:true}).fill('8');
  await page.getByRole('button',{name:'完成编辑'}).click();
  await page.getByLabel('参与更多步骤',{exact:false}).check();
  await page.getByRole('button',{name:'生成新题',exact:true}).click(); await generated();
  await saveBatch();
  const shape=(await stored()).at(-1); assert.equal(shape.theme.kind,'shape'); assert.equal(shape.theme.complexity.mode,'multi-step'); assert.equal(verify(shape).valid,true);
  results.push('multi-step fish, independent part deletion gates and full theme persistence');
  await page.getByRole('button',{name:'查看答案',exact:true}).click(); await page.getByLabel('提示参与棋子',{exact:true}).check();
  await page.getByLabel('答案进度',{exact:true}).fill('1'); await page.screenshot({path:`${output}/phone-shape.png`,fullPage:true});
  await settings(); await page.locator('.generator-kinds button',{hasText:'文字题'}).click(); await page.getByLabel('题目文字',{exact:true}).fill('中秋'); await page.getByLabel('目标手数',{exact:true}).fill('12');
  await page.getByLabel('每题时间预算',{exact:true}).selectOption('30');
  await page.getByRole('button',{name:'生成新题',exact:true}).click(); await generated();
  await saveBatch();
  const text=(await stored()).at(-1); assert.equal(text.theme.text,'中秋'); assert.equal(text.theme.glyphParticipation,'each-character'); assert.ok(text.size<=30); assert.equal(verify(text).valid,true);
  results.push('actual Canvas text, both characters essential, phone-size cap');
  await page.screenshot({path:`${output}/phone-text.png`,fullPage:true});
  // 历史生成：最近 100 道、每页 10 道，未保存的那批也要能回看并打开
  const history = page.getByRole('dialog',{ name:'历史生成题目' });
  await page.getByRole('button',{name:'历史生成',exact:true}).click();
  await history.waitFor({ state:'visible' });
  const historyRows = history.locator('.generator-history-list li');
  assert.ok(await historyRows.count() > 0 && await historyRows.count() <= 10, `每页最多 10 道，实测 ${await historyRows.count()}`);
  assert.match(await history.locator('.generator-history-page small').textContent(),/第 1\/\d+ 页/);
  await history.getByRole('button',{name:'打开'}).first().click();
  await history.waitFor({ state:'hidden' });
  assert.ok(await page.locator('.generator-puzzle-meta').isVisible(), '从历史打开的题要能直接看棋盘');
  results.push('history dialog: newest 100 puzzles, 10 per page, opens a past batch');
  // Slow job cancellation must be immediate and stale messages must stay out.
  await settings(); await page.locator('.generator-kinds button',{hasText:'普通题'}).click(); await page.getByLabel('目标手数',{exact:true}).fill('40'); await page.getByLabel('生成数量',{exact:true}).selectOption('10');
  const beforeListed = await listed(); assert.ok(beforeListed >= 0);
  await page.getByRole('button',{name:'生成新题',exact:true}).click();
  await page.getByRole('button',{name:'停止生成',exact:true}).click(); const stoppedListed = await listed();
  await page.waitForTimeout(350); assert.equal(await listed(), stoppedListed, '停止之后不能再有迟到的题目进来');
  assert.match(await page.locator('.generator-status').textContent(),/已停止/);
  results.push('stop terminates active search; no late result or partial bad puzzle');
  // Simulate the same page-hide signal received by the mobile WebView.
  await page.getByRole('button',{name:'生成新题',exact:true}).click();
  await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'visible'});
  const hiddenListed = await listed(); await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.getByRole('button',{name:'生成新题',exact:true}).waitFor({state:'visible'});
  assert.match(await page.locator('.generator-status').textContent(),/暂停搜索/);
  await page.waitForTimeout(350); assert.equal(await listed(), hiddenListed);
  results.push('mobile pagehide stops the worker without losing accepted results');
  // Responsive and theme checks use real controls and board data.
  for(const width of [320,375,390,768,1024]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
  }
  await page.setViewportSize({width:390,height:844});
  for(const theme of ['dark','porcelain','pixel']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.screenshot({path:`${output}/phone-${theme}.png`,fullPage:true});
  }
  results.push('no horizontal overflow at 320/375/390/768/1024; dark and colored themes');
  // ── 导入「生成题证明 JSON」（用户 2026-10-11：「为什么 json 文件导入会失败了」）──────
  // 真实路径：把一份证明写成文件 → 交给**通用导入入口**（那个 accept 含 .sgf 的隐藏
  // file input，也就是设置里「导入棋谱」用的同一个）→ 断言它进了题库。
  // 从前这类文件没有入口，两个入口分别报「RENJU 文件缺少有效的版本、ID 或节点表」
  // 与「顶层需要题目数组，或包含 puzzles 数组」——所以这条同时守住"不再报错"。
  {
    const sampleId = await page.evaluate(()=>{
      const history=JSON.parse(localStorage.getItem('banbu-puzzle-generator-history-v1')||'[]');
      return history[0]?.puzzles?.[0]?.id || '';
    });
    assert.ok(sampleId, '导入检查需要本机历史里有一道题当样本');
    const bare = await page.evaluate(id=>{
      const history=JSON.parse(localStorage.getItem('banbu-puzzle-generator-history-v1')||'[]');
      for(const batch of history) for(const p of batch.puzzles||[]) if(p.id===id) return JSON.stringify(p);
      return '';
    }, sampleId);
    // 两种真实形态都要走一遍：裸证明、以及 `{puzzle:…}` 外壳（artifacts/research 里两种都有）。
    await writeFile(`${output}/import-bare-proof.json`, bare);
    await writeFile(`${output}/import-wrapped-proof.json`, JSON.stringify({ puzzle: JSON.parse(bare), difficulty:{}, geometry:{}, stats:{} }));
    // 先从题库里把这道题删掉，才能证明"确实是这次导入进去的"（否则它本来就在里面）。
    await page.evaluate(id=>{
      const key='renju-note-puzzle-collections-v1';
      const collections=JSON.parse(localStorage.getItem(key)||'[]');
      for(const collection of collections) collection.puzzles=collection.puzzles.filter(p=>p.generated?.id!==id);
      localStorage.setItem(key, JSON.stringify(collections.filter(c=>c.puzzles.length)));
    }, sampleId);
    const inLibrary = id => page.evaluate(x=>{
      const collections=JSON.parse(localStorage.getItem('renju-note-puzzle-collections-v1')||'[]');
      return collections.some(c=>c.puzzles.some(p=>p.generated?.id===x));
    }, id);
    assert.equal(await inLibrary(sampleId), false, '前置：样本已从题库移除');
    const fileInput = page.locator('input[type=file][accept*=".sgf"]').first();
    await fileInput.setInputFiles(`${output}/import-bare-proof.json`);
    await page.waitForFunction(id=>{
      const collections=JSON.parse(localStorage.getItem('renju-note-puzzle-collections-v1')||'[]');
      return collections.some(c=>c.puzzles.some(p=>p.generated?.id===id));
    }, sampleId, { timeout: 20000 }).catch(()=>{});
    assert.equal(await inLibrary(sampleId), true, '裸证明 JSON 应该被导入题库');
    // 再删一次，试带外壳那种形态。
    await page.evaluate(id=>{
      const key='renju-note-puzzle-collections-v1';
      const collections=JSON.parse(localStorage.getItem(key)||'[]');
      for(const collection of collections) collection.puzzles=collection.puzzles.filter(p=>p.generated?.id!==id);
      localStorage.setItem(key, JSON.stringify(collections.filter(c=>c.puzzles.length)));
    }, sampleId);
    await fileInput.setInputFiles(`${output}/import-wrapped-proof.json`);
    await page.waitForFunction(id=>{
      const collections=JSON.parse(localStorage.getItem('renju-note-puzzle-collections-v1')||'[]');
      return collections.some(c=>c.puzzles.some(p=>p.generated?.id===id));
    }, sampleId, { timeout: 20000 }).catch(()=>{});
    assert.equal(await inLibrary(sampleId), true, '带 {puzzle:…} 外壳的证明 JSON 也该被导入题库');
    results.push('generated-proof json imports through the generic import entry (bare + {puzzle:…} wrapper)');
  }

  // A forged success flag must not unlock play after a reload. Corrupt the puzzle
  // the page actually selects on a fresh load — that is the first one of the last
  // batch restored from local history, not merely the last saved puzzle.
  const selectedPuzzleId = await page.evaluate(()=>{
    const history=JSON.parse(localStorage.getItem('banbu-puzzle-generator-history-v1')||'[]');
    return history[0]?.puzzles?.[0]?.id || '';
  });
  assert.ok(selectedPuzzleId, '本机历史里该有最近一批，否则这条检查测不到东西');
  await page.evaluate(id=>{
    // 两处都要篡改：题库里那份，以及本机历史里那份——刷新后页面默认展示的是历史那批，
    // 只改题库就等于没测到"未入库结果"这条新通道。
    const corrupt=p=>{ const s=p.stones[p.attacker][0]; p.proof.at=s.row*p.size+s.col; p.verification.valid=true; };
    let hit=0;
    const collectionsKey='renju-note-puzzle-collections-v1', collections=JSON.parse(localStorage.getItem(collectionsKey)||'[]');
    for(const collection of collections) for(const entry of collection.puzzles) if(entry.generated && entry.generated.id===id){ corrupt(entry.generated); hit++; }
    localStorage.setItem(collectionsKey,JSON.stringify(collections));
    const historyKey='banbu-puzzle-generator-history-v1', history=JSON.parse(localStorage.getItem(historyKey)||'[]');
    for(const batch of history) for(const p of batch.puzzles||[]) if(p.id===id){ corrupt(p); hit++; }
    localStorage.setItem(historyKey,JSON.stringify(history));
    if(hit<2) throw new Error('题目没能同时出现在题库和本机历史里（命中 '+hit+' 处）');
  },selectedPuzzleId);
  await page.reload({ waitUntil:'domcontentloaded' }); await page.getByRole('button',{name:'对弈',exact:true}).click(); await page.getByRole('button',{name:'打开棋题生成器'}).click();
  await page.waitForFunction(()=>document.querySelector('.generator-status')?.textContent.includes('验证失败'));
  assert.equal(await page.getByRole('button',{name:'开始做题',exact:true}).isDisabled(),true);
  results.push('corrupted stored proof with a forged valid marker cannot unlock challenge');
  assert.deepEqual(errors,[]); await writeFile(`${output}/result.json`,JSON.stringify({passed:results,errors},null,2));
  console.log(JSON.stringify({passed:results,errors},null,2));
} finally {await browser.close();}
