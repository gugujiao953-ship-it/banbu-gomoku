import { winningLinesAt } from "../../game";
import type { Cell, GameDocument, RecordNode, RuleSet } from "../../types";

/**
 * 「自定义开局 · 摆子」的**局面库**（用户 2026-10-14：「摆子的时候很多时候会专门挑战一些固定开局，
 * 所以可以保存局面，下次再想下的时候直接拿来用」）。
 *
 * 存的是**剪过枝的单线**（根→当时游标那一条路线），不是整棵树。两个理由：
 *  ① 「局面」本义就是"现在盘上这些子"，载入后要挑别的路线可以重新导入；
 *  ② 一份带分支的职业棋谱树可能有几万个节点，原样存进 localStorage 会把配额吃掉一大块
 *    （这条存储是**同步写、整份序列化**的，见 `duel-history.ts` 里同一套口径）。
 */
export const DUEL_SETUPS_KEY = "banbu-duel-setups-v1";
/** 上限按"一份单线局面 ≈ 200 手 ≈ 十几 KB"估，40 份远在配额内；超了丢最旧的。 */
export const DUEL_SETUP_LIMIT = 40;

export interface DuelSetupEntry {
  id: string;
  name: string;
  savedAt: number;
  /** 单线棋谱（root→`currentId`，其余分支已删）。 */
  document: GameDocument;
  currentId: string;
  /** 这条路线上的手数（列表直接显示，不用每次重算）。 */
  stones: number;
  boardSize: number;
}

/** 沿 parentId 走到根，返回**从根到游标**的 id 链；坏数据（断链/成环）返回空数组。 */
const chainToRoot = (document: GameDocument, currentId: string): string[] => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = currentId;
  while (cursor) {
    const node: RecordNode | undefined = document.nodes[cursor];
    if (!node || seen.has(cursor)) return [];
    seen.add(cursor);
    chain.push(cursor);
    cursor = node.parentId;
  }
  chain.reverse();
  return chain[0] === document.rootId ? chain : [];
};

/** 这条链上真正落子的步数（根、以及 SGF 那种只带 setup 的节点不算一手）。 */
const chainStoneCount = (document: GameDocument, chain: string[]) =>
  chain.filter((id) => Boolean(document.nodes[id]?.move)).length;

/** 「从根到某个节点」一共几手——导入棋谱后要如实报"这份有几手"，不能拿节点数当手数。 */
export const lineStoneCount = (document: GameDocument, currentId: string) => chainStoneCount(document, chainToRoot(document, currentId));

/**
 * 这个局面**是不是已经分出生死了**（盘上已有连五）。
 *
 * 为什么必须查：胜负只在"落子那一刻"判（`winnerAt(nextBoard, …)`）。自己摆的那批子过不了
 * `play()` 的摆子分支那道拒绝，但**导入的棋谱**常常是一局下完的谱——直接拿来开局，
 * 开始对战之后谁也不会判它结束，AI 会照常在一个已经结束的局面上下下去。
 */
export const positionAlreadyDecided = (board: Cell[][], rule: RuleSet): boolean => {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < (board[row]?.length || 0); col += 1) {
      if (!board[row][col]) continue;
      if (winningLinesAt(board, { row, col }, rule).length) return true;
    }
  }
  return false;
};

/**
 * 把一份棋谱**剪成"根→游标"这一条路线**：其余分支整个删掉。
 *
 * 用在两处：保存局面时（存的就是当前这条线），以及点「开始对局」时
 * （用户 2026-10-14：「导入后棋谱的什么分支都正常显示，不过开始对战的时候会只保留当前路线
 * 为单独局面去对战」——对战期间不该再有任何分支可走）。
 */
export const lineOnlyDocument = (document: GameDocument, currentId: string): GameDocument => {
  const chain = chainToRoot(document, currentId);
  if (!chain.length || chain.length < 2) return document;
  const nodes: Record<string, RecordNode> = {};
  chain.forEach((id, index) => {
    const node = document.nodes[id];
    const nextId = chain[index + 1];
    nodes[id] = { ...node, parentId: index ? chain[index - 1] : null, children: nextId ? [nextId] : [], preferredChildId: nextId };
  });
  return { ...document, nodes, updatedAt: new Date().toISOString(), savedCurrentId: currentId };
};

export const defaultSetupName = (document: GameDocument, currentId: string, stones: number) => {
  const title = (document.metadata.title || "").trim();
  // 有名字的（导入的棋谱、自己命过名的）保留名字，只补一个手数尾巴；没名字的按"第几手"叫。
  return title ? `${title} · ${stones} 手` : `局面 · 第 ${stones} 手`;
};

/** 坏数据逐条丢（与 `duel-history.ts` 同一口径：不因一条坏的清掉整库）。 */
const validEntry = (raw: unknown): DuelSetupEntry | null => {
  const entry = raw as Partial<DuelSetupEntry> | null;
  const document = entry?.document;
  if (!entry || typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || !entry.name.trim()) return null;
  if (!document || typeof document !== "object" || document.version !== 1) return null;
  // 懒加载/动态视图的投影**不是完整棋谱**（只读回了一部分节点），存成局面会留下假完整谱。
  if ((document as { partial?: boolean }).partial || typeof document.rootId !== "string") return null;
  const nodes = document.nodes;
  if (!nodes || typeof nodes !== "object" || !nodes[document.rootId] || typeof entry.currentId !== "string" || !nodes[entry.currentId]) return null;
  const chain = chainToRoot(document, entry.currentId);
  if (!chain.length) return null;
  const stones = chainStoneCount(document, chain);
  if (!stones) return null;
  const boardSize = Number(document.metadata?.boardSize);
  return {
    id: entry.id, name: entry.name.trim().slice(0, 60), savedAt: Number.isFinite(entry.savedAt) ? Number(entry.savedAt) : 0,
    document, currentId: entry.currentId, stones, boardSize: Number.isFinite(boardSize) ? boardSize : 15,
  };
};

export const loadDuelSetups = (): DuelSetupEntry[] => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(DUEL_SETUPS_KEY); } catch { return []; }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(validEntry).filter((item): item is DuelSetupEntry => Boolean(item));
  } catch { return []; }
};

/**
 * 追加一份局面（同名不合并——同一套开局摆两次是常事）。返回新的全表；
 * 写盘失败（配额满）返回 null 并且**不改内存里那份**，调用方据返回值决定要不要提示。
 */
export const addDuelSetup = (entry: Omit<DuelSetupEntry, "id" | "savedAt"> & { id?: string; savedAt?: number }): DuelSetupEntry[] | null => {
  const list = loadDuelSetups();
  const next: DuelSetupEntry[] = [{ ...entry, id: entry.id || `setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, savedAt: entry.savedAt || Date.now() }, ...list];
  const trimmed = next.slice(0, DUEL_SETUP_LIMIT);
  try { localStorage.setItem(DUEL_SETUPS_KEY, JSON.stringify(trimmed)); } catch { return null; }
  return trimmed;
};

const writeList = (list: DuelSetupEntry[]) => {
  try { localStorage.setItem(DUEL_SETUPS_KEY, JSON.stringify(list)); return list; } catch { return null; }
};

export const removeDuelSetup = (id: string): DuelSetupEntry[] | null => writeList(loadDuelSetups().filter((item) => item.id !== id));

export const renameDuelSetup = (id: string, name: string): DuelSetupEntry[] | null => {
  const clean = name.trim().slice(0, 60);
  if (!clean) return null;
  return writeList(loadDuelSetups().map((item) => (item.id === id ? { ...item, name: clean } : item)));
};

export const clearDuelSetups = (): void => { try { localStorage.removeItem(DUEL_SETUPS_KEY); } catch { /* 读不到也就无所谓删 */ } };
