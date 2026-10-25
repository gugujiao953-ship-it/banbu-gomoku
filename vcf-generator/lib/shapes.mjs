// These are drawing outlines, never puzzle positions or stored solutions.
function outline(width,height,lines,dots=[]){
  const rows=Array.from({length:height},()=>Array(width).fill('0'));
  const put=(x,y)=>{if(x>=0&&x<width&&y>=0&&y<height)rows[y][x]='1';};
  for(const line of lines)for(let i=1;i<line.length;i++){
    let [x,y]=line[i-1];const [tx,ty]=line[i],dx=Math.abs(tx-x),dy=-Math.abs(ty-y),sx=x<tx?1:-1,sy=y<ty?1:-1;
    let error=dx+dy;
    for(;;){put(x,y);if(x===tx&&y===ty)break;const e=2*error;if(e>=dy){error+=dy;x+=sx;}if(e<=dx){error+=dx;y+=sy;}}
  }
  for(const [x,y]of dots)put(x,y);
  return rows.map(row=>row.join(''));
}
const FISH=outline(19,13,[
  [[5,6],[7,3],[10,2],[13,2],[16,4],[18,6],[16,8],[13,10],[10,10],[7,9],[5,6]],
  [[5,6],[0,2],[0,10],[5,6]],[[9,3],[10,0],[12,2]],
],[[14,5]]);
const CAT=outline(15,17,[
  [[3,7],[2,1],[6,4],[8,4],[12,1],[11,7],[10,8],[10,10],[12,12],[12,16],[3,16],[3,12],[5,10],[5,8],[3,7]],
  [[12,13],[14,11],[14,9]],[[7,13],[7,16]],
],[[4,6],[9,6],[7,7]]);
const SMALL_FISH=outline(13,9,[
  [[4,4],[6,2],[8,1],[10,2],[12,4],[10,6],[8,7],[6,6],[4,4]],
  [[4,4],[0,1],[0,7],[4,4]],[[6,2],[7,0],[9,1]],
],[[9,3]]);
const SMALL_CAT=outline(11,13,[
  [[2,5],[1,0],[4,2],[6,2],[9,0],[8,5],[7,6],[7,8],[9,10],[9,12],[2,12],[2,10],[4,8],[4,6],[2,5]],
  [[9,10],[10,8],[10,6]],[[5,10],[5,12]],
],[[3,4],[7,4],[5,5]]);
const HEART=outline(11,9,[[[5,8],[0,3],[0,1],[2,0],[4,1],[5,2],[6,1],[8,0],[10,1],[10,3],[5,8]]]);
const STAR=outline(11,11,[[[5,0],[6,4],[10,4],[7,6],[8,10],[5,8],[2,10],[3,6],[0,4],[4,4],[5,0]]]);
const ascii=rows=>rows.map(row=>row.replace(/[^#1]/g,'0').replace(/[#1]/g,'1'));
const MOON=ascii(['00011000000','00111100000','01111100000','01111110000','11111110000','11111110000','11111110000','01111110000','01111100000','00111100000','00011000000']);
const SUN=ascii(['00001000000','00101010000','00011100000','01111111000','00111110000','11111111100','00111110000','01111111000','00011100000','00101010000','00001000000']);
const CLOUD=ascii(['000001100000000','000111111000000','001111111100000','011111111110000','111111111111000','111111111111100','111111111111100','011111111111000','001111111100000']);
const HOUSE=ascii(['0000010000000','0000111000000','0001111100000','0011111110000','0111111111000','1111111111100','0011111110000','0011111110000','0011000110000','0011000110000','0011111110000','0011111110000','0011111110000']);
const FLOWER=ascii(['0000100000000','0001110000000','0011111000000','0001110000000','0000100000000','0000100000000','0011111000000','0111111100000','0011111000000','0000100000000','0000100000000','0001100000000','0001000000000']);
const BUTTERFLY=ascii(['110000001100000','111000011100000','111100111100000','011111111000000','001111110000000','011111111000000','111100111100000','111000011100000','110000001100000','000000100000000','000001110000000','000000100000000','000000100000000']);
const RABBIT=ascii(['0001100110000','0011111111000','0111111111100','0110110111100','0111111111100','0011111111000','0001111110000','0000111100000','0001111110000','0011111111000','0111111111100','0111100111100','0111100111100','0011000011000','0011000011000','0110000001100','0100000000100']);
const TREE=ascii(['0000010000000','0000111000000','0001111100000','0011111110000','0111111111000','1111111111100','0000111000000','0000111000000','0011111110000','0111111111000','1111111111100','0000111000000','0000111000000','0000111000000','0011111110000']);
const ROCKET=ascii(['00000100000','00001100000','00011100000','00111110000','01111111000','11111111100','11111111100','11111111100','01111111000','00111110000','00111110000','00111110000','01111111000','01101101100','01000000100','00011011000','00001000000']);
function split(mask,definitions){
  return definitions.map(({id,label,contains})=>({id,label,points:mask.flatMap((row,r)=>[...row].flatMap((bit,c)=>bit==='1'&&contains(r,c)?[{row:r,col:c}]:[]))}));
}
const CATALOG={
  fish:{id:'fish',label:'小鱼',mask:FISH,parts:split(FISH,[{id:'tail',label:'鱼尾',contains:(r,c)=>c<5},{id:'body',label:'鱼身与鱼头',contains:(r,c)=>c>=5}])},
  cat:{id:'cat',label:'小猫',mask:CAT,parts:split(CAT,[{id:'head',label:'猫头与耳朵',contains:r=>r<=8},{id:'body',label:'猫身与尾巴',contains:r=>r>8}])},
  'fish-small':{id:'fish-small',label:'小鱼（小轮廓）',mask:SMALL_FISH,parts:split(SMALL_FISH,[{id:'tail',label:'鱼尾',contains:(r,c)=>c<4},{id:'body',label:'鱼身与鱼头',contains:(r,c)=>c>=4}])},
  'cat-small':{id:'cat-small',label:'小猫（小轮廓）',mask:SMALL_CAT,parts:split(SMALL_CAT,[{id:'head',label:'猫头与耳朵',contains:r=>r<=6},{id:'body',label:'猫身与尾巴',contains:r=>r>6}])},
  heart:{id:'heart',label:'爱心',mask:HEART,parts:split(HEART,[{id:'left',label:'左半心',contains:(r,c)=>c<5},{id:'right',label:'右半心',contains:(r,c)=>c>=5}])},
  star:{id:'star',label:'星星',mask:STAR,parts:split(STAR,[{id:'left',label:'左侧星角',contains:(r,c)=>c<5},{id:'right',label:'右侧星角',contains:(r,c)=>c>=5}])},
  moon:{id:'moon',label:'月亮',mask:MOON},
  sun:{id:'sun',label:'太阳',mask:SUN},
  cloud:{id:'cloud',label:'云朵',mask:CLOUD},
  house:{id:'house',label:'房子',mask:HOUSE},
  flower:{id:'flower',label:'花朵',mask:FLOWER},
  butterfly:{id:'butterfly',label:'蝴蝶',mask:BUTTERFLY},
  rabbit:{id:'rabbit',label:'兔子',mask:RABBIT},
  tree:{id:'tree',label:'树',mask:TREE},
  rocket:{id:'rocket',label:'火箭',mask:ROCKET},
};
const aliases={'小鱼':'fish','鱼':'fish','小猫':'cat','猫':'cat','爱心':'heart','心':'heart','星星':'star','月亮':'moon','月':'moon','太阳':'sun','云朵':'cloud','云':'cloud','房子':'house','花':'flower','花朵':'flower','蝴蝶':'butterfly','兔子':'rabbit','兔':'rabbit','树':'tree','火箭':'rocket'};
const validLabel=value=>typeof value==='string'&&value.trim().length>0&&[...value].length<=40&&!/[\p{Cc}\p{Cf}]/u.test(value);

export function validateShape(shape){
  if(!shape||typeof shape!=='object'||Array.isArray(shape)||!validLabel(shape.label))throw new Error('Shape requires a visible label');
  if(shape.id!==undefined&&(typeof shape.id!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(shape.id)))throw new Error('Invalid shape id');
  const {mask}=shape;
  if(!Array.isArray(mask)||!mask.length||mask.length>28||mask.some(row=>typeof row!=='string'||!/^[01]+$/.test(row)||row.length!==mask[0].length)||mask[0].length>28||!mask.some(row=>row.includes('1')))throw new Error('Shape mask must be nonempty rectangular binary rows within 28 x 28');
  const parts=shape.parts??[{id:'outline',label:'整个轮廓',points:mask.flatMap((row,r)=>[...row].flatMap((bit,c)=>bit==='1'?[{row:r,col:c}]:[]))}];
  if(!Array.isArray(parts)||!parts.length||parts.length>16)throw new Error('Shape requires 1..16 parts');
  const ids=new Set(),covered=new Set();
  for(const part of parts){
    if(!part||typeof part.id!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(part.id)||ids.has(part.id)||!validLabel(part.label)||!Array.isArray(part.points)||!part.points.length)throw new Error('Invalid shape part');
    ids.add(part.id);
    for(const point of part.points){
      if(!point||!Number.isInteger(point.row)||!Number.isInteger(point.col)||mask[point.row]?.[point.col]!=='1')throw new Error('Shape part contains a point outside its outline');
      const key=point.row+':'+point.col;if(covered.has(key))throw new Error('Shape parts overlap');covered.add(key);
    }
  }
  if(covered.size!==mask.reduce((n,row)=>n+[...row].filter(bit=>bit==='1').length,0))throw new Error('Shape parts do not cover the whole outline');
  return {id:shape.id??'custom',label:shape.label,mask:[...mask],parts:structuredClone(parts)};
}

export function shapeDefinition(input){
  if(typeof input==='string'){
    const id=aliases[input]??input;
    if(!CATALOG[id])throw new Error('Unknown shape; use a built-in outline, a Chinese alias, or a custom shape JSON');
    return {...validateShape(CATALOG[id]),source:'builtin-outline'};
  }
  return {...validateShape(input),source:'custom-mask'};
}

export function prepareShapeOptions(options={}){
  if(options.shapeComplexity!==undefined&&!['standard','multi-step'].includes(options.shapeComplexity))throw new Error('shapeComplexity must be standard or multi-step');
  if(options.shapeComplexity!==undefined&&options.shape===undefined&&options.shapeInfo===undefined)throw new Error('Shape complexity requires a shape');
  if(options.shape===undefined&&options.shapeInfo===undefined)return {...options};
  if(options.text||options.textRaster||options.glyphParticipation!==undefined)throw new Error('Shape and text options must not be combined');
  const info=options.shapeInfo?{...validateShape(options.shapeInfo),source:options.shapeInfo.source}:shapeDefinition(options.shape);
  if(!['builtin-outline','custom-mask'].includes(info.source))throw new Error('Invalid shape source');
  // Multi-step certification requires two distinct initial attacker strokes
  // in every part. Reject an impossible one-point part before construction so
  // a hand-drawn mask cannot spend its whole search budget on guaranteed
  // `shapeComplexity` failures.
  if(options.shapeComplexity==='multi-step' && info.parts.some(part=>part.points.length<2))
    throw new Error('Multi-step shape participation requires at least two points in every part');
  if(options.shapeInfo&&options.shape!==undefined&&options.shape!==info.id)throw new Error('Prepared shape id differs from its outline');
  if(info.source==='builtin-outline'&&JSON.stringify(info)!==JSON.stringify(shapeDefinition(info.id)))throw new Error('Builtin shape differs from its outline');
  if(options.shapeInfo&&options.mask&&JSON.stringify(options.mask)!==JSON.stringify(info.mask))throw new Error('Prepared shape mask differs from its outline');
  if(!options.shapeInfo&&options.mask)throw new Error('Put custom mask rows inside the shape definition');
  if(options.unrestrictedSize||options.maxSize>30||typeof options.size==='number'&&options.size>30)throw new Error('Shape puzzles are limited to 30 lines');
  return {...options,shape:info.id,shapeInfo:info,mask:info.mask,maxSize:options.maxSize??30};
}

export function shapeBoxes(info){
  return info.parts.map(part=>{
    const rows=part.points.map(p=>p.row),cols=part.points.map(p=>p.col),row=Math.min(...rows),col=Math.min(...cols);
    return {...part,row,col,height:Math.max(...rows)-row+1,width:Math.max(...cols)-col+1};
  });
}
