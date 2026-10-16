import { columnName } from '../../game';
import type { GeneratedPuzzle } from './model';

export const PUZZLE_SHARE_WIDTH = 1200;
export const PUZZLE_SHARE_HEIGHT = 1400;

export interface PuzzleShareOptions {
  showCoordinates?: boolean;
  showOutline?: boolean;
  showWatermark?: boolean;
}

const escapeXml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const safeFilePart = (value: string) => value.replace(/[\\/:*?"<>|]/g, '-').trim() || '棋题';

const starPoints = (size: number): ReadonlyArray<readonly [number, number]> => size === 15
  ? [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]
  : size === 19 ? [[3, 3], [3, 15], [9, 9], [15, 3], [15, 15]]
    : [[Math.floor(size / 2), Math.floor(size / 2)]];

export const puzzleShareFilename = (puzzle: GeneratedPuzzle) => `${safeFilePart(puzzle.title)}-${puzzle.size}路.png`;

const titleDetail = (puzzle: GeneratedPuzzle) => {
  const attacker = puzzle.attacker === 'black' ? '黑先' : '白先';
  const rule = puzzle.rules === 'renju' ? '有禁手' : '无禁手';
  const kind = puzzle.ending === 'forbidden' ? '抓禁手' : puzzle.theme?.text ? '文字题' : puzzle.theme?.kind === 'shape' ? '图案题' : 'VCF';
  return `${kind} · ${attacker} · ${puzzle.depth} 手 · ${puzzle.size}×${puzzle.size} · ${rule}`;
};

export const createPuzzleShareSvg = (puzzle: GeneratedPuzzle, options: PuzzleShareOptions = {}) => {
  const size = Math.max(5, Math.min(30, Math.floor(puzzle.size)));
  const boardX = 70;
  const boardY = 190;
  const boardPixels = 1060;
  const margin = size > 24 ? 70 : 64;
  const start = boardX + margin;
  const end = boardX + boardPixels - margin;
  const gap = (end - start) / Math.max(1, size - 1);
  const xy = (row: number, col: number) => ({ x: start + col * gap, y: boardY + margin + row * gap });
  const showCoordinates = options.showCoordinates !== false;
  const showOutline = options.showOutline !== false;
  const fixed = new Set((puzzle.theme?.fixed || []).map((stone) => stone.at));
  const critical = new Set((puzzle.theme?.critical || []).map((stone) => stone.at));
  const grid = Array.from({ length: size }, (_, index) => {
    const offset = start + index * gap;
    const row = boardY + margin + index * gap;
    return `<line x1="${start}" y1="${row}" x2="${end}" y2="${row}"/><line x1="${offset}" y1="${boardY + margin}" x2="${offset}" y2="${boardY + boardPixels - margin}"/>`;
  }).join('');
  const stars = starPoints(size).map(([row, col]) => {
    const point = xy(row, col);
    return `<circle cx="${point.x}" cy="${point.y}" r="7" fill="#55432d"/>`;
  }).join('');
  const coordinates = showCoordinates ? Array.from({ length: size }, (_, index) => {
    const point = xy(index, index);
    const letter = columnName(index);
    const number = size - index;
    return `<g data-export-role="coordinate" fill="#675943" opacity=".8" font-family="ui-monospace, monospace" font-size="18" font-weight="600" text-anchor="middle"><text x="${point.x}" y="${boardY + 30}">${letter}</text><text x="${point.x}" y="${boardY + boardPixels - 18}">${letter}</text><text x="${boardX + 27}" y="${point.y + 6}">${number}</text><text x="${boardX + boardPixels - 27}" y="${point.y + 6}">${number}</text></g>`;
  }).join('') : '';
  const stones = [
    ...puzzle.stones.black.map((stone) => ({ ...stone, player: 'black' as const })),
    ...puzzle.stones.white.map((stone) => ({ ...stone, player: 'white' as const })),
  ].map((stone) => {
    const point = xy(stone.row, stone.col);
    const at = stone.row * size + stone.col;
    const stoneRadius = Math.min(32, gap * .43);
    const fill = stone.player === 'black' ? 'url(#puzzleBlackStone)' : 'url(#puzzleWhiteStone)';
    const textFill = stone.player === 'black' ? '#f5efe1' : '#34312b';
    const ring = showOutline && fixed.has(at)
      ? `<circle cx="${point.x}" cy="${point.y}" r="${stoneRadius + 5}" fill="none" stroke="#2171b8" stroke-width="3"/>`
      : '';
    const criticalRing = showOutline && critical.has(at)
      ? `<circle cx="${point.x}" cy="${point.y}" r="${Math.max(8, stoneRadius - 4)}" fill="none" stroke="#c256df" stroke-width="3"/>`
      : '';
    return `<g data-export-role="stone" filter="url(#puzzleStoneShadow)"><circle cx="${point.x}" cy="${point.y}" r="${stoneRadius}" fill="${fill}" stroke="#0003" stroke-width="1.5"/>${ring}${criticalRing}<text x="${point.x}" y="${point.y + stoneRadius * .3}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="${Math.max(13, stoneRadius * .72)}" font-weight="800" fill="${textFill}">${escapeXml('')}</text></g>`;
  }).join('');
  const themeLabel = puzzle.theme?.text || (puzzle.theme?.kind === 'shape' ? '图案题面' : '');
  const subtitle = escapeXml(titleDetail(puzzle));
  const title = escapeXml(puzzle.title || '未命名棋题');
  const detail = escapeXml(themeLabel ? `题面：${themeLabel}` : '生成后经独立验题通过');
  const watermark = options.showWatermark === false ? '' : '<g data-export-role="watermark"><circle cx="102" cy="1324" r="25" fill="#365e4b"/><text x="102" y="1333" text-anchor="middle" font-size="24" font-family="serif" font-weight="800" fill="#fff">半</text><text x="142" y="1333" font-size="22" font-family="\'Noto Sans SC\', sans-serif" font-weight="700" fill="#365e4b">半步五子棋</text></g>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PUZZLE_SHARE_WIDTH}" height="${PUZZLE_SHARE_HEIGHT}" viewBox="0 0 ${PUZZLE_SHARE_WIDTH} ${PUZZLE_SHARE_HEIGHT}" role="img" aria-label="${title}">
  <defs>
    <radialGradient id="puzzleBlackStone" cx="30%" cy="24%"><stop offset="0" stop-color="#66645e"/><stop offset=".42" stop-color="#282722"/><stop offset="1" stop-color="#090a09"/></radialGradient>
    <radialGradient id="puzzleWhiteStone" cx="30%" cy="24%"><stop offset="0" stop-color="#fffef8"/><stop offset=".6" stop-color="#eee7da"/><stop offset="1" stop-color="#aaa397"/></radialGradient>
    <filter id="puzzleStoneShadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-opacity=".38"/></filter>
    <filter id="puzzleCardShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#513a1b" flood-opacity=".2"/></filter>
  </defs>
  <rect width="1200" height="1400" fill="#f8f6f1"/>
  <text x="70" y="78" font-family="serif, 'Noto Serif SC'" font-size="43" font-weight="800" fill="#292620">${title}</text>
  <text x="70" y="122" font-family="'Noto Sans SC', sans-serif" font-size="22" fill="#777168">${subtitle}</text>
  <g><rect x="${boardX}" y="${boardY}" width="${boardPixels}" height="${boardPixels}" rx="34" fill="#d8ad69" stroke="#b38343" stroke-width="5" filter="url(#puzzleCardShadow)"/><g stroke="#594a36" stroke-width="2.4" opacity=".9">${grid}</g>${stars}${coordinates}${stones}</g>
  <text x="70" y="1288" font-family="'Noto Sans SC', sans-serif" font-size="21" fill="#777168">${detail}</text>
  ${watermark}
  <text x="1130" y="1333" text-anchor="end" font-family="ui-monospace, monospace" font-size="18" fill="#9a9489">PUZZLE · ${escapeXml(puzzle.id.slice(0, 12))}</text>
</svg>`;
};

const loadSvgImage = (svg: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('棋题分享图片 SVG 加载失败')); };
  image.src = url;
});

export const renderPuzzleSharePng = async (puzzle: GeneratedPuzzle, options: PuzzleShareOptions = {}) => {
  const image = await loadSvgImage(createPuzzleShareSvg(puzzle, options));
  const canvas = window.document.createElement('canvas');
  canvas.width = PUZZLE_SHARE_WIDTH;
  canvas.height = PUZZLE_SHARE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建图片画布');
  context.fillStyle = '#f8f6f1';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('PNG 编码失败'));
  }, 'image/png'));
};
