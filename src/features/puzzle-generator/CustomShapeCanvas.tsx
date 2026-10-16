import { Eraser, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';

const GRID = 28;
const CANVAS_SIZE = 336;
const CELL = CANVAS_SIZE / GRID;

export interface CustomShapeCanvasProps {
  mask: string[];
  onChange: (mask: string[]) => void;
}

function toGrid(mask: string[]) {
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill(false));
  const height = Math.min(GRID, mask.length);
  for (let row = 0; row < height; row++) {
    const line = mask[row] || '';
    for (let col = 0; col < Math.min(GRID, line.length); col++) grid[row][col] = line[col] === '1';
  }
  return grid;
}

function trimGrid(grid: boolean[][]) {
  let minRow = GRID, minCol = GRID, maxRow = -1, maxCol = -1;
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) if (grid[row][col]) {
    minRow = Math.min(minRow, row); minCol = Math.min(minCol, col);
    maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
  }
  if (maxRow < 0) return ['0'];
  return grid.slice(minRow, maxRow + 1).map(row => row.slice(minCol, maxCol + 1).map(cell => cell ? '1' : '0').join(''));
}

export function CustomShapeCanvas({ mask, onChange }: CustomShapeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<'draw' | 'erase'>('draw');
  const [historySize, setHistorySize] = useState(0);
  const gridRef = useRef(toGrid(mask));
  const historyRef = useRef<boolean[][][]>([]);
  const drawingRef = useRef(false);

  useEffect(() => { gridRef.current = toGrid(mask); drawCanvas(canvasRef.current, gridRef.current); }, [mask]);
  useEffect(() => { drawCanvas(canvasRef.current, gridRef.current); }, []);

  const paint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Do not clamp outside events to cell (0, 0). On mobile, the first
    // pointer event can arrive just outside the canvas while the modal settles.
    if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) return;
    const col = Math.floor((event.clientX - rect.left) / rect.width * GRID);
    const row = Math.floor((event.clientY - rect.top) / rect.height * GRID);
    const next = tool === 'draw';
    if (gridRef.current[row][col] === next) return;
    gridRef.current[row][col] = next;
    drawCanvas(canvas, gridRef.current);
    onChange(trimGrid(gridRef.current));
  };

  const clear = () => {
    historyRef.current.push(gridRef.current.map(row => [...row]));
    setHistorySize(historyRef.current.length);
    gridRef.current = Array.from({ length: GRID }, () => Array(GRID).fill(false));
    drawCanvas(canvasRef.current, gridRef.current);
    onChange(['0']);
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setHistorySize(historyRef.current.length);
    gridRef.current = previous;
    drawCanvas(canvasRef.current, gridRef.current);
    onChange(trimGrid(gridRef.current));
  };

  return <div className="shape-canvas-editor">
    <div className="shape-canvas-toolbar" role="toolbar" aria-label="图案画笔工具">
      <button type="button" className={tool === 'draw' ? 'is-active' : ''} aria-pressed={tool === 'draw'} onClick={() => setTool('draw')}><Pencil size={16}/>画笔</button>
      <button type="button" className={tool === 'erase' ? 'is-active' : ''} aria-pressed={tool === 'erase'} onClick={() => setTool('erase')}><Eraser size={16}/>橡皮</button>
      <button type="button" onClick={clear} aria-label="清空图案"><Trash2 size={16}/>清空</button>
      <button type="button" onClick={undo} disabled={historySize === 0} aria-label="撤销上一次笔画"><RotateCcw size={16}/>撤销</button>
    </div>
    <canvas ref={canvasRef} className="shape-canvas" width={CANVAS_SIZE} height={CANVAS_SIZE} role="img" aria-label="自定义图案点阵画布"
      onPointerDown={event => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) return; event.currentTarget.setPointerCapture(event.pointerId); historyRef.current.push(gridRef.current.map(row => [...row])); setHistorySize(historyRef.current.length); drawingRef.current = true; paint(event); }}
      onPointerMove={event => { if (drawingRef.current) paint(event); }}
      onPointerUp={() => { drawingRef.current = false; }} onPointerCancel={() => { drawingRef.current = false; }} />
    <div className="shape-canvas-caption"><span>拖动手指绘制</span><span>{Math.max(mask.length, 1)} × {Math.max(mask[0]?.length || 1, 1)} 路已识别</span></div>
  </div>;
}

function drawCanvas(canvas: HTMLCanvasElement | null, grid: boolean[][]) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const styles = getComputedStyle(canvas);
  context.fillStyle = styles.getPropertyValue('--surface-2').trim() || '#f2ead8'; context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.strokeStyle = styles.getPropertyValue('--line').trim() || 'rgba(91, 74, 53, .22)'; context.globalAlpha = .6; context.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) { const at = i * CELL + .5; context.beginPath(); context.moveTo(at, 0); context.lineTo(at, CANVAS_SIZE); context.stroke(); context.beginPath(); context.moveTo(0, at); context.lineTo(CANVAS_SIZE, at); context.stroke(); }
  context.globalAlpha = 1; context.fillStyle = styles.getPropertyValue('--green').trim() || '#276b57';
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) if (grid[row][col]) {
    context.fillRect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2);
  }
}
