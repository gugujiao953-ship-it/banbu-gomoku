import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, History, ImageDown, Pause, Pencil, Play, RotateCcw, Save, Share2, Sparkles, Square, X } from 'lucide-react';
import GeneratorWorker from './generator.worker?worker';
import { DEFAULT_GENERATOR_SETTINGS, validateSettings, type GeneratedPuzzle, type GeneratorKind, type GeneratorSettings, type GeneratorShapeDefinition, type ProofNode, type SolutionMove, type WorkerReply, type WorkerRequest } from './model';
import { GeneratorBoard } from './GeneratorBoard';
import { CustomShapeCanvas } from './CustomShapeCanvas';
import { rasterizeAppText } from './text-raster';
import { replayPrefix, replaySteps } from './replay';
import { HISTORY_PAGE_SIZE, appendBatch, historyPuzzles, lastBatch, loadBatches, type GeneratedBatch } from './history';
import { GENERATED_DEFAULT_FOLDER } from './collection';
import { puzzleShareFilename, renderPuzzleSharePng } from './puzzle-image-export';
import { sharePngFile } from '../../share-file';
import { coordinateName } from '../../game';
import './generator.css';
import { WaitingOverlay } from '../waiting/SelfPlayWait';

const SETTINGS_KEY = 'banbu-puzzle-generator-settings-v2';
function loadSettings(): GeneratorSettings {
  try {
    const value = { ...DEFAULT_GENERATOR_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    // Keep the old fields in the persisted schema so older settings remain
    // readable. The route is now an explicit setting (`qualityRoute`) rather
    // than an invisible forced mode.
    value.moreObstacles = true;
    value.hardSearch = false;
    // 旧版本可能保存过 35 手但仍是 15 秒/标准盘；恢复时一次性补齐长题约束，
    // 避免用户不重新编辑手数就悄悄退回简单路由。
    if (value.depth >= 35) {
      value.expand = true;
      value.maxSize = Math.max(value.maxSize, 30);
      value.seconds = Math.max(value.seconds, value.depth >= 80 ? 60 : 30);
    }
    validateSettings(value); return value;
  }
  catch { return { ...DEFAULT_GENERATOR_SETTINGS, moreObstacles: true, hardSearch: false }; }
}
// 保留少量容易辨认、适合手机小棋盘的内置轮廓；复杂轮廓统一交给画布。
const SHAPES = [['fish-small','小鱼'],['cat-small','小猫'],['heart','爱心'],['moon','月亮'],['star','星星']];
const KINDS: [GeneratorKind, string][] = [['ordinary','普通题'],['forbidden','抓禁手'],['shape','图案题'],['text','文字题']];
const SHAPE_KEYWORDS: Record<string, string[]> = { fish: ['鱼'], cat: ['猫'], heart: ['心'], star: ['星'], moon: ['月'] };
const CUSTOM_MASK_DEFAULT = ['0001000','0011100','0111110','0011100','0001000'];
function customShapeFromMask(rawRows: string[], label = '自定义图案'): GeneratorShapeDefinition {
  const rows = rawRows.length ? rawRows : CUSTOM_MASK_DEFAULT;
  const width = Math.max(1, ...rows.map(row => row.length));
  const mask = rows.map(row => row.padEnd(width, '0').slice(0, 28));
  const points = mask.flatMap((row, r) => [...row].flatMap((bit, col) => bit === '1' ? [{ row: r, col }] : []));
  return { id: 'custom', label: label.trim() || '自定义图案', mask, source: 'custom-mask', parts: [{ id: 'outline', label: '整个轮廓', points }] };
}
function matchShapeDescription(value: string) {
  const query = value.trim().toLowerCase();
  if (!query) return undefined;
  return SHAPES.find(([id, label]) => query === id || query === label || query.includes(label) || query.includes(id) || SHAPE_KEYWORDS[id]?.some(keyword => query.includes(keyword)));
}

export interface PuzzleGeneratorPageProps {
  saved: GeneratedPuzzle[]; initialPuzzle?: GeneratedPuzzle | null; onBack: () => void;
  /** 显式保存才入库；folder 是用户选定的题库文件夹（不存在则由 App 端新建）。 */
  onSave: (puzzles: GeneratedPuzzle[], batchId: string, folder: string) => void;
  puzzleFolders?: string[];
  onExport: (puzzles: GeneratedPuzzle[]) => void;
  onSaveImage?: (file: File) => Promise<void> | void;
  onNotice?: (message: string) => void;
  onSolved?: (puzzle: GeneratedPuzzle) => void;
  appVisible?: boolean;
}
export function PuzzleGeneratorPage({ saved, initialPuzzle, onBack, onSave, puzzleFolders = [], onExport, onSaveImage, onNotice, onSolved, appVisible = true }: PuzzleGeneratorPageProps) {
  // 最近一次生成的那一批：重进页面就展示它（未入库的题不再一刷新就没）。
  const [puzzles, setPuzzles] = useState<GeneratedPuzzle[]>(() => lastBatch()?.puzzles || []);
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(!initialPuzzle && !saved.length && !puzzles.length);
  const [customCanvasOpen, setCustomCanvasOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(initialPuzzle?.id || puzzles[0]?.id || saved[saved.length - 1]?.id || '');
  const [generating, setGenerating] = useState(false), [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ index: 0, count: 1, size: 15 }), [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState(''), [saveError, setSaveError] = useState('');
  // 目标手数输入框的草稿值：null＝未在编辑（显示 settings.depth），字符串＝正在输入（含空串）。
  // 以前输入框直接受控于 settings.depth，清空瞬间 Number('')=0 被钳回 3——清空重打根本打不了新数字
  // （用户 2026-10-07 报"想清空输入其他数字，一直会回到3"）。现在失焦/回车才提交并钳位。
  const [depthDraft, setDepthDraft] = useState<string | null>(null);
  // 从历史恢复出来的这一批如果早就保存过，按钮就该老实显示「已保存到题库」。
  const [savedCount, setSavedCount] = useState(() => {
    const restored = lastBatch()?.puzzles || [];
    return restored.length > 0 && restored.every(puzzle => saved.some(item => item.id === puzzle.id)) ? restored.length : 0;
  });
  const [saveOpen, setSaveOpen] = useState(false), [saveFolder, setSaveFolder] = useState(GENERATED_DEFAULT_FOLDER), [newFolder, setNewFolder] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false), [historyPage, setHistoryPage] = useState(0);
  const [batches, setBatches] = useState<GeneratedBatch[]>(() => loadBatches());
  const [batchId, setBatchId] = useState(() => lastBatch()?.id || '');
  const commitBatch = useCallback(() => {
    if (!acceptedRef.current.length) return;
    setBatchId(batchRef.current);
    setBatches(appendBatch(acceptedRef.current, batchRef.current));
  }, []);
  const [imageBusy, setImageBusy] = useState(false);
  const [verified, setVerified] = useState(false), [playing, setPlaying] = useState(false), [finished, setFinished] = useState(false);
  const [verificationRetry, setVerificationRetry] = useState(0);
  const [replay, setReplay] = useState<number | null>(null), [autoplay, setAutoplay] = useState(false);
  const [moves, setMoves] = useState<SolutionMove[]>([]), [proof, setProof] = useState<ProofNode | null>(null);
  type PlaySnapshot = { moves: SolutionMove[]; proof: ProofNode | null; finished: boolean };
  const [playUndo, setPlayUndo] = useState<PlaySnapshot[]>([]), [playRedo, setPlayRedo] = useState<PlaySnapshot[]>([]);
  const [candidate, setCandidate] = useState<number | null>(null);
  const [outline, setOutline] = useState(true), [supports, setSupports] = useState(false);
  const workerRef = useRef<Worker | null>(null), warmWorkerRef = useRef<Worker | null>(null), epochRef = useRef(0), batchRef = useRef('');
  const acceptedRef = useRef<GeneratedPuzzle[]>([]), trustedRef = useRef(new WeakSet<GeneratedPuzzle>());
  const saveRef = useRef(onSave); saveRef.current = onSave;
  const merged = [...new Map([...saved, ...puzzles].map(p => [p.id, p])).values()];
  if (initialPuzzle && !merged.some(p => p.id === initialPuzzle.id)) merged.push(initialPuzzle);
  const selected = merged.find(p => p.id === selectedId) || null;
  // 答案游标按「看得见的落子」计数：解线里的停着（at:null，抓禁手时黑棋那一口不能堵）不占一步。
  // 原来游标按条目走，跨过停着时棋盘一颗子都不动，看起来就是「退一步没反应、只把上一步盖掉」。
  const solutionSteps = useMemo(() => {
    const steps: { move: SolutionMove; passBefore: boolean }[] = [];
    let passBefore = false;
    for (const move of selected?.solution || []) {
      if (move.at === null) { passBefore = true; continue; }
      steps.push({ move, passBefore }); passBefore = false;
    }
    if (passBefore && steps.length) steps[steps.length - 1].passBefore = true;
    return steps;
  }, [selected]);
  // 历史生成：最近 100 道、每页 10 道（最多 10 页），未入库的题也在这里回看。
  const historyList = useMemo(() => historyPuzzles(batches), [batches]);
  const historyPages = Math.max(1, Math.ceil(historyList.length / HISTORY_PAGE_SIZE));
  const historyCurrent = Math.min(historyPage, historyPages - 1);
  const historyItems = historyList.slice(historyCurrent * HISTORY_PAGE_SIZE, (historyCurrent + 1) * HISTORY_PAGE_SIZE);
  const historyKind = (puzzle: GeneratedPuzzle) => puzzle.ending === 'forbidden' ? '抓禁手' : puzzle.theme?.kind === 'shape' ? '图案' : puzzle.theme?.text ? '文字' : '普通';
  const openHistoryPuzzle = (puzzle: GeneratedPuzzle) => {
    setPuzzles(list => list.some(item => item.id === puzzle.id) ? list : [...list, puzzle]);
    setSelectedId(puzzle.id); setHistoryOpen(false); setNote('已打开历史生成的这道题。');
  };
  const cancelActive = useCallback(() => {
    epochRef.current++;
    workerRef.current?.terminate(); workerRef.current = null;
  }, []);
  const terminate = useCallback(() => {
    cancelActive();
    warmWorkerRef.current?.terminate(); warmWorkerRef.current = null;
  }, [cancelActive]);
  // Keep a completed generator worker warm. Importing the portable engine and
  // building its geometry tables is a noticeable part of the first request;
  // reusing the idle worker removes that fixed cost from the second request
  // without sharing any search state or puzzle results.
  const parkWorker = (worker: Worker) => {
    if (workerRef.current !== worker) return;
    workerRef.current = null;
    worker.onmessage = null;
    worker.onerror = null;
    warmWorkerRef.current?.terminate();
    warmWorkerRef.current = worker;
  };
  const stop = useCallback((message = '已停止，已完成的题目保留。') => {
    terminate(); setGenerating(false); setChecking(false); setAutoplay(false); setNote(message); commitBatch();
  }, [terminate, commitBatch]);
  const launch = (request: WorkerRequest, onReply: (reply: WorkerReply) => void) => {
    cancelActive(); const epoch = epochRef.current;
    const worker = warmWorkerRef.current ?? new GeneratorWorker();
    warmWorkerRef.current = null; workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerReply>) => { if (epochRef.current === epoch) onReply(event.data); };
    worker.onerror = () => { if (epochRef.current === epoch) stop('后台线程启动失败，请重试。'); };
    worker.postMessage(request);
    return worker;
  };
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop('已暂停后台搜索，已完成的题目保留。'); };
    const pageHide = () => stop('已暂停搜索，已完成的题目保留。');
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pageHide);
    return () => { terminate(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pageHide); };
  }, [stop, terminate]);
  useEffect(() => { if (!appVisible) stop('已暂停后台搜索，已完成的题目保留。'); }, [appVisible, stop]);
  useEffect(() => {
    setMoves([]); setProof(selected?.proof || null); setPlaying(false); setFinished(false); setReplay(null); setAutoplay(false); setCandidate(null); setSupports(false); setPlayUndo([]); setPlayRedo([]);
    if (!selected) { setVerified(false); return; }
    if (trustedRef.current.has(selected)) { setChecking(false); setVerified(true); return; }
    if (generating) { setVerified(false); return; }
    setVerified(false); setChecking(true); setNote('正在重新验题…');
    const verificationWorker = launch({ type: 'verify', puzzle: selected }, message => {
      if (message.type === 'verified') { if (workerRef.current === verificationWorker) parkWorker(verificationWorker); setChecking(false); setVerified(message.valid); setNote(message.note); if (message.valid) trustedRef.current.add(selected); }
      if (message.type === 'error') { stop(message.message); setVerified(false); }
    });
    return () => { if (workerRef.current === verificationWorker) terminate(); };
    // Identity is stable in saved collections; callbacks are intentionally read
    // via refs. Generation must not be replaced by selection verification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, generating, verificationRetry]);
  useEffect(() => { if (!generating) return; const start = Date.now(); setElapsed(0); const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000); return () => window.clearInterval(id); }, [generating]);
  // 手数被快捷档/切换题型等外部改动时，收起草稿（正在输入时不打断：此时 settings.depth 不变）。
  useEffect(() => { setDepthDraft(null); }, [settings.depth]);
  useEffect(() => {
    if (!autoplay || !selected) return;
    const total = solutionSteps.length;
    const id = window.setInterval(() => setReplay(current => {
      const next = (current ?? 0) + 1;
      if (next >= total) { setAutoplay(false); return total; }
      return next;
    }), 700);
    return () => window.clearInterval(id);
  }, [autoplay, selected, solutionSteps]);
  const change = (patch: Partial<GeneratorSettings>) => setSettings(current => ({ ...current, ...patch }));
  // 关闭扩盘时仍以 15 路显示；深度达到阈值会自动打开扩盘，避免"选了 60 手但盘还是 15 路"。
  // ≥35 手自动开扩展棋盘：白先 35 手在 15 路上会把预算耗在失败构造，20 路通常 1-2 秒通过；
  // 黑先 35 手仍会优先尝试 15 路，40 手以上则按原策略直接从 16 路起步。
  // 35 手起给自然接线留出 30 秒预算；80 手起再升到 60 秒。
  // 预算是上限，实测 35 手通常几秒完成，不会强制等待。
  const changeDepth = (value: number) => {
    // 先按最终能力上限钳位，再根据深度自动打开扩盘；否则在关闭扩盘时输入
    // 60/100 会先被旧的 40 上限截断，用户必须重复输入一次才能得到目标手数。
    const depth = Math.max(3, Math.min(100, Math.round(value) || 3));
    change({ depth, ...(depth >= 35 ? { expand: true, maxSize: Math.max(settings.maxSize, 30) } : {}), ...(depth >= 35 ? {
      seconds: Math.max(settings.seconds, depth >= 80 ? 60 : 30),
    } : {}) });
  };
  const changeMaxSize = (value: number) => change({ maxSize: Math.min(30, Math.max(5, Math.round(value))) });
  const changeKind = (kind: GeneratorKind) => {
    // 普通题从图案/文字切回来时不能把长题悄悄压回标准盘。
    // 35 手以上的普通题依赖扩展路数；100 手题也必须保留这个状态，
    // 否则 changeKind 后 validateSettings 会在生成前拒绝或把目标截短。
    const longDepth = settings.depth >= 35;
    change({ kind, hardSearch: false,
      ...(kind === 'forbidden' ? { attacker: 'white', rules: 'renju' } : {}),
      ...(kind === 'text' ? { expand: true, depth: 20 } : {}),
      ...(kind === 'shape' ? { shape: 'custom', customShape: settings.customShape || customShapeFromMask(CUSTOM_MASK_DEFAULT), expand: true } : {}),
      ...(kind === 'ordinary' ? {
        depth: settings.depth,
        expand: longDepth,
        ...(longDepth ? { maxSize: Math.max(settings.maxSize, 30) } : {}),
      } : {}),
    });
    if (kind === 'shape') setCustomCanvasOpen(true);
  };
  const targetFolder = () => newFolder.trim() || saveFolder.trim() || GENERATED_DEFAULT_FOLDER;
  const saveAccepted = () => {
    const list = puzzles.length ? puzzles : acceptedRef.current;
    if (!list.length) return;
    const folder = targetFolder();
    try { saveRef.current(list, batchId || batchRef.current, folder); setSavedCount(list.length); setSaveError(''); setSaveOpen(false); setNote(`已保存 ${list.length} 道题到“${folder}”。`); }
    catch (error) { setSaveError(error instanceof Error ? `尚未保存：${error.message}。请导出题集或重试保存。` : '尚未保存，请导出题集或重试保存。'); }
  };
  const generate = () => {
    try {
      // Unique first moves are part of the generator contract. Keep the old
      // field in persisted settings for compatibility, but never expose a
      // second-answer mode from the app.
      const effectiveSettings = { ...settings, uniqueFirst: true };
      validateSettings(effectiveSettings);
      const raster = effectiveSettings.kind === 'text' ? rasterizeAppText(effectiveSettings.text, effectiveSettings.textLayout, effectiveSettings.depth >= 24) : undefined;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(effectiveSettings));
      batchRef.current = `generated-vcf-${Date.now().toString(36)}`; acceptedRef.current = [];
      setPuzzles([]); setBatchId(batchRef.current);
      setGenerating(true); setChecking(false); setPlaying(false); setAutoplay(false); setReplay(null); setCandidate(null); setSaveError(''); setSavedCount(0);
      setProgress({ index: 1, count: effectiveSettings.count, size: effectiveSettings.expand ? 0 : 15 }); setNote('正在生成并验题…');
      launch({ type: 'generate', settings: effectiveSettings, seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0, exclude: merged.map(p => p.id), raster }, message => {
        if (message.type === 'progress') setProgress(p => ({ ...p, index: message.index, count: message.count, ...(message.size ? { size: message.size } : {}) }));
        if (message.type === 'puzzle') {
          trustedRef.current.add(message.puzzle); acceptedRef.current.push(message.puzzle);
          setPuzzles(p => [...p, message.puzzle]); setSelectedId(id => acceptedRef.current.length === 1 ? message.puzzle.id : id);
        }
        if (message.type === 'done') {
          const active = workerRef.current; if (active) parkWorker(active);
          setGenerating(false); commitBatch();
          if (message.produced) setSettingsOpen(false);
          setNote(message.produced === message.requested ? `已完成 ${message.produced} 道，独立验题通过。` : `本次生成 ${message.produced}/${message.requested} 道，尚未凑齐。可以重试或增加搜索时间。`);
        }
        if (message.type === 'error') stop(message.message);
      });
    } catch (error) { setNote(error instanceof Error ? error.message : '无法开始生成'); }
  };
  /** 落子并把这一手交给验手。用户 10-07：「点上去只有坐标位置，落不下实际的子…去掉那个什么
   *  坐标的框框和落子的框框，搞成直接一点就落子的样子」——所以这里改成**点盘即落**：
   *  `at` 由点击处直接传进来，不再从 `candidate` 状态读（同一轮里 setState 还没生效）。
   *  还没进做题态时（playing=false）由调用方把「空历史 + 题面 proof」作为 base 传进来，
   *  于是第一手也是点一下就走，不必先按「开始做题」。 */
  const place = (at: number, base?: { moves: SolutionMove[]; proof: ProofNode | null }) => {
    const useMoves = base ? base.moves : moves;
    const useProof = base ? base.proof : proof;
    // proof 为空＝正在走岔路（试走模式，见 vcf-generator/lib/browser.mjs 的 trialStep）：
    // 只要已经走过子，就允许继续把这条岔路走到底。其余状态照旧要求证明树在场。
    if (!selected || (!useProof && !useMoves.length) || !verified || checking || generating) return;
    setChecking(true); setNote('正在检查这一步…');
    launch({ type: 'move', puzzle: selected, moves: useMoves, proof: useProof, at }, message => {
      if (message.type === 'move') {
        if (workerRef.current) parkWorker(workerRef.current); setChecking(false); setNote(message.result.note);
        if (message.result.status === 'accepted' || message.result.status === 'won') {
          const result = message.result;
          setPlayUndo(history => [...history, { moves: useMoves, proof: useProof, finished }]);
          setPlayRedo([]);
          setMoves(current => [...current, ...result.moves]); setProof(result.proof); setCandidate(null);
          if (message.result.status === 'won') { setFinished(true); setPlaying(false); onSolved?.(selected); }
        } else {
          // 被验手拒掉时必须在**棋盘边上**也响一下（用户 10-07：只改顶部那行小字，
          // 注意力在盘上的人看不到，观感就是"点了几下都一样、这盘落不了子"）。
          // 带上坐标：一步式落子后候选点会随下一手清掉，提示里点名是哪个点更有用。
          onNotice?.(`${coordinateOf(at)}：${message.result.note}`);
        }
      }
      if (message.type === 'error') stop(message.message);
    });
  };
  const begin = () => { cancelActive(); setChecking(false); setMoves([]); setProof(selected?.proof || null); setPlaying(true); setFinished(false); setCandidate(null); setReplay(null); setAutoplay(false); setSupports(false); setPlayUndo([]); setPlayRedo([]); setNote('点棋盘空交叉点直接落子。不成冲四会被判不成立；算不赢的冲四会让你走进去，走到头才判死路。'); };
  const restorePuzzle = () => {
    cancelActive();
    setChecking(false);
    setMoves([]);
    setProof(selected?.proof || null);
    setPlaying(false);
    setFinished(false);
    setReplay(null);
    setAutoplay(false);
    setCandidate(null);
    setPlayUndo([]);
    setPlayRedo([]);
    setNote('已复原到题面。点棋盘空交叉点直接落子。');
  };
  const showAnswer = () => {
    cancelActive();
    setChecking(false);
    setCandidate(null);
    setAutoplay(false);
    setReplay(0);
    setNote('答案从题面开始，你已走的子保留在「做题」里。');
  };
  // 答案只是另一个视图，不清做题进度；复原才真的清盘。
  const backToPlay = () => {
    cancelActive();
    setChecking(false);
    setReplay(null);
    setAutoplay(false);
    setCandidate(null);
    if (!playing && !finished) setPlaying(true);
    setNote('点击棋盘空点选择位置，再确认落子。');
  };
  const stepPlayBack = () => {
    if ((!playing && !finished) || checking || generating || !playUndo.length) return;
    const previous = playUndo[playUndo.length - 1];
    setPlayUndo(history => history.slice(0, -1));
    setPlayRedo(history => [...history, { moves, proof, finished }]);
    setMoves(previous.moves); setProof(previous.proof); setFinished(previous.finished); setCandidate(null);
    setNote('已退回上一手，可以重新选择。');
  };
  const stepPlayForward = () => {
    if ((!playing && !finished) || checking || generating || !playRedo.length) return;
    const next = playRedo[playRedo.length - 1];
    setPlayRedo(history => history.slice(0, -1));
    setPlayUndo(history => [...history, { moves, proof, finished }]);
    setMoves(next.moves); setProof(next.proof); setFinished(next.finished); setCandidate(null);
    setNote(next.finished ? '已回到完成位置。' : '已推进下一手。');
  };
  const solutionPrefix = (steps: number) => {
    if (!selected || steps < 1) return 0;
    let seen = 0;
    for (let i = 0; i < selected.solution.length; i++) { if (selected.solution[i].at !== null && ++seen >= steps) return i + 1; }
    return selected.solution.length;
  };
  const displayedMoves = selected && replay !== null ? selected.solution.slice(0, solutionPrefix(replay)) : moves;
  const coordinateOf = (at: number) => selected ? coordinateName({ row: Math.floor(at / selected.size), col: at % selected.size }, selected.size) : '';
  const replayStep = replay && replay > 0 ? solutionSteps[replay - 1] : null;
  const replayNote = !replayStep ? '题面' : `${replayStep.passBefore ? '黑棋防点为禁手，跳过防守；' : ''}${replayStep.move.player === 1 ? '黑' : '白'} ${coordinateOf(replayStep.move.at as number)}${replayStep.move.note === 'five' ? ' · 连五获胜' : ''}`;
  const createPuzzleImageFile = async (puzzle: GeneratedPuzzle) => {
    const blob = await renderPuzzleSharePng(puzzle, { showCoordinates: true, showOutline: true, showWatermark: true });
    return new File([blob], puzzleShareFilename(puzzle), { type: 'image/png', lastModified: Date.now() });
  };
  const fallbackDownload = (file: File) => {
    const url = URL.createObjectURL(file);
    const anchor = window.document.createElement('a');
    anchor.href = url; anchor.download = file.name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const savePuzzleImage = async () => {
    if (!selected || !verified || imageBusy || generating) return;
    setImageBusy(true);
    try {
      const file = await createPuzzleImageFile(selected);
      if (onSaveImage) await onSaveImage(file);
      else fallbackDownload(file);
      if (!onSaveImage) onNotice?.(`题目图片已保存：${file.name}`);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '题目图片保存失败，请重试');
    } finally { setImageBusy(false); }
  };
  const sharePuzzleImage = async () => {
    if (!selected || !verified || imageBusy || generating) return;
    setImageBusy(true);
    try {
      const file = await createPuzzleImageFile(selected);
      const result = await sharePngFile(file, selected.title || '半步五子棋棋题', `棋题生成器 · ${selected.depth} 手 · ${selected.size} 路`);
      if (result === 'shared') onNotice?.('题目图片已交给系统分享');
      else if (result === 'cancelled') onNotice?.('已取消分享');
      else if (onSaveImage) await onSaveImage(file);
      else { fallbackDownload(file); onNotice?.(`当前平台不支持系统分享，已保存：${file.name}`); }
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '题目图片分享失败，请重试');
    } finally { setImageBusy(false); }
  };
  return <section className="puzzle-generator-page generator-workspace" data-puzzle-generator-page>
    {/* 一体化工作区（用户 10-07：「大刀阔斧…最好搞成一体化的，设置与上面的棋盘是一个区域…
        参考我们对弈打谱界面，那里功能按钮很多但很整齐、也一屏可见」）：
        顶条（标题 + 参数摘要 + 设置/保存/历史）→ 设置抽屉（同一区域内展开）→ 棋盘区（吃满剩余高度）
        → 功能行（横向可滑，打谱页同款）→ 做题行。所有区块共享一个 100dvh 高度预算，页面不滚动。 */}
    <header className="generator-bar">
      <button type="button" className="generator-back" onClick={onBack} aria-label="返回对弈"><ArrowLeft size={20}/></button>
      <div className="generator-bar-copy"><b>棋题生成器</b><small className="generator-settings-summary">{KINDS.find(([id]) => id === settings.kind)?.[1]} · {settings.attacker === 'black' ? '黑先' : '白先'} · {settings.depth} 手 · {settings.expand ? `≤${settings.maxSize} 路` : '15 路'}</small></div>
      <div className="generator-bar-actions">
        <button type="button" className={`generator-bar-button${settingsOpen ? ' on' : ''}`} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}><Pencil size={15}/><span>{settingsOpen ? '收起设置' : '调整设置'}</span></button>
        <button type="button" className="generator-bar-button" disabled={!puzzles.length} aria-pressed={puzzles.length > 0 && savedCount >= puzzles.length} onClick={() => setSaveOpen(true)}><Save size={15}/><span>保存本批</span></button>
        <button type="button" className="generator-bar-button" disabled={!batches.length} onClick={() => { setHistoryPage(0); setHistoryOpen(true); }}><History size={15}/><span>历史</span></button>
      </div>
    </header>
      <section className={`generator-settings generator-dock${settingsOpen ? ' is-open' : ''}`} aria-label="生成设置" hidden={!settingsOpen}>
        <div>
        <fieldset disabled={generating}><legend className="generator-visually-hidden">题目选项</legend>
          <section className="generator-settings-block generator-type-block" aria-label="题型选择">
          <b className="generator-settings-block-title">题型</b>
          <div className="generator-kinds" role="radiogroup" aria-label="题型">{KINDS.map(([id, label]) => <button type="button" role="radio" key={id} aria-checked={settings.kind === id} aria-pressed={settings.kind === id} onClick={() => changeKind(id)}>{label}</button>)}</div>
          </section>
          <section className="generator-setting-pane generator-settings-block" aria-label="基础参数">
          <b className="generator-settings-block-title">基础参数</b>
          <div className="generator-fields"><label>先手<select aria-label="先手" value={settings.attacker} disabled={settings.kind === 'forbidden'} onChange={e => change({ attacker: e.target.value as GeneratorSettings['attacker'] })}><option value="black">黑先</option><option value="white">白先</option></select></label>
            <label>规则<select aria-label="生成规则" value={settings.rules} disabled={settings.kind === 'forbidden'} onChange={e => change({ rules: e.target.value as GeneratorSettings['rules'] })}><option value="renju">有禁手</option><option value="freestyle">无禁手</option></select></label>
            <label>目标手数<input aria-label="目标手数" type="number" min={3} max={settings.expand ? 100 : 40} step="1" value={depthDraft ?? String(settings.depth)}
              onChange={e => setDepthDraft(e.target.value)}
              onBlur={() => { if (depthDraft === null) return; if (depthDraft.trim() !== '' && Number.isFinite(Number(depthDraft))) changeDepth(Number(depthDraft)); setDepthDraft(null); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}/></label>
            <label>生成数量<select aria-label="生成数量" value={settings.count} onChange={e => change({ count: Number(e.target.value) as GeneratorSettings['count'] })}>{[1,5,10].map(n => <option key={n} value={n}>{n} 道</option>)}</select></label>
            <label>每题时间预算<select aria-label="每题时间预算" value={settings.seconds} onChange={e => change({ seconds: Number(e.target.value) })}>{[5,15,30,60,120].map(n => <option key={n} value={n}>{n} 秒</option>)}</select></label></div>
          <div className="generator-depths" aria-label="常用手数">{(settings.kind === 'text' ? [12,20,30,60,100] : settings.kind === 'shape' ? [5,8,12,30,60,100] : [5,10,20,30,35,40,60,80,100]).filter(n => settings.expand || n <= 40).map(n => <button type="button" key={n} aria-pressed={settings.depth === n} onClick={() => changeDepth(n)}>{n} 手</button>)}</div>
          </section>
          {settings.kind !== 'ordinary' && <section className="generator-setting-pane generator-settings-block" aria-label="题型专属设置">
          <b className="generator-settings-block-title">本题型选项</b>
          {settings.kind === 'shape' && <div className="generator-specific generator-mode-panel" data-generator-pane="shape"><label>图案<select aria-label="图案" value={settings.shape} onChange={e => { const shape = e.target.value; change({ shape, customShape: shape === 'custom' ? settings.customShape || customShapeFromMask(CUSTOM_MASK_DEFAULT) : undefined, ...(['fish','cat','cloud','butterfly','rabbit','rocket'].includes(shape) ? { expand: true } : {}) }); if (shape === 'custom') setCustomCanvasOpen(true); else setCustomCanvasOpen(false); }}><option value="custom">自定义轮廓</option>{SHAPES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label>描述<input aria-label="图案描述" list="generator-shape-aliases" value={settings.shapeDescription || ''} placeholder="如 月亮、星星" onChange={e => { const value = e.target.value; const match = matchShapeDescription(value); change({ shapeDescription: value, ...(match ? { shape: match[0], customShape: undefined, ...(['fish','cat','cloud','butterfly','rabbit','rocket'].includes(match[0]) ? { expand: true } : {}) } : settings.shape === 'custom' && value.trim() ? { customShape: customShapeFromMask(settings.customShape?.mask || CUSTOM_MASK_DEFAULT, value) } : {}) }); }}/><datalist id="generator-shape-aliases">{SHAPES.map(([id,label]) => <option key={id} value={label}>{id}</option>)}</datalist></label>
            {settings.shape === 'custom' && <div className="generator-custom-summary"><span><b>{settings.customShape?.label || '自定义图案'}</b><small>{settings.customShape?.mask.length || 0} × {settings.customShape?.mask[0]?.length || 0} 路点阵</small></span><button type="button" onClick={() => setCustomCanvasOpen(true)} aria-label="编辑画布" title="编辑画布"><Pencil size={15}/></button></div>}
            <label className="generator-check"><input type="checkbox" checked={settings.shapeComplexity} onChange={e => change({ shapeComplexity: e.target.checked })}/><span>参与更多步骤</span></label></div>}
          {settings.kind === 'text' && <div className="generator-specific generator-fields generator-mode-panel" data-generator-pane="text"><label>文字（1–4字）<input aria-label="题目文字" value={settings.text} maxLength={4} onChange={e => { const text = e.target.value; const length = [...text].length; const compact = settings.depth >= 24 && length <= 2; const required = length >= 3 ? length * 6 + (length - 1) + 2 : length >= 2 ? length * (compact ? 6 : 9) + (length - 1) * (compact ? 1 : 2) + 2 : 15; change({ text, ...(length >= 2 ? { expand: true, maxSize: Math.max(settings.maxSize, required) } : {}), ...(length >= 3 ? { depth: Math.max(settings.depth, length * 3) } : {}) }); }}/></label><label>排列<select aria-label="文字排列" value={settings.textLayout} onChange={e => change({ textLayout: e.target.value as GeneratorSettings['textLayout'] })}><option value="horizontal">横排</option><option value="vertical">竖排</option></select></label></div>}
          </section>}
          <section className="generator-setting-pane generator-settings-block generator-board-block" aria-label="棋盘范围">
          <b className="generator-settings-block-title">棋盘范围</b>
          <div className="generator-check-row">
          <label className="generator-check generator-quality-toggle"><input type="checkbox" checked={settings.qualityRoute} onChange={e => change({ qualityRoute: e.target.checked })}/><span>{settings.qualityRoute ? '高质量路线（新生成器）' : '快速路线（兼容旧版）'}<small>{settings.qualityRoute ? '多段支撑、牵制与可验证干扰，题目更复杂但搜索时间更长。' : '兼容旧版的单链构造，适合快速试题；仍会经过独立验题。'}</small></span></label>
          <label className="generator-check"><input type="checkbox" checked={settings.expand} onChange={e => { const checked = e.target.checked; change({ expand: checked, ...(checked ? {} : { depth: Math.min(settings.depth, 40) }) }); }}/><span>扩展棋盘<small>{settings.expand ? `上限 ${settings.maxSize} 路` : '标准 15 × 15 棋盘'}</small></span></label>
          </div>
          {settings.expand && <div className="generator-stepper" aria-label="最大路数"><span>最大路数</span><div><button type="button" onClick={() => changeMaxSize(settings.maxSize - 1)} disabled={settings.maxSize <= 5} aria-label="最大路数减一">−</button><output>{settings.maxSize} 路</output><button type="button" onClick={() => changeMaxSize(settings.maxSize + 1)} disabled={settings.maxSize >= 30} aria-label="最大路数加一">＋</button></div><small>可选 5–30 路</small></div>}
          </section>
        </fieldset></div>
      </section>
    <div className="generator-stage" aria-label="题目棋盘">
        {/* 头部一行：选题 + 元信息 + 进度（用户 10-07 一体化：这三样原来各占一行，
            矮横屏里光头部就吃掉 110px，棋盘只剩 93px）。 */}
        <div className="generator-stage-head">
          {merged.length > 0 && <label className="generator-result-select">题目<select aria-label="选择生成题目" value={selectedId} disabled={checking && !generating} onChange={e => { if (!generating) { cancelActive(); setChecking(false); } setSelectedId(e.target.value); }}>{[...merged].reverse().map(p => <option key={p.id} value={p.id}>{p.title} · {p.size} 路</option>)}</select></label>}
          {selected && <div className="generator-puzzle-meta"><span>{selected.size} × {selected.size}</span><span>{selected.attacker === 'black' ? '黑先' : '白先'} · {selected.depth} 手</span><span>{selected.rules === 'renju' ? '有禁手' : '无禁手'}</span>{verified && <span className="generator-verified"><Check size={13}/>验题通过</span>}</div>}
          {(generating || note) && <span className="generator-inline-status" role="status" aria-live="polite">{generating ? `正在生成第 ${progress.index}/${progress.count} 道${progress.size ? ` · ${progress.size} 路` : ''} · ${elapsed} 秒` : note}</span>}
        </div>
        {selected ? <div className="generator-stage-board">
            <GeneratorBoard key={selected.id} puzzle={selected} moves={displayedMoves} outline={outline} supports={supports} candidate={candidate}
              onBlocked={reason => onNotice?.(reason === "occupied" ? "这个交叉点已经有子了，换个空点" : "点在棋盘的交叉点上（不是木边）")}
              onPoint={verified && replay === null && !finished && !checking && !generating ? at => {
                // 点空交叉点 = 直接落子（用户 10-07：去掉坐标框与落子键，一步式）。
                setCandidate(at);
                if (playing) place(at);
                else { begin(); place(at, { moves: [], proof: selected.proof || null }); }
              } : undefined}/>
          </div> : <div className="generator-stage-board generator-empty"><Sparkles size={32}/><p>选好题型，生成一道试试。</p><small>生成的题先进这台设备的「历史生成」，点「保存本批到题库」才会入库。</small></div>}
    </div>
    {/* 功能行（打谱页同款横向 rail）：生成 / 做题 / 答案 / 复原 / 显示开关 / 图片与导出，
        横向放不下时整行可滑，永远不占第二屏。 */}
    <div className="generator-rail" role="toolbar" aria-label="生成与做题操作">
      <button type="button" className={`generator-primary ${generating ? ' generator-stop' : ''}`} onClick={() => generating ? stop() : generate()}>{generating ? <Square size={17}/> : <Sparkles size={18}/>}<span>{generating ? '停止生成' : '生成新题'}</span></button>
      {selected && <button type="button" className="generator-rail-button" aria-pressed={replay === null && (playing || finished)} disabled={!verified || checking || generating} onClick={replay !== null ? backToPlay : begin}><Play size={17}/><span>{replay !== null ? '回到做题' : playing || finished ? '重新做题' : '开始做题'}</span></button>}
      {selected && <button type="button" className="generator-rail-button" disabled={!verified || checking || generating || replay !== null} aria-pressed={replay !== null} onClick={showAnswer}><Play size={17}/><span>查看答案</span></button>}
      {selected && <button type="button" className="generator-rail-button" disabled={!verified || checking || generating} onClick={restorePuzzle}><RotateCcw size={17}/><span>复原题面</span></button>}
      {selected?.theme && <button type="button" className={`generator-rail-button${outline ? ' on' : ''}`} aria-pressed={outline} onClick={() => setOutline(v => !v)}><span>轮廓</span></button>}
      {selected?.theme && <button type="button" className={`generator-rail-button${supports ? ' on' : ''}`} aria-pressed={supports} onClick={() => setSupports(v => !v)}><span>参与子</span></button>}
      {selected && !verified && !generating && <button type="button" className="generator-rail-button" disabled={checking} onClick={() => setVerificationRetry(n => n + 1)}><span>{checking ? '正在验题…' : '重新验题'}</span></button>}
      {selected && <button type="button" className="generator-rail-button" disabled={!verified || imageBusy || generating} onClick={() => { void sharePuzzleImage(); }} aria-label="分享题目图片" title="分享题目图片"><Share2 size={17}/></button>}
      {selected && <button type="button" className="generator-rail-button" disabled={!verified || imageBusy || generating} onClick={() => { void savePuzzleImage(); }} aria-label="保存题目图片" title="保存题目图片"><ImageDown size={17}/></button>}
      {selected && <button type="button" className="generator-rail-button" disabled={!verified} onClick={() => onExport([selected])} aria-label="导出当前题目" title="导出题目数据"><Download size={17}/></button>}
    </div>
    {selected && replay === null && (playing || finished) && <div className="generator-rail generator-rail-play">
      <small className="generator-rail-note">{checking ? '验手中…' : `点空交叉点直接落子 · 当前 ${moves.length} 手`}</small>
      <button type="button" className="generator-rail-button" onClick={stepPlayBack} disabled={!playUndo.length || checking || generating}><ChevronLeft size={16}/><span>撤销这一手</span></button>
      <button type="button" className="generator-rail-button" onClick={stepPlayForward} disabled={!playRedo.length || checking || generating}><span>重做</span><ChevronRight size={16}/></button>
    </div>}
    {selected && replay !== null && verified && <div className="generator-rail generator-rail-replay">
      <button type="button" className="generator-rail-button" onClick={() => { setReplay(0); setAutoplay(false); }} aria-label="答案回到题面"><RotateCcw size={16}/><span>题面</span></button>
      <button type="button" className="generator-rail-button" disabled={replay === 0} onClick={() => { setReplay(n => Math.max(0,(n || 0)-1)); setAutoplay(false); }} aria-label="答案上一步"><ChevronLeft size={18}/></button>
      <button type="button" className="generator-rail-button" onClick={() => { if (replay >= solutionSteps.length) setReplay(0); setAutoplay(v => !v); }} aria-label={autoplay ? '暂停答案' : '播放答案'}>{autoplay ? <Pause size={18}/> : <Play size={18}/>}</button>
      <button type="button" className="generator-rail-button" disabled={replay >= solutionSteps.length} onClick={() => { setReplay(n => Math.min(solutionSteps.length,(n || 0)+1)); setAutoplay(false); }} aria-label="答案下一步"><ChevronRight size={18}/></button>
      <input type="range" min="0" max={solutionSteps.length} value={replay} aria-label="答案进度" onChange={e => { setReplay(Number(e.target.value)); setAutoplay(false); }}/>
      <small className="generator-rail-note" title={replayNote}>{replay}/{solutionSteps.length}</small>
    </div>}
    {saveError && <div className="generator-save-error" role="alert">{saveError}<button type="button" onClick={saveAccepted}><Save size={16}/>重试保存</button><button type="button" onClick={() => onExport(puzzles.length ? puzzles : acceptedRef.current)}><Download size={16}/>导出本批</button></div>}
    {customCanvasOpen && settings.kind === 'shape' && settings.shape === 'custom' && <div className="generator-canvas-modal" role="dialog" aria-modal="true" aria-label="编辑自定义轮廓"><div className="generator-canvas-modal-card"><div className="generator-canvas-modal-head"><b>编辑自定义轮廓</b><button type="button" onClick={() => setCustomCanvasOpen(false)} aria-label="关闭"><X size={18}/></button></div><label>轮廓名称<input aria-label="自定义轮廓名称" value={settings.customShape?.label || '自定义图案'} onChange={e => change({ customShape: customShapeFromMask(settings.customShape?.mask || CUSTOM_MASK_DEFAULT, e.target.value), expand: true })}/></label><CustomShapeCanvas mask={settings.customShape?.mask || CUSTOM_MASK_DEFAULT} onChange={mask => change({ shape: 'custom', customShape: customShapeFromMask(mask, settings.customShape?.label || '自定义图案'), expand: true })}/><button type="button" className="generator-primary" onClick={() => setCustomCanvasOpen(false)}>完成编辑</button></div></div>}
    {saveOpen && <div className="generator-modal" role="dialog" aria-modal="true" aria-label="保存到题库文件夹"><div className="generator-modal-card">
      <div className="generator-modal-head"><b>保存到题库</b><button type="button" onClick={() => setSaveOpen(false)} aria-label="关闭保存对话框"><X size={18}/></button></div>
      <p className="generator-modal-note">本批 {puzzles.length} 道已通过独立验题。生成结果不会自动入库，保存后才会出现在题库里。</p>
      <label className="generator-field-label" htmlFor="generator-save-folder">题库文件夹</label>
      <select id="generator-save-folder" aria-label="保存到的题库文件夹" value={saveFolder} onChange={e => { setSaveFolder(e.target.value); setNewFolder(''); }}>
        {[...new Set([GENERATED_DEFAULT_FOLDER, ...puzzleFolders])].map(folder => <option key={folder} value={folder}>{puzzleFolders.includes(folder) ? folder : `${folder}（新建）`}</option>)}
      </select>
      <label className="generator-field-label" htmlFor="generator-new-folder">新建文件夹（可留空）</label>
      <input id="generator-new-folder" aria-label="新建题库文件夹名" value={newFolder} maxLength={24} placeholder={`如 ${GENERATED_DEFAULT_FOLDER}`} onChange={e => setNewFolder(e.target.value)}/>
      <p className="generator-modal-note">保存位置：{targetFolder()}{newFolder.trim() || !puzzleFolders.includes(saveFolder) ? '（该文件夹会自动创建）' : ''}</p>
      <div className="generator-modal-actions"><button type="button" onClick={() => setSaveOpen(false)}>取消</button><button type="button" className="generator-primary" onClick={saveAccepted}><Save size={16}/>保存到「{targetFolder()}」</button></div>
    </div></div>}
    {historyOpen && <div className="generator-modal" role="dialog" aria-modal="true" aria-label="历史生成题目"><div className="generator-modal-card">
      <div className="generator-modal-head"><b>历史生成</b><button type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史生成"><X size={18}/></button></div>
      <p className="generator-modal-note">最近 {historyList.length} 道生成题（最多保留 100 道，每页 {HISTORY_PAGE_SIZE} 道）。这里只存在这台设备上，没保存的题也能回看。</p>
      <ul className="generator-history-list">{historyItems.map(puzzle => <li key={puzzle.id}>
        <div><b>{puzzle.title}</b><small>{historyKind(puzzle)} · {puzzle.size} 路 · {puzzle.depth} 手 · {puzzle.attacker === 'black' ? '黑先' : '白先'}</small></div>
        <button type="button" onClick={() => openHistoryPuzzle(puzzle)}>{puzzle.id === selectedId ? '正在做' : '打开'}</button>
      </li>)}</ul>
      <div className="generator-history-page"><button type="button" disabled={historyCurrent === 0} onClick={() => setHistoryPage(historyCurrent - 1)}><ChevronLeft size={16}/>上一页</button><small>第 {historyCurrent + 1}/{historyPages} 页</small><button type="button" disabled={historyCurrent >= historyPages - 1} onClick={() => setHistoryPage(historyCurrent + 1)}>下一页<ChevronRight size={16}/></button></div>
    </div></div>}
    {/* 生成中的等待弹窗（用户 2026-10-08：等待时放一个弹窗 + 耐心的等待动画）。
        动画是「两颗棋子自己跟自己下一盘」，纯 CSS 驱动；文字接的是**真实进度**（第几道 / 已等几秒），
        不写假百分比。带一个停止出口——长等待里没有出口最难受。 */}
    {generating && <WaitingOverlay
      title="正在生成题目"
      detail={`第 ${progress.index}/${progress.count} 道 · 已等 ${elapsed} 秒`}
      onStop={() => stop()}
    />}
  </section>;
}
