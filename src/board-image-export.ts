import { boardAt, depthOf, pathToNode } from "./game";
import type { BoardMark, GameDocument, Position, RecordNode } from "./types";
import { transformBoardPosition, type BoardRotation } from "./board-transform";

export interface BoardShareOptions {
  showMoveNumbers: boolean;
  showCoordinates: boolean;
  showAnnotations: boolean;
  showWatermark: boolean;
  rotation: BoardRotation;
  mirrored: boolean;
}

export const BOARD_SHARE_WIDTH = 1200;
export const BOARD_SHARE_HEIGHT = 1400;

const escapeXml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const safeFilePart = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名棋谱";

const symmetryPoint = (point: Position, transform: number, size: number): Position => {
  let x = point.col;
  let y = point.row;
  if (transform >= 4) y = size - 1 - y;
  const turns = transform >= 4 ? transform - 4 : transform;
  for (let turn = 0; turn < turns; turn += 1) [x, y] = [size - 1 - y, x];
  return { row: y, col: x };
};

const displayMarks = (marks: BoardMark[], board: ReturnType<typeof boardAt>, size: number) => {
  const displayed = new Map<string, BoardMark>();
  marks.forEach((mark) => displayed.set(`${mark.row},${mark.col}`, mark));
  marks.forEach((mark) => {
    if (!mark.nativeSymmetry) return;
    for (let transform = 1; transform < 8; transform += 1) {
      const point = symmetryPoint(mark, transform, size);
      const key = `${point.row},${point.col}`;
      if (!board[point.row]?.[point.col] && !displayed.has(key)) displayed.set(key, { ...mark, ...point });
    }
  });
  marks.filter((mark) => !mark.nativeSymmetry).forEach((mark) => displayed.set(`${mark.row},${mark.col}`, mark));
  return [...displayed.values()];
};

const ruleName = (document: GameDocument) => document.metadata.rule === "renju"
  ? "连珠规则"
  : document.metadata.rule === "standard" ? "标准五子棋" : "无禁手";

const starPoints = (size: number): number[][] => size === 15
  ? [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]
  : size === 19 ? [[3, 3], [3, 15], [9, 9], [15, 3], [15, 15]]
    : [[Math.floor(size / 2), Math.floor(size / 2)]];

const annotationSvg = (mark: BoardMark, x: number, y: number) => {
  const style = mark.style || (mark.kind === "label" ? "text" : mark.kind);
  const color = escapeXml(mark.color || "#9f342d");
  const label = escapeXml(mark.label || "");
  const fontSize = Array.from(mark.label || "").length > 2 ? 20 : 27;
  const text = label ? `<text x="${x}" y="${y + 9}" text-anchor="middle" font-family="ui-monospace, 'Noto Sans SC', sans-serif" font-size="${fontSize}" font-weight="800" fill="${color}" paint-order="stroke" stroke="#f3c77f" stroke-width="3">${label}</text>` : "";
  if (style === "text") return text || `<text x="${x}" y="${y + 9}" text-anchor="middle" font-size="27" font-weight="800" fill="${color}">?</text>`;
  if (style === "circle") return mark.label
    ? `<circle cx="${x}" cy="${y}" r="34" fill="none" stroke="${color}" stroke-width="5"/>${text}`
    : `<circle cx="${x}" cy="${y}" r="11" fill="${color}" opacity=".88"/>`;
  if (style === "triangle") return `<path d="M ${x} ${y - 35} L ${x - 32} ${y + 25} L ${x + 32} ${y + 25} Z" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round"/>${text}`;
  return `<g stroke="${color}" stroke-width="5" stroke-linecap="round"><line x1="${x - 25}" y1="${y - 25}" x2="${x + 25}" y2="${y + 25}"/><line x1="${x + 25}" y1="${y - 25}" x2="${x - 25}" y2="${y + 25}"/></g>${text}`;
};

const visibleVariationSvg = (node: RecordNode, x: number, y: number) => {
  const rawText = (node.boardText || "").trim();
  if (rawText) {
    const text = escapeXml(Array.from(rawText).slice(0, 4).join(""));
    const fontSize = Array.from(rawText).length <= 1 ? 34 : Array.from(rawText).length === 2 ? 28 : 22;
    return `<text x="${x}" y="${y + 9}" text-anchor="middle" font-family="ui-monospace, 'Noto Sans SC', sans-serif" font-size="${fontSize}" font-weight="900" fill="#1d1c19" paint-order="stroke" stroke="#f3c77f" stroke-width="4">${text}</text>`;
  }
  const fill = node.move?.player === "white" ? "#fffaf0" : "#272621";
  const stroke = node.move?.player === "white" ? "#514a40" : "#fff8e8";
  return `<circle cx="${x}" cy="${y}" r="13" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
};

export const boardShareFilename = (document: GameDocument, currentId: string) => {
  const move = depthOf(document, document.nodes[currentId] ? currentId : document.rootId);
  return `${safeFilePart(document.metadata.title)}-第${move}手.png`;
};

export const createBoardShareSvg = (document: GameDocument, currentId: string, options: BoardShareOptions) => {
  const safeCurrentId = document.nodes[currentId] ? currentId : document.rootId;
  const current = document.nodes[safeCurrentId] || document.nodes[document.rootId];
  const board = boardAt(document, safeCurrentId);
  const path = pathToNode(document, safeCurrentId);
  const size = document.metadata.boardSize || 15;
  const moveCount = depthOf(document, safeCurrentId);
  const numbers = new Map<string, number>();
  let turn = 0;
  path.forEach((node) => {
    if (node.move || node.passPlayer) turn += 1;
    if (node.move) numbers.set(`${node.move.row},${node.move.col}`, turn);
  });

  const boardX = 70;
  const boardY = 190;
  const boardPixels = 1060;
  const margin = 64;
  const start = boardX + margin;
  const end = boardX + boardPixels - margin;
  const gap = (end - start) / Math.max(1, size - 1);
  const xy = (point: Position) => ({ x: start + point.col * gap, y: boardY + margin + point.row * gap });
  const visualXy = (point: Position) => xy(transformBoardPosition(point, size, options.rotation, options.mirrored));

  const grid = Array.from({ length: size }, (_, index) => {
    const offset = start + index * gap;
    const row = boardY + margin + index * gap;
    return `<line x1="${start}" y1="${row}" x2="${end}" y2="${row}"/><line x1="${offset}" y1="${boardY + margin}" x2="${offset}" y2="${boardY + boardPixels - margin}"/>`;
  }).join("");
  const stars = starPoints(size).map(([row, col]) => {
    const point = xy({ row, col });
    return `<circle cx="${point.x}" cy="${point.y}" r="7" fill="#55432d"/>`;
  }).join("");
  const coordinates = options.showCoordinates ? Array.from({ length: size }, (_, index) => {
    const x = start + index * gap;
    const y = boardY + margin + index * gap;
    const letter = String.fromCharCode(65 + index);
    const number = size - index;
    return `<g data-export-role="coordinate" fill="#675943" opacity=".8" font-family="ui-monospace, monospace" font-size="18" font-weight="600" text-anchor="middle"><text x="${x}" y="${boardY + 30}">${letter}</text><text x="${x}" y="${boardY + boardPixels - 18}">${letter}</text><text x="${boardX + 27}" y="${y + 6}">${number}</text><text x="${boardX + boardPixels - 27}" y="${y + 6}">${number}</text></g>`;
  }).join("") : "";
  const stones = board.flatMap((row, rowIndex) => row.map((player, colIndex) => {
    if (!player) return "";
     const point = visualXy({ row: rowIndex, col: colIndex });
    const number = numbers.get(`${rowIndex},${colIndex}`);
    const numberText = options.showMoveNumbers && number
      ? `<text data-export-role="move-number" x="${point.x}" y="${point.y + 8}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="24" font-weight="800" fill="${player === "black" ? "#f5efe1" : "#34312b"}">${number}</text>`
      : "";
    const last = !options.showMoveNumbers && current?.move?.row === rowIndex && current.move.col === colIndex
      ? `<circle cx="${point.x}" cy="${point.y}" r="8" fill="#c94c40" stroke="#fff" stroke-width="2"/>`
      : "";
    return `<g data-export-role="stone" filter="url(#shareStoneShadow)"><circle cx="${point.x}" cy="${point.y}" r="${Math.min(32, gap * .43)}" fill="url(#${player === "black" ? "shareBlackStone" : "shareWhiteStone"})" stroke="#0003" stroke-width="1.5"/>${numberText}${last}</g>`;
  })).join("");

  const annotations = options.showAnnotations && current ? [
    ...displayMarks(current.marks || [], board, size).map((mark) => {
       const point = visualXy(mark);
      return `<g data-export-role="annotation">${annotationSvg(mark, point.x, point.y)}</g>`;
    }),
    ...(current.children || []).slice(0, 512).map((id) => document.nodes[id]).filter((node): node is RecordNode => Boolean(node?.move || node?.anchor)).map((node) => {
       const point = visualXy(node.move || node.anchor!);
      return `<g data-export-role="native-annotation">${visibleVariationSvg(node, point.x, point.y)}</g>`;
    }),
  ].join("") : "";

  const title = escapeXml(document.metadata.title || "未命名棋谱");
  const players = [document.metadata.black, document.metadata.white].filter(Boolean).join(" vs ");
  const subtitle = escapeXml(`第 ${moveCount} 手 · ${ruleName(document)}${players ? ` · ${players}` : ""}`);
  const details = [document.metadata.event, document.metadata.date].filter(Boolean).join(" · ");
  const watermark = options.showWatermark
    ? `<g data-export-role="watermark"><circle cx="102" cy="1324" r="25" fill="#365e4b"/><text x="102" y="1333" text-anchor="middle" font-size="24" font-family="serif" font-weight="800" fill="#fff">半</text><text x="142" y="1333" font-size="22" font-family="'Noto Sans SC', sans-serif" font-weight="700" fill="#365e4b">半步五子棋</text></g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_SHARE_WIDTH}" height="${BOARD_SHARE_HEIGHT}" viewBox="0 0 ${BOARD_SHARE_WIDTH} ${BOARD_SHARE_HEIGHT}" role="img" aria-label="${title} 当前局面">
  <defs>
    <radialGradient id="shareBlackStone" cx="30%" cy="24%"><stop offset="0" stop-color="#66645e"/><stop offset=".42" stop-color="#282722"/><stop offset="1" stop-color="#090a09"/></radialGradient>
    <radialGradient id="shareWhiteStone" cx="30%" cy="24%"><stop offset="0" stop-color="#fffef8"/><stop offset=".6" stop-color="#eee7da"/><stop offset="1" stop-color="#aaa397"/></radialGradient>
    <filter id="shareStoneShadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-opacity=".38"/></filter>
    <filter id="shareCardShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#513a1b" flood-opacity=".2"/></filter>
  </defs>
  <rect width="1200" height="1400" fill="#f8f6f1"/>
  <text x="70" y="78" font-family="serif, 'Noto Serif SC'" font-size="43" font-weight="800" fill="#292620">${title}</text>
  <text x="70" y="122" font-family="'Noto Sans SC', sans-serif" font-size="22" fill="#777168">${subtitle}</text>
   <g>
    <rect x="${boardX}" y="${boardY}" width="${boardPixels}" height="${boardPixels}" rx="34" fill="#d8ad69" stroke="#b38343" stroke-width="5" filter="url(#shareCardShadow)"/>
    <g stroke="#594a36" stroke-width="2.4" opacity=".9">${grid}</g>
    ${stars}${coordinates}${stones}${annotations}
  </g>
  ${details ? `<text x="70" y="1288" font-family="'Noto Sans SC', sans-serif" font-size="21" fill="#777168">${escapeXml(details)}</text>` : ""}
  ${watermark}
  <text x="1130" y="1333" text-anchor="end" font-family="ui-monospace, monospace" font-size="18" fill="#9a9489">CURRENT POSITION · ${moveCount}</text>
</svg>`;
};

const loadSvgImage = (svg: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("分享图片 SVG 加载失败")); };
  image.src = url;
});

export const renderBoardSharePng = async (document: GameDocument, currentId: string, options: BoardShareOptions) => {
  const svg = createBoardShareSvg(document, currentId, options);
  const image = await loadSvgImage(svg);
  const canvas = window.document.createElement("canvas");
  canvas.width = BOARD_SHARE_WIDTH;
  canvas.height = BOARD_SHARE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建图片画布");
  context.fillStyle = "#f8f6f1";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("PNG 编码失败"));
  }, "image/png"));
};
