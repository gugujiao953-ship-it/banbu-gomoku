import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bookmark, Check, ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Clipboard, Copy, Filter, Flag, FoldVertical, GitBranch, LocateFixed, Maximize2, Minimize2, Minus, PencilLine, Plus, RotateCcw, ScrollText, Search, Scissors, Trash2, UnfoldVertical, X, ZoomIn } from "lucide-react";
import { coordinateName } from "../../game";
import { compactChildCount, compactIndexOf, compactNodeIndex } from "../../compact-index";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "../../types";
import type { RecordBookmark } from "./bookmarks";
import { searchRecordBookmarks } from "./bookmarks";
import type { SubtreeClipboard } from "./subtree-clipboard";
import { recordMainLineIds, remainingLayersOf } from "./tree-expansion";
import { assignTreeLayout } from "./tree-layout";
import { TreeListView, type TreeListRow } from "./TreeListView";
import { TreePreview } from "./TreePreview";
import { TreeNavigator } from "./TreeNavigator";
import { TreeOverview } from "./TreeOverview";
import { TreeBranchAtlas, type TreeBranchRegion } from "./TreeBranchAtlas";
import { treeAncestorPath } from "./tree-navigation";
import { buildVisibleTree, treeBranchFrontier } from "./visible-tree";
import { clippedTreeRoute, createTreeSpatialIndex, treeEdgeBounds, treeEdgePath, treeEdgeRoute, treeStructureBins, treeViewportBounds, type TreeEdgeRoute } from "./tree-viewport";
import { buildNodeSearchIndex, searchNodes, NODE_SEARCH_KIND_LABELS } from "./node-search";
import { buildTranspositionIndex, isTransposition, rankSamePositions, type TranspositionIndex } from "./transposition";
import "./record-tree.css";

const TREE_NODE_WIDTH = 132;
const TREE_NODE_HEIGHT = 44;
/**
 * 链条节点（无分叉、无注解、非当前/书签）压成小胶囊：一手只占这么宽，长链不再拉出超长直线。
 *
 * ⚠ 用户 09-26：「分支树的图片里面，除了首尾的两手，其他的都没有显示任何信息，连坐标都没有」
 * ——上一版只画一个手数圆点，长链上除首尾外全是数字，看不出每一手落在哪个点。现在改成
 * **坐标 + 手数**的小胶囊（64px，仍比方框的 132px 省一半多），收缩节点不再丢信息。
 */
const TREE_CHAIN_WIDTH = 64;
const TREE_CHAIN_HEIGHT = 26;
const TREE_CHAIN_TOP = (TREE_NODE_HEIGHT - TREE_CHAIN_HEIGHT) / 2;
/** 胶囊中线（文字基线按它对齐）。 */
const TREE_CHAIN_MID = TREE_CHAIN_TOP + TREE_CHAIN_HEIGHT / 2;
const TREE_X_GAP = 30;
const TREE_Y_GAP = 14;
const TREE_MIN_SCALE = 0.01;
/** 结构档：界面百分比 **≤5%** 时只剩圆点（点按放大）。用户 2026-10-14：「5% 的时候缩略为再一种样子」。 */
const TREE_STRUCTURE_MAX_PERCENT = 5;
/** 紧凑档：**≤20%**（且还没到结构档）换成单行「坐标 · 手数」胶囊。用户 2026-10-14：「20 的时候缩略为另外一种样子」。 */
const TREE_COMPACT_MAX_PERCENT = 20;
const TREE_COMPACT_TEXT_PX = 6;
const TREE_MAX_SCALE = 100;
const TREE_DRAG_THRESHOLD = 6;
/** 滚轮每 1 单位 deltaY 的缩放系数：240（两三格滚轮）大约 100× → 70×。 */
const TREE_WHEEL_FACTOR = 0.0015;
/** 尚未测得实际画布宽度时的坐标宽度；测量后100%按实际像素显示。 */
const TREE_VIEW_WINDOW_WIDTH = 660;
const TREE_VIEW_WINDOW_HEIGHT = 760;
/** DOM 尚未布局时的高度兜底；测量成功后使用全部可用高度。 */
const TREE_CANVAS_MAX_HEIGHT = 620;
/** 节点布局的顶部留白。 */
const TREE_CONTENT_TOP = 44;
const minimumScaleForLayout = (layout: { contentWidth: number; contentHeight: number; viewWidth: number; viewHeight: number } | null) => layout
  ? Math.min(TREE_MIN_SCALE, Math.max(Number.EPSILON, (layout.viewWidth - 32) / layout.contentWidth), Math.max(Number.EPSILON, (layout.viewHeight - 32) / layout.contentHeight)) : TREE_MIN_SCALE;

/**
 * 从画布顶端量到弹层可用底边，再扣除下方工具行和手机操作区。
 *
 * 两个坑：
 *   ① 不能用 `sheet.clientHeight`——sheet 的高度是**跟着内容走**的，画布一矮它就跟着矮，
 *      于是「量出来只剩 211px → 画布就 211px → 下次量还是 211px」自锁在矮档（实测就是这样）。
 *      要用 `maxHeight` 那个**上限**（可用高度），它不受内容影响。
 *   ② 侧栏与画布并排，不扣侧栏高度。上方控件的换行直接体现在画布顶端的位置上。
 */
const measureCanvasRoom = (panel: HTMLElement | null): number | null => {
  if (typeof document === "undefined") return null;
  const sheet = panel?.closest<HTMLElement>(".bottom-sheet");
  const viewport = panel?.querySelector<HTMLElement>(".tree-viewport");
  if (!sheet || !viewport) return null;
  const sheetStyle = getComputedStyle(sheet);
  // 上限可能是 min(96dvh,1100px) 这类表达式，浏览器已经把它解析成 px
  const maxHeight = Number.parseFloat(sheetStyle.maxHeight);
  const ceiling = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : sheet.clientHeight;
  if (!ceiling) return null;
  const sheetRect = sheet.getBoundingClientRect();
  // offsetHeight 会取整；拿它反推缩放会在整数边界反复触发 ResizeObserver。
  // 只校正真实的入场变换，无动画时按 1:1 的布局像素测量。
  const sheetScale = sheetStyle.transform && sheetStyle.transform !== "none" ? new DOMMatrixReadOnly(sheetStyle.transform).d : 1;
  const top = (viewport.getBoundingClientRect().top - sheetRect.top) / (sheetScale || 1);
  if (!top) return null; // jsdom / 尚未布局时沿用兜底。
  const mapbarHeight = panel?.querySelector<HTMLElement>(".tree-mapbar")?.offsetHeight || 0;
  const inspector = panel?.querySelector<HTMLElement>(".tree-inspector");
  // 浮出的详情不消耗画布高度；普通布局中的选项行与手机详情按实际高度扣除。
  const inspectorHeight = inspector && getComputedStyle(inspector).position === "absolute" ? 0 : inspector?.offsetHeight || 0;
  const room = ceiling - top - mapbarHeight - inspectorHeight - (Number.parseFloat(sheetStyle.paddingBottom) || 0) - 18;
  return Math.max(0, room);
};

interface TreeCanvasPoint {
  x: number;
  y: number;
}

const clientPointInTreeCanvas = (svg: SVGSVGElement, clientX: number, clientY: number): TreeCanvasPoint => {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) return { x: clientX, y: clientY };
  const renderedScale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const leftInset = (rect.width - viewBox.width * renderedScale) / 2;
  const topInset = (rect.height - viewBox.height * renderedScale) / 2;
  return {
    x: viewBox.x + (clientX - rect.left - leftInset) / renderedScale,
    y: viewBox.y + (clientY - rect.top - topInset) / renderedScale,
  };
};

export interface RecordTreePanelProps {
  document: GameDocument;
  currentId: string;
  path: RecordNode[];
  compactIndex?: CompactRenLibIndex;
  /**
   * 这份文档**只是懒加载源的一部分**（DP/DB 局面库、RenLib 网页核心读的 .lib、
   * 按需窗口的大型棋谱）：`document.nodes` 里只有「已经问过」的局面，
   * 其余分支只以 `unloadedChildren` 记数量。
   *
   * 为什么要显式传（2026-10-10 排查）：树面板原来只认 `compactIndex`（只覆盖分页大棋谱），
   * DP/LIB 这两种懒加载视图的投影**没有** compactIndex，于是任何「遍历整份文档算个结论」
   * 的功能都会**拿子集当全谱**、给出看不出问题的假结论
   * （同型局面搜索就是这样：905/107242 个局面上算完，界面写「全谱没有殊途同归」）。
   * 由 App 统一判定后传进来（它已经 import 了两个守卫），面板内各功能按它降级或如实说明。
   */
  partial?: boolean;
  bookmarks: RecordBookmark[];
  clipboard: SubtreeClipboard | null;
  busy?: boolean;
  readOnly?: boolean;
  branchNameOverrides?: Record<string, string>;
  onLocate: (id: string, pivotId?: string) => void;
  /** 记谱流里点一手：跳到那个局面但保持面板打开（一边读一边走）。 */
  onFlowJump?: (id: string) => void;
  onCreateBranch: (id: string) => void;
  onRenameBranch: (id: string, title: string) => void;
  onDeleteBranch: (id: string) => void;
  /** 「设为主分支」：把这一手所在的一整条线写成棋谱主线（智子的 makeMainBranch）。 */
  onSetMainBranch: (id: string) => void;
  onCopy: (id: string) => void;
  onCut: (id: string) => void;
  onPaste: (id: string) => void;
  onCancelCopy: () => void;
  /**
   * 「同型局面 · 并入」：把 `donorId` 那一处同型（走子顺序不同、盘面相同）的后续
   * 搬到 `keeperId` 下，并删掉那一处重复。由 App 落成一串可撤销的草稿操作
   * （见 features/record-tree/transposition-merge.ts 的说明）。
   */
  onMergeSamePositions?: (keeperId: string, donorId: string) => void;
  /**
   * 「展开未加载分支」（2026-10-10）：点一下把这一支在库里的后续查回来。
   *
   * 只有**懒加载源**（DP/DB 局面数据库、RenLib 网页核心读的 .lib）会用到：它们按局面
   * 查询，投影里只能铺「已经问过的」分支，其余的挂 `unloadedChildren` 标记
   * （群友报的「九天指南 / 丘月败10.db / 花月黑必胜地毯.lib 打谱看得见、分支树里没有」
   * 就是这些没被铺开的后续）。点击后由 App 调会话的按需查询并回推文档。
   */
  onLoadBranch?: (id: string) => void;
  onToggleBookmark: (id: string) => void;
  onEditBookmark: (bookmark: RecordBookmark, patch: Partial<Pick<RecordBookmark, "title" | "note" | "accent">>) => void;
  onDeleteBookmark: (bookmark: RecordBookmark) => void;
}

const baseLabelForNode = (node: RecordNode, boardSize = 15) => node.move
  ? coordinateName(node.move, boardSize)
  : node.passPlayer
    ? `${node.passPlayer === "black" ? "黑" : "白"}方过手`
    : node.setup
      ? "设置局面"
      : node.parentId
        ? "注释节点"
        : "起始局面";

const labelForNode = (node: RecordNode, boardSize = 15) => node.boardText?.trim() || baseLabelForNode(node, boardSize);
const playerForNode = (node: RecordNode) => node.move?.player || node.passPlayer;

/**
 * 操作区按钮排几列（用户 2026-10-10：「排列要自动调整」）。
 *
 * 为什么不能只靠 CSS 的 `auto-fill`：它按容器宽度决定每排几个，**最后一排可能只剩一个**
 * （实测 390px、11 个按钮 → 5/5/1，孤零零一个「删除分支」吊在第三排，很难看）。
 * 所以在 JS 里算「均衡列数」：先看这个宽度最多放得下几个（每格至少 ACTION_MIN_CELL 宽），
 * 再在不超过它的前提下选一个**让每排尽量均匀**的列数——
 * 例如 11 个按钮、最多 5 列 → 排 3 排 → 每排 4 个 → 4/4/3，而不是 5/5/1。
 */
const ACTION_MIN_CELL = 58;
const ACTION_GAP = 5;
const actionColumns = (available: number, count: number): number => {
  if (count <= 0 || available <= 0) return 1;
  const capacity = Math.max(1, Math.floor((available + ACTION_GAP) / (ACTION_MIN_CELL + ACTION_GAP)));
  const rowsIfFull = Math.ceil(count / capacity);
  // 平均分布：把总数列成「排数」份，向上取整——最后一排因此不会只剩零星一两个
  return Math.max(1, Math.min(capacity, Math.ceil(count / rowsIfFull)));
};
/** 收缩胶囊上的短标签：有坐标用坐标，没有着法的过手/摆局用最短认得出的字样。 */
const compactLabelForNode = (node: RecordNode, boardSize = 15) => node.move
  ? coordinateName(node.move, boardSize)
  : node.passPlayer ? "过手"
    : node.setup ? "摆局"
      : "注释";

export function RecordTreePanel(props: RecordTreePanelProps) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 18, y: 18 });
  const [selectedId, setSelectedId] = useState(props.currentId);
  /**
   * 「展开下一层 / 收起这一层」（用户 09-22 要的「单独的展开和收起」）：
   * 每个分叉点记**一共摊开了几层**，点一次只多摊一层，不会一下把整枝扯出来。
   * 旧版是一个「展开过没有」的布尔量，点一次就递归摊开整枝——用户嫌没有逐层的控制。
   */
  const [openLevels, setOpenLevels] = useState<Map<string, number>>(() => new Map());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  /** 整树视野：default＝路径+主分支，expanded＝全部摊开，collapsed＝只留当前路径。 */
  const [treeMode, setTreeMode] = useState<"default" | "expanded" | "collapsed">("default");
  /**
   * 「只看这支」（用户 2026-10-10）：选中的这一手**只显示它自己的后续**，
   * 别的分支全藏起来。和「收起全部」互为反面（那个是只留到当前手的一条线）。
   *
   * 存的是节点 id 而不是布尔：换一手就要换聚焦对象。设上以后 treeMode 让位
   * （见 setFocusNode），免得两套视野规则互相打架。
   */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [atlasMode, setAtlasMode] = useState(false);
  const [focusHistory, setFocusHistory] = useState<{ focusId: string | null; treeMode: "default" | "expanded" | "collapsed"; openLevels: Map<string, number>; collapsedIds: Set<string>; scale: number; pan: { x: number; y: number }; atlasMode: boolean }[]>([]);
  const [view, setView] = useState<"tree" | "navigate" | "list" | "bookmarks">("tree");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inspectorView, setInspectorView] = useState<"preview" | "actions" | null>(null);
  /** 右下角那张**小地图**是否折叠（用户 2026-10-14：「我们要做的折叠是，把右下角缩略图折叠，
   *  就是那个相当于小地图一样的预览，而不是棋盘预览折叠」）。 */
  const [minimapCollapsed, setMinimapCollapsed] = useState(false);
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [branchTitle, setBranchTitle] = useState("");
  /**
   * 搜索（用户 09-26：「加入搜索功能，可以一键搜索到哪一步、哪个注释、哪个标注什么的…
   * 有多个名字一样的，就从近到远可以一个个的看，就像 Word 文档里面的查找功能一样」）。
   * searchAnchor ＝ 输入查询那一刻的手数，命中按离它多远排序（见 node-search.ts）。
   */
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * 「同型局面」（用户 2026-10-09，群友提的「殊途同归」）：两条不同落子顺序走到同一个盘面。
   *
   * **默认关**：它是一层标注，打开后会改变画面密度，所以走「要用再开」——
   * 与 RenLib 把 `Show Auto Link Variants` 放在 View 菜单里当开关是同一个口径。
   * 两个好处：① 不想看的人画面与现在完全一致；② 既有的树门禁（默认视野节点数写死）
   * 不会被这层标注碰到。
   */
  const [showTranspositions, setShowTranspositions] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(false);
  useEffect(() => {
    const closeOutsideMenus = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      panelRef.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.open = false;
      });
    };
    window.addEventListener("pointerdown", closeOutsideMenus);
    return () => window.removeEventListener("pointerdown", closeOutsideMenus);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAnchor, setSearchAnchor] = useState(0);
  const [searchCursor, setSearchCursor] = useState(0);
  const searchListRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ active: false, moved: false, pointerId: -1, startX: 0, startY: 0, startClientX: 0, startClientY: 0, panX: 0, panY: 0 });
  const pinchRef = useRef({ points: new Map<number, { x: number; y: number }>(), distance: 0, scale: 1, active: false });
  const pinchGestureRef = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressProgressTimer = useRef<number | null>(null);
  /** 「展开分支」后要把视野带到那一枝上（斜向布局铺得开，展开点在屏外是常事）。 */
  const pendingRevealRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 滚轮缩放走原生非 passive 监听（React 的 onWheel 是 passive 的，preventDefault 无效）；
  // 监听器只挂一次，缩放/平移的最新值经 viewRef 进来，不用反复解绑。
  const viewRef = useRef({ scale, pan });
  viewRef.current = { scale, pan };
  const [longPressId, setLongPressId] = useState<string | null>(null);
  const [pressingId, setPressingId] = useState<string | null>(null);
  const [longPressProgress, setLongPressProgress] = useState(0);
  /**
   * 画布能分到的高度（量真实 DOM，见 measureCanvasRoom）。
   *
   * 必须是 state 而不是在 positions 的 useMemo 里直接量：本面板其它块的高度会随视口变
   * （390px 下工具条 110px、412px 下 94px），窗口一变大画布就该跟着长。老代码把测量塞在
   * useMemo 里、依赖只有 [tree,dotIds,openLevels]，于是**窗口怎么变都不重算**——实测
   * 390×844 开面板量到 331px，把窗口拉到 1400 高还是 331px，压到 600 高仍是 331px
   * （该收的时候不收，面板内容直接顶出屏幕）。这里改成 resize 时重测一次，再把值喂给 memo。
   */
  const [roomHeight, setRoomHeight] = useState<number | null>(null);
  const [canvasWidth, setCanvasWidth] = useState<number | null>(null);
  /**
   * 操作区能用的宽度（量真实 DOM，和 roomHeight 同一套思路）。
   * 用它算「均衡排几列」，见 actionColumns。量不到时（jsdom/首帧）走兜底 390 内容宽。
   */
  const [actionWidth, setActionWidth] = useState<number | null>(null);
  const actionGridRef = useRef<HTMLDivElement | null>(null);
  /**
   * 操作区当前**实际显示了几个**按钮——从 DOM 数，不按条件手写一份。
   *
   * 手写会漂：按钮的出现条件有六七个（只读、view、有没有子节点、在主分支上没有、
   * 有没有剪贴板…），加一个按钮忘了同步那个数，列数就算错。
   * 直接从量到的元素上读 `children.length`，以后加按钮不用改这里。
   */
  const [actionCount, setActionCount] = useState(0);
  /**
   * 用户自己动过画面没有（拖动 / 捏合 / 滚轮 / 缩放按钮都算）。
   * 用途只有一个：画布高度是**挂载后**才量准的（首帧按内容高度兜底），量准后要补一次居中；
   * 但只在他还没动过画面时补——动过的人正在看别处，补居中就是打断他。
   */
  const userMovedRef = useRef(false);
  const readOnly = Boolean(props.readOnly);
  const boardSize = props.document.metadata.boardSize || 15;
  const displayLabel = (node: RecordNode, id: string) => props.branchNameOverrides?.[id]?.trim() || labelForNode(node, boardSize);
  const openNavigator = () => { setView("navigate"); setPreviewOpen(true); setGraphExpanded(false); };
  const showSelectedInGraph = () => {
    setAtlasMode(false);
    setFocusId(null);
    setFocusHistory([]);
    setPreviewOpen(false);
    // Returning to a selected branch owns the viewport; a later height measurement must not recenter on currentId.
    userMovedRef.current = true;
    pendingRevealRef.current = selectedId;
    setView("tree");
  };
  // 布局结果给 effect 用（effect 只依赖 currentId/文档，不依赖 positions，免得一展开就重置视野）
  const positionsRef = useRef<{ contentWidth: number; contentHeight: number; viewWidth: number; viewHeight: number; byId: Map<string, { x: number; y: number; w: number }> } | null>(null);
  /**
   * 把画面平移到「当前手居中」的位置（用户 09-20：打开图谱要默认定位在当前局面那一手）。
   * transform 是 translate(pan) scale(s)，内容点 p 落在 viewBox 的 pan + p*s 处，
   * 所以让 p 落在 viewBox 中心就是 pan = 中心 - p*s。
   */
  const centerOnCurrent = (nextScale: number) => {
    const layout = positionsRef.current;
    const point = layout?.byId.get(props.currentId);
    if (!layout || !point) { setPan({ x: 18, y: 18 }); return; }
    setPan({
      x: layout.viewWidth / 2 - (point.x + point.w / 2) * nextScale,
      y: layout.viewHeight / 2 - (point.y + TREE_NODE_HEIGHT / 2) * nextScale,
    });
  };

  useEffect(() => { setSelectedId(props.currentId); }, [props.currentId]);
  useEffect(() => {
    setSelectedId(props.currentId);
    setOpenLevels(new Map());
    setCollapsedIds(new Set());
    /**
     * 「只看这支」的聚焦点也要清掉（2026-10-11 P3）：`focusId` 是个**节点 id**，
     * 换文档之后它在新的 `document.nodes` 里根本不存在，而 `focusReachable` 是按它算的
     * ——不清的话白名单是空集，整棵树只剩「起始局面」一个节点，用户看到画布全空、
     * 又找不到恢复入口（按钮的按下态绑的是 `focusId === selected.id`，新谱下恒 false）。
     * 触发面：在 DP/LIB 上做一次编辑会自动换出「可编辑副本」（新 id），面板仍开着。
     */
    setFocusId(null);
    setFocusHistory([]);
    setView("tree");
    setGraphExpanded(false);
    setAtlasMode(false);
    // 换谱/打开：回到 100% 并对准当前手
    setScale(1);
    centerOnCurrent(1);
  }, [props.document.id]);
  // 当前手变了就把画面跟过去（列表也是自动滚到当前手，两边行为一致）
  useEffect(() => { centerOnCurrent(viewRef.current.scale); }, [props.currentId]);
  /**
   * 画布高度量准后补一次居中（用户 09-26，`qa/record-list-check` 的 L2b 抓到的旧账）：
   * 挂载那次居中用的是**兜底内容高度**（量不到真实可用高度时 180px），等 ResizeObserver/补帧
   * 把真实高度（实测 397px）喂回来时，画布已经长高，pan.y 却还是按 180 算的——
   * 于是「打开图谱时当前手居中」这条一直差着半个高度（900×900 实测偏 108px），
   * 而 userMovedRef 保证只在用户还没动过画面时才补。
   */
  useEffect(() => {
    if (userMovedRef.current) return;
    centerOnCurrent(viewRef.current.scale);
    // centerOnCurrent 每次渲染都是新函数，放进来只会空转；它只读 positionsRef/viewRef 两个 ref。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomHeight, canvasWidth]);
  /**
   * 量画布可用高度：挂载时量一次，窗口尺寸/方向变了再量（用户 09-25：转屏/拉窗口后面板尺寸
   * 不跟着变）。首帧 DOM 还没布局完、或者夹在面板打开的动画里量不准，所以下一帧再补一次。
   */
  useEffect(() => {
    if (view !== "tree") return;
    let frame = 0;
    const sync = () => {
      setRoomHeight(measureCanvasRoom(panelRef.current));
      setCanvasWidth(panelRef.current?.querySelector<HTMLElement>(".tree-viewport")?.clientWidth || null);
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    sync();
    schedule();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    panelRef.current?.querySelectorAll(".record-tree-tabs, .tree-toolbar, .tree-viewport, .tree-mapbar, .tree-inspector, .tree-copy-banner, .tree-window-note, .tree-scope-path").forEach((element) => observer?.observe(element));
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
    // 搜索面板开合同样会占掉画布的高度：跟着重测一次，别把操作区顶出屏幕（R84 的老毛病）。
  }, [view, searchOpen, previewOpen, inspectorView, graphExpanded, atlasMode, selectedId, openLevels, treeMode, focusId, props.document, props.clipboard]);
  /**
   * 量操作区可用宽度，用来算均衡列数（见 actionColumns）。与画布高度同一套时机：
   * 挂载量一次、下一帧补一次（面板有入场动画，首帧量不准）、resize/转屏再量。
   */
  useEffect(() => {
    // 依赖「选中的是谁」而不是 selected 对象本身：selected 在下面才声明（顺序上拿不到），
    // 而这里真正在意的只是「选中的节点换了没」——换了就要重算一次列数。
    let frame = 0;
    const sync = () => {
      const grid = actionGridRef.current;
      setActionWidth(grid?.clientWidth || null);
      // 按钮个数直接从 DOM 数（见 actionCount 的说明：手写会漂）
      setActionCount(grid ? grid.children.length : 0);
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    sync();
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, [selectedId, view, readOnly, graphExpanded, inspectorView]);
  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (longPressProgressTimer.current !== null) window.clearInterval(longPressProgressTimer.current);
  }, []);
  // 滚轮缩放：以光标为锚点（滚轮停在哪儿，哪儿就不动）。非 passive 才能 preventDefault，
  // 否则画布一滚整页就跟着滚。图谱页签挂载后才有 svg，所以依赖 view。
  useEffect(() => {
    const svg = svgRef.current;
    if (view !== "tree" || atlasMode || !svg) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (!deltaY) return;
      const { scale, pan } = viewRef.current;
      // 保留三位小数：低倍区间（1%–10%）用两位会被 toFixed 压成同一个值而卡住
      const next = Math.min(TREE_MAX_SCALE, Math.max(minimumScaleForLayout(positionsRef.current), Number((scale * Math.exp(-deltaY * TREE_WHEEL_FACTOR)).toPrecision(6))));
      if (next === scale) return;
      const anchor = clientPointInTreeCanvas(svg, event.clientX, event.clientY);
      const ratio = next / scale;
      userMovedRef.current = true;
      setPan({ x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio });
      setScale(next);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [view, atlasMode]);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (longPressProgressTimer.current !== null) window.clearInterval(longPressProgressTimer.current);
    longPressTimer.current = null; longPressProgressTimer.current = null;
    setLongPressProgress(0); setPressingId(null);
  };
  const beginLongPress = (id: string) => {
    cancelLongPress();
    setLongPressId(null); setLongPressProgress(0); setPressingId(id);
    const started = Date.now();
    longPressProgressTimer.current = window.setInterval(() => setLongPressProgress(Math.min(1, (Date.now() - started) / 620)), 32);
    longPressTimer.current = window.setTimeout(() => {
      setLongPressProgress(1); setSelectedId(id); setLongPressId(id); setInspectorView("actions"); cancelLongPress();
    }, 620);
  };

  const pathIds = useMemo(() => new Set(props.path.map((node) => node.id)), [props.path]);
  const isCompact = Boolean(props.compactIndex || compactIndexOf(props.document));
  /**
   * 「这份文档不完整」——分页大棋谱（compactIndex）**或** App 标明的懒加载源（DP/LIB）。
   *
   * 凡是「遍历整份文档得出结论」的功能都要认它：不认就会拿已加载的子集当全谱，
   * 给出看起来权威、实际只覆盖一小部分的数字（2026-10-10 排查出的同一类问题，见 partial 注释）。
   */
  const isPartial = isCompact || props.partial === true;
  const bookmarkByNode = useMemo(() => new Map(props.bookmarks.map((bookmark) => [bookmark.nodeId, bookmark])), [props.bookmarks]);
  const selected = props.document.nodes[selectedId] || props.document.nodes[props.currentId];
  const selectedBookmark = selected ? bookmarkByNode.get(selected.id) : undefined;
  const filteredBookmarks = useMemo(() => searchRecordBookmarks(props.bookmarks, bookmarkQuery), [bookmarkQuery, props.bookmarks]);
  // 选中节点的后续分支数（大型棋谱走紧凑索引，不展开 children 代理）。
  const selectedChildCount = (() => {
    if (!selected) return 0;
    const compact = props.compactIndex || compactIndexOf(props.document);
    const index = compact ? compactNodeIndex(props.document, selected.id) : undefined;
    const loaded = index === undefined || !compact ? selected.children.length : compactChildCount(compact, index);
    // 懒加载源（DP/DB）里还有没查回来的分支：数量要算进去，否则徽标会少报。
    return loaded + (selected.unloadedChildren || 0);
  })();
  /** 其中「还没从库里读回来」的有几支——操作区说明里如实标出来，免得与徽标数字对不上。 */
  const selectedUnloadedCount = selected ? Math.max(0, selected.unloadedChildren || 0) : 0;

  /**
   * 把画面拉回内容附近（用户 09-26：「我在一个坐标缩小时…那个坐标缩小后不在我的视线范围内了」）。
   *
   * 视野在内容坐标里的区间是 [(0−pan)/s, (view−pan)/s]，这里要求它与内容在横竖两个方向都至少
   * 叠住 MIN_VISIBLE 像素；内容缩得比视野还小时直接居中。这样无论怎么缩，画布上都还能看到树，
   * 而不是一片空白（再者缩小后 pan 停在远处时，用户除了「重置」没有任何办法回去）。
   * **只用在缩放操作上**：拖动是用户自己在推画面，不跟他抢。
   */
  const clampPanToContent = (next: { x: number; y: number }, nextScale: number) => {
    const layout = positionsRef.current;
    if (!layout) return next;
    const MIN_VISIBLE = 60;
    const axis = (pan: number, view: number, content: number) => {
      const minimum = MIN_VISIBLE - content * nextScale;
      const maximum = view - MIN_VISIBLE;
      if (minimum > maximum) return (view - content * nextScale) / 2;
      return Math.min(maximum, Math.max(minimum, pan));
    };
    return { x: axis(next.x, layout.viewWidth, layout.contentWidth), y: axis(next.y, layout.viewHeight, layout.contentHeight) };
  };

  /**
   * 改缩放一律**锚定画布中心**（用户 09-20 抓图发现：原来只改 scale 不动 pan，
   * 内容点映射是 pan + p*s，缩小 20 倍就把整棵树推到视野外——点 5% 画布直接空了），
   * 并且缩完按上面的规则夹回内容附近（用户 09-26 的补充）。
   * 滚轮/双指是另一种锚点（以光标、指中为锚，见下面两处），互不影响。
   */
  const zoomTo = (nextScale: number) => {
    const layout = positionsRef.current;
    const { scale: current, pan } = viewRef.current;
    const clamped = Math.min(TREE_MAX_SCALE, Math.max(minimumScaleForLayout(layout), Number(nextScale.toPrecision(6))));
    if (clamped === current) return;
    if (!layout) { setScale(clamped); return; }
    const cx = layout.viewWidth / 2, cy = layout.viewHeight / 2;
    const ratio = clamped / current;
    userMovedRef.current = true;
    setPan(clampPanToContent({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio }, clamped));
    setScale(clamped);
  };
  const nudgeScale = (direction: -1 | 1) => {
    // 低倍区间（1%–30%）步长要小，否则从 1% 按一次就跳到 15%，看不到连续变化
    const value = viewRef.current.scale;
    if (value < .01) { zoomTo(value * (direction < 0 ? .8 : 1.25)); return; }
    const step = value < 0.05 ? 0.01 : value < 0.3 ? 0.05 : value < 2 ? 0.15 : value < 5 ? 0.5 : value < 20 ? 2 : 10;
    zoomTo(value + direction * step);
  };

  /**
   * 「展开下一层 / 收起这一层」（用户 09-22 要的「单独的展开和收起」）。
   * 逐层控制：每一层点一次只多摊开**一层**，不会一下把整枝扯出来。
   * 实现上不再用「这个节点展开没展开」的布尔量，而是记**这一枝摊开了几层**
   * （`openLevels`：分叉点 id → 层数）。这样同一个分叉可以一层一层往下点，
   * 也能一层一层收回来。
   */
  const expandBranch = (id: string) => {
    setTreeMode("default");
    setCollapsedIds((value) => { const next = new Set(value); next.delete(id); return next; });
    /**
     * 关键：**只在真的还能多摊一层时才 +1**（2026-10-11 群友报「可以一直点，
     * 收回分支那里加到 50」）。旧实现无条件 +1，点了没产出也照涨。
     *
     * 上限按**这一手下面已加载子树的高度**算（不是孩子个数）：逐层展开时一层一个数，
     * 所以「还能点几次」＝这个子树还有几层没露。用 `remainingLayersOf` 算。
     * 只要子树里还有 `unloadedChildren`（懒加载源里没读回来的分支），就当高度未知、
     * 允许继续点——读回来之后高度会自己变准。
     */
    const depthLimit = remainingLayersOf(props.document, id);
    const frontier = treeBranchFrontier(tree, id, openLevels.get(id) ?? 0);
    const selectedDepth = tree.find((entry) => entry.id === id)?.depth ?? 0;
    setOpenLevels((value) => {
      const current = value.get(id) ?? 0;
      if (Number.isFinite(depthLimit) && current >= depthLimit) return value;
      // A previously requested layer is still unread. Retry that read without growing the level counter.
      if (frontier.some((entry) => entry.depth < selectedDepth + current && (entry.node.unloadedChildren || 0) > 0)) return value;
      return new Map(value).set(id, current + 1);
    });
    // 展开后把视野带到展开处（横铺下新枝往右铺，容易落在屏外）
    pendingRevealRef.current = id;
    /**
     * 懒加载源（DP/LIB）：这一支的后续还没从库里查过，展开就等于「去要一次」。
     * 查完会话会回推新文档，树上就长出真正的子节点（见 props.onLoadBranch 的说明）。
     */
    const node = props.document.nodes[id];
    const loadIds = new Set(frontier
      .filter((entry) => (entry.node.unloadedChildren || 0) > 0).map((entry) => entry.id));
    if (node && (node.unloadedChildren || 0) > 0) loadIds.add(id);
    for (const target of loadIds) props.onLoadBranch?.(target);
  };
  /**
   * 「收起这一层」：把选中这一手自己摊开的层数减一；自己没有摊开过就把它默认框架里
   * 露着的旁支收掉（标成 collapsed，让这一层重新藏起来）。**不往上找祖先**——
   * 详见 collapseTargetId 上面的注释。
   */
  const collapseBranch = (id: string) => {
    setTreeMode("default");
    const levels = openLevels.get(id) ?? 0;
    if (levels > 0) {
      setOpenLevels((value) => {
        const next = new Map(value);
        const remaining = levels - 1;
        if (remaining > 0) next.set(id, remaining);
        else next.delete(id);
        return next;
      });
      if (levels === 1) setCollapsedIds((value) => new Set(value).add(id));
      return;
    }
    setCollapsedIds((value) => new Set(value).add(id));
  };
  /**
   * 展开全部 / 收起全部（用户 09-20 第二轮要求加回）。
   * 上一版「收起全部」只是「回到默认视野」，已经在默认视野时点了毫无变化——用户的原话是
   * 「根本不生效」。现在做成三个**看得出区别**的状态：
   *   default  —— 当前路径 + 主分支（打开时的样子）
   *   expanded —— 摊开全部已加载节点，屏幕只绘制视野附近
   *   collapsed——只留当前路径这一条线（主分支的旁支也收起来）
   */
  const expandWholeTree = () => {
    setCollapsedIds(new Set());
    setOpenLevels(new Map());
    setFocusId(null);
    setFocusHistory([]);
    userMovedRef.current = true;
    pendingRevealRef.current = selectedId;
    setTreeMode((value) => value === "expanded" ? "default" : "expanded");
  };
  const collapseWholeTree = () => {
    setOpenLevels(new Map());
    setCollapsedIds(new Set());
    setFocusId(null);
    setFocusHistory([]);
    pendingRevealRef.current = null;
    setTreeMode((value) => value === "collapsed" ? "default" : "collapsed");
  };
  /**
   * 「只看这支」：把视野收到选中的这一手的后续上，别的一概不画。
   *
   * 三套视野规则（默认框架 / 展开全部 / 收起全部）与它互斥：聚焦时另外两个的标记
   * 要清掉，否则点「展开全部」会看到两套规则同时生效、画面莫名其妙。
   */
  const toggleFocusBranch = (id: string) => {
    if (focusId === id) { restoreFocus(focusHistory.length - 1); return; }
    setFocusHistory((history) => [...history, { focusId, treeMode, openLevels, collapsedIds, scale, pan, atlasMode }]);
    setFocusId(id);
    setTreeMode("default");
    setCollapsedIds(new Set());
    setOpenLevels(new Map());
    pendingRevealRef.current = id;
  };
  const restoreFocus = (index: number) => {
    const previous = focusHistory[index];
    setFocusId(previous?.focusId ?? null);
    setTreeMode(previous?.treeMode ?? "default");
    setOpenLevels(previous?.openLevels ?? new Map());
    setCollapsedIds(previous?.collapsedIds ?? new Set());
    setFocusHistory((history) => history.slice(0, Math.max(0, index)));
    userMovedRef.current = true;
    pendingRevealRef.current = null;
    if (previous) { setScale(previous.scale); setPan(previous.pan); }
    setAtlasMode(previous?.atlasMode ?? false);
  };

  // 默认视野：当前路径 + 棋谱自己的主分支（preferredChildId 链；没设置的分叉按最高子树走）。
  // 「设为主分支」改了 preferred 之后，这里跟着变——默认摊开的就是用户认定的那条线。
  // 「收起全部」时只保留当前路径，连主分支也不自动摊开。
  const mainLineIds = useMemo(() => recordMainLineIds(props.document), [props.document]);
  // 主分支这条线是「切回主分支」的目标：path 含起始局面，手数要按有着法的节点数
  const currentTurn = props.path.filter((node) => node.move || node.passPlayer).length;
  const mainLineArray = useMemo(() => [...mainLineIds], [mainLineIds]);
  const mainLineTurn = mainLineArray.length > 1 ? Math.min(currentTurn, mainLineArray.length - 1) : null;
  const jumpTo = props.onFlowJump || ((target: string) => props.onLocate(target, props.document.nodes[target]?.parentId || undefined));

  // ── 搜索：索引整份棋谱（不只画布上画出来的那些），命中按「从近到远」排 ──────────
  const searchIndex = useMemo(() => searchOpen ? buildNodeSearchIndex(props.document, props.branchNameOverrides) : { entries: [], truncated: false }, [searchOpen, props.document, props.branchNameOverrides]);
  const searchHits = useMemo(() => searchNodes(props.document, searchIndex, searchQuery, searchAnchor), [props.document, searchIndex, searchQuery, searchAnchor]);
  const searchActiveId = searchHits[searchCursor]?.id ?? null;
  /**
   * 同型局面索引：只在开关打开时才算（它要遍历全谱逐节点算局面键，几百毫秒级，
   * 不该为没打开这个功能的人白付）。大型按需窗口的棋谱（`isCompact`）直接不建——
   * 那种 `document.nodes` 只有当前可视的一小段，遍历它既慢又得不到真实结果，
   * 界面会如实说「大型棋谱暂不做同型查找」，而不是给一个看起来像「没有同型」的空结果。
   */
  const transpositionIndex = useMemo(
    // 懒加载源（DP/LIB）与分页大棋谱一律不建索引：遍历到的只是子集，
    // 算出来的「同型」既漏（未加载分支里可能有）又可能把两个真同型报成不同，
    // 而界面会把它写成「全谱 N 处」——那是假结论。宁可不做，也不给错的数。
    () => (showTranspositions && !isPartial ? buildTranspositionIndex(props.document) : null),
    [showTranspositions, isPartial, props.document],
  );
  /** 输入即搜：查询变了就把锚点定在「我现在的这一手」，光标退回第一个命中。 */
  const runSearch = (query: string) => { setSearchQuery(query); setSearchAnchor(currentTurn); setSearchCursor(0); };
  const stepSearch = (direction: -1 | 1) => {
    if (!searchHits.length) return;
    const next = (searchCursor + direction + searchHits.length) % searchHits.length;
    setSearchCursor(next);
    jumpTo(searchHits[next].id);
  };
  /**
   * 查询落定后自动跳到最近的那个命中（用户要的「一键搜索到哪一步」），之后用上一个/下一个翻。
   * 用 ref 记住「这条查询已经跳过了」：跳过去会让当前手变、进而重渲染，不记住就会反复跳。
   */
  const searchJumpRef = useRef("");
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) return;
    const key = `${searchQuery}|${searchAnchor}`;
    if (searchJumpRef.current === key) return;
    searchJumpRef.current = key;
    const first = searchHits[0];
    if (first) jumpTo(first.id);
    // jumpTo 每次渲染都是新函数（父组件给的或本地箭头），放进来只会空转；用上面的 ref 控重。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchHits, searchOpen, searchQuery, searchAnchor]);
  // 光标换位置时把命中列表滚到那一条（一次搜索可能几十条）。
  useEffect(() => {
    const list = searchListRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(".tree-search-hit.active");
    if (!active) return;
    const listBox = list.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.top >= listBox.top && activeBox.bottom <= listBox.bottom) return;
    list.scrollTop += activeBox.top - listBox.top - listBox.height / 2;
  }, [searchCursor, searchHits]);

  const layoutSelectionId = treeMode === "expanded" ? props.document.rootId : focusId ?? selectedId;
  const visibleTree = useMemo(() => buildVisibleTree({
    document: props.document, currentId: props.currentId, selectedId: layoutSelectionId, path: props.path,
    mainLineIds, openLevels, collapsedIds, treeMode, focusId, compactIndex: props.compactIndex,
  }), [collapsedIds, focusId, mainLineIds, openLevels, props.compactIndex, props.currentId, props.document, props.path, layoutSelectionId, treeMode]);
  const tree = visibleTree.entries;
  const selectedTreeEntry = useMemo(() => tree.find((entry) => entry.id === selectedId), [tree, selectedId]);

  /**
   * 当前选中那一手的同型局面（按「离得近」排在前面）。
   *
   * **不排除已经画在画布上的那些**：同型的两手常常**都看得见**（一条在主线上、一条在旁边的
   * 枝上），这正是最该跳的场景——用户要的是「从这一枝到那一枝」，而不是「找看不见的东西」。
   * 排除掉它们会让列表在常见情形下变成空的，那才是真没用的。
   * `rankSamePositions` 已经剔除了**它自己**，所以列表里永远只有「对面那些」。
   */
  const samePositions = useMemo(
    () => (selected && transpositionIndex
      ? rankSamePositions(transpositionIndex, props.document, selected.id, pathIds)
      : []),
    [transpositionIndex, props.document, selected, pathIds],
  );
  /** 整份棋谱里有多少手存在同型（开关打开时显示在工具条上，让用户知道这层标注值不值得开）。 */
  const transpositionCount = useMemo(
    () => (transpositionIndex ? [...new Set(transpositionIndex.byKey.values())].filter((ids) => ids.length > 1).length : 0),
    [transpositionIndex],
  );

  const branchPoints = useMemo(() => tree.filter((entry) => entry.childCount > 1).length, [tree]);
  const shownChildCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of tree) if (entry.parentId) map.set(entry.parentId, (map.get(entry.parentId) || 0) + 1);
    return map;
  }, [tree]);
  const selectedShownChildren = selected ? shownChildCount.get(selected.id) || 0 : 0;
  /** 选中这一手下面露着的**非路径**孩子：收起来能藏掉的就是这些（路径上的那一手永远留着）。 */
  const selectedHidableChildren = useMemo(() => tree.filter((entry) => entry.parentId === selectedId && !entry.onPath).length, [tree, selectedId]);
  /** 选中这一手当前摊开了几层（0＝只露默认框架），按钮上直接写出来，用户知道自己在第几层。 */
  const selectedOpenLevels = selected ? openLevels.get(selected.id) ?? 0 : 0;
  /** 选中这一手下面还露着一个「折叠入口」（分叉点自己没摊开的那种），也算它还有得可展。 */
  const selectedHasFoldedChild = useMemo(() => tree.some((entry) => entry.parentId === selectedId && entry.folded), [tree, selectedId]);
  /**
   * 「展开下一层」＝在选中这一手上多摊**一层**（用户 09-22：要有单独的展开和收起，
   * 不是点一下整枝扯出来）。只要它下面还有没画出来的东西就可点。
   * 「收起这一层」＝把**选中这一手自己**摊开的层数减一；自己没有摊开过就收自己默认框架里
   * 露着的旁支。**绝不往上找别人的摊开**——以前那版会一路找到祖先，在 a 上连点几下
   * 收起，最后收掉的是 root 那一层，主分支整条消失，用户根本不知道发生了什么。
   */
  const collapseTargetId = (() => {
    if (!selected) return null;
    if ((openLevels.get(selected.id) ?? 0) > 0) return selected.id;
    // 默认框架下的「收起」只在这一手真的藏得掉东西时可点：只剩当前路径那一手时
    // 收了也没变化（用户以前最烦的就是「点了没反应」的按钮）。
    if (!collapsedIds.has(selected.id) && selectedHidableChildren > 0) return selected.id;
    return null;
  })();
  const selectedRemainingLayers = useMemo(() => selected && view === "tree" && treeMode !== "expanded"
    ? remainingLayersOf(props.document, selected.id) : 0, [props.document, selectedId, treeMode, view]);
  const selectedFrontier = useMemo(() => treeMode === "expanded" ? [] : treeBranchFrontier(tree, selectedId, selectedOpenLevels), [tree, treeMode, selectedId, selectedOpenLevels]);
  const canExpandBranch = (() => {
    if (!selected || props.busy || treeMode === "expanded") return false;
    // 已经摊到「已加载子树的高度」就到顶了：再点没有东西可露，按钮该灰掉
    // （2026-10-11 群友报「可以一直点」——旧判据把 unloadedChildren 也算作「还有得展」，
    //  而那一支读回来是个叶子，于是点了没产出、按钮却永远亮着）。
    const remaining = selectedRemainingLayers;
    if (Number.isFinite(remaining) && selectedOpenLevels >= remaining) return false;
    // 再点一次会摊开「当前摊到的最外一层」的下一层：那一层上只要还有孩子，就还有得展。
    // 不能只看选中节点的直接孩子——逐层展开时，孩子全露出来了、孙辈还藏着的正是常态。
    const frontier = selectedFrontier;
    const frontierHasChildren = frontier.some((entry) => entry.childCount > 0);
    // 库里还有没读回来的分支时也允许点：点一下就是「去要一次」（展开 = 触发 onLoadBranch）
    if (selectedUnloadedCount > 0) return true;
    if (frontier.some((entry) => (entry.node.unloadedChildren || 0) > 0)) return true;
    return frontierHasChildren || (selectedChildCount > 0 && (selectedShownChildren < selectedChildCount || selectedHasFoldedChild));
  })();
  const canCollapseBranch = Boolean(collapseTargetId);

  // 智子式紧凑链（用户 09-19：「为啥那么长」）：一手一列 × 132px 的方框，50 手就是 8000px 的长线。
  // 现在只让「需要看内容」的节点占方框——分叉点（要挂数量徽标）、当前手、书签、
  // 有盘面文字/分支名的节点；其余链条节点压成圆点 + 手数，一手 34px，长链缩短约 3.7 倍。
  const dotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of tree) {
      if (entry.turnDepth === 0 || entry.isCurrent || entry.folded || entry.childCount > 1) continue;
      if (bookmarkByNode.has(entry.id) || entry.hasText || props.branchNameOverrides?.[entry.id]?.trim()) continue;
      ids.add(entry.id);
    }
    return ids;
  }, [tree, bookmarkByNode, props.branchNameOverrides]);

  // 列表流与画布共用同一棵可视树：左边看形状、右边读手数，展开/收起两边同步。
  const listRows = useMemo(() => {
    const rows: TreeListRow[] = [];
    if (view !== "list") return rows;
    const levelById = new Map<string, number>();
    const seenParents = new Set<string>();
    for (const entry of tree) {
      let level = 0;
      if (entry.parentId) {
        const firstChild = !seenParents.has(entry.parentId);
        seenParents.add(entry.parentId);
        level = (levelById.get(entry.parentId) ?? 0) + (firstChild ? 0 : 1);
      }
      levelById.set(entry.id, level);
      rows.push({
        id: entry.id,
        get label() { return displayLabel(entry.node, entry.id); },
        turn: entry.turnDepth,
        get player() { return playerForNode(entry.node) || null; },
        level,
        childCount: entry.childCount,
        onPath: entry.onPath,
        isCurrent: entry.isCurrent,
        hasBookmark: bookmarkByNode.has(entry.id),
        onMainLine: mainLineIds.has(entry.id),
        get note() { return props.branchNameOverrides?.[entry.id]?.trim() ? "" : (entry.node.boardText?.trim() || ""); },
      });
    }
    return rows;
  }, [bookmarkByNode, mainLineIds, props.branchNameOverrides, tree, view]);

  // Keep ordinary branches in familiar left-to-right lanes. A wide fork is
  // packed into several complete subtree lanes by assignTreeLayout, so opening
  // all candidates no longer produces one unreadable wall in a single column.
  const geometry = useMemo(() => {
    const layout = assignTreeLayout(tree, {
      getWidth: (entry) => dotIds.has(entry.id) ? TREE_CHAIN_WIDTH : TREE_NODE_WIDTH,
      getHeight: () => TREE_NODE_HEIGHT,
      xGap: TREE_X_GAP,
      yGap: TREE_Y_GAP,
      wideForkThreshold: 4,
      maxForkColumns: 4,
      isMainLine: (entry) => mainLineIds.has(entry.id),
    });
    const byId = new Map<string, { x: number; y: number; w: number }>();
    for (const entry of tree) {
      const point = layout.points.get(entry.id);
      if (!point) continue;
      byId.set(entry.id, { x: 18 + point.x, y: TREE_CONTENT_TOP + point.y, w: point.w });
    }
    const routes = new Map<string, TreeEdgeRoute>();
    for (const entry of tree) {
      const child = byId.get(entry.id), parent = entry.parentId ? byId.get(entry.parentId) : undefined;
      if (!child || !parent) continue;
      const rail = layout.edgeRails.get(entry.id);
      routes.set(entry.id, treeEdgeRoute(parent, child, rail === undefined ? undefined : TREE_CONTENT_TOP + rail, TREE_X_GAP));
    }
    const contentWidth = Math.max(430, 18 + layout.width + 18);
    const contentHeight = Math.max(180, TREE_CONTENT_TOP + layout.height + 18);
    return { contentWidth, contentHeight, byId, routes, wideForks: layout.wideForks };
  }, [tree, dotIds, mainLineIds]);
  const positions = useMemo(() => {
    const { contentWidth, contentHeight, byId } = geometry;
    // 100% means physical pixels, including on phones; the overview handles distant branches.
    const viewWidth = canvasWidth ?? Math.min(contentWidth, TREE_VIEW_WINDOW_WIDTH);
    const canvasHeight = Math.max(100, roomHeight ?? Math.min(TREE_CANVAS_MAX_HEIGHT, contentHeight));
    // Match the SVG viewBox to its physical aspect ratio: no unused letterbox area on phones.
    const viewHeight = canvasHeight * viewWidth / (canvasWidth ?? viewWidth);
    const layout = { contentWidth, contentHeight, viewWidth, viewHeight, canvasHeight, byId };
    positionsRef.current = layout;
    return layout;
  }, [geometry, roomHeight, canvasWidth]);
  const selectedTrace = useMemo(() => new Set(treeAncestorPath(props.document, selectedId).map((node) => node.id)), [props.document, selectedId]);
  const branchBands = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of tree) if (entry.parentId) counts.set(entry.parentId, (counts.get(entry.parentId) ?? 0) + 1);
    const fork = tree.find((entry) => (counts.get(entry.id) ?? 0) > 1);
    if (!fork) return [];
    const groups = new Map<string, string>();
    const bands = new Map<string, TreeBranchRegion & { x: number; y: number; right: number; bottom: number }>();
    for (const entry of tree) {
      const group = entry.parentId === fork.id ? entry.id : entry.parentId ? groups.get(entry.parentId) : undefined;
      if (!group) continue;
      groups.set(entry.id, group);
      const point = positions.byId.get(entry.id)!;
      const band = bands.get(group) ?? { id: group, x: point.x - 9, y: point.y - 7, right: point.x + point.w + 9, bottom: point.y + TREE_NODE_HEIGHT + 7, count: 0, firstTurn: entry.turnDepth, lastTurn: entry.turnDepth, forks: 0, unloaded: 0 };
      band.x = Math.min(band.x, point.x - 9);
      band.y = Math.min(band.y, point.y - 7);
      band.right = Math.max(band.right, point.x + point.w + 9);
      band.bottom = Math.max(band.bottom, point.y + TREE_NODE_HEIGHT + 7);
      band.count += 1;
      band.lastTurn = Math.max(band.lastTurn, entry.turnDepth);
      band.forks += Number(entry.childCount > 1);
      band.unloaded += entry.unloadedChildren;
      bands.set(group, band);
    }
    return [...bands.values()];
  }, [tree, geometry]);
  const centerOnPoint = (x: number, y: number) => {
    userMovedRef.current = true;
    setPan({ x: positions.viewWidth / 2 - x * scale, y: positions.viewHeight / 2 - y * scale });
  };
  const viewport = useMemo(() => treeViewportBounds(pan, scale, positions.viewWidth, positions.viewHeight), [pan, scale, positions.viewWidth, positions.viewHeight]);
  const spatial = useMemo(() => ({
    nodes: createTreeSpatialIndex(tree, (entry) => {
      const point = geometry.byId.get(entry.id)!;
      return { left: point.x, top: point.y, right: point.x + point.w, bottom: point.y + TREE_NODE_HEIGHT };
    }),
    edges: createTreeSpatialIndex(tree.filter((entry) => geometry.routes.has(entry.id)), (entry) => treeEdgeBounds(geometry.routes.get(entry.id)!)),
  }), [tree, geometry]);
  const virtual = tree.length > 100;
  const screenTree = useMemo(() => atlasMode ? [] : virtual ? spatial.nodes(viewport) : tree, [atlasMode, virtual, spatial, viewport, tree]);
  const screenEdges = useMemo(() => atlasMode ? [] : virtual ? spatial.edges(viewport) : tree, [atlasMode, virtual, spatial, viewport, tree]);
  const structureMode = Math.round(scale * 100) <= TREE_STRUCTURE_MAX_PERCENT;
  // 缩小后用单行坐标与手数（字号按屏幕恒定 6px，不随缩放再变小），保持可读。
  const compactDetail = !structureMode && Math.round(scale * 100) <= TREE_COMPACT_MAX_PERCENT;
  const screenNodes = useMemo(() => structureMode
    ? treeStructureBins(screenTree, geometry.byId, scale, new Set([selectedId, props.currentId]))
    : screenTree.map((entry) => ({ entry, point: geometry.byId.get(entry.id)!, count: 1 })), [structureMode, screenTree, geometry, scale, selectedId, props.currentId]);
  const edgePaths = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    for (const entry of screenEdges) {
      const route = geometry.routes.get(entry.id);
      if (!route) continue;
      const cls = selectedTrace.has(entry.id) ? "trace" : entry.onPath ? "path" : entry.revealed ? "revealed" : "plain";
      const segments = groups.get(cls) ?? new Set<string>();
      for (const segment of clippedTreeRoute(route, viewport)) segments.add(segment);
      groups.set(cls, segments);
    }
    return [...groups].sort((a, b) => Number(a[0] === "trace") - Number(b[0] === "trace")).map(([cls, segments]) => ({ cls, d: [...segments].join(" ") }));
  }, [screenEdges, geometry, viewport, selectedTrace]);
  const focusCrumbs = useMemo(() => focusId ? treeAncestorPath(props.document, focusId).filter((node) => node.id === focusId || node.id === props.document.rootId || treeChildCountForCrumb(node) > 1) : [], [props.document, focusId]);
  function treeChildCountForCrumb(node: RecordNode) {
    const index = props.compactIndex ?? compactIndexOf(props.document), at = index ? compactNodeIndex(props.document, node.id) : undefined;
    return index && at !== undefined ? compactChildCount(index, at) : node.children.length;
  }
  const activateGraphNode = (id: string) => {
    setSelectedId(id);
    if (structureMode) {
      const point = geometry.byId.get(id)!;
      userMovedRef.current = true;
      setScale(1);
      setPan({ x: positions.viewWidth / 2 - point.x - point.w / 2, y: positions.viewHeight / 2 - point.y - 22 });
    }
  };
  const inspectSelectedNode = () => {
    const point = positions.byId.get(selectedId);
    if (!point) return;
    const nextScale = Math.max(1, scale);
    userMovedRef.current = true;
    pendingRevealRef.current = null;
    setAtlasMode(false);
    setScale(nextScale);
    setPan({ x: positions.viewWidth / 2 - (point.x + point.w / 2) * nextScale, y: positions.viewHeight / 2 - (point.y + TREE_NODE_HEIGHT / 2) * nextScale });
  };
  /** 详情面板的开/关：同一个按钮再点一次收起。面板自己不带折叠（R196 加过一把，用户说
   *  要折叠的是右下角那张小地图，已撤）；折叠小地图见 `minimapCollapsed`。 */
  const toggleInspector = (next: "preview" | "actions") => { setInspectorView(inspectorView === next ? null : next); };
  const fitGraph = () => {
    // Leave room for the structure hint so fitting a large graph does not
    // hide the root/current node underneath it.
    const hintInset = virtual ? 40 : 0;
    const next = Math.min(1, (positions.viewWidth - 32) / positions.contentWidth, (positions.viewHeight - 32 - hintInset) / positions.contentHeight);
    userMovedRef.current = true;
    setScale(next);
    setPan({ x: (positions.viewWidth - positions.contentWidth * next) / 2, y: hintInset + (positions.viewHeight - hintInset - positions.contentHeight * next) / 2 });
  };
  const openAtlas = () => {
    if (atlasMode) { setAtlasMode(false); pendingRevealRef.current = selectedId; return; }
    setAtlasMode(true);
    setTreeMode("expanded");
    setOpenLevels(new Map());
    setCollapsedIds(new Set());
  };
  /**
   * 「展开分支」后把视野带到展开处：横铺布局里新枝可能铺到很右边，视野只对着当前手时
   * 展开点在屏外是常事。横向把锚点摆到画布左侧、纵向按新枝在上还是在下对齐。
   */
  useEffect(() => {
    const anchorId = pendingRevealRef.current;
    if (!anchorId) return;
    pendingRevealRef.current = null;
    const layout = positionsRef.current;
    const anchor = layout?.byId.get(anchorId);
    if (!layout || !anchor) return;
    const { scale } = viewRef.current;
    const children = tree.filter((entry) => entry.parentId === anchorId);
    const above = children.filter((entry) => (layout.byId.get(entry.id)?.y ?? 0) < anchor.y - 1).length;
    // 分支在上边（横铺的常态）：锚点压到画布下部，把上方让给新枝；否则居中偏上。
    const targetY = above > 0 ? layout.viewHeight * 0.72 : layout.viewHeight * 0.3;
    setPan({ x: layout.viewWidth * 0.22 - anchor.x * scale, y: targetY - (anchor.y + TREE_NODE_HEIGHT / 2) * scale });
  }, [positions, tree, view]);

  const startDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = clientPointInTreeCanvas(event.currentTarget, event.clientX, event.clientY);
    if (event.pointerType === "touch") {
      pinchRef.current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchRef.current.points.size === 1) {
        pinchGestureRef.current = false;
        pinchRef.current.active = false;
        dragRef.current = {
          active: true,
          moved: false,
          pointerId: event.pointerId,
          startX: point.x,
          startY: point.y,
          startClientX: event.clientX,
          startClientY: event.clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }
      if (pinchRef.current.points.size >= 2) {
        const [a, b] = Array.from(pinchRef.current.points.values());
        pinchRef.current.distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        pinchRef.current.scale = scale;
        pinchRef.current.active = true;
        pinchGestureRef.current = true;
        dragRef.current.active = false;
        dragRef.current.moved = true;
        for (const pointerId of pinchRef.current.points.keys()) event.currentTarget.setPointerCapture(pointerId);
        cancelLongPress();
      }
      return;
    }
    dragRef.current = { active: true, moved: false, pointerId: event.pointerId, startX: point.x, startY: point.y, startClientX: event.clientX, startClientY: event.clientY, panX: pan.x, panY: pan.y };
  };
  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch") {
      const points = pinchRef.current.points;
      if (!points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size >= 2 && pinchRef.current.active) {
        const [a, b] = Array.from(points.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        // 低倍区间（1%–10%）两位小数会被 toFixed 压成同一个值而卡住，和滚轮一样保留三位。
        const next = Math.min(TREE_MAX_SCALE, Math.max(minimumScaleForLayout(positionsRef.current), Number((pinchRef.current.scale * distance / pinchRef.current.distance).toPrecision(6))));
        const { scale: current, pan: panNow } = viewRef.current;
        if (next !== current) {
          // **以两指中点为锚**：手指夹住的那个位置缩完还在原处。
          // 老代码只改 scale 不调 pan，锚点等于画布原点，于是缩小时看着的那个点一下就跑出视野
          // （用户 09-26 报的「不知道是在哪个地方缩的」）。
          const anchor = clientPointInTreeCanvas(event.currentTarget, (a.x + b.x) / 2, (a.y + b.y) / 2);
          const ratio = next / current;
          userMovedRef.current = true;
          setPan(clampPanToContent({ x: anchor.x - (anchor.x - panNow.x) * ratio, y: anchor.y - (anchor.y - panNow.y) * ratio }, next));
          setScale(next);
        }
        dragRef.current.moved = true;
        cancelLongPress();
        return;
      }
    }
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const clientDx = event.clientX - drag.startClientX;
    const clientDy = event.clientY - drag.startClientY;
    if (Math.hypot(clientDx, clientDy) > TREE_DRAG_THRESHOLD && !drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      cancelLongPress();
    }
    if (!drag.moved) return;
    const point = clientPointInTreeCanvas(event.currentTarget, event.clientX, event.clientY);
    userMovedRef.current = true;
    setPan({ x: drag.panX + point.x - drag.startX, y: drag.panY + point.y - drag.startY });
  };
  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch") {
      pinchRef.current.points.delete(event.pointerId);
      if (pinchRef.current.points.size < 2) pinchRef.current.active = false;
      if (dragRef.current.pointerId === event.pointerId) dragRef.current.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (pinchRef.current.points.size === 0) window.setTimeout(() => { pinchGestureRef.current = false; }, 0);
      return;
    }
    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const beginBookmarkEdit = (bookmark: RecordBookmark) => {
    setEditingBookmarkId(bookmark.id);
    setBookmarkTitle(bookmark.title);
    setBookmarkNote(bookmark.note);
  };
  const commitBookmarkEdit = () => {
    const bookmark = props.bookmarks.find((item) => item.id === editingBookmarkId);
    if (!bookmark || !bookmarkTitle.trim()) return;
    props.onEditBookmark(bookmark, { title: bookmarkTitle, note: bookmarkNote });
    setEditingBookmarkId(null);
  };

  const nodeActions = selected && <section className={`tree-node-actions ${view === "navigate" ? "navigation-actions" : ""}`} aria-label={`节点操作 ${displayLabel(selected, selected.id)}`}>
        {!readOnly && longPressId === selected.id && <div className="tree-long-press-menu" role="menu" aria-label="分支快捷操作"><b>分支操作</b><button type="button" onClick={() => { props.onCopy(selected.id); setLongPressId(null); }}><Copy/>复制</button><button type="button" onClick={() => { props.onCut(selected.id); setLongPressId(null); }}><Scissors/>剪切</button>{props.clipboard && <button type="button" onClick={() => { props.onPaste(selected.id); setLongPressId(null); }}><Clipboard/>粘贴</button>}<button type="button" className="danger" onClick={() => { props.onDeleteBranch(selected.id); setLongPressId(null); }}><Trash2/>删除分支</button></div>}
        <div className="tree-node-action-head"><span className={`tree-action-stone ${playerForNode(selected) || "neutral"}`}/><div><b>{displayLabel(selected, selected.id)}</b><small>{selected.id === props.currentId ? "当前局面" : "已选节点"}{mainLineIds.has(selected.id) ? " · 在主分支上" : ""}{selectedChildCount ? ` · ${selectedChildCount} 个后续${selectedUnloadedCount ? `（${selectedUnloadedCount} 支待读取）` : ""}` : " · 分支末端"}</small></div>{selectedBookmark && <Bookmark className="bookmarked"/>}</div>
        {!readOnly && renaming ? <div className="tree-inline-rename"><input autoFocus value={branchTitle} onChange={(event) => setBranchTitle(event.target.value)} placeholder="输入分支名称" onKeyDown={(event) => { if (event.key === "Enter" && branchTitle.trim()) { props.onRenameBranch(selected.id, branchTitle); setRenaming(false); } if (event.key === "Escape") setRenaming(false); }}/><button type="button" onClick={() => { if (branchTitle.trim()) props.onRenameBranch(selected.id, branchTitle); setRenaming(false); }}><Check/></button><button type="button" onClick={() => setRenaming(false)}><X/></button></div> : <div className="tree-node-action-grid" ref={actionGridRef} style={{ "--tree-action-cols": actionColumns(actionWidth ?? 390, actionCount || 1) } as CSSProperties}>
          <button type="button" onClick={() => props.onLocate(selected.id, selected.parentId || undefined)} disabled={props.busy}><LocateFixed/>定位</button>
          {/* 操作区按钮的**顺序原则**（用户 2026-10-11：「排列一下，下面的那些按钮的顺序」）：
              **看 → 改 → 搬 → 研究 → 删**，同一类相邻，危险的排最后。
              · 看：定位 / 展开下一层 / 收起这一层 / 只看这支 / 展开全部 / 收起全部
                （按"这一支"到"整棵树"由近及远；定位排最前，它是"我在哪"）
              · 改：设为主分支 / 新分支 / 加书签 / 重命名
              · 搬：复制分支 / 粘贴到这里
              · 研究：同型局面
              · 删：删除分支（唯一一枚 danger，永远最后一个）
              改之前是"视图与编辑交替"（设为主分支夹在展开/收起中间），
              找一个按钮要逐行扫。 */}
          {view === "tree" && <>
            {selectedChildCount > 0 && <>
              <button type="button" onClick={() => expandBranch(selected.id)} disabled={!canExpandBranch} title="把这一手下面的一层分支摊开；再点一次继续往下摊一层"><UnfoldVertical/>展开下一层</button>
              <button type="button" onClick={() => collapseBranch(selected.id)} disabled={!canCollapseBranch} title="把摊开的分支收回一层；已经收回去了就整枝收起"><FoldVertical/>收起这一层{selectedOpenLevels > 0 ? ` (${selectedOpenLevels})` : ""}</button>
            </>}
            {/* 「只看这支」（用户 2026-10-10）：只看选中这一手的后续，其他分支全藏。
                名字取三个字——操作区一行最多也就放五六个，「只看这一手的后续分支」太长了。 */}
            <button type="button" aria-pressed={focusId === selected.id} onClick={() => toggleFocusBranch(selected.id)} disabled={!selectedChildCount} title={selectedChildCount ? "只显示这一手的后续分支，其他分支都隐藏起来" : "这一手没有后续分支"}><Filter/>只看这支</button>
            <button type="button" aria-pressed={treeMode === "expanded"} onClick={expandWholeTree} title="展开全部已加载分支；屏幕外节点可通过拖动或小地图查看"><ChevronsUpDown/>展开全部</button>
            <button type="button" aria-pressed={treeMode === "collapsed"} onClick={collapseWholeTree} title="只留当前路径这一条线，其余分支先收起来"><ChevronsDownUp/>收起全部</button>
          </>}
          {!readOnly && selected.parentId && !mainLineIds.has(selected.id) && <button type="button" onClick={() => props.onSetMainBranch(selected.id)} disabled={props.busy} title="把这一手所在的整条线设为棋谱主分支（写进草稿，可撤销）"><Flag/>设为主分支</button>}
          {!readOnly && <><button type="button" onClick={() => props.onCreateBranch(selected.id)} disabled={props.busy}><GitBranch/>新分支</button><button type="button" onClick={() => props.onToggleBookmark(selected.id)}><Bookmark/>{selectedBookmark ? "取消书签" : "加书签"}</button></>}
          {!readOnly && selected.parentId && <button type="button" onClick={() => { setBranchTitle(displayLabel(selected, selected.id)); setRenaming(true); }}><PencilLine/>重命名</button>}
          {!readOnly && <button type="button" onClick={() => props.onCopy(selected.id)} disabled={isCompact} title={isCompact ? "大型棋谱当前只加载可视窗口，请先创建编辑副本" : "复制此节点以下的完整子树"}><Copy/>复制分支</button>}
          {!readOnly && props.clipboard && <button type="button" className="primary" onClick={() => props.onPaste(selected.id)} disabled={props.busy || isCompact}><Clipboard/>粘贴到这里</button>}
          {/* 「同型局面」入口做成与其它按钮同级的一枚（用户 2026-10-10：「应该放到下面去，
              和那些按钮一起」）——原来它在工具条上，和搜索并排，位置与语义都不搭。 */}
          <button type="button" aria-pressed={showTranspositions} onClick={() => setShowTranspositions((value) => !value)} title={isCompact ? "大型棋谱按需窗口暂不做同型查找" : "找出「走子顺序不同、盘面相同」的同型局面（殊途同归）"}><GitBranch/>同型局面{showTranspositions && transpositionCount ? ` ${transpositionCount}` : ""}</button>
          {!readOnly && selected.parentId && <button type="button" className="danger" onClick={() => props.onDeleteBranch(selected.id)}><Trash2/>删除分支</button>}
        </div>}
        {isCompact && <p className="helper">大型棋谱树是按需窗口。定位与浏览可直接使用；复制、粘贴等完整子树编辑需先进入可编辑副本。</p>}
        {/* 同型局面（用户 2026-10-09 提、2026-10-10 明确要「合并」）：
            两条不同落子顺序走到同一盘面时，把它们**收成一条**。
            列表里每条给两个动作：点一行＝跳过去看；点「并入」＝把那一处搬过来并删掉。 */}
        {showTranspositions && (transpositionIndex ? <section className="tree-transposition" aria-label="同型局面">
          <div className="tree-transposition-head">
            <b>同型局面</b>
            <small>{transpositionCount ? `全谱 ${transpositionCount} 处殊途同归` : "全谱没有殊途同归"}</small>
          </div>
          {samePositions.length ? <>
            <p className="helper">这些是同一盘面的另一条走法。「并入」会把它的后续搬到这里、并删掉多余的那一处（保存前可撤销）。</p>
            <div className="tree-transposition-list">
              {samePositions.map((entry) => <div key={entry.id} className="tree-transposition-row">
                <button type="button" className="tree-transposition-jump" onClick={() => jumpTo(entry.id)} title="跳到这个同型局面去看">
                  <span className={`tree-action-stone ${playerForNode(props.document.nodes[entry.id]) || "neutral"}`}/>
                  <span><b>{displayLabel(props.document.nodes[entry.id], entry.id)}</b><small>第 {entry.turn} 手 · {entry.marker}</small></span>
                  <ChevronRight/>
                </button>
                {!readOnly && props.onMergeSamePositions && <button type="button" className="tree-transposition-merge" disabled={props.busy} title="把这一处的后续搬到当前这一手下面，并删掉这一处重复（保存前可整体撤销）" onClick={() => props.onMergeSamePositions?.(selected.id, entry.id)}>并入</button>}
              </div>)}
            </div>
          </> : <p className="helper">{isTransposition(transpositionIndex, selected.id)
            ? "这一手的同型局面都在当前画面上，不用跳。"
            : transpositionCount
              ? "这一手没有同型局面。有同型的那些手会带一枚蓝点。"
              : "这份棋谱里还没有「走子顺序不同、盘面相同」的局面。"}</p>}
        </section> : <section className="tree-transposition" aria-label="同型局面">
          {/* 懒加载源（DP/LIB）与分页大棋谱：**如实说不做**，不给一个看起来像「没有同型」的空结果。
              这一句是 2026-10-10 排查时补的——原来这里直接不渲染，用户点了按钮没反应、
              也不知道是「查过了没有」还是「根本没查」。 */}
          <div className="tree-transposition-head"><b>同型局面</b></div>
          <p className="helper">{isCompact
            ? "大型棋谱按需窗口暂不做同型查找（只加载了可视的这一段，查了也算不准）。"
            : "这份棋谱是数据库/库文件按局面读取的，全库还没读完，暂不做同型查找。"}</p>
        </section>)}
      </section>;

  return <div className={`record-tree-panel ${view === "tree" && graphExpanded ? "graph-expanded" : ""}`} ref={panelRef}>
    <div className="record-tree-tabs" role="tablist" aria-label="分支树视图">
      <button type="button" className={view === "tree" ? "active" : ""} onClick={showSelectedInGraph} role="tab" aria-selected={view === "tree"}><GitBranch/>图谱</button>
      <button type="button" className={view === "navigate" ? "active" : ""} onClick={openNavigator} role="tab" aria-selected={view === "navigate"}><ChevronRight/>导航</button>
      <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")} role="tab" aria-selected={view === "list"}><ScrollText/>列表</button>
      <button type="button" className={view === "bookmarks" ? "active" : ""} onClick={() => setView("bookmarks")} role="tab" aria-selected={view === "bookmarks"}><Bookmark/>书签{props.bookmarks.length ? ` ${props.bookmarks.length}` : ""}</button>
    </div>

    {props.clipboard && !readOnly && <div className="tree-copy-banner" role="status"><Clipboard/><span><b>已复制 {Object.keys(props.clipboard.nodes).length} 个节点</b><small>点选目标节点，再点“粘贴到这里”</small></span><button type="button" onClick={props.onCancelCopy}>取消</button></div>}

    {(view === "tree" || view === "list") && (props.partial || visibleTree.unloadedCount > 0) && <div className="tree-window-note" role="status"><span>库文件按需读取；尚未读取的后续可继续展开。</span><button type="button" onClick={openNavigator}>导航读取后续<ChevronRight/></button></div>}

    {view === "navigate" && selected && <>
      <TreeNavigator document={props.document} node={selected} currentId={props.currentId} compactIndex={props.compactIndex} mainLineIds={mainLineIds} bookmarkIds={bookmarkByNode} branchNames={props.branchNameOverrides} busy={props.busy} onSelect={setSelectedId} onGraph={showSelectedInGraph} onLoadBranch={props.onLoadBranch} previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen((value) => !value)} onLocate={() => props.onLocate(selected.id, selected.parentId || undefined)}/>
    </>}

    {view === "bookmarks" ? <div className="tree-bookmark-browser">
      <label className="tree-bookmark-search"><Search/><input value={bookmarkQuery} onChange={(event) => setBookmarkQuery(event.target.value)} placeholder="搜索书签标题或备注" aria-label="搜索书签"/></label>
      <div className="tree-bookmark-list">
        {filteredBookmarks.map((bookmark) => <article key={bookmark.id} className={`tree-bookmark-card ${bookmark.accent || "jade"}`}>
          {!readOnly && editingBookmarkId === bookmark.id ? <div className="tree-bookmark-edit">
            <label>标题<input autoFocus value={bookmarkTitle} onChange={(event) => setBookmarkTitle(event.target.value)}/></label>
            <label>备注<textarea value={bookmarkNote} onChange={(event) => setBookmarkNote(event.target.value)} placeholder="自由记录研究想法"/></label>
            <div className="bookmark-accent-picker" aria-label="书签标识颜色">{(["jade", "gold", "blue", "rose"] as const).map((accent) => <button key={accent} type="button" className={accent} aria-label={`选择${accent}标识`} onClick={() => props.onEditBookmark(bookmark, { accent })}/>)}</div>
            <div className="tree-edit-actions"><button type="button" onClick={commitBookmarkEdit}><Check/>保存</button><button type="button" onClick={() => setEditingBookmarkId(null)}><X/>取消</button></div>
          </div> : <>
            <button type="button" className="tree-bookmark-jump" onClick={() => props.onLocate(bookmark.nodeId)}><Bookmark/><span><b>{bookmark.title}</b><small>{bookmark.note || labelForNode(props.document.nodes[bookmark.nodeId] || { parentId: null, move: null } as RecordNode)}</small></span><LocateFixed/></button>
            {!readOnly && <div className="tree-bookmark-actions"><button type="button" onClick={() => beginBookmarkEdit(bookmark)} aria-label={`编辑书签 ${bookmark.title}`}><PencilLine/>编辑</button><button type="button" onClick={() => props.onDeleteBookmark(bookmark)} aria-label={`删除书签 ${bookmark.title}`}><Trash2/>删除</button></div>}
          </>}
        </article>)}
        {!filteredBookmarks.length && <div className="sheet-empty"><Bookmark/><b>{bookmarkQuery ? "没有匹配的书签" : "还没有书签"}</b><span>{bookmarkQuery ? "换个标题或备注关键词试试。" : "回到变化树，选中节点后即可快速添加。"}</span></div>}
      </div>
    </div> : <>
      {view === "tree" && <div className="tree-graph-layout">
      <div className="tree-graph-pane">
      <div className="tree-toolbar">
        <div className="tree-toolbar-head">
          <div className="tree-toolbar-title"><b>变化总览</b><small>{tree.length} 个已展开节点{branchPoints ? ` · ${branchPoints} 个分支点` : ""}</small></div>
          {/* 搜索开关放在**标题行**（用户 2026-10-11：「那个搜索的按钮好像是单独一行了，
              你改一下位置，让他和别的在一行，同时也不会挤的别的按钮太小或者看不见」）。
              ⚠ 它原来自己占一整行（`.tree-toolbar-actions`）——那行的成因是"当时有两枚开关、
              两枚一起挤不下标题"，后来「同型局面」挪去操作区只剩它一枚，于是**一行只放一个按钮**。
              现在收进标题行：标题 `flex:1 1 auto` + `min-width:0`（可省略号），
              开关 `flex:0 0 auto`（固定不被压扁），窄屏下挤的是标题文字而不是按钮。 */}
          <details className="tree-branch-menu" onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.open) { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label="展开与收起分支"><GitBranch/>展开</summary>
            <div className="tree-branch-choices" onClick={(event) => { if ((event.target as HTMLElement).closest("button:not(:disabled)")) event.currentTarget.closest("details")?.removeAttribute("open"); }}>
              <button type="button" onClick={() => expandBranch(selectedId)} disabled={!canExpandBranch}><UnfoldVertical/>展开下一层</button>
              <button type="button" onClick={() => collapseBranch(selectedId)} disabled={!canCollapseBranch}><FoldVertical/>收起这一层</button>
              <button type="button" onClick={expandWholeTree}><ChevronsUpDown/>展开全部</button>
              <button type="button" onClick={collapseWholeTree}><ChevronsDownUp/>收起全部</button>
            </div>
          </details>
          <button type="button" className="tree-search-toggle" aria-pressed={searchOpen} aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)} title="在整份棋谱里搜手数、坐标、注释与标注"><Search/>搜索</button>
          <button type="button" className="tree-atlas-toggle" aria-label={atlasMode ? "切换逐手图谱" : "分区总览"} aria-pressed={atlasMode} onClick={openAtlas} title="每条变化一个分区，点按逐层深入">{atlasMode ? "逐手" : "分区"}</button>
          <button type="button" className="tree-expand-toggle" aria-label={graphExpanded ? "退出放大图谱" : "放大图谱"} aria-pressed={graphExpanded} title={graphExpanded ? "恢复预览与节点编辑操作" : "给大图谱更多空间"} onClick={() => { userMovedRef.current = true; pendingRevealRef.current = selectedId; setGraphExpanded((value) => !value); }}>{graphExpanded ? <Minimize2/> : <Maximize2/>}</button>
        </div>
        {atlasMode && <div className="tree-atlas-tools">分区总览 · {tree.length} 个已读取节点 · 名称保持可读</div>}
        <div className="tree-zoom-controls" aria-label="分支树缩放" hidden={atlasMode}>
          <button type="button" onClick={() => nudgeScale(-1)} aria-label="缩小"><Minus/></button>
          <input className="tree-zoom-range" type="range" min={0} max={1} step={0.001} value={Math.log(scale / minimumScaleForLayout(positions)) / Math.log(TREE_MAX_SCALE / minimumScaleForLayout(positions))} onChange={(event) => zoomTo(minimumScaleForLayout(positions) * Math.pow(TREE_MAX_SCALE / minimumScaleForLayout(positions), Number(event.target.value)))} aria-label="缩放比例"/>
          <details className="tree-zoom-menu" onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.open) { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label="选择缩放比例">{scale >= 2 ? `${Number(scale.toFixed(2))}×` : scale < 0.1 ? `${Number((scale * 100).toPrecision(2))}%` : `${Math.round(scale * 100)}%`}</summary>
            <div className="tree-zoom-presets" aria-label="快速缩放">{[0.05, 0.1, 0.2, 0.5, 1, 5, 50, 100].map((value) => <button key={value} type="button" onClick={(event) => { zoomTo(value); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{value <= 1 ? `${value * 100}%` : `${value}×`}</button>)}</div>
          </details>
          <button type="button" onClick={() => nudgeScale(1)} aria-label="放大"><Plus/></button>
          <button type="button" onClick={fitGraph} aria-label="总览全部已展开分支" title="看全局结构；点按节点放大查看"><Maximize2/></button>
          <button type="button" onClick={() => { userMovedRef.current = false; setScale(1); if (focusId) { const point = positions.byId.get(focusId); if (point) setPan({ x: positions.viewWidth / 2 - point.x - point.w / 2, y: positions.viewHeight / 2 - point.y - 22 }); } else centerOnCurrent(1); }} aria-label="重置视图，回到当前手居中"><RotateCcw/></button>
        </div>
        {searchOpen && <div className="tree-search" role="search">
          <label className="tree-search-field"><Search/><input autoFocus value={searchQuery} placeholder="搜手数 / 坐标 / 注释 / 标注：41、H8、双三、三角" aria-label="在棋谱树里搜索" onChange={(event) => runSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); stepSearch(event.shiftKey ? -1 : 1); } if (event.key === "Escape") { event.preventDefault(); setSearchOpen(false); } }}/><button type="button" onClick={() => setSearchOpen(false)} aria-label="关闭搜索"><X/></button></label>
          <div className="tree-search-nav">
            <span>{searchQuery.trim() ? (searchHits.length ? `第 ${searchCursor + 1} / ${searchHits.length} 个命中` : isPartial ? "没有命中（未加载的分支还没索引）" : "没有命中") : `已索引 ${searchIndex.entries.length} 个节点${searchIndex.truncated ? "（超大棋谱只索引了前面一部分）" : ""}${isPartial ? "（未加载的分支还没索引，点「展开下一层」读回来再搜）" : ""}`}</span>
            <button type="button" onClick={() => stepSearch(-1)} disabled={!searchHits.length}>上一个</button>
            <button type="button" onClick={() => stepSearch(1)} disabled={!searchHits.length}>下一个</button>
          </div>
          {searchHits.length > 0 && <div className="tree-search-list" ref={searchListRef} role="list">
            {searchHits.map((hit, index) => <button key={hit.id} type="button" role="listitem" className={`tree-search-hit ${index === searchCursor ? "active" : ""}`} onClick={() => { setSearchCursor(index); jumpTo(hit.id); }}>
              <b>{hit.turn > 0 ? `第 ${hit.turn} 手` : "起始局面"}</b>
              <span>{hit.kinds.map((kind) => NODE_SEARCH_KIND_LABELS[kind]).join(" · ")}</span>
              <small>{hit.detail}</small>
            </button>)}
          </div>}
        </div>}
      </div>
      {focusId && <nav className="tree-scope-path" aria-label="图谱分支路径"><button type="button" onClick={() => restoreFocus(focusHistory.length - 1)}>返回上一级</button><div>{focusCrumbs.map((node) => <button key={node.id} type="button" aria-current={node.id === focusId ? "location" : undefined} disabled={node.id === focusId} onClick={() => node.id === props.document.rootId ? restoreFocus(0) : toggleFocusBranch(node.id)} title={displayLabel(node, node.id)}>{node.id === props.document.rootId ? "全谱" : displayLabel(node, node.id)}<ChevronRight/></button>)}</div></nav>}
      <div className="tree-viewport" aria-label="棋谱树，可拖动查看" data-layout-nodes={tree.length} data-rendered-nodes={screenNodes.length} data-display={atlasMode ? "atlas" : structureMode ? "structure" : "detail"} data-detail={compactDetail ? "compact" : "full"} style={{ height: positions.canvasHeight }}>
        {!atlasMode && structureMode && <span className="tree-structure-hint">{geometry.wideForks ? "多分支已分栏 · " : ""}结构总览 · 点按放大查看</span>}
        {atlasMode ? <TreeBranchAtlas regions={branchBands} selectedPath={selectedTrace} mainLine={mainLineIds} label={(id) => displayLabel(props.document.nodes[id], id)} onEnter={(region) => { setSelectedId(region.id); toggleFocusBranch(region.id); if (!region.forks) setAtlasMode(false); }} onDetail={() => { setAtlasMode(false); pendingRevealRef.current = selectedId; }}/> : <svg ref={svgRef} className="tree-canvas" width="100%" height="100%" viewBox={`0 0 ${positions.viewWidth} ${positions.viewHeight}`} role="img" aria-label="分支树，可拖动查看；滚轮或双指可缩放" onPointerDownCapture={startDrag} onPointerMoveCapture={moveDrag} onPointerUpCapture={endDrag} onPointerCancelCapture={endDrag}>
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            <g className="tree-branch-bands" aria-hidden="true">{!structureMode && branchBands.filter((band) => band.right >= viewport.left && band.x <= viewport.right && band.bottom >= viewport.top && band.y <= viewport.bottom).map((band) => <rect key={band.id} className={selectedTrace.has(band.id) ? "selected" : ""} x={band.x} y={band.y} width={band.right - band.x} height={band.bottom - band.y} rx="10"/>)}</g>
            <g className="tree-edges">{virtual ? edgePaths.map(({ cls, d }) => <path key={cls} d={d} className={`tree-edge ${cls}`} style={structureMode ? { strokeWidth: cls === "trace" ? 2 / scale : 1 / scale } : undefined}/>) : [...tree].sort((a, b) => Number(selectedTrace.has(a.id)) - Number(selectedTrace.has(b.id))).map((entry) => {
              const route = geometry.routes.get(entry.id);
              if (!route) return null;
              const d = treeEdgePath(route);
              const cls = `tree-edge ${entry.onPath ? "path" : entry.revealed ? "revealed" : ""} ${selectedTrace.has(entry.id) ? "trace" : ""}`;
              return <path key={`${entry.parentId}-${entry.id}`} d={d} className={cls}/>;
            })}</g>
            <g className="tree-nodes">{screenNodes.map(({ entry, point, count }) => {
              const player = playerForNode(entry.node), title = displayLabel(entry.node, entry.id);
              const branchPoint = entry.childCount > 1;
              const childHint = entry.childCount === 1 && !entry.onPath ? " · 后续 1 支" : "";
              const branchHint = branchPoint ? `，这里分出 ${entry.childCount} 支${entry.folded ? "（未展开）" : ""}` : "";
              return <g key={entry.id} className={`tree-node ${entry.isCurrent ? "current" : ""} ${entry.id === selectedId ? "selected" : ""} ${entry.onPath ? "path" : ""} ${branchPoint ? "branching" : ""} ${entry.folded ? "folded" : ""} ${entry.revealed ? "revealed" : ""} ${entry.id === searchActiveId ? "search-hit" : ""} ${player || "neutral"}`} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`${title}${entry.isCurrent ? "，当前局面" : ""}${entry.id === selectedId ? "，已选中" : ""}${entry.id === searchActiveId ? "，搜索命中" : ""}${branchHint}`} onPointerDown={(event) => { event.stopPropagation(); if (!readOnly && event.pointerType === "touch" && !pinchGestureRef.current) beginLongPress(entry.id); }} onPointerUp={(event) => { const wasGesture = pinchGestureRef.current || dragRef.current.moved; cancelLongPress(); if (event.pointerType === "touch" && !wasGesture) activateGraphNode(entry.id); }} onPointerCancel={() => cancelLongPress()} onClick={() => { if (dragRef.current.moved || pinchGestureRef.current) return; if (longPressId === entry.id) { activateGraphNode(entry.id); return; } activateGraphNode(entry.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateGraphNode(entry.id); } }}>
                {pressingId === entry.id && longPressProgress > 0 && <circle className="tree-long-press-progress" cx={dotIds.has(entry.id) ? TREE_CHAIN_WIDTH - 6 : TREE_NODE_WIDTH - 10} cy={dotIds.has(entry.id) ? TREE_NODE_HEIGHT - 8 : TREE_NODE_HEIGHT - 10} r="7" style={{ strokeDashoffset: `${44 * (1 - longPressProgress)}` }} aria-label="正在加载分支操作"/>}
                {structureMode ? <><title>{title}{count > 1 ? `附近 ${count} 个节点；点按放大` : "；点按放大"}</title><rect className="tree-structure-hit" x={point.w / 2 - 6 / scale} y={22 - 6 / scale} width={12 / scale} height={12 / scale}/><circle className={`tree-structure-node ${entry.id === selectedId ? "selected" : entry.isCurrent ? "current" : ""}`} cx={point.w / 2} cy="22" r={(entry.id === selectedId || entry.isCurrent ? 4 : count > 1 ? 3 : 2) / scale}/></> : compactDetail ? <>
                  <title>{title} · 第 {entry.turnDepth} 手{branchHint}</title>
                  <rect className="tree-dot-face tree-compact-face" width={point.w + TREE_X_GAP - 8} height={TREE_NODE_HEIGHT} rx="9"/>
                  <svg x="0" y="0" width={point.w + TREE_X_GAP - 8} height={TREE_NODE_HEIGHT} overflow="hidden">
                    <text className="tree-chain-label tree-compact-label" x={(point.w + TREE_X_GAP - 8) / 2} y="22" textAnchor="middle" dominantBaseline="central" textLength={Math.min(point.w + TREE_X_GAP - 14, (compactLabelForNode(entry.node, boardSize).length + String(entry.turnDepth).length + 1) * TREE_COMPACT_TEXT_PX * 0.62 / scale)} lengthAdjust="spacingAndGlyphs" style={{ fontSize: TREE_COMPACT_TEXT_PX / scale }}>{compactLabelForNode(entry.node, boardSize)}·{entry.turnDepth}</text>
                  </svg>
                </> : dotIds.has(entry.id) ? <>
                  <rect className="tree-dot-face" width={TREE_CHAIN_WIDTH} height={TREE_CHAIN_HEIGHT} y={TREE_CHAIN_TOP} rx={TREE_CHAIN_HEIGHT / 2}/>
                  <circle className="tree-node-dot" cx="13" cy={TREE_CHAIN_MID} r="4.5"/>
                  <text className="tree-chain-label" x="22" y={TREE_CHAIN_MID + 3.5}>{compactLabelForNode(entry.node, boardSize)}</text>
                  <text className="tree-chain-num" x={TREE_CHAIN_WIDTH - 8} y={TREE_CHAIN_MID + 3.5}>{entry.turnDepth}</text>
                </> : <>
                  <title>{title}</title><rect width={TREE_NODE_WIDTH} height={TREE_NODE_HEIGHT} rx="12"/><circle cx="16" cy="22" r="7" className="tree-node-dot"/><svg x="30" y="0" width="82" height={TREE_NODE_HEIGHT} overflow="hidden"><text x="0" y="19" className="tree-node-label">{title}</text></svg><text x="30" y="34" className="tree-node-meta">{entry.turnDepth === 0 ? "起始局面" : `第 ${entry.turnDepth} 手`}{childHint}</text>{entry.isCurrent && <circle cx={TREE_NODE_WIDTH - 12} cy="12" r="4" className="tree-current-dot"/>}{bookmarkByNode.has(entry.id) && <path className="tree-node-bookmark" d={`M ${TREE_NODE_WIDTH - 24} 4 h 8 v 11 l -4 -2.8 -4 2.8 z`}/>}
                </>}
                {!structureMode && !compactDetail && branchPoint && <g className={`tree-branch-mark ${entry.folded ? "folded" : ""}`} aria-hidden="true"><circle cx={TREE_NODE_WIDTH - 21} cy={TREE_NODE_HEIGHT - 15} r="9.5"/><text x={TREE_NODE_WIDTH - 21} y={TREE_NODE_HEIGHT - 11}>{entry.childCount}</text></g>}
                {/* 同型局面标记（用户 2026-10-09）：这一手的盘面在**别处**还出现过。
                    画成节点左上角的一枚小圆点——RenLib 是把它画成棋盘上另一种颜色的点，
                    我们这里没有棋盘（是树画布），所以用「节点自带一枚标记」表达同一件事。
                    aria-hidden：信息在操作区的文字里完整给一份，读屏用户不靠这个点。 */}
                {showTranspositions && transpositionIndex && isTransposition(transpositionIndex, entry.id) && (
                  <circle className="tree-transposition-dot" cx={dotIds.has(entry.id) ? TREE_CHAIN_WIDTH / 2 : 11} cy={dotIds.has(entry.id) ? 5 : 9} r="4" aria-hidden="true"/>
                )}
              </g>;
            })}</g>
          </g>
        </svg>}
        {/* 右下角那张**小地图（缩略图）**带一把折叠（用户 2026-10-14：要折叠的是它，不是棋盘预览）。
            折叠后原地只剩一颗小按钮——它占的就是缩略图自己那个角，所以不需要给别的东西让位。 */}
        {!atlasMode && tree.length > 24 && (minimapCollapsed
          ? <button type="button" className="tree-minimap-reopen" onClick={() => setMinimapCollapsed(false)} aria-label="展开小地图" aria-expanded="false" aria-controls="tree-minimap" title="展开小地图"><ChevronUp/></button>
          : <div className="tree-minimap" id="tree-minimap"><TreeOverview entries={tree} points={positions.byId} routes={geometry.routes} width={positions.contentWidth} height={positions.contentHeight} viewWidth={positions.viewWidth} viewHeight={positions.viewHeight} pan={pan} scale={scale} selectedId={selectedId} onCenter={centerOnPoint}/><button type="button" className="tree-minimap-collapse" onClick={() => setMinimapCollapsed(true)} aria-label="折叠小地图" aria-expanded="true" aria-controls="tree-minimap" title="折叠成右下角的小按钮"><ChevronDown/></button></div>)}
      </div>
      <div className="tree-mapbar">
        <div className="tree-mapbar-context">
          <button type="button" className="tree-mapbar-selected" onClick={inspectSelectedNode} aria-label="看清所选节点" title="放大并居中所选节点" disabled={!positions.byId.has(selectedId)}><ZoomIn/><span><b>{selected ? displayLabel(selected, selected.id) : "所选节点"}</b><small>{selectedTreeEntry ? selectedTreeEntry.turnDepth ? `第 ${selectedTreeEntry.turnDepth} 手` : "起始局面" : "所选节点"}{selectedChildCount ? ` · ${selectedChildCount} 个后续` : " · 末端"}</small></span></button>
          <button type="button" onClick={openNavigator}>导航<ChevronRight/></button>
          <button type="button" onClick={() => focusId === selectedId ? restoreFocus(0) : toggleFocusBranch(selectedId)} disabled={focusId !== selectedId && !selectedChildCount}>{focusId === selectedId ? "返回全谱" : "只看这支"}</button>
          <button type="button" onClick={() => selected && props.onLocate(selected.id, selected.parentId || undefined)} aria-label="将所选节点定位到棋盘" disabled={!selected || props.busy}><LocateFixed/>到棋盘</button>
        </div>
      </div>
      </div>
      <aside className="tree-inspector" id="tree-inspector" aria-label="节点预览与操作" hidden={graphExpanded}>
      <div className="tree-inspector-options" role="group" aria-label="节点详情选项">
        <button type="button" className="tree-quick-expand" onClick={() => expandBranch(selectedId)} disabled={!canExpandBranch} aria-label="展开所选节点的下一层">展开一层</button>
        <button type="button" className="tree-quick-collapse" onClick={() => collapseBranch(selectedId)} disabled={!canCollapseBranch || props.busy} aria-label="收起所选节点的一层">收起一层</button>
        <button type="button" aria-pressed={inspectorView === "preview"} aria-expanded={inspectorView === "preview"} aria-controls="tree-inspector-content" onClick={() => toggleInspector("preview")}>棋盘预览</button>
        <button type="button" aria-pressed={inspectorView === "actions"} aria-expanded={inspectorView === "actions"} aria-controls="tree-inspector-content" onClick={() => toggleInspector("actions")}>节点操作</button>
      </div>
      <div className="tree-inspector-content" id="tree-inspector-content" hidden={!inspectorView}>
      {/* 这里**不放**折叠按钮（R196 加过一把"面板折叠＋画布右下角小按钮"，用户 2026-10-14 说
          要折叠的是右下角那张小地图，不是棋盘预览 ⇒ 已撤；折叠位在 `.tree-minimap` 上）。 */}
      <div hidden={inspectorView !== "preview"}>
      <TreePreview
        document={props.document}
        node={selected}
        compactIndex={props.compactIndex}
        open={inspectorView === "preview"}
        onToggle={() => setInspectorView(null)}
        hideHeader
      />
      </div>
      <div hidden={inspectorView !== "actions"}>{nodeActions}</div>
      <div className="tree-legend"><span><i className="path"/>当前路径</span><span><i className="trace"/>所选路径</span><span><i className="branch"/>多分支点</span><span><i className="revealed"/>自己展开的枝</span>{showTranspositions && <span><i className="transposition"/>同型局面</span>}<span><i className="black"/>黑</span><span><i className="white"/>白</span></div>
      </div>
      </aside>
      </div>}
    </>}

    {view === "list" && <div className="tree-list-pane">
      <TreeListView
        rows={listRows}
        onMainLine={mainLineIds.has(props.currentId)}
        mainLineTurn={mainLineTurn}
        onActivate={(id) => { setSelectedId(id); jumpTo(id); }}
        onBackToMainLine={() => { if (mainLineArray[mainLineTurn ?? 0]) { const target = mainLineArray[mainLineTurn ?? 0]; setSelectedId(target); jumpTo(target); } }}
      />
    </div>}

    {view !== "tree" && nodeActions}

  </div>;
}
