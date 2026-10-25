import { coordName } from './board.mjs';

export function forbiddenReason(p) {
  if (!p.forbidden) return '';
  const label = { 'double-three': '三三', 'double-four': '四四', overline: '长连' }[p.forbidden.kind];
  return `白棋第 ${p.forbidden.attackingMove} 手冲四后，黑棋唯一堵点 ${coordName(p.forbidden.at, p.size)} 是${label}禁手，无法合法堵住；答案用黑棋停着演示，再由白棋成五。`;
}

// Offline viewer. Data is inserted only into a safely escaped JSON literal;
// all problem names and explanations are subsequently assigned as textContent.
export function viewer(puzzles) {
  const json = JSON.stringify(puzzles).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VCF 样题</title>
<style>
*{box-sizing:border-box}body{font:16px system-ui;margin:0;background:#101a19;color:#eaf1eb}main{max-width:1100px;margin:auto;padding:24px;min-width:0}h1{font-size:24px;margin:0 0 8px}button,select,input{font:inherit}button,select{padding:8px 12px;border:1px solid #567168;border-radius:8px;background:#243a33;color:inherit;max-width:100%}button:disabled,input:disabled,select:disabled{opacity:.4}nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.selection{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px;margin:14px 0 10px}.selection select{width:100%;min-width:0}label{display:flex;align-items:center;gap:6px;max-width:100%}input[type=range]{width:110px;max-width:30vw}input[type=checkbox]{accent-color:#dcaf6c}#count,.meta{color:#b3c8bb;line-height:1.6}.meta{margin:12px 0}#viewport{overflow:auto;max-height:72vh;width:100%;margin-top:14px;border-radius:12px;background:#d9bd84}canvas{display:block;margin:auto}#line{line-height:1.8;overflow-wrap:anywhere;min-height:1.8em}#forbidden-note{background:#302f29;border-left:3px solid #f0b36b;padding:12px;line-height:1.6;overflow-wrap:anywhere}details{margin-top:20px;border-top:1px solid #3d5249;padding-top:12px}summary{cursor:pointer;color:#c8d9cc}#catalog{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 0}#catalog button{text-align:left;overflow-wrap:anywhere;font-size:14px}#catalog button[aria-current=true]{border-color:#edbc77;background:#39493b}[hidden]{display:none!important}@media(max-width:600px){main{padding:12px}h1{font-size:21px}button,select{padding:8px 10px}.meta,#count{font-size:14px}.selection{grid-template-columns:1fr}#catalog{grid-template-columns:1fr}}
</style></head><body><main><h1>从空盘生成的 VCF</h1><div id="count"></div>
<div class="selection"><select id="type" aria-label="题型筛选"><option value="all">全部题型</option><option value="ordinary">普通 VCF</option><option value="forbidden">白棋抓禁手</option><option value="text">双字题</option><option value="shape">图形题</option></select><select id="puzzle" aria-label="选择题目"></select></div>
<nav aria-label="题目和答案控制"><button id="previous-puzzle">上一题</button><button id="next-puzzle">下一题</button><button id="start">题面</button><button id="prev">上一步</button><button id="next">下一步</button><button id="end">完整答案</button><button id="fit">适合窗口</button><label>格距 <input id="zoom" type="range" min="2" max="38" value="28" aria-label="棋盘缩放"></label><label><input id="outline" type="checkbox">显示图形轮廓</label><label><input id="critical" type="checkbox"><span id="critical-label">显示关键笔画</span></label><label><input id="forbidden" type="checkbox">显示禁手点</label></nav>
<p class="meta" id="meta"></p><p class="meta" id="shape-use" role="note" hidden></p><div id="viewport"><canvas id="board" aria-label="VCF 棋盘"></canvas></div><p id="forbidden-note" role="note" hidden></p><p id="line" aria-live="polite"></p><details><summary id="catalog-title">题目目录</summary><div id="catalog"></div></details></main>
<script>
const puzzles=${json};
const $=id=>document.getElementById(id);let selected=puzzles.length?0:-1,step=0,visible=[];
const colLabel=c=>{let s='';for(c++;c;c=Math.floor(c/26)){c--;s=String.fromCharCode(65+c%26)+s}return s};
const name=(at,n)=>colLabel(at%n)+(n-Math.floor(at/n));
const forbiddenKinds={'double-three':'三三','double-four':'四四',overline:'长连'};
const matches=(p,type)=>type==='all'||type==='ordinary'&&!p.forbidden&&!p.theme||type==='forbidden'&&!!p.forbidden||type==='text'&&!!p.theme&&p.theme.kind!=='shape'||type==='shape'&&p.theme?.kind==='shape';
function resetHints(){step=0;$('outline').checked=puzzles[selected]?.theme?.kind==='shape';$('critical').checked=false;$('forbidden').checked=false;$('forbidden-note').hidden=true;$('forbidden-note').textContent='';$('shape-use').hidden=true;$('shape-use').textContent=''}
function rebuild(){visible=puzzles.map((p,i)=>i).filter(i=>matches(puzzles[i],$('type').value));if(!visible.includes(selected))selected=visible[0]??-1;$('puzzle').replaceChildren();$('catalog').replaceChildren();visible.forEach(i=>{const p=puzzles[i],label=(i+1)+'. '+p.title+'（'+p.size+'路）';const o=document.createElement('option');o.value=i;o.textContent=label;$('puzzle').append(o);const b=document.createElement('button');b.textContent=label;b.dataset.index=i;b.onclick=()=>selectPuzzle(i);$('catalog').append(b)});$('puzzle').value=selected;resetHints();fit()}
function selectPuzzle(i){if(!visible.includes(i))return;selected=i;$('puzzle').value=i;resetHints();fit()}
function render(){
 const p=puzzles[selected],position=visible.indexOf(selected),has=!!p;
 document.querySelectorAll('nav button,nav input').forEach(el=>el.disabled=!has);$('puzzle').disabled=!has;$('type').disabled=!puzzles.length;
 $('previous-puzzle').disabled=!has||position<=0;$('next-puzzle').disabled=!has||position>=visible.length-1;
 $('catalog-title').textContent='题目目录（'+visible.length+' 道）';
 for(const b of $('catalog').children)b.setAttribute('aria-current',String(+b.dataset.index===selected));
 $('count').textContent=has?'共 '+puzzles.length+' 道 · 当前 '+(selected+1)+' / '+puzzles.length+($('type').value==='all'?'':' · 此题型 '+(position+1)+' / '+visible.length):'共 '+puzzles.length+' 道';
 if(!p){$('meta').textContent=puzzles.length?'此题型暂无题目，请切换题型。':'本批没有通过验证的题目。';$('line').textContent='';$('forbidden-note').hidden=true;const c=$('board');c.width=0;c.height=0;return}
 const shape=p.theme?.kind==='shape';$('outline').disabled=!shape;$('critical-label').textContent=shape?'显示参与棋子':'显示关键笔画';$('critical').disabled=!p.theme;$('forbidden').disabled=!p.forbidden;
 const gap=+$('zoom').value,pad=32,n=p.size,edge=pad*2+gap*(n-1),canvas=$('board');canvas.width=edge;canvas.height=edge;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#d9bd84';ctx.fillRect(0,0,edge,edge);ctx.strokeStyle='#806a49';ctx.lineWidth=.6;
 for(let k=0;k<n;k++){ctx.beginPath();ctx.moveTo(pad,pad+k*gap);ctx.lineTo(edge-pad,pad+k*gap);ctx.moveTo(pad+k*gap,pad);ctx.lineTo(pad+k*gap,edge-pad);ctx.stroke()}
 if(gap>=16){ctx.fillStyle='#514632';ctx.font='10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';for(let k=0;k<n;k++){ctx.fillText(colLabel(k),pad+k*gap,8);ctx.fillText(String(n-k),8,pad+k*gap)}}
 const cells=new Map();p.stones.black.forEach(s=>cells.set(s.row*n+s.col,{p:1}));p.stones.white.forEach(s=>cells.set(s.row*n+s.col,{p:2}));p.solution.slice(0,step).forEach((m,i)=>{if(m.at!==null)cells.set(m.at,{p:m.player,number:i+1})});
 if(shape&&$('outline').checked){ctx.fillStyle='#91c5c5';for(const s of p.theme.fixed){ctx.beginPath();ctx.arc(pad+(s.at%n)*gap,pad+Math.floor(s.at/n)*gap,gap*.56,0,Math.PI*2);ctx.fill()}}
 for(const [at,s]of cells){const x=pad+(at%n)*gap,y=pad+Math.floor(at/n)*gap;ctx.beginPath();ctx.arc(x,y,gap*.43,0,Math.PI*2);ctx.fillStyle=s.p===1?'#172322':'#fffdf1';ctx.fill();ctx.strokeStyle='#394b3f';ctx.lineWidth=.6;ctx.stroke();if(s.number){ctx.fillStyle=s.p===1?'#f5f8eb':'#1b2823';ctx.font='bold '+Math.max(6,gap*.36)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.number,x,y)}}
 const circle=(at,color)=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(pad+(at%n)*gap,pad+Math.floor(at/n)*gap,gap*.56,0,Math.PI*2);ctx.stroke()};
 const shapeUse=p.theme?.complexity,attackNumber=p.solution.slice(0,step).filter(m=>m.at!==null&&m.player===(p.attacker==='black'?1:2)).length,currentUse=shapeUse?.steps.find(s=>s.move===attackNumber);
 if($('critical').checked&&p.theme){const points=new Set([...(p.theme.critical||[]),...(p.theme.characters||[]).flatMap(ch=>ch.critical||[]),...(p.theme.parts||[]).flatMap(part=>part.critical||[])].map(s=>s.at));for(const at of points)circle(at,'#b02f59');if(currentUse)for(const at of new Set(currentUse.runs.flatMap(run=>run.strokes)))circle(at,'#d35416')}
 $('shape-use').hidden=!shapeUse||!$('critical').checked;
 $('shape-use').textContent=shapeUse&&$('critical').checked?(currentUse?'攻方第 '+attackNumber+' 手冲四借用的轮廓子：'+([...new Set(currentUse.runs.flatMap(run=>run.strokes))].map(at=>name(at,n)).join('、')||'此手未借用初始轮廓子')+'。橙圈标出此手支撑，紫圈标出全解参与子。':shapeUse.parts.map((part,i)=>p.theme.parts[i].label+'：'+part.usedStrokes+' 枚轮廓子支撑 '+part.turns+' 次冲四').join('；')+'。逐步播放可查看每手借用的棋子。'):'';
 if($('forbidden').checked&&p.forbidden)circle(p.forbidden.at,'#b32230');
 $('meta').textContent=p.size+' 路 · '+(p.attacker==='black'?'黑先':'白先')+' · '+(p.rules==='renju'?'连珠规则':'自由规则')+' · 最短 '+p.depth+' 手（含最后成五） · 独立复核通过 · '+p.stones.black.length+' 黑 / '+p.stones.white.length+' 白'+(p.theme?.glyphParticipation==='each-character'?' · 每个字均参与，逐字删字验证通过':'')+(shape?' · '+p.theme.parts.map(part=>part.label).join('、')+'均参与'+($('outline').checked?' · 浅蓝圈标出图形轮廓':''):'')+(shapeUse?' · 图形 '+shapeUse.usedStrokes+' 子支撑 '+shapeUse.participatingTurns+' 次冲四 · '+shapeUse.reusedStrokes+' 子复用':'')+(p.size>25?' · 此尺寸超出应用当前导入范围':'');
 $('line').textContent=p.solution.slice(0,step).map((m,i)=>(i+1)+'.'+(m.at===null?(p.forbidden?'黑无法合法堵（停着演示）':(m.player===1?'黑':'白')+'停着'):(m.player===1?'黑':'白')+name(m.at,n))).join(' → ');
 const showHint=!!p.forbidden&&($('forbidden').checked||step===p.solution.length);$('forbidden-note').hidden=!showHint;$('forbidden-note').textContent=showHint?'白棋第 '+p.forbidden.attackingMove+' 手冲四后，黑棋唯一堵点 '+name(p.forbidden.at,n)+' 是'+forbiddenKinds[p.forbidden.kind]+'禁手，无法合法堵住；答案用黑棋停着演示，再由白棋成五。':'';
 $('prev').disabled=step===0;$('next').disabled=step===p.solution.length;
}
function fit(){const p=puzzles[selected];if(p)$('zoom').value=Math.max(2,Math.min(38,Math.floor((Math.min($('viewport').clientWidth,window.innerHeight*.67)-64)/(p.size-1))));render()}
$('type').onchange=rebuild;$('puzzle').onchange=e=>selectPuzzle(+e.target.value);
$('previous-puzzle').onclick=()=>selectPuzzle(visible[visible.indexOf(selected)-1]);$('next-puzzle').onclick=()=>selectPuzzle(visible[visible.indexOf(selected)+1]);
$('start').onclick=()=>{resetHints();render()};$('prev').onclick=()=>{step=Math.max(0,step-1);render()};$('next').onclick=()=>{step=Math.min(puzzles[selected].solution.length,step+1);render()};$('end').onclick=()=>{step=puzzles[selected].solution.length;$('forbidden').checked=!!puzzles[selected].forbidden;render()};
$('zoom').oninput=render;$('outline').onchange=render;$('critical').onchange=render;$('forbidden').onchange=render;$('fit').onclick=fit;window.addEventListener('resize',fit);rebuild();
</script></body></html>`;
}
