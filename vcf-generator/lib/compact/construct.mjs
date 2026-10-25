import { Board, other } from '../board.mjs';
import { addForbiddenConstraints } from '../forbidden.mjs';
import { causalWindows, counterFourWindows } from '../temporal.mjs';

// Shared objects contain geometry only: no cell colors, timeline, refs, score,
// guard or random state. Reusing them cannot accept or omit a dynamic choice.
const geometryModules=new WeakMap();
// 第 44 轮：constraints() 去重的直接映射戳数组（按 size 缓存、进程内调用序号做戳），
// 以及模块条目池的全局调用序号。
let dedupSeq=0;
// 第 64 轮：候选槽的锚点从「每个槽一个数组」改成「sources 下标的 16 位掩码＋计数」（sourceLimit≤16，装得下）。
// 插桩实测（artifacts/iter/round64/dbg-run.mjs）：15 路 D12 一次构造有 ~5.9k 次 constraints() 调用、每次去重出 ~600 个槽，
// 其中只有 ~150 个成为候选——旧写法为那 450 个立刻被 `present[attack]` 拒掉的槽也各付一次数组分配＋push 扩容。
// anchorsOf 只在**真正进入主解路径**的那一手还原数组，按掩码升序＝旧「首见即 push」的顺序，逐字相同。
const anchorsOf = (mask, sources) => { const out = []; for (let i = 0; i < sources.length; i++) if (mask & (1 << i)) out.push(sources[i]); return out; };

// Same 32-bit generator the batch driver uses, so a salt drawn from the caller's
// stream reproduces a construction-only stream of its own.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// From-empty, temporal constraint synthesis. Static supports and earlier
// moves may support several fours; planned attack/reply cells stay empty in
// the starting diagram. Every accepted output still goes through solve() and
// the separate reference verifier in generate.mjs.
// 到最近已有子的切比雪夫距离（棋盘内八邻域，L∞ 两遍 chamfer 精确）。99＝全空区域；
// 查询点恒为空格，所以"距离 ≤ N"与"八邻域半径 N 内有子"逐字等价（N=1 即贴格）。
function stoneDistanceMap(cells,size){
  const d=new Int8Array(cells.length).fill(99);
  for(let q=0;q<cells.length;q++)if(cells[q])d[q]=0;
  for(let r=0;r<size;r++)for(let c=0;c<size;c++){
    const q=r*size+c;let m=d[q];
    if(r){let u=d[q-size]+1;if(u<m)m=u;if(c){u=d[q-size-1]+1;if(u<m)m=u;}if(c<size-1){u=d[q-size+1]+1;if(u<m)m=u;}}
    if(c){const u=d[q-1]+1;if(u<m)m=u;}
    d[q]=m;
  }
  for(let r=size-1;r>=0;r--)for(let c=size-1;c>=0;c--){
    const q=r*size+c;let m=d[q];
    if(r<size-1){let u=d[q+size]+1;if(u<m)m=u;if(c){u=d[q+size-1]+1;if(u<m)m=u;}if(c<size-1){u=d[q+size+1]+1;if(u<m)m=u;}}
    if(c<size-1){const u=d[q+1]+1;if(u<m)m=u;}
    d[q]=m;
  }
  return d;
}

export function constructCompact(size, depth, attacker, rng, { guard, constructionNodes, rule='renju', ending='five', forbiddenKind='any', routingNoise=1, diagnostics={}, theme, shapeInfo, regionBoxes=[], shapeComplexity, naturalStyle=false, deepWeave=true }) {
  // 构造期随机流与调用方的共享流解耦：整次构造只从共享流抽 1 个盐，之后每一抽都走这条本地流。
  // 原来 constraints() 的平手噪声和 starts 的定序直接从共享流抽，抽取次数随「哪一次抽取撞上线」
  // 而变 ⇒ 换节点上限＝把整条尝试序列重排一遍，抬高上限不单调（规程待办池 P0）。本地流的抽取
  // 顺序只由本次搜索自身决定，所以同一盐在 cap 1000/6000 下走过的搜索前缀逐手一致。
  // 只对应用走的 naturalStyle 普通题链生效。两个例外都是实测出来的坑，不是保守起见：
  //   · 标准模式继续直接抽共享流——optimization.node.mjs:79 拿冻结快照逐字段比 constructCompact
  //     的 cells/path/blocks/nodes，动它＝真回退（第 17 轮踩过）；
  //   · 文字/图案题（theme）继续原轨迹——15 路 32 手单字题只有 12 次尝试的额度
  //     （generator.test.ts:102），换轨迹直接把它打挂，而那是手机产品保证。
  const crng = naturalStyle && !theme ? seededRandom(Math.floor(rng() * 4294967296) >>> 0) : rng;
  const geometry=new Board(size), defender=other(attacker), cells=new Uint8Array(size*size);
  for(const stone of theme?.fixed||[])cells[stone.at]=stone.player;
  // Initial and scheduled stones have identical membership to the former
  // cells/attackTime/replyTime lookup. This array is updated and undone with
  // those sources; it contains no inferred facts and does not prune moves.
  const present=Uint8Array.from(cells);
  // 第 44 轮：行/列查表（构造内 size 固定）。行/列值域 0..size-1（≤29）放 Uint8。
  // 把热路径里的 Math.floor(q/size)、q%size 换成数组读——纯等价（整数、无 FP 语义）。
  const rowOf=new Uint8Array(cells.length), colOf=new Uint8Array(cells.length);
  for(let q=0;q<cells.length;q++){rowOf[q]=Math.floor(q/size);colOf[q]=q%size;}
  // The rectangle membership check is on the hottest candidate path.  Build
  // a compact per-cell mask once per construction so custom 28x28 outlines
  // do not repeatedly perform floor/mod arithmetic for every required point.
  // Candidate indexes are valid board cells (negative endpoints are rejected
  // before this query), so clipping the rectangle preserves membership.
  const themeArea = theme ? new Uint8Array(cells.length) : null;
  if (themeArea) {
    const top = Math.max(0, theme.row), bottom = Math.min(size, theme.row + theme.height);
    const left = Math.max(0, theme.col), right = Math.min(size, theme.col + theme.width);
    for (let row = top; row < bottom; row++) themeArea.fill(1, row * size + left, row * size + right);
  }
  const inTheme=q=>!!themeArea?.[q];
  // 题面固定攻方子（热路径要按节点取用，原先每个节点都会 filter+map 一遍；theme 在一次
  // constructCompact 内不变，所以在这里算一次即可——语义逐字不变）。
  const themeAttackerAt=theme?(theme.fixed?.filter(stone=>stone.player===attacker).map(stone=>stone.at)||[]):[];
  const partCells=shapeInfo
    ? shapeInfo.parts.map(part=>part.points.map(p=>(p.row+theme.row)*size+p.col+theme.col).filter(q=>cells[q]===attacker))
    : regionBoxes.map(box => {
      const points=[];
      for(let r=box.row;r<box.row+box.height;r++)for(let c=box.col;c<box.col+box.width;c++){
        const q=(r+theme.row)*size+c+theme.col;
        if(theme.mask[r]?.[c]==='1'&&cells[q]===attacker)points.push(q);
      }
      return points;
    });
  // A part's fixed attacker strokes do not change while constructing one
  // candidate. Cache their exact Chebyshev distances lazily; the missing
  // part can change during backtracking, but its geometry cannot.
  const partDistances = new Array(partCells.length);
  const distancesForPart = index => {
    if (!partDistances[index]) {
      const strokes = new Uint8Array(cells.length);
      for (const at of partCells[index]) strokes[at] = 1;
      partDistances[index] = stoneDistanceMap(strokes, size);
    }
    return partDistances[index];
  };
  const multiStep=shapeComplexity==='multi-step';
  // A multi-step certificate requires every outline part to contribute at
  // least two fixed attacker strokes. Some phase colours cannot satisfy that
  // condition; reject the palette before building its search tree. This is a
  // necessary-condition prune only, so feasible palettes keep the same route
  // and all accepted puzzles still pass the independent shape certificate.
  if(multiStep && partCells.some(points => points.length < 2)) {
    diagnostics.shapePhasePrunes = (diagnostics.shapePhasePrunes || 0) + 1;
    return null;
  }
  // 第 24 轮：门槛从 `depth<35` 放开到全深度。原来长题退回单锚链的理由是"搜索已经够重"，
  // 但代价是 35 手以上的题面完全吃不到连片/支点打分（第 21 轮实测：深档跨度罚分按不住，
  // 只动打分端没用——要动就得动这个门槛）。成本按 `structureWeight`（depth>=35 现 0.45）控。
  // 第 25 轮加预算闸：连片路由与"单次尝试更重"是一体的，15/30 秒这种手机档赔不起——
  // 实测 15 秒档 D50 扩盘 1.3s→12.4s、D40 15路 9.8s→超时（机器同种同机，第 22 轮树对比）。
  // 所以只在**总预算 >= 60 秒**时才给深档开连片（`deepWeave`，由 generate() 按总预算算），
  // 短预算退回第 22 轮那种"多次轻尝试"的档位；<=20 手的短题不受影响（本来就没到门槛）。
  const wovenRouting=naturalStyle&&(depth<35||deepWeave);
  const textRouting=wovenRouting&&!shapeInfo&&regionBoxes.length>0;
  const sourceLimit=textRouting?6:(wovenRouting?16:1);
  // 第 70 轮（待办池 P0「岔路要冲向同一个终点」的构造期那一刀，第 69 轮预注册）。两个开关分开，
  // 便于把"放行潜伏三"与"末手要求交叉窗"的成本各自归因：
  //   · latentThree —— 交给 temporal 的因果剪枝，允许"已有 3 枚攻方子、但补不出活四"的潜伏窗活下来；
  //   · crossEndRequire —— 末手那一步必须挂着另一条通向同一个终点孔的线，否则这个末手候选不要。
  // 作用域照第 69 轮的批准口径收窄到 naturalStyle 普通题：标准模式与文字/图案题轨迹逐字不变
  // （optimization.node.mjs:79 拿冻结快照逐字段比 constructCompact，动它＝真回退）。
  const latentThree=naturalStyle&&!theme&&ending==='five';
  const crossEndRequire=false;   // 实测：开着它浅档（3–12 手）末手候选被全灭，15 秒预算烧光也出不来题；潜伏三放行保留。
  // 交叉窗里"最晚落下的那枚攻方子"允许排到第几手。 Infinity＝只要早于末手；
  // 越小＝岔路越早可用＝每手挂得住的同终点线越多（第 70 轮的靶子就是每手 0.27–0.42 → ≥0.8）。
  const crossEndLatest=Number.POSITIVE_INFINITY;
  const shapeParts=new Int8Array(cells.length).fill(-1),shapeUses=new Uint16Array(cells.length),shapeAxes=new Uint8Array(cells.length),partTurns=new Uint16Array(partCells.length);
  if(multiStep)partCells.forEach((points,i)=>points.forEach(q=>{shapeParts[q]=i;}));
  const attackTime=new Int16Array(cells.length).fill(-1),replyTime=new Int16Array(cells.length).fill(-1);
  const refs=new Uint16Array(cells.length), supportUses=new Uint16Array(cells.length), supportAxes=new Uint8Array(cells.length), path=[],blocks=[],backEnds=[],plannedWindows=[];
  // 第 44 轮：constraints() 的模块条目池（entry 对象跨调用复用；anchors 数组仍每次新建）。
  const moduleList=[];
  // 第 29 轮：回溯端"支持掩码重算"的逐格缓存。重算值 G(q) 只由本节点的前缀窗口
  // （plannedWindows[0..len-2]）决定——同一节点的 try 循环里前缀不变、同一格会被反复
  // 重算（插桩实测 638M 次扫描、8.2M 次尝试）。stamp 用进入该节点时的 nodes 序号
  // （单调、每次构造从 1 起）：深层递归写的是更大的 stamp，回来读天然不混。
  // 值域 ≤1<<3，Uint8 放得下。
  const recomputeMask=new Uint8Array(cells.length);
  const recomputeStamp=new Int32Array(cells.length).fill(-1);
  const routeAxes=[], routeAnchors=[];
  let cached=geometryModules.get(geometry.windows);
  if(!cached){
    const windowCount=geometry.windows.length;
    cached={windows:new Map(),modules:new Map(),
      // 键 ＝ 窗口号*25＋attack索引*5＋reply索引（≤ windowCount*25）；戳＝调用序号。
      slotStamp:new Int32Array(windowCount*25),slotSlot:new Int32Array(windowCount*25)};
    geometryModules.set(geometry.windows,cached);
  }
  const {windows,modules,slotStamp,slotSlot}=cached;
  const windowFor=id=>{
    if(windows.has(id))return windows.get(id);
    guard.check();
    const points=geometry.windows[id];
    const r0=Math.floor(points[0]/size),c0=points[0]%size;
    const r1=Math.floor(points[1]/size),c1=points[1]%size,dr=r1-r0,dc=c1-c0;
    const before=geometry.index(r0-dr,c0-dc),after=geometry.index(r0+5*dr,c0+5*dc);
    const reserved=Array.from({length:4},(_,flags)=>[...points,...(flags&1&&before>=0?[before]:[]),...(flags&2&&after>=0?[after]:[])]);
    // 第 44 轮：axis 只由窗口几何决定，随窗口缓存算一次（原来是每模块每次调用重算）；
    // slotBase＝窗口号*25；changes 改数组下标缓存（changedMask ≤ 127），替掉每条目一次 Map.get。
    const data={points,before,after,reserved,changes:[],axis:axisOf(points),slotBase:id*25};
    windows.set(id,data);return data;
  };
  // Only materialize a window set when a sorted candidate is actually tried.
  // Both temporal and defender scans share this geometry-only mask cache.
  const affectedFor=(data,mask)=>{
    let affected=data.changes[mask];
    if(!affected){
      const changed=[...data.points,data.before,data.after].filter((q,i)=>q>=0&&(mask&(1<<i)));
      affected=[...new Set(changed.flatMap(q=>geometry.incidence[q]))];
      data.changes[mask]=affected;
    }
    return affected;
  };
  const moduleFor=prev=>{
    if(modules.has(prev))return modules.get(prev);
    guard.check();
    const choices=geometry.incidence[prev].flatMap(id=>{
      const data=windowFor(id),{points,before,after}=data,position=points.indexOf(prev),out=[];
    for(let attack=0;attack<5;attack++)for(let reply=0;reply<5;reply++){
      if(attack===reply||attack===position||reply===position)continue;
      // 第 44 轮：key/行/列全是几何的纯函数，随描述符缓存（跨构造复用）；全表内联与原来逐字等价：
      // key 算法与 constraints 里原式一字不差，行/列与原 Math.floor(q/size)、q%size 同值。
      out.push({points,attack:points[attack],reply:points[reply],holes:[attack,reply],support:points.filter((q,k)=>k!==attack&&k!==reply),before,after,data,changedMask:(1<<attack)|(1<<reply)|(1<<position),
        key:data.slotBase+attack*5+reply,attackRow:rowOf[points[attack]],attackCol:colOf[points[attack]]});
    }
      return out;
    });
    modules.set(prev,choices);return choices;
  };
  const untouched=q=>q>=0&&!present[q];
  let nodes=0;
  // 题面里的一枚子是否贴住已经在题面上的子（八邻域），即到最近已有子的切比雪夫距离 ≤1。
  // 窗口总是经过上一个攻点展开，而那个攻点在题面里是空点，所以"离锚点很近"并不等于"连着题面"——
  // 这就是过去每个模块各自成一簇、题面铺满 15 路的原因（实测中位 17 个连通块、
  // 跨度 15、密度 0.17；人类题同手数中位是 1 块、跨度 9、密度 0.46）。
  // 第 28 轮：原先是逐格 9/25 点探测的闭包（每模块数次），改为在 constraints() 开头一次算好
  // 距离图（两遍 chamfer，L∞ 精确），查表 1 次代替 9/25 次格点读——语义等价，见 stoneDistanceMap。
  const axisOf=points=>{
    const dr=Math.floor(points[1]/size)-Math.floor(points[0]/size), dc=points[1]%size-points[0]%size;
    return dr===0?0:dc===0?1:dc===1?2:3;
  };
  // 末手五连的终点孔 h 上是否还挂着**另一条**线（第 70 轮的构造期要求，见上面 crossEndRequire 注释）。
  // 形状：另一条五格线过 h、h 坐在它的端点上、线上已有 3 枚攻方子（题面固定子／本模块新增的题面子／
  // 更早几手已排定的攻点都算）、第 4 格空着＝岔路落点 k，并且这条线补不出活四（四的远端已被守方堵住），
  // 于是落 k 只得到一个"冲同一个 h"的冲四。这正是真人题那种"多条冲四收敛到同一终点、次序可交换"，
  // 而它在补子端拿不到（第 68 轮实测 0/199 次存在落点，因为那些格子是主线未来的攻点）。
  // 排除末手自己那条五格窗，也排除岔路落点恰是本模块攻点/堵点的情形——那都不算"另一条线"。
  // 这是构造期的结构要求，不是验收放松：唯一首手／最短解／独立验题／第二解与证不死复核一条没减。
  const crossEndWindow=(h,module,add)=>{
    const term=module.data.points;
    const pending=q=>{for(let i=0;i<add.length;i+=2)if(add[i]===q)return add[i+1];return 0;};
    for(const id of geometry.incidence[h]){
      const points=geometry.windows[id];
      const i0=points[0]===h?0:points[4]===h?4:-1;
      if(i0<0)continue;                                     // h 不在端点 ⇒ 补出来不是"过 h 的四"
      if(points[0]===term[0]&&points[4]===term[4])continue; // 末手自己那条线
      const data=windowFor(id),far=i0===0?data.after:data.before;
      if(far>=0&&cells[far]!==defender&&present[far]!==defender&&replyTime[far]<0&&pending(far)!==defender)continue;
      let attackers=0,spot=-1,latest=-1,ok=true;
      for(let k=0;k<5;k++){
        if(k===i0)continue;
        const q=points[k],stone=present[q]||pending(q);
        if(stone===attacker){attackers++;if(attackTime[q]>latest)latest=attackTime[q];continue;}
        if(stone||q===module.attack||q===module.reply){ok=false;break;}
        if(spot>=0){ok=false;break;}                         // 第二个空格 ⇒ 不是"三子＋一落点"
        spot=q;
      }
      if(!ok||attackers!==3||spot<0||latest>crossEndLatest)continue;
      return true;
    }
    return false;
  };
  const constraints=(prev,terminal,stage)=>{
    let choices=[];
    // Diagram proximity is used only by natural ordinary routing. Themes
    // have their own fixed-part distances, and the fast route's structure
    // score is zero, so neither needs this full-board scan.
    const dist=wovenRouting&&!theme?stoneDistanceMap(cells,size):null;
    // Traditional VCFs frequently jump to a second forcing line that was
    // prepared several turns earlier. Legacy routing only scans windows
    // through the immediately preceding attack. Natural routing scans the
    // existing attacker anchors too, then keeps only windows tied to at least
    // one real anchor. This changes the dependency graph, never the proof
    // gates below.
    // 热路径（第 25 轮 CPU profile：constraints 占 48% 自身时间）：这里的每个集合/数组/字符串
    // 都是**每个节点 × 每个模块**付一次，改成 hoist 到调用外或单循环，语义逐字不变。
    // 第 28 轮删掉 activeAnchors：它只被下面那个 anchors 过滤用，而过滤恒真——anchors 集合的
    // 每个来源都取自 sources，sources ⊆ {prev}∪path∪themeAttackerAt（woven）或 {prev}（标准），
    // 过滤永不剔除任何项。每节点省一次 ~40 项的 Set 构造 + 每模块一次 filter 分配。
    // 第 44 轮：候选源手工去重构建——等价于 [...new Set(candidates)].slice(0,sourceLimit)
    // （保首现顺序、再截断），免去中间数组/spread；顺序与 sourceLimit 语义一字不差。
    const sources=[];
    { const seenSources=new Set(); const add=s=>{if(!seenSources.has(s)){seenSources.add(s);sources.push(s);}};
      add(prev);
      if(wovenRouting){const from=Math.max(0,path.length-(textRouting?3:8));for(let i=path.length-1;i>=from;i--)add(path[i]);for(const s of themeAttackerAt)add(s);}
      if(sources.length>sourceLimit)sources.length=sourceLimit; }
    // 第 44 轮：去重从 Map 改为「直接映射戳数组」——键＝窗口号*25＋attack索引*5＋reply索引，
    // 值域 < windows.length*25（15 路 14300，随 geometry 缓存一次分配、跨构造共用；戳＝进程内单调
    // 调用序号，无需清零）。与旧 (p0, attack, reply) 键同为一一对应：两条 5 格线最多共 1 格，
    // 若同 (attack, reply) 则两线共 3 格＝同一条线。语义＝同键首见建条目、后续 source 追加 anchors
    // 并保留插入顺序——与旧 Map 版逐字相同；条目对象仍池化复用，anchors 数组每次调用新建
    // （会被 routeAnchors 长期持有，绝不复用旧值）。
    const callSeq=++dedupSeq;
    let entryN=0;
    for(let si=0;si<sources.length;si++)for(const module of moduleFor(sources[si])){
      const bit=1<<si,slot=module.key;
      if(slotStamp[slot]===callSeq){const hit=moduleList[slotSlot[slot]];hit.anchorMask|=bit;hit.anchorCount++;continue;}
      slotStamp[slot]=callSeq;
      const entry=moduleList[entryN]??(moduleList[entryN]={module:null,anchorMask:0,anchorCount:0});
      entry.module=module;entry.anchorMask=bit;entry.anchorCount=1;
      slotSlot[slot]=entryN;entryN++;
    }
    // 第 28 轮：require 原先**每模块**建一次闭包（每节点 ~1200 次上下文分配），改成每次
    // constraints() 只建一次、状态走外层 let、module 作为参数传入——判据与调用序列一字未动。
    // 第 29 轮：扁平 [q,p,q,p,…]，模块级复用同一个 scratch；只有进入 choices 时才 slice 一份。
    // 原写法每个模块新建一个数组（每节点 ~1300 个）＋每个新增子一对 [q,p]（~800 对）——
    // 插桩显示 A（apply+push）/B 段合计占 extend 内环 ~17%。所有消费点逐处改成步长 2 的
    // 索引循环；"对数"＝additions.length>>1。
    let valid,borrowed,reusedMoves,flags,changedMask;
    const additions=[];
    const require=(q,p,module)=>{
      if(q<0)return p===defender; // board edges can close a four
      // Support cells and the two exterior endpoints are distinct; each
      // is required once, so no per-candidate assignment map is necessary.
      if(q===module.before)flags|=1;
      if(q===module.after)flags|=2;
      const existing=present[q];
      if(existing)return existing===p;
      if(!p)return true;
      if(inTheme(q))return false; // the initial shape background stays empty
      changedMask|=1<<(q===module.before?5:q===module.after?6:module.data.points.indexOf(q));
      additions.push(q,p);return true;
    };
    // 第 44 轮：循环不变量提出循环（prev / routeAxes 末位 / structureWeight 在本次调用内不变）。
    const prevRow=rowOf[prev],prevCol=colOf[prev];
    const previousAxis=routeAxes[routeAxes.length-1];
    const structureWeight=depth>=35?0.45:1;
    for(let ei=0;ei<entryN;ei++){
      const entry=moduleList[ei];
      const module=entry.module;
      // 等价内联（原 untouched(q)=q>=0&&!present[q]，两处顺次短路语义相同）。
      if(module.attack<0||present[module.attack]||module.reply<0||present[module.reply])continue;
      if(attacker===1&&rule==='renju'&&(module.before>=0&&present[module.before]===1||module.after>=0&&present[module.after]===1))continue;
      additions.length=0;valid=true;borrowed=0;reusedMoves=0;flags=0;changedMask=module.changedMask;
      for(const q of module.support){
        if(q!==prev&&present[q]===attacker){borrowed++;if(attackTime[q]>=0)reusedMoves++;}
        if(!require(q,attacker,module)){valid=false;break;}
      }
      if(!valid)continue;
      // 硬版本第 0 轮 link 项：普通题新增的攻方题面子不许整块浮空——至少一枚贴住已有题面，
      // 其余最多离题面两格（罚分只能换一种碎法，第 0/2/9 轮已实证）。文字/图案题落点受字形矩形
      // 限制不动；>20 手的构造预算已在临界点（实测同门限下 15 路 30 手 0.3s→27.3s），保持原路由。
      if(wovenRouting&&!theme&&depth<=20){
        // 单循环取代 filter+some+every（同一判据：有新增且"至少一枚贴 1 格、其余都在 2 格内"才留）。
        // 第 28 轮：nearDiagram(q,1)/(q,2) 换成距离图查表（dist 在本次调用内由当前 cells 一次算好）。
        let attackerAdditions=0,anyNear1=false,allNear2=true;
        for(let i=0;i<additions.length;i+=2){const q=additions[i];if(additions[i+1]===attacker){attackerAdditions++;if(!anyNear1&&dist[q]<=1)anyNear1=true;if(allNear2&&dist[q]>2)allNear2=false;}}
        if(attackerAdditions&&!(anyNear1&&allNear2))continue;
      }
      let openEnd=-1;
      if(terminal&&ending!=='forbidden'){
        // Four contiguous stones with two real endpoints. Mirror windows
        // cover either direction, without reserving an entire fresh module.
        if(module.holes[1]===4&&module.holes[0]>0&&module.holes[0]<4){
          openEnd=module.before;
          if(openEnd<0||!require(openEnd,0,module)||present[module.after]===attacker)continue;
        }else if(module.holes[1]===0&&module.holes[0]>0&&module.holes[0]<4){
          openEnd=module.after;
          if(openEnd<0||!require(openEnd,0,module)||present[module.before]===attacker)continue;
        }else continue;
        // 第 70 轮：末手必须挂着一条通向同一个终点孔的旁支线，否则这个末手候选直接不要。
        if(crossEndRequire&&!crossEndWindow(openEnd,module,additions)){
          diagnostics.crossEndPrunes=(diagnostics.crossEndPrunes||0)+1;continue;
        }
      }else{
        if(module.holes.includes(4)&&!require(module.before,defender,module))continue;
        if(module.holes.includes(0)&&!require(module.after,defender,module))continue;
      }
      const points=module.data.reserved[flags];
      // 第 28 轮：原来这里是 `[...module.anchors].filter(activeAnchors.has)`，两个数组分配 + 每项
      // 回调；该过滤恒真（见上方注释），直接用条目自带的数组（sources 去重后天然无重复）。
      const anchorMask=entry.anchorMask,anchorCount=entry.anchorCount;
      if(wovenRouting&&anchorCount<1)continue;
      // 第 44 轮：axis/行/列随描述符与窗口缓存（同一值），prev 行列与 structureWeight 已提出循环。
      const axis=module.data.axis;
      // 单循环取代两次 filter（原写法每个模块分配两个数组）。
      let sharedSupports=0,crossAxisSupports=0;
      for(const q of module.support){
        if(supportUses[q]>0)sharedSupports++;
        const mask=supportAxes[q];
        if(mask&&!(mask&(1<<axis)))crossAxisSupports++;
      }
      const attackRow=module.attackRow,attackCol=module.attackCol;
      const distance=Math.max(Math.abs(attackRow-prevRow),Math.abs(attackCol-prevCol));
      // 单循环取代 Math.min(...anchors.map(...))（空集时同为 Infinity）。
      let anchorDistance=Infinity;
      // 绝大多数槽只有一个锚点：直接由最低位取那一个 sources 下标（Math.clz32），不走位扫描。
      if((anchorMask&(anchorMask-1))===0){const anchor=sources[31-Math.clz32(anchorMask)];anchorDistance=Math.max(Math.abs(attackRow-rowOf[anchor]),Math.abs(attackCol-colOf[anchor]));}
      else for(let m=anchorMask,si=0;m;m>>>=1,si++)if(m&1){
        const anchor=sources[si];
        const d=Math.max(Math.abs(attackRow-rowOf[anchor]),Math.abs(attackCol-colOf[anchor]));
        if(d<anchorDistance)anchorDistance=d;
      }
      // 本模块新增的题面子至少要贴住一枚已有题面子，否则它另起一簇。
      // 第 28 轮：some+闭包换显式循环（每节点 ~1200 次回调解绑），判据同 dist[q]<=1。
      let linked=!additions.length;
      if(dist&&!linked)for(let i=0;i<additions.length;i+=2)if(dist[additions[i]]<=1){linked=true;break;}
      const structureScore=wovenRouting
        ? structureWeight*(anchorCount*4+Math.max(0,anchorCount-1)*5+sharedSupports*4+crossAxisSupports*3
          +(previousAxis!==undefined&&axis!==previousAxis?4:0)-Math.max(0,distance-4)*1.1-Math.max(0,anchorDistance-3)*0.9
          +(theme?0:linked?(additions.length?2:-1):-12))
        : 0;
      choices.push({attack:module.attack,reply:module.reply,data:module.data,additions:additions.slice(),points,changedMask,openEnd,axis,anchorMask,sources,anchorCount,
        sharedSupports,crossAxisSupports,
        // Reuse is ordering, never acceptance. Small randomness diversifies
        // equal-cost routings without a stored pattern or puzzle seed.
        score:borrowed*5+reusedMoves*2-(additions.length>>1)+structureScore+crng()*routingNoise});
    }
    if(multiStep){
      for(const choice of choices){
        choice.axis=choice.data.axis;
        choice.strokeSupports=choice.data.points.filter(q=>shapeParts[q]>=0);
        const touched=new Set();
        for(const q of choice.strokeSupports){
          const part=shapeParts[q];touched.add(part);
          choice.score+=2+(shapeUses[q]?0:1)+(shapeUses[q]&&!(shapeAxes[q]&(1<<choice.axis))?2:0);
        }
        for(const part of touched)if(partTurns[part]<2)choice.score+=4;
      }
    }
    if (!multiStep) {
      const missingRegions = partCells.map((points, index) => index).filter(index => !partCells[index].some(q => refs[q]));
      // Reserve the remaining modules for characters that have not yet been
      // touched. This turns the old score-only preference into a cheap hard
      // construction constraint and avoids late full-solver rejection.
      if (missingRegions.length && depth - 1 - stage <= missingRegions.length) {
        choices = choices.filter(choice => choice.data.points.some(q => missingRegions.some(index => partCells[index].includes(q))));
      }
    }
    const missingIndex=multiStep?partCells.findIndex((points,i)=>partTurns[i]<2||points.filter(q=>shapeUses[q]).length<2):partCells.findIndex(points=>!points.some(q=>refs[q]));
    if(missingIndex>=0&&partCells[missingIndex].length){
      const distances=distancesForPart(missingIndex);
      for(const choice of choices)choice.score-=distances[choice.attack]*2;
    }
    // 跨度预算（第 15 轮立、第 17 轮带岔路门重开）：题面外接矩形顶过人类区间上沿（10）之后
    // 还在往外长的模块一律扣分。放在候选打分端是有依据的——第 0/2/9/14 轮四次证明只在补子上
    // 重排换不动跨度（第 14 轮把补子全挪进框内 D20 仍是 13），只有构造时就少往外长才行。
    // 同时给"新增子贴住已有题面的比例"加分：只压跨度会把模块塞进框内但浮空的角落
    // （第 15 轮实测 D20 连通块 3→5）。软罚分不硬拒（第 11 轮硬拒＝100 次尝试 0 题）。
    // 只对应用走的路由生效：`wovenRouting`＝naturalStyle&&depth<35，标准模式（冻结快照考题）
    // 必须一字不变，否则 optimization.node.mjs 的构造比对会从"只差 shallow 键"升级成真回退。
    if(wovenRouting&&!theme&&depth<=20){
      let top=size,left=size,bottom=-1,right=-1;
      for(let q=0;q<cells.length;q++)if(cells[q]){
        const row=rowOf[q],col=colOf[q];
        if(row<top)top=row;if(row>bottom)bottom=row;if(col<left)left=col;if(col>right)right=col;
      }
      const over=additions=>{
        let a=top,b=bottom,c=left,d=right;
        for(let i=0;i<additions.length;i+=2){
          const q=additions[i];
          const row=rowOf[q],col=colOf[q];
          if(row<a)a=row;if(row>b)b=row;if(col<c)c=col;if(col>d)d=col;
        }
        return Math.max(0,Math.max(b-a,d-c)+1-10);
      };
      // 第 62 轮：软预算的「后硬」阶段（待办池 P0 原文「先软后硬」，软侧 R17/R18/R20 已扫完）。
      // 五次证伪说明罚分端换不动跨度，而 `filter` 换得动——实测 15 路 D12 官方卷 跨 12→10、块 3→2、
      // 自然度 0.8412→0.9496。作用域三处收窄都有依据：图案题跨度由字形点阵定死（R14 汇报口径）；
      // 抓禁手对跨度类改动读反（R18 的 4 seed 池）；深度只到 12——≤12 手题面 ~48 枚子，10×10 框的
      // 占盘率 0.48 正是人类实测，D20 的 73 枚在数学上进不了 10×10（R21）。
      // 成本靠第 62 轮放松的可骗下限买掉（见 generate-core.mjs:634 的 `ceil(turns*0.7)`）。
      if (!theme && ending === 'five' && depth <= 12) {
        const spanAfter = additions => {
          let a = top, b = bottom, c = left, d = right;
          for (let i = 0; i < additions.length; i += 2) {
            const q = additions[i];
            const row = rowOf[q], col = colOf[q];
            if (row < a) a = row; if (row > b) b = row; if (col < c) c = col; if (col > d) d = col;
          }
          return Math.max(b - a, d - c) + 1;
        };
        const kept = choices.filter(choice => spanAfter(choice.additions) <= 10);
        if (kept.length) choices = kept;
      }
      // 第 44 轮：forEach 改显式循环（顺序与累加一字不差）。
      for(const choice of choices){
        choice.score-=over(choice.additions)*2.5;
        let attached=0;for(let i=0;i<choice.additions.length;i+=2)if(dist[choice.additions[i]]<=1)attached++;
        // 普通题按枚计数（第 18 轮）：比例把"只贴 1 枚"和"4 枚全贴"判成同分，于是模块可以只留
        // 一枚着地、其余浮在框内——第 17 轮"最差题块数 7→8"就是这种形状（两池实测按枚版把
        // compactPassRate 0.211→0.322、spanMedian 12→11、块最差 8→7/5）。
        // 抓禁手仍用比例：4 个 seed×5 道实测按枚版 naturalScore 0.6628＜无预算 0.6918＜比例版
        // 0.8166，按枚对它是退步（它的末模块要给禁手点留位，奖励"多枚贴格"反而挤坏收尾）。
        // 权重 1.5→3 是第 20 轮扫出来的：over/attached/预算 六档 × 两个池子只有这一档同向，
        // 再拿第三个不重叠的池子（seed 7/8/9）验过——naturalScore 0.8809→0.8929、0.8809→0.9093、
        // 0.8566→0.8816 三池同向，spanMedian 两池降（11→10、12→11），抓禁手 4 seed 池逐字不变。
        choice.score+=ending==='five'?3*attached:(choice.additions.length?4*attached/(choice.additions.length>>1):0);
      }
    }
    if(wovenRouting){
      // Prefer a balanced mix of axes and shared anchors, while retaining a
      // small random tie-breaker so repeated requests do not form one stock
      // diagram. The cap keeps the wider anchor portfolio bounded on phones.
      const axisCounts=[0,0,0,0];for(const axis of routeAxes)axisCounts[axis]++;
      const axisCap=Math.max(2,stage/3);
      for(const choice of choices){const count=axisCounts[choice.axis];choice.score+=(count===0?3:0)-(count>axisCap?1:0);}
    }
    choices.sort((a,b)=>b.score-a.score);
    return wovenRouting?choices.slice(0,256):choices;
  };
  const useCausalFast=diagnostics.causalFast!==false;
  // Changed exterior endpoints are defenders, so their incident causal
  // windows are blocked. The previous attack and all changed interior cells
  // remain in the mask; defender feasibility still checks the complete mask.
  const causal=(choice,stage)=>causalWindows(geometry.windows,affectedFor(choice.data,useCausalFast?choice.changedMask&31:choice.changedMask),cells,attackTime,replyTime,path,blocks,backEnds,stage,depth,attacker,ending,latentThree,windowFor);
  const feasible=(affected,stage)=>{
    if(attacker===1&&rule==='renju'){
      for(let turn=0;turn<plannedWindows.length;turn++){
        const data=plannedWindows[turn];
        if([data.before,data.after].some(q=>q>=0&&(cells[q]===1||attackTime[q]>=0&&attackTime[q]<=turn))){
          diagnostics.overlinePrunes=(diagnostics.overlinePrunes||0)+1;return false;
        }
      }
    }
    // Advancing the prefix also activates the preceding reply, even when its
    // window is disjoint from the new module. Include its incidence explicitly.
    if(!counterFourWindows(geometry.windows,affected,cells,attackTime,replyTime,stage,attacker,rule,windowFor)||
      stage&&!counterFourWindows(geometry.windows,geometry.incidence[blocks[stage-1]],cells,attackTime,replyTime,stage,attacker,rule,windowFor)){
      diagnostics.counterFourPrunes=(diagnostics.counterFourPrunes||0)+1;return false;
    }
    return true;
  };
  const extend=(prev,stage)=>{
    guard.check();nodes++;diagnostics.deepest=Math.max(diagnostics.deepest||0,stage+1);
    const recomputeAt=nodes;
    // 只读诊断：本次构造是不是"撞满节点上限"才停的。深档爬坡要靠它决定翻不翻倍
    // （第 23 轮把随机流解耦之后，翻倍不再重排已有尝试，见规程 P0）。
    if(nodes>constructionNodes){diagnostics.hitCap=true;return false;}
    if(multiStep&&partTurns.some(turns=>turns+depth-1-stage<2))return false;
    if(stage===depth-1){
      if(partCells.some(points=>!points.some(q=>refs[q]))){diagnostics.shapeCoveragePrunes=(diagnostics.shapeCoveragePrunes||0)+1;return false;}
      if(multiStep){
        const usedTurns=plannedWindows.filter(data=>data.points.some(q=>shapeParts[q]>=0)).length;
        const reused=partCells.some(points=>points.some(q=>shapeUses[q]>=2));
        if(partCells.some((points,i)=>partTurns[i]<2||points.filter(q=>shapeUses[q]).length<2)||usedTurns<Math.ceil((depth-1)*.6)||!reused){
          diagnostics.shapeComplexityPrunes=(diagnostics.shapeComplexityPrunes||0)+1;return false;
        }
      }
      if(ending==='forbidden'){
        const reserved=new Set([...(theme?.protectedCells||[]),...[...refs.keys()].filter(q=>refs[q])]);
        if(!addForbiddenConstraints({cells,reserved,path,blocks},size,forbiddenKind,crng,guard,null))return false;
      }
      return true;
    }
    for(const choice of constraints(prev,stage===depth-2,stage)){
      if(nodes>constructionNodes){diagnostics.hitCap=true;return false;}
      {const add=choice.additions;for(let i=0;i<add.length;i+=2){const q=add[i],p=add[i+1];cells[q]=p;present[q]=p;}}
      path.push(choice.attack);blocks.push(choice.reply);backEnds.push(choice.openEnd);
      plannedWindows.push(choice.data);routeAxes.push(choice.axis);routeAnchors.push(anchorsOf(choice.anchorMask,choice.sources));
      let previousAxes,touchedParts;
      for(const q of choice.data.points)if(q!==choice.attack&&q!==choice.reply&&present[q]===attacker){supportUses[q]++;supportAxes[q]|=1<<choice.axis;}
      if(multiStep){
        previousAxes=choice.strokeSupports.map(q=>shapeAxes[q]);touchedParts=[...new Set(choice.strokeSupports.map(q=>shapeParts[q]))];
        for(const q of choice.strokeSupports){shapeUses[q]++;shapeAxes[q]|=1<<choice.axis;}
        for(const part of touchedParts)partTurns[part]++;
      }
      attackTime[choice.attack]=stage;replyTime[choice.reply]=stage;
      present[choice.attack]=attacker;present[choice.reply]=defender;
      for(const q of choice.points)refs[q]++;
      if(causal(choice,stage)&&feasible(affectedFor(choice.data,choice.changedMask),stage)&&extend(choice.attack,stage+1))return true;
      if(multiStep){
        choice.strokeSupports.forEach((q,i)=>{shapeUses[q]--;shapeAxes[q]=previousAxes[i];});
        for(const part of touchedParts)partTurns[part]--;
      }
      for(const q of choice.data.points)if(q!==choice.attack&&q!==choice.reply&&present[q]===attacker){supportUses[q]--;}
      // ⚠️ 这里**必须**保留"重算"：看似更省的"下探压栈、回溯还原旧掩码"实测会改变产出
      // （对拍：同 seed 同参数 D12 s7 节点 80 vs 79、路径第 6 手分叉）——说明重算在修某种
      // 增量写法盖不住的漂移，语义上不是等价改写。没有对拍证据前别再动这一处。
      // 第 29 轮：只做"同节点同格只算一次"的记忆化（G(q) 是纯函数），计算式与调用判据一字未动。
      if(wovenRouting)for(const q of choice.data.points)if(q!==choice.attack&&q!==choice.reply&&present[q]===attacker){
        let mask;
        if(recomputeStamp[q]===recomputeAt)mask=recomputeMask[q];
        else{
          mask=0;
          for(let i=0;i<plannedWindows.length-1;i++)if(plannedWindows[i].points.includes(q))mask|=1<<routeAxes[i];
          recomputeStamp[q]=recomputeAt;recomputeMask[q]=mask;
        }
        supportAxes[q]=mask;
      }
      for(const q of choice.points)refs[q]--;
      attackTime[choice.attack]=-1;replyTime[choice.reply]=-1;
      present[choice.attack]=0;present[choice.reply]=0;
      path.pop();blocks.pop();backEnds.pop();
      plannedWindows.pop();routeAxes.pop();routeAnchors.pop();
      {const add=choice.additions;for(let i=0;i<add.length;i+=2){const q=add[i];cells[q]=0;present[q]=0;}}
    }
    return false;
  };
  const initialStarts=theme?theme.fixed.filter(s=>s.player===attacker).map(s=>s.at):[...cells.keys()];
  // 定序键一次算好：中心距离优先、本地随机数只用于同距离内的平手判序。旧写法在 sort 比较器里
  // 现场抽 rng()，那是一个非常序比较器（结果依赖引擎的排序实现），抽取次数也随实现而变。
  const keyedStarts=initialStarts.map(q=>({q,order:crng(),dist:0}));
  if(wovenRouting&&!theme){
    const center=(size-1)/2;
    for(const k of keyedStarts)k.dist=Math.max(Math.abs(Math.floor(k.q/size)-center),Math.abs(k.q%size-center));
  }
  const starts=keyedStarts.sort((a,b)=>a.dist-b.dist||a.order-b.order).map(x=>x.q);
  if(partCells.length)starts.sort((a,b)=>Number(!partCells[0].includes(a))-Number(!partCells[0].includes(b)));
  for(const start of starts){
    if(nodes>constructionNodes){diagnostics.hitCap=true;break;}
    if(!theme){cells[start]=attacker;present[start]=attacker;}refs[start]++;
    if(extend(start,0)){
      const reserved=new Set([...(theme?.protectedCells||[]),...[...refs.keys()].filter(q=>refs[q]||cells[q])]);
      const supportEntries=[...supportUses].reduce((n,uses)=>n+(uses>1?1:0),0);
      const crossAxisEntries=[...supportAxes].reduce((n,mask)=>n+(mask&&(mask&(mask-1))?1:0),0);
      const axesUsed=new Set(routeAxes).size;
      return {cells,reserved,path:[...path],blocks:[...blocks],nodes,
        network:{ windows:plannedWindows.map(data=>({points:[...data.points],before:data.before,after:data.after})), axes:[...routeAxes], anchors:routeAnchors.map(anchors=>[...anchors]), supportEntries, crossAxisEntries, axesUsed },
        ...(theme?{glyphAnchor:start}:{}),
        compact:{initialAttackers:cells.filter(p=>p===attacker).length,initialDefenders:cells.filter(p=>p===defender).length,
          distinctReserved:reserved.size,deepest:diagnostics.deepest,routingNoise,naturalStyle,wovenRouting, supportEntries, crossAxisEntries, axesUsed}};
    }
    if(!theme){cells[start]=0;present[start]=0;}refs[start]--;
  }
  return null;
}

