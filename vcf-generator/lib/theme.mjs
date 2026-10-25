// Small explicit glyphs are portable, reproducible, and need no font/Canvas.
// An arbitrary user mask can supply larger typefaces or a custom silhouette.
const GLYPHS = {
  '国': ['111111111','100000001','101111101','100010001','101111101','100010101','101111101','100000001','111111111'],
  '庆': ['000010000','001111111','001000000','001001000','001001000','001111110','010001000','010010100','100100010'],
  '中': ['000010000','000010000','011111110','010010010','010010010','011111110','000010000','000010000','000010000'],
  '秋': ['001000100','111000101','001001010','111000100','011000100','101000100','001001010','001010001','001100001'],
};

export function textMask(text) {
  const chars = [...text];
  if (!chars.length || chars.some(ch => !GLYPHS[ch])) throw new Error('Built-in text supports 国、庆、中、秋; use --mask for other glyphs');
  return Array.from({ length: 9 }, (_, row) => chars.map(ch => GLYPHS[ch][row]).join('00'));
}

export function makeTheme(size, { text, mask, origin, phase = 0, colorSeed } = {}) {
  if (!text && !mask) return null;
  const rows = mask || textMask(text);
  if (!Array.isArray(rows) || !rows.length || rows.some(row => typeof row !== 'string' || !/^[01]+$/.test(row) || row.length !== rows[0].length)) throw new Error('Mask must be rectangular strings of 0/1');
  const height = rows.length, width = rows[0].length;
  const row = origin?.row ?? size - height - 2, col = origin?.col ?? size - width - 2;
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row + height >= size || col + width >= size) throw new Error('Board is too small for the holiday mask and its margin');
  const fixed = [], protectedCells = new Set();
  let state=colorSeed??7919+phase;
  const rnd=()=>{state=Math.imul(state,1664525)+1013904223|0;return(state>>>0)/4294967296;};
  for (let r = row - 1; r <= row + height; r++) for (let c = col - 1; c <= col + width; c++) if (r >= 0 && c >= 0) protectedCells.add(r * size + c);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) if (rows[r][c] === '1') {
    // 2r+c mod 4 avoids monochrome runs of >=3 on ANY of the four axes.
    fixed.push({ at: (r + row) * size + c + col, player: colorSeed===undefined?((2 * r + c + phase) % 4 < 2 ? 1 : 2):(rnd()<.5?1:2) });
  }
  // A sparse character can still make a broken three even when solid strokes
  // alternate colours. Solve the local two-colour constraints on ALL five-
  // windows: >=3 occupied stroke points must not all have the same colour.
  // This avoids a pre-existing short VCF elsewhere in the printed character.
  const byAt = new Map(fixed.map((s,i)=>[s.at,i])), clauses = [], seen = new Set();
  for (const stone of fixed) for (const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]) for (let start=-4;start<=0;start++) {
    const ar=Math.floor(stone.at/size),ac=stone.at%size, ids=[];
    let valid=true;
    for(let k=0;k<5;k++) {
      const r=ar+(start+k)*dr,c=ac+(start+k)*dc;
      if(r<0||r>=size||c<0||c>=size){valid=false;break;}
      if(byAt.has(r*size+c)) ids.push(byAt.get(r*size+c));
    }
    const key=ids.slice().sort((a,b)=>a-b).join(',');
    if(valid&&ids.length>=3&&!seen.has(key)){clauses.push(ids);seen.add(key);}
  }
  let solved=false;
  for(let attempt=0;attempt<10000;attempt++) {
    const bad=clauses.filter(ids=>ids.every(i=>fixed[i].player===fixed[ids[0]].player));
    if(!bad.length){solved=true;break;}
    const group=bad[Math.floor(rnd()*bad.length)],at=group[Math.floor(rnd()*group.length)];
    fixed[at].player=3-fixed[at].player;
  }
  if(!solved)throw new Error('Could not safely colour the glyph; choose another mask or spacing');
  return { text: text || 'custom', mask: rows, row, col, height, width, fixed, protectedCells };
}
