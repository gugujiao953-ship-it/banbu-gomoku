import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, HelpCircle, Loader2, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import { hasNativeHttp, loadOnlineProxyTemplate } from "./online-http";
import { OnlinePuzzlePanel } from "./OnlinePuzzlePanel";
import { OnlineOtherPanel } from "./OnlineOtherPanel";
import { renjuOpeningOptions } from "./renju-net";
import { RENJU_GAME_TYPES, RENJU_RULES } from "./renju-reference";
import { hasCjk, loadPlayerAliases, resolvePlayerQuery } from "./player-aliases";
import { ONLINE_GAME_DOWNLOAD_ENABLED, ONLINE_GAME_SOURCES } from "./sources";
import { EXTERNAL_ENTRY_LINKS, EXTERNAL_SOURCES, buildExternalPlayerSearchUrl } from "./external-links";
import { indexGames, loadRecordIndex, searchRecordIndex, type IndexEventEntry, type IndexGameEntry, type IndexPlayerEntry, type RecordIndex } from "./record-index";
import type { OnlineFetchedPuzzleSet, OnlineFetchedRecord, OnlineGameSummary, OnlineImportOutcome, OnlineLookupEntry, OnlineSearchQuery, OnlineSearchResult, OnlineSource, OnlineTournamentSummary } from "./types";

/** 来源顺序即面板里下拉的顺序：能检索的排前面，浏览式的排后面。
 *  启用清单在 sources.ts——那里记录着每个来源的条款结论与停用原因。 */
const SOURCES: OnlineSource[] = ONLINE_GAME_SOURCES;
/**
 * 棋谱来源全停用时用的占位来源：**没有任何能力**（supports 一律 false、不实现
 * search/lookup/fetchGame/listTournaments）。它存在的唯一目的是让下面那些
 * `source.supports(...)` 之类的渲染期读取不至于拿到 undefined 而崩——
 * 真正的界面由「只给链接」分支接管（见下面的 SOURCES.length === 0 分支）。
 */
const LINK_ONLY_SOURCE: OnlineSource = {
  id: "link-only",
  label: "在线棋谱已改为只给链接",
  homepage: "",
  credit: "",
  notes: [],
  supports: () => false,
  search: () => Promise.resolve({ items: [], total: 0, page: 1, pageCount: 1 }),
  fetchGame: () => Promise.reject(new Error("在线棋谱已改为只给链接，不再取回棋谱")),
};
const QUERY_KEY = "banbu-online-query-v1";
/** 棋手检索的上一句输入（用户 09-26 新增的那一步）。 */
const PLAYER_QUERY_KEY = "banbu-online-player-query-v1";
const EVENTS_KEY = "banbu-online-events-v1";
/** 「棋谱 / 题库 / 其他」看哪一面：记住上次选的，不用每次重新点。 */
const CONTENT_KEY = "banbu-online-content-v1";

type ContentKind = "games" | "puzzles" | "other";

/** 存档里可能是旧值或乱值（这一项以前只有 games/puzzles 两种）：只认这三个，其余回「棋谱」。 */
const readContentKind = (stored: string | null): ContentKind =>
  stored === "puzzles" || stored === "other" ? stored : "games";

export type { OnlineImportOutcome };

interface OnlineLibraryPanelProps {
  onImport: (records: OnlineFetchedRecord[]) => Promise<OnlineImportOutcome>;
  /** 打开设置页（在线棋谱在浏览器版需要代理时给的去向）。 */
  onOpenSettings: () => void;
}

interface StoredQuery {
  /** 默认栏「名字」：棋手或赛事二选一，由联想项决定落到哪一类。 */
  nameText: string; nameId: string; nameDetail: string; nameKind: "" | "player" | "tournament";
  player1Text: string; player1Id: string; player1Detail: string;
  player2Text: string; player2Id: string; player2Detail: string;
  yearFrom: string; yearTo: string;
  tournamentText: string; tournamentId: string; tournamentDetail: string;
  openingId: string; ruleId: string; typeId: string;
  minMoves: string; maxMoves: string;
}

const EMPTY_QUERY: StoredQuery = {
  nameText: "", nameId: "", nameDetail: "", nameKind: "",
  player1Text: "", player1Id: "", player1Detail: "",
  player2Text: "", player2Id: "", player2Detail: "",
  yearFrom: "", yearTo: "", tournamentText: "", tournamentId: "", tournamentDetail: "",
  openingId: "", ruleId: "", typeId: "", minMoves: "", maxMoves: "",
};

const loadStoredQuery = (): StoredQuery => {
  try {
    const raw = localStorage.getItem(QUERY_KEY);
    if (!raw) return EMPTY_QUERY;
    return { ...EMPTY_QUERY, ...(JSON.parse(raw) as Partial<StoredQuery>) };
  } catch {
    return EMPTY_QUERY;
  }
};

/** 高级筛选（年份/规则/开局/类型/手数）是否被用户动过——「详细设置」按钮上挂个计数。 */
const countDetailedFilters = (query: StoredQuery) =>
  [query.player1Id, query.player2Id, query.tournamentId, query.yearFrom, query.yearTo, query.openingId, query.ruleId, query.typeId, query.minMoves, query.maxMoves]
    .filter(Boolean).length;

/** Player and tournament filters need the source's numeric id, not the name the
 *  user types, so each one is a search box backed by the source's picker.
 *  中文名在这里就翻译成来源认的拉丁写法（见 player-aliases.ts）。 */
function LookupField({ label, placeholder, source, kind, value, onPick }: {
  label: string;
  placeholder: string;
  source: OnlineSource;
  /** name = 棋手或赛事二选一（默认栏）；player/tournament = 明确指定。 */
  kind: "player" | "tournament" | "name";
  value: { text: string; id: string; detail: string; kind?: string };
  onPick: (next: { text: string; id: string; detail: string; kind?: "player" | "tournament" }) => void;
}) {
  const [entries, setEntries] = useState<Array<OnlineLookupEntry & { kind: "player" | "tournament" }>>([]);
  const [busy, setBusy] = useState(false);
  const [translated, setTranslated] = useState("");
  useEffect(() => {
    const text = value.text.trim();
    if (!source.lookup || text.length < 2 || value.id) { setEntries([]); setTranslated(""); return; }
    const resolved = kind === "tournament" ? { query: text.trim().toLowerCase(), alias: null } : resolvePlayerQuery(text);
    setTranslated(resolved.query !== text.trim() ? `${text.trim()} → ${resolved.query}` : "");
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      // 「名字」栏要同时问棋手和赛事两条路：用户输入的是名字，不该由他先决定这是人名还是赛事名。
      const jobs: Array<Promise<Array<OnlineLookupEntry & { kind: "player" | "tournament" }>>> = kind === "name"
        ? [
          source.lookup!("player", resolved.query).then((found) => found.map((entry) => ({ ...entry, kind: "player" as const }))).catch(() => []),
          source.lookup!("tournament", resolved.query).then((found) => found.map((entry) => ({ ...entry, kind: "tournament" as const }))).catch(() => []),
        ]
        : [source.lookup!(kind, resolved.query).then((found) => found.map((entry) => ({ ...entry, kind: kind as "player" | "tournament" }))).catch(() => [])];
      void Promise.all(jobs).then((groups) => {
        if (!active) return;
        // 棋手与赛事交替排列，两类都能一眼看到（不把一类的 6 条占满）。
        const merged: Array<OnlineLookupEntry & { kind: "player" | "tournament" }> = [];
        for (let index = 0; index < 6; index += 1) {
          for (const group of groups) if (group[index]) merged.push(group[index]);
        }
        setEntries(merged.slice(0, 8));
      }).finally(() => { if (active) setBusy(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, source, value.id, value.text]);
  return (
    <label className="online-field">{label}
      <input
        value={value.text}
        placeholder={placeholder}
        data-online-lookup={kind}
        onChange={(event) => onPick({ text: event.target.value, id: "", detail: "", kind: undefined })}
      />
      {value.id
        ? <small className="online-picked"><Check size={12}/>已选{value.kind === "tournament" ? "赛事" : value.kind === "player" ? "棋手" : ""}：{value.text}{value.detail ? ` · ${value.detail}` : ""}<button type="button" onClick={() => onPick({ text: "", id: "", detail: "", kind: undefined })}>清除</button></small>
        : busy ? <small className="online-hint">查找中…{translated ? `（${translated}）` : ""}</small>
          : entries.length > 0 && (
            <span className="online-suggestions">
              {entries.map((entry) => (
                <button
                  key={`${entry.kind}-${entry.id}`}
                  type="button"
                  data-online-suggestion={`${entry.kind}-${entry.id}`}
                  onClick={() => onPick({ text: entry.name, id: entry.id, detail: entry.detail, kind: entry.kind })}
                >
                  <b>{entry.name}</b>
                  <small><span className="online-suggestion-kind">{entry.kind === "tournament" ? "赛事" : "棋手"}</span>{entry.detail ? ` ${entry.detail}` : ""}</small>
                </button>
              ))}
            </span>
          )}
      {!value.id && !busy && !entries.length && translated && <small className="online-hint">将按「{translated}」检索</small>}
    </label>
  );
}

export function OnlineLibraryPanel({ onImport, onOpenSettings }: OnlineLibraryPanelProps) {
  // 在线界面有三个内容面：棋谱（励精连珠教室 + 棋手目录）、题库（习题网站导航），
  // 以及「其他」（网盘资料，用户 2026-10-14 要求加）。三者的检索单位与产物都不一样，
  // 所以只共用这一层外壳。三个页签都常驻（用户 09-26：在线功能不再需要开关）。
  const [contentKind, setContentKind] = useState<ContentKind>(() => {
    try { return readContentKind(localStorage.getItem(CONTENT_KEY)); } catch { return "games"; }
  });
  const switchContent = (next: ContentKind) => {
    setContentKind(next);
    try { localStorage.setItem(CONTENT_KEY, next); } catch { /* 不记住也不影响使用 */ }
  };
  // 来源清单可能为空（棋谱通道已改为只给链接）：初始 id 必须兜底，否则挂载即崩。
  const [sourceId, setSourceId] = useState(SOURCES[0]?.id || LINK_ONLY_SOURCE.id);
  const source = useMemo(() => SOURCES.find((entry) => entry.id === sourceId) || SOURCES[0] || LINK_ONLY_SOURCE, [sourceId]);
  const [query, setQuery] = useState<StoredQuery>(loadStoredQuery);
  const [result, setResult] = useState<OnlineSearchResult | null>(null);
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<"idle" | "searching" | "downloading">("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState<(OnlineImportOutcome & { downloadFailures: Array<{ name: string; reason: string }> }) | null>(null);
  // 默认只露棋手与赛事；年份/规则/开局/类型/手数收进「详细设置」。
  const [showDetails, setShowDetails] = useState(() => countDetailedFilters(loadStoredQuery()) > 0);
  const [showSourceInfo, setShowSourceInfo] = useState(false);
  // 外部来源（只给链接、不抓取）默认折叠：不抢主流程，展开也只是拼 URL、不发请求。
  const [showExternal, setShowExternal] = useState(false);
  // 最近赛事：**默认折叠**，展开才发请求（robots 合规：打开面板必须零请求）。
  const storedEvents = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(EVENTS_KEY) || "{}") as { year?: string; majorOnly?: boolean }; } catch { return {}; }
  }, []);
  const currentYear = new Date().getFullYear();
  const [showEvents, setShowEvents] = useState(false);
  const [eventYear, setEventYear] = useState(storedEvents.year && /^\d{4}$/.test(storedEvents.year) ? storedEvents.year : String(currentYear));
  const [majorOnly, setMajorOnly] = useState(storedEvents.majorOnly !== false);
  const [tournaments, setTournaments] = useState<OnlineTournamentSummary[]>([]);
  const [tournamentPage, setTournamentPage] = useState({ page: 1, pageCount: 1 });
  const [eventsBusy, setEventsBusy] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [tournamentGames, setTournamentGames] = useState<OnlineSearchResult | null>(null);
  const [gamesBusy, setGamesBusy] = useState(false);
  const cancelRef = useRef(false);
  const needsProxy = !hasNativeHttp() && !loadOnlineProxyTemplate();
  // 这个来源能不能检索？不能（励精连珠教室只有赛事档案）就把检索区整块收起来，
  // 只留「最近赛事」——不要给一个按下去必然失败的按钮。
  // ⚠ 用户 09-26 已把在线面的检索合并成顶部那**一个**框（棋手与赛事一起查、结果标来源）。
  //    这套由 `canSearch` 驱动的来源级检索区目前是关着的；哪天真启用一个带服务端检索的来源，
  //    界面上就会冒出两个输入框——届时要么把它并进 PlayerIndexSearch（一个框、结果分
  //    「我们的目录 / 来源站」两组），要么让它明确让位，别再摆两套输入。
  const canSearch = source.supports("player") || source.supports("tournament");
  const canBrowse = Boolean(source.listTournaments);

  useEffect(() => { try { localStorage.setItem(QUERY_KEY, JSON.stringify(query)); } catch { /* not persisted */ } }, [query]);
  useEffect(() => { try { localStorage.setItem(EVENTS_KEY, JSON.stringify({ year: eventYear, majorOnly })); } catch { /* not persisted */ } }, [eventYear, majorOnly]);
  // 别名表只影响「中文名怎么变拉丁名」，加载失败也不影响别的功能。
  useEffect(() => { void loadPlayerAliases(); }, []);

  const patchQuery = (patch: Partial<StoredQuery>) => setQuery((current) => ({ ...current, ...patch }));

  const baseQuery = (): OnlineSearchQuery => ({
    // 「名字」栏选中棋手＝黑方筛选、选中赛事＝赛事筛选（用户可以再在详细设置里补白方）。
    player1: (query.nameKind === "player" ? query.nameId : "") || query.player1Id || undefined,
    tournamentId: (query.nameKind === "tournament" ? query.nameId : "") || undefined,
    player2: query.player2Id || undefined,
    yearFrom: query.yearFrom || undefined,
    yearTo: query.yearTo || undefined,
    openingId: query.openingId || undefined,
    ruleId: query.ruleId || undefined,
    typeId: query.typeId || undefined,
    minMoves: query.minMoves || undefined,
    maxMoves: query.maxMoves || undefined,
  });

  /**
   * 只有文字、没点联想项的筛选字段**不能静默丢掉**（原实现就是这样：输入棋手名直接点检索，
   * 结果是全库）。这里在检索前把它拿去来源查一次，取第一条；查不到就如实报错。
   */
  const resolveFilters = async (): Promise<OnlineSearchQuery | null> => {
    const next = baseQuery();
    const notes: string[] = [];
    // 「名字」栏没点联想项时也要能搜：先当棋手问一次，查不到再当赛事问（顺序固定，结果可预期）。
    if (query.nameText.trim() && !(query.nameKind && query.nameId)) {
      const text = query.nameText.trim();
      const resolved = resolvePlayerQuery(text);
      const player = await source.lookup?.("player", resolved.query).catch(() => []) || [];
      if (player[0]) {
        next.player1 = player[0].id;
        notes.push(`${text} → 棋手 ${player[0].name}`);
      } else {
        const tournament = await source.lookup?.("tournament", text.toLowerCase()).catch(() => []) || [];
        if (!tournament[0]) {
          setError(`没有找到「${text}」${hasCjk(text) ? "：可以换成拼音/英文写法，或只输入名字的一部分" : "：试试只输入名字的一部分"}`);
          return null;
        }
        next.tournamentId = tournament[0].id;
        notes.push(`${text} → 赛事 ${tournament[0].name}`);
      }
    }
    const fields: Array<{ key: "player1" | "player2" | "tournamentId"; text: string; kind: "player" | "tournament"; label: string }> = [
      { key: "player1", text: query.player1Text, kind: "player", label: "棋手（黑方）" },
      { key: "player2", text: query.player2Text, kind: "player", label: "棋手（白方）" },
      { key: "tournamentId", text: query.tournamentText, kind: "tournament", label: "赛事" },
    ];
    for (const field of fields) {
      const text = field.text.trim();
      if (!text || next[field.key] || !source.lookup) continue;
      const resolved = field.kind === "player" ? resolvePlayerQuery(text) : { query: text.toLowerCase(), alias: null };
      const found = await source.lookup(field.kind, resolved.query).catch(() => []);
      const first = found[0];
      if (!first) {
        setError(`${field.label}没有找到「${text}」${hasCjk(text) ? "：可以换成拼音/英文写法，或只输入名字的一部分" : "：试试只输入名字的一部分"}`);
        return null;
      }
      next[field.key] = first.id;
      notes.push(resolved.query !== text ? `${text} → ${first.name}（按 ${resolved.query} 匹配）` : `${text} → ${first.name}`);
    }
    setNotice(notes.length ? `已自动匹配：${notes.join("；")}` : "");
    return next;
  };

  const runSearch = async (targetPage: number) => {
    setPhase("searching");
    setError("");
    setNotice("");
    setOutcome(null);
    const filters = await resolveFilters();
    if (!filters) { setPhase("idle"); setResult(null); return; }
    try {
      const found = await source.search(filters, targetPage);
      setResult(found);
      setPage(targetPage);
      setSelected(new Set());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setResult(null);
    } finally {
      setPhase("idle");
    }
  };

  const items = result?.items || [];
  // 「在线查看」（把一局取回本应用里看局面）已按用户 09-26 的要求撤掉：在线面上的每一局
  // 现在都是「点了才在浏览器打开对应网页」。取回单局的通道 `source.fetchGame` 仍留在
  // 下面的批量下载里（由 ONLINE_GAME_DOWNLOAD_ENABLED 门控），要恢复只需把行内按钮加回来。

  const selectedItems = useMemo(() => {
    const pool = [...(result?.items || []), ...(tournamentGames?.items || [])];
    const byId = new Map(pool.map((item) => [item.id, item] as const));
    return [...selected].map((id) => byId.get(id)).filter((item): item is OnlineGameSummary => Boolean(item));
  }, [result, tournamentGames, selected]);
  const selectedCount = selectedItems.length;
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const download = async () => {
    const wanted = selectedItems;
    if (!wanted.length) return;
    cancelRef.current = false;
    setPhase("downloading");
    setError("");
    setNotice("");
    setOutcome(null);
    setProgress({ done: 0, total: wanted.length });
    const records: OnlineFetchedRecord[] = [];
    const downloadFailures: Array<{ name: string; reason: string }> = [];
    for (const [index, item] of wanted.entries()) {
      if (cancelRef.current) break;
      try {
        records.push(await source.fetchGame(item));
      } catch (failure) {
        downloadFailures.push({ name: `${item.black} - ${item.white}（${item.date}）`, reason: failure instanceof Error ? failure.message : String(failure) });
      }
      setProgress({ done: index + 1, total: wanted.length });
    }
    if (cancelRef.current) {
      setPhase("idle");
      setOutcome({ inserted: 0, duplicates: 0, failures: [], downloadFailures: [...downloadFailures, { name: "本次下载", reason: "已取消，已取回的棋谱未导入" }] });
      return;
    }
    try {
      const saved = await onImport(records);
      setOutcome({ ...saved, downloadFailures });
      setSelected(new Set());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPhase("idle");
    }
  };

  /** 取赛事清单。来源作为参数传进来：切来源时 setState 还没生效，用闭包里的
   *  `source` 会拿上一个来源去请求（切到励精却按 renju.net 取，必错）。 */
  const loadTournaments = async (target: OnlineSource, targetPage = 1) => {
    if (!target.listTournaments) return;
    setEventsBusy(true);
    setError("");
    try {
      const found = await target.listTournaments({ yearFrom: eventYear, yearTo: eventYear, page: targetPage });
      setTournaments((current) => targetPage === 1 ? found.items : [...current, ...found.items]);
      setTournamentPage({ page: found.page, pageCount: found.pageCount });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      if (targetPage === 1) setTournaments([]);
    } finally {
      setEventsBusy(false);
    }
  };

  const switchSource = (nextId: string) => {
    const next = SOURCES.find((entry) => entry.id === nextId) || SOURCES[0] || LINK_ONLY_SOURCE;
    setSourceId(next.id);
    // 换来源＝换数据源，检索结果与选择都作废，免得把 A 源的结果当 B 源的。
    setResult(null);
    setSelected(new Set());
    setError("");
    setNotice("");
    setExpandedId("");
    setTournamentGames(null);
    setTournaments([]);
    // 浏览式来源（没有检索）直接把赛事浏览打开：这一步是用户点出来的，请求仍属用户触发。
    if (!(next.supports("player") || next.supports("tournament")) && next.listTournaments) {
      setShowEvents(true);
      void loadTournaments(next, 1);
    }
  };

  const toggleTournament = async (tournament: OnlineTournamentSummary) => {
    if (expandedId === tournament.id) { setExpandedId(""); setTournamentGames(null); return; }
    if (!source.listTournamentGames) return;
    setExpandedId(tournament.id);
    setTournamentGames(null);
    setGamesBusy(true);
    setError("");
    try {
      setTournamentGames(await source.listTournamentGames(tournament.id, 1));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setGamesBusy(false);
    }
  };

  // 级别筛选只在来源提供了判据时生效：用英文关键词去筛中文赛事会把整张表清空（实测踩过）。
  const levelFilter = source.isMajorEvent;
  const visibleTournaments = useMemo(
    () => (majorOnly && levelFilter ? tournaments.filter((item) => levelFilter(item.name)) : tournaments),
    [levelFilter, majorOnly, tournaments],
  );
  // 检索结果按赛事分组（用户要求：搜出来必须是赛事、赛事里含对局，不能几百局平铺）。
  // 按棋手搜时站点不给赛事名 → 用轮次/日期当组名并标明「按日期」，别让用户以为
  // 赛事就叫「2024-06-23」。
  const resultGroups = useMemo(() => {
    const groups = new Map<string, OnlineGameSummary[]>();
    for (const item of result?.items || []) {
      const key = item.event?.trim() || `按日期 · ${item.round || item.date || "日期未知"}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()];
  }, [result]);
  const hasNamedEvents = Boolean(result?.items.some((item) => item.event?.trim()));

  // 分组键优先用「轮次」：励精连珠教室的轮次页给得出（D组 第九轮），renju.net 的
  // 棋谱列表只有日期（轮次要下载后才知道），于是自然退回按日期分组。
  const gamesByGroup = useMemo(() => {
    const groups = new Map<string, OnlineGameSummary[]>();
    for (const item of tournamentGames?.items || []) {
      const key = item.round || item.date || "未标注轮次";
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [tournamentGames]);

  return (
    // 棋谱库的第三个界面：页面形态，没有弹层外壳、没有「完成」按钮。
    <div className="online-library" data-online-panel={contentKind === "puzzles" ? "puzzle" : contentKind === "other" ? "other" : source.id} aria-label="在线棋谱库">
      {/* 先选「看棋谱、看题库，还是看网盘资料」：三者的检索方式完全不同，混在一屏只会互相干扰。
          三个页签都常驻（用户 09-26：在线功能不再需要开关）。 */}
      <div className="online-content-switch" role="tablist" aria-label="在线内容">
        <button type="button" role="tab" aria-selected={contentKind === "games"} className={contentKind === "games" ? "active" : ""} data-online-content="games" onClick={() => switchContent("games")}>棋谱</button>
        <button type="button" role="tab" aria-selected={contentKind === "puzzles"} className={contentKind === "puzzles" ? "active" : ""} data-online-content="puzzles" onClick={() => switchContent("puzzles")}>题库</button>
        <button type="button" role="tab" aria-selected={contentKind === "other"} className={contentKind === "other" ? "active" : ""} data-online-content="other" onClick={() => switchContent("other")}>其他</button>
      </div>
      {contentKind === "puzzles" ? (
        <OnlinePuzzlePanel/>
      ) : contentKind === "other" ? (
        <OnlineOtherPanel/>
      ) : <>
      {/* 棋手检索排在最上面（用户 09-26）：先在这里看到棋手与他的对局，点了某一条才开网页。 */}
      <PlayerIndexSearch/>
      {SOURCES.length === 0 ? (
        // 棋谱来源全部停用（用户 2026-09-19）：这里不再有浏览/下载，只有跳转入口。
        // 抓取代码一行没删，见 sources.ts 的恢复步骤。
        <div className="online-link-only" data-online-link-only>
          {/* 文案就一句「点入口去网站看局面」（用户 09-19：合规理由用户没必要知道）。 */}
          <p className="online-link-only-note">点下面的入口或检索按钮，在来源网站里查看局面。</p>
          <ExternalLinksPanel/>
        </div>
      ) : <>
      <div className="online-source-row">
        {SOURCES.length > 1 ? (
          <label className="online-field online-source-pick">棋谱来源
            <select value={sourceId} data-online-source onChange={(event) => switchSource(event.target.value)}>
              {SOURCES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
        ) : <span className="online-source-label">棋谱来源<b>{source.label}</b></span>}
        <button
          type="button"
          className="online-help"
          aria-label="棋谱来源说明"
          aria-expanded={showSourceInfo}
          data-online-source-help
          onClick={() => setShowSourceInfo((visible) => !visible)}
        ><HelpCircle size={17}/></button>
      </div>
      {showSourceInfo && (
        <div className="online-source-info" role="note">
          <ul className="online-source-notes">{source.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          <p className="online-credit">{source.credit}</p>
          <a className="metadata-source-link" href={source.homepage} target="_blank" rel="noreferrer"><ExternalLink size={13}/>在浏览器中打开 {source.homepage.replace(/^https?:\/\//, "")}</a>
        </div>
      )}

      {/* 跳转到来源网站：见 external-links.ts。默认折叠，展开也只是拼对方站点的 URL，本应用不抓取。 */}
      <ExternalLinksPanel
        mode="collapsible"
        expanded={showExternal}
        onToggle={() => setShowExternal((visible) => !visible)}
      />

      {needsProxy && (
        <div className="online-warning" role="status">
          <AlertTriangle size={15}/>
          <div>
            <b>当前环境无法直接读取该站点</b>
            <p>{source.label} 不提供跨域访问。安卓应用内会自动走系统网络直连；浏览器版请填写代理地址后再试。</p>
            <button type="button" className="secondary-button" onClick={onOpenSettings}><Settings2 size={14}/>去设置代理</button>
          </div>
        </div>
      )}

      {canSearch && <div className="online-filters">
        {/* 默认只留「名字」一栏：棋手名和赛事名都往这里输，联想结果里挑一个即可。
            黑方/白方是同一件事的细分，收进「详细设置」——首屏只让人做一件事。 */}
        <LookupField
          label="名字" placeholder="棋手或赛事的名字：中文名/拼音/英文名，选中联想项" source={source} kind="name"
          value={{ text: query.nameText, id: query.nameId, detail: query.nameDetail, kind: query.nameKind || undefined }}
          onPick={(next) => patchQuery({ nameText: next.text, nameId: next.id, nameDetail: next.detail, nameKind: next.kind || "" })}
        />
        <button
          type="button"
          className={`online-details-toggle ${showDetails ? "open" : ""}`}
          aria-expanded={showDetails}
          data-online-details
          onClick={() => setShowDetails((visible) => !visible)}
        >
          <SlidersHorizontal size={15}/>详细设置
          {countDetailedFilters(query) > 0 && <small>{countDetailedFilters(query)} 项已设</small>}
          <ChevronDown size={14}/>
        </button>
        {showDetails && (
          <div className="online-detailed" data-online-detailed>
            <LookupField
              label="棋手（黑方）" placeholder="可留空" source={source} kind="player"
              value={{ text: query.player1Text, id: query.player1Id, detail: query.player1Detail }}
              onPick={(next) => patchQuery({ player1Text: next.text, player1Id: next.id, player1Detail: next.detail })}
            />
            <LookupField
              label="棋手（白方）" placeholder="可留空" source={source} kind="player"
              value={{ text: query.player2Text, id: query.player2Id, detail: query.player2Detail }}
              onPick={(next) => patchQuery({ player2Text: next.text, player2Id: next.id, player2Detail: next.detail })}
            />
            <LookupField
              label="赛事（只要赛事）" placeholder="可留空；上面「名字」选赛事也等同于这里" source={source} kind="tournament"
              value={{ text: query.tournamentText, id: query.tournamentId, detail: query.tournamentDetail }}
              onPick={(next) => patchQuery({ tournamentText: next.text, tournamentId: next.id, tournamentDetail: next.detail })}
            />
            <div className="two-cols">
              <label className="online-field">起始年份<input inputMode="numeric" value={query.yearFrom} placeholder="如 2024" onChange={(event) => patchQuery({ yearFrom: event.target.value.replace(/\D/g, "").slice(0, 4) })}/></label>
              <label className="online-field">结束年份<input inputMode="numeric" value={query.yearTo} placeholder="如 2024" onChange={(event) => patchQuery({ yearTo: event.target.value.replace(/\D/g, "").slice(0, 4) })}/></label>
            </div>
            <div className="three-cols">
              <label className="online-field">规则
                <select value={query.ruleId} onChange={(event) => patchQuery({ ruleId: event.target.value })}>
                  <option value="">全部</option>
                  {RENJU_RULES.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
                </select>
              </label>
              <label className="online-field">开局
                <select value={query.openingId} onChange={(event) => patchQuery({ openingId: event.target.value })}>
                  <option value="">全部</option>
                  {renjuOpeningOptions().map((opening) => <option key={opening.id} value={opening.id}>{opening.label}</option>)}
                </select>
              </label>
              <label className="online-field">类型
                <select value={query.typeId} onChange={(event) => patchQuery({ typeId: event.target.value })}>
                  <option value="">全部</option>
                  {RENJU_GAME_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>
            <div className="two-cols">
              <label className="online-field">最少手数<input inputMode="numeric" value={query.minMoves} onChange={(event) => patchQuery({ minMoves: event.target.value.replace(/\D/g, "").slice(0, 3) })}/></label>
              <label className="online-field">最多手数<input inputMode="numeric" value={query.maxMoves} onChange={(event) => patchQuery({ maxMoves: event.target.value.replace(/\D/g, "").slice(0, 3) })}/></label>
            </div>
          </div>
        )}
      </div>}

      {/* 一屏一个主按钮：能检索的来源给「检索」，不能检索的来源不给假按钮。 */}
      {canSearch && (
        <div className="online-actions">
          <button className="primary-button" data-online-search onClick={() => { void runSearch(1); }} disabled={phase !== "idle"}>
            {phase === "searching" ? <Loader2 className="online-spin" size={16}/> : <Search size={16}/>}检索
          </button>
        </div>
      )}
      {!canSearch && (
        <p className="online-browse-note" role="note">
          这个来源没有检索接口，只能在下面按赛事浏览。
          {/* 把「为什么没有检索」如实说出来：用户会以为功能坏了。 */}
          {SOURCES.length === 1 ? "这个来源没有检索接口，只能在下面按赛事浏览；要按棋手或赛事名检索，用「跳转到来源网站」里的检索框去来源站点查。" : "要按棋手/赛事搜，请在上方切换来源。"}
        </p>
      )}

      {/* 选中后才出现的吸底操作条：勾选发生在下面的列表里，下载按钮必须跟手，
          而不是固定在顶部等用户滚回去按。下载中它变成进度 + 停止。 */}
      {ONLINE_GAME_DOWNLOAD_ENABLED && (selectedCount > 0 || phase === "downloading") && (
        <div className="online-selection-bar" role="status" aria-live="polite" data-online-selection-bar>
          {phase === "downloading" ? (
            <>
              <span className="online-selection-count">正在取回 {progress.done} / {progress.total}</span>
              <button type="button" className="secondary-button" data-online-cancel onClick={() => { cancelRef.current = true; }}>停止</button>
            </>
          ) : (
            <>
              <span className="online-selection-count">已选 <b>{selectedCount}</b> 局</span>
              <button type="button" className="online-selection-clear" aria-label="清空已选" onClick={() => setSelected(new Set())}><X size={14}/>清空</button>
              <button type="button" className="primary-button" data-online-download onClick={() => { void download(); }} disabled={phase !== "idle"}>
                <Download size={16}/>下载并导入
              </button>
            </>
          )}
        </div>
      )}

      {phase === "downloading" && <p className="helper" data-online-progress>正在逐局取回并导入：{progress.done} / {progress.total}（来源站点会限速，请勿离开）</p>}
      {notice && <p className="helper" data-online-notice>{notice}</p>}
      {error && <p className="online-error" role="alert" data-online-error>{error}</p>}

      {outcome && (
        <div className="online-report" data-online-report>
          <b>导入完成</b>
          <p>新增 {outcome.inserted} 局，重复跳过 {outcome.duplicates} 局{(outcome.failures.length + outcome.downloadFailures.length) > 0 ? `，失败 ${outcome.failures.length + outcome.downloadFailures.length} 局` : ""}。</p>
          {[...outcome.failures, ...outcome.downloadFailures].slice(0, 6).map((failure) => <p key={failure.name} className="online-failure">{failure.name}：{failure.reason}</p>)}
        </div>
      )}

      {result && (
        <section className="online-results" aria-label="检索结果">
          <header>
            <b>{result.total.toLocaleString("zh-CN")} 局匹配</b>
            <small>第 {result.page} / {result.pageCount} 页 · 本页 {items.length} 局{hasNamedEvents ? "" : " · 按日期分组"}</small>
          </header>
          <div className="online-result-head">
            {ONLINE_GAME_DOWNLOAD_ENABLED && (<label className="online-check-all">
              <input
                type="checkbox"
                data-online-select-all
                checked={items.length > 0 && items.every((item) => selected.has(item.id))}
                onChange={(event) => setSelected((current) => {
                  const next = new Set(current);
                  for (const item of items) { if (event.target.checked) next.add(item.id); else next.delete(item.id); }
                  return next;
                })}
              />全选本页
            </label>)}
            <div className="online-pager">
              <button type="button" className="secondary-button" disabled={page <= 1 || phase !== "idle"} onClick={() => { void runSearch(page - 1); }}><ChevronLeft size={15}/>上一页</button>
              <button type="button" className="secondary-button" disabled={page >= result.pageCount || phase !== "idle"} onClick={() => { void runSearch(page + 1); }}>下一页<ChevronRight size={15}/></button>
            </div>
          </div>
          {items.length === 0
            ? <p className="helper">没有匹配的棋谱，试试放宽年份或去掉筛选项。</p>
            : (
              // 按赛事分组展示：几百局平铺既难找、也没法「整场下回来」——这正是用户要的形态。
              <div className="online-result-groups" data-online-groups>
                {resultGroups.map(([event, games]) => {
                  const allPicked = games.every((item) => selected.has(item.id));
                  return (
                    <section key={event} className="online-result-group" data-online-result-group={event}>
                      <header className="online-result-group-head">
                        <span className="online-result-group-title">
                          <b>{event}</b>
                          <small>{games.length} 局</small>
                        </span>
                        <button
                          type="button"
                          className="online-result-group-pick"
                          data-online-group-pick={event}
                          onClick={() => setSelected((current) => {
                            const next = new Set(current);
                            for (const item of games) { if (allPicked) next.delete(item.id); else next.add(item.id); }
                            return next;
                          })}
                        >{allPicked ? "取消本赛事" : "全选本赛事"}</button>
                      </header>
                      <ul className="online-game-list">
                        {games.map((item) => <OnlineGameRow key={item.id} item={item} checked={selected.has(item.id)} onToggle={() => toggle(item.id)} downloadEnabled={ONLINE_GAME_DOWNLOAD_ENABLED}/>)}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          <p className="online-credit">{source.credit}</p>
        </section>
      )}

      {canBrowse && (
        <section className="online-events" aria-label="最近赛事">
          <button
            type="button"
            className={`online-events-head ${showEvents ? "open" : ""}`}
            aria-expanded={showEvents}
            data-online-events
            onClick={() => {
              const next = !showEvents;
              setShowEvents(next);
              // 展开才发请求（面板打开本身必须零请求，robots 合规底线）。
              if (next && !tournaments.length && !eventsBusy) void loadTournaments(source, 1);
            }}
          >
            <span className="online-events-title"><b>最近赛事</b><small>{levelFilter ? `${majorOnly ? "重大赛事" : "全部赛事"} · ` : ""}{eventYear} 年</small></span>
            <ChevronDown size={16}/>
          </button>
          {showEvents && (
            <div className="online-events-body" data-online-events-body>
              <p className="helper">
                {levelFilter ? "「重大赛事」= 世界级 + 各国国家级（含国内全国赛/杯赛/公开赛）；欧洲各站公开赛、北欧与地方俱乐部赛不算。" : ""}
                {source.id === "renju-net" ? "来源列表只提供日期，轮次在单局下载后写入棋谱信息。" : "点开赛事可逐轮取回棋谱。"}
              </p>
              <div className="online-events-controls">
                <label className="online-field">年份
                  <select value={eventYear} data-online-events-year onChange={(event) => { setEventYear(event.target.value); setExpandedId(""); setTournamentGames(null); setTournaments([]); void loadTournaments(source, 1); }}>
                    {Array.from({ length: 11 }, (_, index) => String(currentYear - index)).map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
                {levelFilter && (
                  <label className="online-field">级别
                    <select value={majorOnly ? "major" : "all"} data-online-events-level onChange={(event) => { const next = event.target.value === "major"; setMajorOnly(next); if (next) { setExpandedId(""); setTournamentGames(null); } }}>
                      <option value="major">重大赛事</option>
                      <option value="all">全部赛事</option>
                    </select>
                  </label>
                )}
                <button type="button" className="secondary-button" disabled={eventsBusy} onClick={() => { void loadTournaments(source, 1); }} data-online-events-refresh>
                  {eventsBusy ? <Loader2 className="online-spin" size={14}/> : null}刷新
                </button>
              </div>
              {visibleTournaments.length === 0 && !eventsBusy && <p className="helper">{tournaments.length === 0 ? "这一年还没有取到赛事。" : "这一年没有匹配「重大赛事」的赛事，可切到「全部赛事」。"}</p>}
              <ul className="online-event-list">
                {visibleTournaments.map((tournament) => (
                  <li key={tournament.id} className={expandedId === tournament.id ? "online-event open" : "online-event"} data-online-event={tournament.id}>
                    <button type="button" className="online-event-head" aria-expanded={expandedId === tournament.id} onClick={() => { void toggleTournament(tournament); }}>
                      <span className="online-event-main">
                        <b>{tournament.name}</b>
                        <small>{[tournament.dateFrom, tournament.dateTo !== tournament.dateFrom ? tournament.dateTo : "", tournament.place, tournament.ruleName].filter(Boolean).join(" · ")}</small>
                      </span>
                      {expandedId === tournament.id ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
                    </button>
                    {expandedId === tournament.id && (
                      <div className="online-event-games" data-online-event-games={tournament.id}>
                        {gamesBusy && <p className="helper"><Loader2 className="online-spin" size={13}/> 正在取该赛事的棋谱…</p>}
                        {!gamesBusy && tournamentGames && (
                          <>
                            <div className="online-event-tools">
                              <span>已列 {tournamentGames.items.length} 局{tournamentGames.pageCount > 1 ? ` · 第 ${tournamentGames.page} / ${tournamentGames.pageCount} ${tournamentGames.pageUnit || "页"}` : ""}</span>
                              {ONLINE_GAME_DOWNLOAD_ENABLED && (<button type="button" className="secondary-button" data-online-event-select-all onClick={() => setSelected((current) => {
                                const next = new Set(current);
                                const allSelected = tournamentGames.items.every((item) => next.has(item.id));
                                for (const item of tournamentGames.items) { if (allSelected) next.delete(item.id); else next.add(item.id); }
                                return next;
                              })}>{tournamentGames.items.every((item) => selected.has(item.id)) ? "取消全选" : "全选已列出"}</button>)}
                            </div>
                            {gamesByGroup.map(([group, games]) => (
                              <div key={group} className="online-event-round">
                                <small className="online-event-date">{group}</small>
                                <ul className="online-game-list">
                                  {games.map((item) => <OnlineGameRow key={item.id} item={item} checked={selected.has(item.id)} onToggle={() => toggle(item.id)} downloadEnabled={ONLINE_GAME_DOWNLOAD_ENABLED}/>)}
                                </ul>
                              </div>
                            ))}
                            {tournamentGames.pageCount > tournamentGames.page && (
                              <button type="button" className="secondary-button" data-online-event-more disabled={gamesBusy} onClick={() => {
                                void (async () => {
                                  setGamesBusy(true);
                                  try {
                                    const more = await source.listTournamentGames!(tournament.id, tournamentGames.page + 1);
                                    setTournamentGames({ ...more, items: [...tournamentGames.items, ...more.items] });
                                  } catch (failure) {
                                    setError(failure instanceof Error ? failure.message : String(failure));
                                  } finally {
                                    setGamesBusy(false);
                                  }
                                })();
                              }}>加载更多（还有 {tournamentGames.pageCount - tournamentGames.page} {tournamentGames.pageUnit || "页"}）</button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {tournamentPage.page < tournamentPage.pageCount && (
                <button type="button" className="secondary-button" data-online-events-more disabled={eventsBusy} onClick={() => { void loadTournaments(source, tournamentPage.page + 1); }}>
                  {eventsBusy ? <Loader2 className="online-spin" size={14}/> : null}加载更多赛事（第 {tournamentPage.page + 1} / {tournamentPage.pageCount} 页）
                </button>
              )}
            </div>
          )}
        </section>
      )}
      </>}
      </>}
    </div>
  );
}


/**
 * 来源站的入口列表（见 external-links.ts）。
 *
 * 用户 09-26：「两个搜索占空间，一个就够了」——这里**原来还有一个自己的检索框**（填棋手名
 * 或赛事名，点「按棋手检索 / 按赛事检索」跳过去），现在整块删掉：检索只有上面那一个输入框，
 * 它同时查棋手与赛事，结果里标明是谁、哪一届、来自哪个站；查不到时由那条结果自己给出
 * 「到来源站检索」的链接。这里只留入口列表与署名行。
 */
function ExternalLinksPanel({ mode = "always", expanded = true, onToggle }: {
  mode?: "collapsible" | "always";
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const open = mode === "always" || expanded;
  return (
    <div className="online-external">
      {mode === "collapsible" && (
        <button type="button" className={`online-external-toggle ${open ? "open" : ""}`} aria-expanded={open} data-online-external-toggle onClick={onToggle}>
          <ExternalLink size={15}/>跳转到来源网站
          <ChevronDown size={14}/>
        </button>
      )}
      {open && (
        <div className="online-external-body">
          <div className="online-external-quick">
            {EXTERNAL_ENTRY_LINKS.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}<ExternalLink size={12}/></a>
            ))}
          </div>
          {/* 信息来源把两个站点都写上（用户 09-19），但不展开讲条款。 */}
          <p className="online-external-credit">
            信息来源：
            {EXTERNAL_SOURCES.map((entry, index) => (
              <span key={entry.id}>
                {index > 0 && " · "}
                <a href={entry.origin} target="_blank" rel="noreferrer" title={entry.credit}>{entry.label}</a>
              </span>
            ))}
            <small>棋谱版权归原作者所有，仅供个人打谱研究。</small>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 在线棋谱的**唯一**检索框（用户 09-26：「两个搜索占空间，一个就够了；来源合并，
 * 搜到后显示是哪个来源的哪个东西」）。
 *
 * 一个输入框同时查两类东西——棋手与赛事；结果一律带着「这是谁、哪一届、来自哪个站」，
 * 点某一条才在浏览器打开来源站那一页。原来「跳转到来源网站」那块里还有一个自己的检索框，
 * 已删掉，只留入口列表。
 *
 * 数据是**打进包里**的自有目录（`record-index.ts`：能按棋手查的站都不允许我们把它的库内容
 * 抓回来列给用户，所以只能自己整理一份）。因此打开面板、检索、比对都不向任何第三方发请求，
 * 网页版也不会有「目录没取到所以搜不了」这种情况——上一版把目录放成运行时去 fetch 的文件，
 * 那个文件在旧预缓存或没部署到的环境里取不到，检索就永远出不来结果。
 * 目录里没有时如实说没有，并给一条到来源站检索的入口——不猜、不替他编对局。
 */
function PlayerIndexSearch() {
  const [text, setText] = useState(() => { try { return localStorage.getItem(PLAYER_QUERY_KEY) || ""; } catch { return ""; } });
  const [result, setResult] = useState<{ players: IndexPlayerEntry[]; events: IndexEventEntry[] } | null>(null);
  const [expanded, setExpanded] = useState("");
  /**
   * 目录分片（09-28 起一千多局，不再静态挂在启动主包上，见 record-index.ts 的 loadRecordIndex）。
   * null = 还在加载；这一面在加载完成前不给「目录共 N 位」那种假数字。
   */
  const [index, setIndex] = useState<RecordIndex | null>(null);
  useEffect(() => {
    let alive = true;
    loadRecordIndex().then((value) => { if (alive) setIndex(value); }).catch(() => { /* 分片加载失败：下面按「目录里还没有」如实处理 */ });
    return () => { alive = false; };
  }, []);

  const runSearch = async () => {
    const wanted = text.trim();
    try { localStorage.setItem(PLAYER_QUERY_KEY, wanted); } catch { /* 记不住也不影响这次检索 */ }
    if (!wanted) { setResult(null); setExpanded(""); return; }
    await loadPlayerAliases();
    const found = searchRecordIndex(index ?? await loadRecordIndex(), wanted);
    setResult(found);
    setExpanded(found.players.length === 1 ? found.players[0].name : found.players.length === 0 && found.events.length === 1 ? `赛事:${found.events[0].name}` : "");
  };

  const translated = text.trim() ? resolvePlayerQuery(text).query : "";
  const aliasHint = translated && translated !== text.trim().toLowerCase() ? `${text.trim()} → ${translated}` : "";
  const players = result?.players || [];
  const events = result?.events || [];
  const empty = Boolean(result) && players.length === 0 && events.length === 0;
  const anyGames = players.some((entry) => indexGames(entry).length > 0) || events.length > 0;

  return (
    <div className="online-player-search" data-online-player-search aria-label="棋手与赛事检索">
      <div className="online-filters">
        <label className="online-field">棋手或赛事名
          <input
            value={text}
            data-online-player-query
            placeholder="棋手名或赛事名：中文名 / 拼音 / 英文名都行"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void runSearch(); } }}
          />
          {aliasHint && <small className="online-hint">将按「{aliasHint}」比对目录</small>}
        </label>
        <button type="button" className="primary-button" data-online-player-go onClick={() => { void runSearch(); }}>
          <Search size={16}/>检索
        </button>
      </div>
      <p className="helper" data-online-player-status>
        {index
          ? <>目录共 {index.players.length.toLocaleString("zh-CN")} 位棋手 · {index.events.length} 届赛事 · {index.gameCount.toLocaleString("zh-CN")} 局 · 整理于 {index.updated}；结果先列在下面，点某一条才打开网页。</>
          : "目录加载中…（第一次打开要读一个本地分片，离线也在）"}
      </p>

      {empty && (
        <p className="online-player-miss" role="status" data-online-player-miss>
          <AlertTriangle size={14}/> 目录里还没有「{text.trim()}」。
          <a href={buildExternalPlayerSearchUrl(resolvePlayerQuery(text).query)} target="_blank" rel="noreferrer" data-online-player-fallback>到来源站检索这个词<ExternalLink size={12}/></a>
        </p>
      )}

      {result && players.length > 0 && !anyGames && (
        // 搜到了人、但目录没记他的单局：别让人对着一张空卡发呆，直接把来源站入口递到手边。
        <p className="online-player-miss" role="status" data-online-player-nogames>
          <AlertTriangle size={14}/> 目录里还没记{players.length > 1 ? "这几位" : `「${players[0].name}」`}的单局棋谱。
          <a href={buildExternalPlayerSearchUrl((players[0].latin[0] || players[0].name).toLowerCase())} target="_blank" rel="noreferrer" data-online-player-empty-link>到来源站看{players[0].name}的全部棋谱<ExternalLink size={12}/></a>
        </p>
      )}

      {result && (players.length > 0 || events.length > 0) && (
        <ul className="online-player-list" data-online-player-results>
          {players.map((entry) => {
            const games = indexGames(entry);
            const open = expanded === entry.name;
            return (
              <li key={`p-${entry.name}`} className={open ? "online-player open" : "online-player"} data-online-player={entry.name}>
                <button type="button" className="online-player-head" aria-expanded={open} onClick={() => setExpanded(open ? "" : entry.name)}>
                  <span className="online-player-main">
                    <b>{entry.name}<span className="online-player-kind">棋手</span></b>
                    <small>{entry.latin.join(" / ") || "目录里没有其它写法"}</small>
                  </span>
                  <small className="online-player-count">{games.length ? `${games.length} 局` : "只有入口"}</small>
                  {open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
                </button>
                {open && (
                  <div className="online-player-games" data-online-player-games={entry.name}>
                    {games.length > 0 && <IndexGamesByEvent games={games} testId={entry.name}/>}
                    {games.length === 0 && <p className="helper">目录里没有他的单局记录，只有下面的入口。</p>}
                    {entry.links.map((link) => (
                      <a key={link.url} className="online-player-link" href={link.url} target="_blank" rel="noreferrer" data-online-player-link={link.label}>{link.label}<ExternalLink size={12}/></a>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
          {events.map((event) => {
            const key = `赛事:${event.name}`;
            const open = expanded === key;
            return (
              <li key={key} className={open ? "online-player open" : "online-player"} data-online-event-entry={event.name}>
                <button type="button" className="online-player-head" aria-expanded={open} onClick={() => setExpanded(open ? "" : key)}>
                  <span className="online-player-main">
                    <b>{event.name}<span className="online-player-kind">赛事</span></b>
                    <small>{[event.year, event.source].filter(Boolean).join(" · ")}</small>
                  </span>
                  <small className="online-player-count">{event.games.length} 局</small>
                  {open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
                </button>
                {open && (
                  <div className="online-player-games" data-online-player-games={event.name}>
                    <IndexGameRows games={event.games} testId={`event-${event.name}`}/>
                    <a className="online-player-link" href="https://www.ljrenju.com/news/index.htm" target="_blank" rel="noreferrer" data-online-player-link="在连珠史记里看更多赛事">在连珠史记里看更多赛事<ExternalLink size={12}/></a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * 棋手卡片里的对局**按届分组**（09-28：目录从 1 届扩到 18 届世锦赛后，一个人平铺五六十行
 * 根本读不动）。默认只展开最近那一届，其余点届名展开。
 */
function IndexGamesByEvent({ games, testId }: { games: IndexGameEntry[]; testId: string }) {
  const groups: Array<{ key: string; event: string; year: string; games: IndexGameEntry[] }> = [];
  const byKey = new Map<string, number>();
  for (const game of games) {
    const key = `${game.event}|${game.year}`;
    const at = byKey.get(key);
    if (at === undefined) { byKey.set(key, groups.length); groups.push({ key, event: game.event || "未标注赛事", year: game.year, games: [game] }); }
    else groups[at].games.push(game);
  }
  groups.sort((a, b) => Number(b.year) - Number(a.year) || a.event.localeCompare(b.event, "zh"));
  const [openEvent, setOpenEvent] = useState(groups[0]?.key ?? "");
  return <div className="online-player-events">
    {groups.map((group) => <div key={group.key} className="online-player-event">
      <button type="button" className="online-player-event-head" aria-expanded={openEvent === group.key} onClick={() => setOpenEvent(openEvent === group.key ? "" : group.key)}>
        <b>{group.event}</b><small>{group.year} · {group.games.length} 局</small>
        {openEvent === group.key ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
      </button>
      {openEvent === group.key && <IndexGameRows games={group.games} testId={`${testId}/${group.event}`}/>}
    </div>)}
  </div>;
}

/** 目录里的一条对局＝整行外链，行里写清是谁对谁、哪一届、哪一轮、来自哪个站。 */
function IndexGameRows({ games, testId }: { games: IndexGameEntry[]; testId: string }) {
  return (
    <ul className="online-game-list">
      {games.map((game, position) => (
        <li key={`${game.url}-${position}`} className="online-game-row" data-online-index-game={`${testId}#${position}`}>
          <a className="online-game-open" href={game.url} target="_blank" rel="noreferrer" aria-label={`在浏览器中打开 ${game.black} 对 ${game.white}`}>
            <span className="online-game-main">
              <b>{game.black} <span className="online-vs">对</span> {game.white}</b>
              <small>{[game.event, game.year, game.result, game.note].filter(Boolean).join(" · ") || "目录未标注赛事与年份"}</small>
              <small className="online-game-src">来源：{game.source}</small>
            </span>
            <span className="online-game-action"><ExternalLink size={13}/>打开网页</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * 棋谱列表里的一局。用户 09-26：**点了某一条才跳转**——整行就是一个链接，
 * 在浏览器里打开这一局在来源站的网页。原来那个「在线查看」（把这一局取回本应用里
 * 看局面）按同一句话撤掉了：在线面不再把第三方内容装进应用。
 */
function OnlineGameRow({ item, checked, onToggle, downloadEnabled }: {
  item: OnlineGameSummary; checked: boolean; onToggle: () => void; downloadEnabled: boolean;
}) {
  return (
    <li className={checked ? "online-game-row selected" : "online-game-row"} data-online-game={item.id}>
      {downloadEnabled && <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`选择 ${item.black} 对 ${item.white}`}/>}
      <a
        className="online-game-open"
        href={item.url}
        target="_blank"
        rel="noreferrer"
        data-online-open={item.id}
        aria-label={`在浏览器中打开 ${item.black} 对 ${item.white} 的网页`}
      >
        <span className="online-game-main">
          <b>{item.black} <span className="online-vs">对</span> {item.white}</b>
          <small>{item.date || "日期未知"} · {item.result || "结果未标"} · {item.moveCount ? `${item.moveCount} 手` : "手数以该站页面为准"}</small>
        </span>
        <span className="online-game-action"><ExternalLink size={13}/>打开网页</span>
      </a>
    </li>
  );
}
