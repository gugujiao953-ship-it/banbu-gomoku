import { nextPlayerAt } from "../../game";
import { openingStageActor, type OpeningSession } from "../../opening-rules";
import type { GameDocument, OpeningRule, Player, RecordNode } from "../../types";

/**
 * 人机对弈的**可恢复会话**（用户 09-28：「如果对弈时候退出了，下次打开人机对战按钮时候，
 * 会弹窗是否回到上次对局，就是可以保存状态」）。
 *
 * 存什么：整份对局棋谱 + 当前手 + 对局状态（含开局会话）+ 计时。
 * 为什么连棋谱一起存而不只存 id：对局中的棋谱默认**不进棋谱库**（用户同轮决定：
 * 「用户如果不主动保存就不会进棋谱库」），所以它在库里根本没有落点；只存 id 的话，
 * 用户中途去新建一盘、清库、或换到别的谱，回来就什么都找不到了。
 *
 * ⚠ 命门在 `duelAwaitingSide`（用户 09-28 自己点出的风险：「如果在人机下的时候退出了，
 * 再进去，会不会导致人机这一手不落子」）。会——因为 AI 的应手**不是**由某个
 * 「轮到 AI 就把棋下了」的监视 effect 驱动的，而是人做完动作后顺手调度一次
 * （`App.tsx` 里 play / 开局决策 / 悔棋都调 `scheduleAiOpening`）。进程一退出，
 * 那次调度就没了，恢复回来的局面正等着 AI，于是棋盘僵死。
 * 所以恢复方必须自己补这一次调度，并且只在「确实等着 AI」时补。
 */

export const DUEL_SESSION_KEY = "banbu-duel-session-v1";
/** 快照版本：字段形状变了就 +1，旧版快照直接丢弃（不猜怎么迁移）。 */
const SNAPSHOT_VERSION = 1;
/** 棋谱节点上限与序列化上限：超出就不存（宁可不给恢复，也不要把 localStorage 撑爆）。 */
const MAX_NODES = 4000;
const MAX_BYTES = 4 * 1024 * 1024;

/** 难度档名（与 App 里 AiStrength 同一组字面量；结构一致所以两边可以直接互相赋值）。 */
export type DuelStrength = "初级" | "中级" | "高级" | "大师" | "自由";

export interface DuelSessionGame {
  /**
   * 一局一个 token（战绩去重用）：终局→刷新→恢复→再结算 这条链不能把同一局记两次。
   * 可选且**不升快照版本号**——老存档没这个字段照样能恢复，只是那一局的战绩可能记重一次。
   */
  id?: string;
  humanPlayer: Player;
  aiPlayer: Player;
  strength: DuelStrength;
  forbiddenEnabled: boolean;
  /** 人类包干时限（0 = 不限）；AI 不占钟（与 App 里的 AiGameState 同一口径）。 */
  timeLimitMs: number;
  readOffMs: number;
  thinkTimeMs: number;
  thinkDepth: number;
  unlimitedThinking: boolean;
  outcome: "won" | "lost" | "draw" | null;
  opening: OpeningSession;
  /** 引擎档（与 App 里的 AiEngineChoice 同一组取值；不认识的一律回落 strong）。 */
  engineChoice: "light" | "strong" | "tuned" | "kata" | "ikatago";
  /** 本局开局规则（对局状态里的 opening.rule 也有一份，这里冗余存一份便于校验）。 */
  rule: OpeningRule;
  /**
   * 「自定义开局」三件套（用户 2026-10-13）。与上面的 `id` 同一条先例：**可选、不升版本号**，
   * 老存档读出来是 undefined（＝不是自定义局），恢复语义靠 `Boolean()` / `number()` 收敛。
   * `customSetupCount` 是摆子阶段的子数，也就是正式对局的边界（悔棋不许退到它以下）。
   */
  customOpening?: boolean;
  customStarted?: boolean;
  customSetupCount?: number;
}

export interface DuelSessionSnapshot {
  version: number;
  savedAt: string;
  document: GameDocument;
  currentId: string;
  game: DuelSessionGame;
  clock: { humanElapsedMs: number; moveElapsedMs: number; expired: boolean; readOffExpired: boolean };
}

/** 恢复后局面在等谁。`ai-move` / `ai-opening` 都必须由恢复方补一次调度。 */
export type DuelAwaiting = "none" | "ai-move" | "ai-opening" | "human";

const isPlayer = (value: unknown): value is Player => value === "black" || value === "white";
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
const STAGE_KINDS = new Set(["normal", "place", "swap", "taraguchi-fifth", "choose-fifth-count", "offer-fifths", "choose-fifth", "batch", "swap2-choice", "swap2-pick"]);
const OPENING_RULES = new Set(["free", "swap1", "swap2", "swap3", "five-two", "five-n", "yamaguchi", "soosyrv-8", "taraguchi-10", "tarannikov"]);
const ENGINE_CHOICES = new Set(["light", "strong", "tuned", "kata", "ikatago"]);
/** 难度档名白名单（与 App 里 AI_STRENGTH_OPTIONS 的 title 同步）：认不出来就回落「大师」，
 *  不让一条被改过的存档在信息格里显示乱码难度。 */
const STRENGTHS = new Set(["初级", "中级", "高级", "大师", "自由"]);

/**
 * 局面在等谁：
 *  - 已终局 → `none`（恢复后直接给终局面板，不该再调度任何一手）；
 *  - 开局阶段 → 看该阶段的 actor/chooser 是谁（`openingStageActor`，与 `scheduleAiOpening` 同一处口径）；
 *  - 正常阶段 → 看行棋方是不是 AI。
 */
/**
 * 局面在等谁：
 *  - 已终局 → `none`（恢复后直接给终局面板，不该再调度任何一手）；
 *  - **自定义开局还在摆子阶段** → `human`（摆子阶段 AI 一律不许动，哪怕轮到它的颜色 ——
 *    摆的黑白是轮流落的，颜色随时可能"轮到 AI"，这里若按行棋方判就会在恢复时偷落一手）；
 *  - 开局阶段 → 看该阶段的 actor/chooser 是谁（`openingStageActor`，与 `scheduleAiOpening` 同一处口径）；
 *  - 正常阶段 → 看行棋方是不是 AI。
 */
export const duelAwaitingSide = (game: Pick<DuelSessionGame, "outcome" | "aiPlayer" | "opening" | "customOpening" | "customStarted">, document: GameDocument, currentId: string): DuelAwaiting => {
  if (game.outcome) return "none";
  if (game.customOpening && !game.customStarted) return "human";
  const actor = openingStageActor(game.opening.stage);
  if (actor) return actor === "ai" ? "ai-opening" : "human";
  return nextPlayerAt(document, currentId) === game.aiPlayer ? "ai-move" : "human";
};

/** 弹窗上要说清楚的三件事：第几手、谁走、什么时候退的。 */
export const duelSessionSummary = (snapshot: DuelSessionSnapshot): { turn: number; awaiting: DuelAwaiting; finished: boolean } => {
  let turn = 0;
  let cursor: string | null = snapshot.currentId;
  let guard = 0;
  while (cursor && guard < MAX_NODES) {
    const node: RecordNode | undefined = cursor === null ? undefined : snapshot.document.nodes[cursor];
    if (!node) break;
    if (node.move || node.passPlayer) turn += 1;
    cursor = node.parentId;
    guard += 1;
  }
  return { turn, awaiting: duelAwaitingSide(snapshot.game, snapshot.document, snapshot.currentId), finished: Boolean(snapshot.game.outcome) };
};

/** 写入（返回是否真的写进去了）。超上限或存储不可用时静默失败——恢复是便利功能，不该反过来弄坏对局。 */
export const saveDuelSession = (snapshot: Omit<DuelSessionSnapshot, "version"> & { version?: number }): boolean => {
  try {
    const body = JSON.stringify({ ...snapshot, version: SNAPSHOT_VERSION });
    if (body.length > MAX_BYTES) return false;
    localStorage.setItem(DUEL_SESSION_KEY, body);
    return true;
  } catch {
    return false;
  }
};

/** 整条快照的校验：任何一处不像样就整条作废（宁可不给恢复，也不恢复出一个坏局面）。 */
const readSnapshot = (value: unknown): DuelSessionSnapshot | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DuelSessionSnapshot>;
  if (raw.version !== SNAPSHOT_VERSION) return null;
  const document = raw.document;
  const currentId = raw.currentId;
  if (!document || typeof document !== "object" || typeof document.rootId !== "string" || !document.nodes || typeof document.nodes !== "object") return null;
  const ids = Object.keys(document.nodes);
  if (!ids.length || ids.length > MAX_NODES || !document.nodes[document.rootId]) return null;
  if (typeof currentId !== "string" || !document.nodes[currentId]) return null;
  const game = raw.game as Partial<DuelSessionGame> | undefined;
  if (!game || !isPlayer(game.humanPlayer) || !isPlayer(game.aiPlayer) || game.humanPlayer === game.aiPlayer) return null;
  if (typeof game.strength !== "string" || !STRENGTHS.has(game.strength)) return null;
  if (game.outcome !== null && game.outcome !== "won" && game.outcome !== "lost" && game.outcome !== "draw") return null;
  if (typeof game.engineChoice !== "string" || !game.engineChoice) return null;
  const opening = game.opening;
  if (!opening || typeof opening !== "object" || !OPENING_RULES.has(String(opening.rule)) || !isPlayer(opening.humanPlayer)) return null;
  if (opening.opener !== "human" && opening.opener !== "ai") return null;
  if (!opening.stage || typeof opening.stage !== "object" || !STAGE_KINDS.has(String((opening.stage as { kind?: string }).kind))) return null;
  if (!Array.isArray(opening.candidates)) return null;
  const clock = raw.clock;
  if (!clock || typeof clock !== "object") return null;
  return {
    version: SNAPSHOT_VERSION,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    document,
    currentId,
    game: {
      id: typeof game.id === "string" && game.id ? game.id : undefined,
      humanPlayer: game.humanPlayer, aiPlayer: game.aiPlayer, strength: (STRENGTHS.has(game.strength) ? game.strength : "大师") as DuelStrength,
      forbiddenEnabled: Boolean(game.forbiddenEnabled),
      timeLimitMs: number(game.timeLimitMs), readOffMs: number(game.readOffMs),
      thinkTimeMs: number(game.thinkTimeMs), thinkDepth: number(game.thinkDepth),
      unlimitedThinking: Boolean(game.unlimitedThinking),
      outcome: game.outcome ?? null,
      opening: { rule: opening.rule, n: number(opening.n), humanPlayer: opening.humanPlayer, opener: opening.opener, stage: opening.stage, candidates: opening.candidates },
      engineChoice: (ENGINE_CHOICES.has(game.engineChoice) ? game.engineChoice : "strong") as DuelSessionGame["engineChoice"],
      rule: opening.rule,
      // 自定义开局三件套：白名单重建必须在这里抄一遍，否则"存进去、恢复出来就丢了"
      // （这个函数是逐字段重建，不是透传）。老快照没这三个键 → false / 0，行为与改动前一致。
      customOpening: Boolean(game.customOpening),
      customStarted: Boolean(game.customStarted),
      customSetupCount: number(game.customSetupCount),
    },
    clock: {
      humanElapsedMs: number(clock.humanElapsedMs), moveElapsedMs: number(clock.moveElapsedMs),
      expired: Boolean(clock.expired), readOffExpired: Boolean(clock.readOffExpired),
    },
  };
};

/** 读出快照；坏数据一律清空并返回 null。 */
export const loadDuelSession = (): DuelSessionSnapshot | null => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(DUEL_SESSION_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { clearDuelSession(); return null; }
  const snapshot = readSnapshot(parsed);
  if (!snapshot) clearDuelSession();
  return snapshot;
};

export const clearDuelSession = () => {
  try { localStorage.removeItem(DUEL_SESSION_KEY); } catch { /* 存储不可用就当没有 */ }
};
