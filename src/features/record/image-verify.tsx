import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Cpu, Eye, EyeOff, Eraser, HelpCircle, ListPlus, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import type { Cell } from "../../types";
import "./image-verify.css";

export interface RecognitionGrid {
  originX: number;
  originY: number;
  spacingX: number;
  spacingY: number;
}

interface Props {
  url: string;
  name: string;
  board: Cell[][];
  boardSize: number;
  /**
   * 棋盘**被整份替换**的版本号（2026-10-13）：导入、复原出结果、AI 回填时由调用方 +1。
   * 以前这里靠 `board` 的引用变化来重置本地编辑态，而现在用户的每一下「去子/改色」都会
   * 实时回传给调用方（见 onBoardChange）——再用引用当依赖，就会「边改边被重置」。
   */
  boardRevision: number;
  /** 用户在核对屏改过的棋盘（去子/补子/改色/整体位移）实时回传：复原那一趟要按它读号，
   *  否则用户删掉的子会在复原时被重新找回来（用户 2026-10-13 报的正是这条）。 */
  onBoardChange?: (board: Cell[][]) => void;
  grid: RecognitionGrid | null;
  gridCanvas: { width: number; height: number } | null;
  note: string;
  confidence: number;
  /** 已按序号复原手序时不允许改子：改一颗就会让「1..N 完整序号」这个前提失效。 */
  editable: boolean;
  /** 叠图棋子上要印的手序号（键 "row,col"）：复原成功后填入；仅部分读出时也用它标能读到的号。 */
  numberAt: Record<string, number>;
  /** 「复原手序-本地」：用本应用识别器重跑序号匹配（正式功能，09-28 转正）。 */
  localRestoreBusy: boolean;
  onLocalRestore: () => void;
  /**
   * 复原后续动作（用户 2026-10-09）：**试过复原但没凑齐完整手序**时，弹出两个按钮——
   *  · 「重新识别」：整盘从头再读一遍（与第一次复原同一条路，用于怀疑上次读漏了）；
   *  · 「补全识别」：只对**上次没读到的那些子**重读——已读准的号直接沿用，所以这一趟
   *    便宜得多，而且能把预算集中花在难读的少数几颗上。
   * 只有 `restoreAttempted && readCount < stoneCount` 时渲染这组按钮。
   */
  restoreAttempted: boolean;
  readCount: number;
  stoneCount: number;
  reRestoreBusy: boolean;
  onReRestore: () => void;
  completeRestoreBusy: boolean;
  onCompleteRestore: () => void;
  /** 「复原手序-云端」：把图发给用户配置的识图大模型读序号。 */
  aiRestoreConfigured: boolean;
  aiRestoreBusy: boolean;
  onAiRestore: () => void;
  /** 「AI 辅助识别」（2026-10-02，本地为主、云端为辅）：本地读错时一键让
   *  大模型重读整盘，局面+手序一次返回。
   *  ⚠ 入口按用户 2026-10-02 要求**暂时移除**（「这个功能暂时不加」）——接线保留，
   *  以后要恢复时把下面 panel 里对应的按钮组加回来即可。 */
  aiRecogBusy: boolean;
  onAiRecog: () => void;
  onConfirm: (board: Cell[][]) => void;
  onBack: () => void;
  onCancel: () => void;
}

type ViewMode = "overlay" | "photo" | "result";
type EditTool = "place" | "erase";
type Point = { row: number; col: number };

const coordLabel = (point: Point, boardSize: number) => `${String.fromCharCode(65 + point.col)}${boardSize - point.row}`;

/**
 * 叠图核对（用户 09-17）：把识别结果按识别到的网格画回原图，半透明叠着看，
 * 一眼就能发现「多一颗 / 少一颗 / 黑白反了 / 整体错一格」。
 *
 * 09-23 改版（用户）：**闪烁对比换成显式的「编辑」模式**。
 *  - 闪烁每 650ms 翻转一次整张大图的可见性，低端 WebView 上等于不停全量重绘——
 *    「导入时对比也卡」的主要来源就是它。而且静态叠图已经能看出偏差，闪烁的
 *    增量价值撑不起这个代价。原图/叠图/只看识别三个静态看法保留，顺序为
 *    只看识别 / 叠图 / 只看原图 / 编辑（用户 09-23 二改钦定）。
 *  - 编辑不再是「点一下就改」的隐式行为（黑→白→删循环，误触即改），而是进入
 *    显式模式：右上角「编辑中」徽标 + 退出按钮，底部工具行——黑白切换（固定档，
 *    不再一手一手循环）、放子、去子；另有**整盘位移**四向按钮常驻（用户 09-23
 *    二改：「移子」指编辑面板里那种整体位移，不是挪单颗；按钮不用先选子就出现）。
 *    位移语义与编辑面板一致：有棋子会移出棋盘时直接拒绝、不静默裁剪。
 *
 *  为什么用 SVG 覆盖层而不是画到 canvas 上：识别结果的格子数量级只有几百，
 *  SVG 直接按交叉点画圆最省事，而且能跟着 CSS 一起过主题（描边用语义 token）。
 */
export function ImageVerifyScreen({ url, name, board, boardRevision, onBoardChange, boardSize, grid, gridCanvas, note, confidence, editable, numberAt, localRestoreBusy, onLocalRestore, restoreAttempted, readCount, stoneCount, reRestoreBusy, onReRestore, completeRestoreBusy, onCompleteRestore, aiRestoreConfigured, aiRestoreBusy, onAiRestore, aiRecogBusy, onAiRecog, onConfirm, onBack, onCancel }: Props) {
  const [cells, setCells] = useState<Cell[][]>(() => board.map((row) => [...row]));
  const [view, setView] = useState<ViewMode>("overlay");
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<EditTool>("place");
  const [player, setPlayer] = useState<"black" | "white">("black");
  const [hint, setHint] = useState("");
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageBox, setImageBox] = useState({ width: 0, height: 0 });

  // 只在「棋盘被整份替换」时重置本地编辑态（导入 / 复原出结果 / AI 回填都会让调用方把
  // boardRevision +1）。不再拿 board 的引用当依赖——用户每一下编辑都会实时回传，
  // 用引用做依赖会变成「边改边被重置」。
  useEffect(() => { setCells(board.map((row) => [...row])); }, [boardRevision]);

  // 用户的每一下编辑都实时回传给调用方（复原那一趟要按它读号，否则他删掉的子会被找回）。
  // 用 effect 汇报、回调走 ref：一是别在 setCells 的更新函数里做副作用（StrictMode 下
  // 更新函数可能被调用两次），二是回调每次渲染都是新函数，进依赖会变成无限循环。
  const boardChangeRef = useRef(onBoardChange);
  boardChangeRef.current = onBoardChange;
  useEffect(() => { boardChangeRef.current?.(cells); }, [cells]);

  // 退出编辑时清掉操作提示，别把上一句带进下次编辑。
  useEffect(() => {
    if (!editing) setHint("");
  }, [editing]);

  // 图片按容器宽度自适应，量出真实显示尺寸后覆盖层才能按比例落点。
  useEffect(() => {
    const measure = () => {
      const rect = imageRef.current?.getBoundingClientRect();
      if (rect) setImageBox({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (imageRef.current) observer.observe(imageRef.current);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const stones = useMemo(() => {
    const list: Array<{ row: number; col: number; player: Cell }> = [];
    cells.forEach((row, r) => row.forEach((player, c) => { if (player) list.push({ row: r, col: c, player }); }));
    return list;
  }, [cells]);

  const counts = useMemo(() => ({
    black: stones.filter((stone) => stone.player === "black").length,
    white: stones.filter((stone) => stone.player === "white").length,
  }), [stones]);

  /** 画布坐标 → 覆盖层坐标（覆盖层与图片同框，按显示尺寸等比换算）。
   *  网格几何全是「原图像素 / 原图尺寸」的比例，与 <img> 用的是不是缩小预览无关。 */
  const toDisplay = (canvasX: number, canvasY: number) => {
    if (!gridCanvas || !gridCanvas.width || !gridCanvas.height) return { x: 0, y: 0 };
    return { x: (canvasX / gridCanvas.width) * imageBox.width, y: (canvasY / gridCanvas.height) * imageBox.height };
  };
  const step = grid && gridCanvas && imageBox.width
    ? { x: (grid.spacingX / gridCanvas.width) * imageBox.width, y: (grid.spacingY / gridCanvas.height) * imageBox.height }
    : { x: 0, y: 0 };


  /** 编辑动作（已换算好交叉点）。返回 false 表示点了没效果（用于给出提示）。 */
  const applyEdit = (row: number, col: number): boolean => {
    let handled = false;
    setCells((current) => {
      const next = current.map((line) => [...line]);
      const value = next[row][col];
      const point = { row, col };
      if (tool === "erase") {
        if (!value) { setHint(`${coordLabel(point, boardSize)}：这里本来就是空的`); return current; }
        next[row][col] = null;
        setHint(`${coordLabel(point, boardSize)}：已去掉${value === "black" ? "黑" : "白"}子`);
        handled = true;
        return next;
      }
      // place：点空位放当前颜色；点到棋子上=把它改成当前颜色（修「黑白反了」）。
      if (!value) {
        next[row][col] = player;
        setHint(`${coordLabel(point, boardSize)}：补了一颗${player === "black" ? "黑" : "白"}子`);
      } else if (value !== player) {
        next[row][col] = player;
        setHint(`${coordLabel(point, boardSize)}：${value === "black" ? "黑" : "白"} → ${player === "black" ? "黑" : "白"}`);
      } else {
        setHint(`${coordLabel(point, boardSize)}：已经是${player === "black" ? "黑" : "白"}子`);
        return current;
      }
      handled = true;
      return next;
    });
    return handled;
  };

  /** 整盘位移一格（用户 09-23 二改：「移子」=编辑面板里的「位移」，不是挪单颗）。
   *  语义与编辑面板的 shiftPosition 一致：任何棋子会移出棋盘就**直接拒绝**、
   *  不静默裁剪——裁过的局面看起来像「识别又错了几颗」，比原样不动更难排查。 */
  const shiftBoard = (dRow: number, dCol: number) => {
    const label = dRow < 0 ? "上" : dRow > 0 ? "下" : dCol < 0 ? "左" : "右";
    let outside = 0;
    for (let r = 0; r < boardSize; r += 1) {
      for (let c = 0; c < boardSize; c += 1) {
        if (cells[r][c] && (r + dRow < 0 || c + dCol < 0 || r + dRow >= boardSize || c + dCol >= boardSize)) outside += 1;
      }
    }
    if (outside) { setHint(`整体${label}移会把这 ${outside} 颗棋子移出棋盘，已取消；先往回移或改方向`); return; }
    setCells((current) => {
      const next: Cell[][] = current.map((line) => line.map(() => null));
      for (let r = 0; r < boardSize; r += 1) {
        for (let c = 0; c < boardSize; c += 1) {
          if (current[r][c]) next[r + dRow][c + dCol] = current[r][c];
        }
      }
      return next;
    });
    setHint(`已整体${label}移一格（全部 ${stones.length} 颗棋子一起挪）`);
  };

  const handleTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!grid || !imageBox.width) return;
    if (!editable) { setHint("本次已按序号复原手序，改子会破坏手序，请返回后改用「按局面导入」"); return; }
    if (!editing) { setHint("点「编辑」进入编辑模式才能改子"); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    // 覆盖层坐标 → 画布坐标 → 最近的交叉点
    const canvasX = (localX / imageBox.width) * (gridCanvas?.width ?? 0);
    const canvasY = (localY / imageBox.height) * (gridCanvas?.height ?? 0);
    const col = Math.round((canvasX - grid.originX) / grid.spacingX);
    const row = Math.round((canvasY - grid.originY) / grid.spacingY);
    if (row < 0 || col < 0 || row >= boardSize || col >= boardSize) { setHint("点到棋盘外了"); return; }
    applyEdit(row, col);
  };

  const gridLines = useMemo(() => {
    if (!grid || !imageBox.width) return [];
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; frame: boolean }> = [];
    for (let index = 0; index < boardSize; index += 1) {
      const verticalTop = toDisplay(grid.originX + index * grid.spacingX, grid.originY);
      const verticalBottom = toDisplay(grid.originX + index * grid.spacingX, grid.originY + (boardSize - 1) * grid.spacingY);
      lines.push({ x1: verticalTop.x, y1: verticalTop.y, x2: verticalBottom.x, y2: verticalBottom.y, frame: index === 0 || index === boardSize - 1 });
      const horizontalLeft = toDisplay(grid.originX, grid.originY + index * grid.spacingY);
      const horizontalRight = toDisplay(grid.originX + (boardSize - 1) * grid.spacingX, grid.originY + index * grid.spacingY);
      lines.push({ x1: horizontalLeft.x, y1: horizontalLeft.y, x2: horizontalRight.x, y2: horizontalRight.y, frame: index === 0 || index === boardSize - 1 });
    }
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, gridCanvas, imageBox.width, imageBox.height, boardSize]);

  const photoVisible = view !== "result";
  const radius = step.x > 0 ? Math.max(4, Math.min(step.x, step.y) * 0.46) : 6;

  return (
    <div className="image-verify" role="dialog" aria-label="识别结果核对">
      <header className="image-verify-head">
        <b>核对识别结果</b>
        <span>共 {stones.length} 子（黑 {counts.black} / 白 {counts.white}）· 置信度 {Math.round(confidence * 100)}%</span>
        {editing && <span className="image-verify-editing" data-editing="true"><Pencil aria-hidden="true"/>编辑中</span>}
      </header>
      {editing && <div className="image-verify-editbar">
        <button type="button" className="image-verify-exit" onClick={() => setEditing(false)}><X aria-hidden="true"/><span>退出编辑</span></button>
      </div>}
        <div className="image-verify-stage">
          <div className="image-verify-frame" onPointerDown={handleTap} data-editable={editable && editing ? "true" : "false"} data-editing={editing ? "true" : "false"}>
          <img ref={imageRef} src={url} alt={name} className="image-verify-photo" data-hidden={photoVisible ? "false" : "true"} draggable={false}/>
          {grid && view !== "photo" && <svg className="image-verify-overlay" viewBox={`0 0 ${Math.max(1, imageBox.width)} ${Math.max(1, imageBox.height)}`} aria-hidden="true">
            <g className="image-verify-lines">
              {gridLines.map((line, index) => <line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} data-frame={line.frame ? "true" : "false"}/>)}
            </g>
            {stones.map((stone) => {
              const point = toDisplay(grid.originX + stone.col * grid.spacingX, grid.originY + stone.row * grid.spacingY);
              const order = numberAt[`${stone.row},${stone.col}`];
              return (
                <g key={`${stone.row}-${stone.col}`}>
                  <circle className={`image-verify-stone ${stone.player}`} cx={point.x} cy={point.y} r={radius} data-verify-stone={`${stone.row}-${stone.col}`}/>
                  {order !== undefined && <text className={`image-verify-number ${stone.player}`} x={point.x} y={point.y} fontSize={Math.max(7, radius * 0.95)} data-verify-number={`${stone.row}-${stone.col}`}>{order}</text>}
                </g>
              );
            })}
          </svg>}
        </div>
      </div>
      {/* 棋盘（stage）常驻屏幕上半：下面全部内容收进固定高度的可滚动区域，
          按钮/说明再长也不会把棋盘挤没（2026-10-02 用户要求）。 */}
      <div className="image-verify-panel">
      <p className="image-verify-note" role="status">
        {!grid && "这次没检测到网格几何，只能看原图核对（识别结果已按标准边距给出）。"}
        {editing ? "点空位放当前颜色的子、去子；「位移」把全部棋子一起挪一格。" : editable ? "如果识别有错子，可进入编辑模式调试。" : "本次已按序号复原手序，叠图仅供核对，改子会破坏手序。"}
      </p>
      <p className="image-verify-hint" aria-live="polite">{hint || note}</p>
      {editing && <div className="image-verify-tools" role="group" aria-label="编辑工具">
        <div className="image-verify-player" role="group" aria-label="落子颜色（点一下也切回放子）">
          <button type="button" className={tool === "place" && player === "black" ? "active" : ""} aria-pressed={tool === "place" && player === "black"} onClick={() => { setPlayer("black"); setTool("place"); }}>黑</button>
          <button type="button" className={tool === "place" && player === "white" ? "active" : ""} aria-pressed={tool === "place" && player === "white"} onClick={() => { setPlayer("white"); setTool("place"); }}>白</button>
        </div>
        <button type="button" className={tool === "place" ? "active" : ""} aria-pressed={tool === "place"} onClick={() => setTool("place")}><Pencil aria-hidden="true"/><span>放子</span></button>
        <button type="button" className={tool === "erase" ? "active" : ""} aria-pressed={tool === "erase"} onClick={() => setTool("erase")}><Eraser aria-hidden="true"/><span>去子</span></button>
      </div>}
      {editing && <div className="image-verify-shift" role="group" aria-label="整盘位移">
        <span>位移</span>
        <button type="button" aria-label="整体上移一格" onClick={() => shiftBoard(-1, 0)}>↑</button>
        <button type="button" aria-label="整体下移一格" onClick={() => shiftBoard(1, 0)}>↓</button>
        <button type="button" aria-label="整体左移一格" onClick={() => shiftBoard(0, -1)}>←</button>
        <button type="button" aria-label="整体右移一格" onClick={() => shiftBoard(0, 1)}>→</button>
        <small>全部棋子一起挪一格</small>
      </div>}
      <div className="image-verify-modes" role="group" aria-label="查看方式">
        <button type="button" className={view === "result" ? "active" : ""} aria-pressed={view === "result"} onClick={() => setView("result")}><Eye aria-hidden="true"/><span>只看识别</span></button>
        <button type="button" className={view === "overlay" ? "active" : ""} aria-pressed={view === "overlay"} onClick={() => setView("overlay")}><Check aria-hidden="true"/><span>叠图</span></button>
        <button type="button" className={view === "photo" ? "active" : ""} aria-pressed={view === "photo"} onClick={() => setView("photo")}><EyeOff aria-hidden="true"/><span>只看原图</span></button>
        <button type="button" className={editing ? "active" : ""} aria-pressed={editing} disabled={!editable} title={editable ? "进入编辑模式改错子" : "已按序号复原手序，不允许改子"} onClick={() => setEditing((on) => !on)}><Pencil aria-hidden="true"/><span>编辑</span></button>
      </div>
      <div className="image-verify-restore" role="group" aria-label="复原手序">
        <button type="button" data-local-restore="" onClick={onLocalRestore} disabled={localRestoreBusy || aiRestoreBusy || reRestoreBusy || completeRestoreBusy}><Cpu aria-hidden="true"/><span>{localRestoreBusy ? "本地读序中…" : "复原手序-本地"}</span></button>
        <button type="button" data-ai-restore="" onClick={onAiRestore} disabled={localRestoreBusy || aiRestoreBusy || reRestoreBusy || completeRestoreBusy}><Sparkles aria-hidden="true"/><span>{aiRestoreBusy ? "云端读图中…" : "复原手序-云端"}</span></button>
        {restoreAttempted && readCount < stoneCount && <div className="image-verify-followup" role="group" aria-label="复原未完整时的续做">
          <button type="button" data-re-restore="" onClick={onReRestore} disabled={localRestoreBusy || aiRestoreBusy || reRestoreBusy || completeRestoreBusy}><RefreshCw aria-hidden="true"/><span>{reRestoreBusy ? "重新读序号中…" : "重新识别"}</span></button>
          <button type="button" data-complete-restore="" onClick={onCompleteRestore} disabled={localRestoreBusy || aiRestoreBusy || reRestoreBusy || completeRestoreBusy}><ListPlus aria-hidden="true"/><span>{completeRestoreBusy ? `补读缺号中…（${stoneCount - readCount} 颗）` : "补全识别"}</span></button>
        </div>}
        <small>{localRestoreBusy || aiRestoreBusy
          ? aiRestoreBusy ? "「复原手序-云端」会把整张图发送到你配置的 AI 服务（设置里填的地址）读序号，通常十几秒" : "「复原手序-本地」正在重新读取棋子上的序号，请稍候"
          : aiRestoreConfigured
            ? "前提：图上的棋子印有手序（手数）数字才能复原，没印手序的图只能按当前局面导入。本地=用本应用识别器读序号；云端=把整张图交给识图大模型读。成功后棋子会标上手序，核对再导入"
            : "图上的棋子印有手序（手数）数字才能复原。「复原手序-本地」用本应用识别器读序号；「复原手序-云端」先到 设置→数据与兼容→AI 识图服务 填接口与 Key"}</small>
      </div>
      </div>
      <footer className="image-verify-actions">
        <button type="button" className="image-verify-back" onClick={onBack}><HelpCircle aria-hidden="true"/><span>返回对齐</span></button>
        <button type="button" className="image-verify-cancel" onClick={onCancel}><X aria-hidden="true"/><span>取消</span></button>
        <button type="button" className="image-verify-confirm" onClick={() => onConfirm(cells)}><Check aria-hidden="true"/><span>确认导入</span></button>
      </footer>
    </div>
  );
}
