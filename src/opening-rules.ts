import { evaluateRenjuMove } from "./game";
import type { Cell, OpeningRule, Player, Position } from "./types";

export type OpeningActor = "human" | "ai";
export type OpeningStage =
  | { kind: "normal" }
  | { kind: "place"; moveNumber: number; player: Player; actor: OpeningActor; radius: number | null }
  | { kind: "swap"; afterMove: number; chooser: OpeningActor; taraguchiChoice?: boolean }
  | { kind: "offer-fifths"; actor: OpeningActor; count: number }
  | { kind: "choose-fifth"; chooser: OpeningActor };

export interface OpeningSession {
  rule: OpeningRule;
  n: number;
  humanPlayer: Player;
  opener: OpeningActor;
  stage: OpeningStage;
  candidates: Position[];
}

export const openingRuleName = (rule: OpeningRule, n = 2) => ({
  free: "自由开局",
  "five-two": "五手两打",
  "five-n": `五手 ${n} 打`,
  "taraguchi-10": "塔拉山口-10",
  tarannikov: "塔拉 · 五次交换",
}[rule]);

export const actorForColor = (session: Pick<OpeningSession, "humanPlayer">, player: Player): OpeningActor => session.humanPlayer === player ? "human" : "ai";
const otherActor = (actor: OpeningActor): OpeningActor => actor === "human" ? "ai" : "human";
const place = (session: OpeningSession, moveNumber: number, radius: number | null): OpeningStage => ({
  kind: "place", moveNumber, player: moveNumber % 2 ? "black" : "white", actor: actorForColor(session, moveNumber % 2 ? "black" : "white"), radius,
});

export const createOpeningSession = (rule: OpeningRule, n: number, humanPlayer: Player): OpeningSession => {
  const normalizedN = rule === "five-two" ? 2 : rule === "taraguchi-10" ? 10 : Math.max(3, Math.min(10, Math.round(n || 3)));
  const opener: OpeningActor = humanPlayer === "black" ? "human" : "ai";
  const base: OpeningSession = { rule, n: normalizedN, humanPlayer, opener, stage: { kind: "normal" }, candidates: [] };
  if (rule === "free") return base;
  return { ...base, stage: { kind: "place", moveNumber: 1, player: "black", actor: opener, radius: 0 } };
};

export const completeOpeningPlacement = (session: OpeningSession): OpeningSession => {
  if (session.stage.kind !== "place") return session;
  const move = session.stage.moveNumber;
  if (session.rule === "five-two" || session.rule === "five-n") {
    if (move < 3) return { ...session, stage: { kind: "place", moveNumber: move + 1, player: move === 1 ? "white" : "black", actor: session.opener, radius: move } };
    if (move === 3) return { ...session, stage: { kind: "swap", afterMove: 3, chooser: otherActor(session.opener) } };
    if (move === 4) return { ...session, candidates: [], stage: { kind: "offer-fifths", actor: actorForColor(session, "black"), count: session.n } };
    if (move === 6) return { ...session, stage: { kind: "normal" } };
  }
  if (session.rule === "tarannikov") {
    if (move <= 5) return { ...session, stage: { kind: "swap", afterMove: move, chooser: otherActor(session.stage.actor) } };
    return { ...session, stage: { kind: "normal" } };
  }
  if (session.rule === "taraguchi-10") {
    if (move <= 3) return { ...session, stage: { kind: "swap", afterMove: move, chooser: otherActor(session.stage.actor) } };
    if (move === 4) return { ...session, stage: { kind: "swap", afterMove: 4, chooser: otherActor(session.stage.actor), taraguchiChoice: true } };
    if (move === 5) return { ...session, stage: { kind: "swap", afterMove: 5, chooser: otherActor(session.stage.actor) } };
    return { ...session, stage: { kind: "normal" } };
  }
  return { ...session, stage: { kind: "normal" } };
};

export const decideOpeningSwap = (session: OpeningSession, swap: boolean): OpeningSession => {
  if (session.stage.kind !== "swap") return session;
  const stage = session.stage;
  const updated = swap ? { ...session, humanPlayer: session.humanPlayer === "black" ? "white" as const : "black" as const } : session;
  if (stage.taraguchiChoice) {
    if (!swap) return { ...updated, candidates: [], stage: { kind: "offer-fifths", actor: actorForColor(updated, "black"), count: 10 } };
    return { ...updated, stage: place(updated, 5, 4) };
  }
  if (session.rule === "five-two" || session.rule === "five-n") return { ...updated, stage: place(updated, 4, null) };
  if (session.rule === "tarannikov") return { ...updated, stage: place(updated, stage.afterMove + 1, stage.afterMove < 5 ? stage.afterMove : null) };
  if (session.rule === "taraguchi-10") return { ...updated, stage: place(updated, stage.afterMove + 1, stage.afterMove < 4 ? stage.afterMove : null) };
  return updated;
};

const samePoint = (left: Position, right: Position) => left.row === right.row && left.col === right.col;
export const addFifthCandidate = (session: OpeningSession, position: Position): OpeningSession => {
  if (session.stage.kind !== "offer-fifths" || session.candidates.some((point) => samePoint(point, position))) return session;
  const candidates = [...session.candidates, position];
  return candidates.length >= session.stage.count
    ? { ...session, candidates, stage: { kind: "choose-fifth", chooser: actorForColor(session, "white") } }
    : { ...session, candidates };
};

export const completeFifthChoice = (session: OpeningSession): OpeningSession => ({ ...session, candidates: [], stage: place(session, 6, null) });

export const openingPositionAllowed = (boardSize: number, position: Position, stage: OpeningStage): boolean => {
  if (stage.kind !== "place" || stage.radius === null) return true;
  const center = Math.floor(boardSize / 2);
  return Math.max(Math.abs(position.row - center), Math.abs(position.col - center)) <= stage.radius;
};

const transformedPoint = (position: Position, transform: number, size: number): Position => {
  let row = position.row, col = position.col;
  if (transform >= 4) col = size - 1 - col;
  for (let turn = 0; turn < transform % 4; turn += 1) [row, col] = [col, size - 1 - row];
  return { row, col };
};

const shapeKey = (board: Cell[][], candidate: Position) => {
  const size = board.length;
  const variants = Array.from({ length: 8 }, (_, transform) => {
    const stones: string[] = [];
    for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) {
      const cell = board[row][col];
      if (!cell) continue;
      const point = transformedPoint({ row, col }, transform, size);
      stones.push(`${cell[0]}${point.row},${point.col}`);
    }
    const point = transformedPoint(candidate, transform, size);
    stones.push(`b${point.row},${point.col}`);
    return stones.sort().join("|");
  });
  return variants.sort()[0];
};

export const isDistinctFifthCandidate = (board: Cell[][], candidates: Position[], position: Position) => {
  const candidateKey = shapeKey(board, position);
  return !candidates.some((candidate) => shapeKey(board, candidate) === candidateKey);
};

export const suggestOpeningPlacement = (board: Cell[][], stage: OpeningStage): Position | null => {
  if (stage.kind !== "place") return null;
  const center = Math.floor(board.length / 2);
  const preferred: Position[] = [
    { row: center, col: center }, { row: center, col: center + 1 }, { row: center + 1, col: center },
    { row: center - 1, col: center }, { row: center, col: center - 1 }, { row: center + 1, col: center + 1 },
  ];
  const rest: Position[] = [];
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < board.length; col += 1) rest.push({ row, col });
  rest.sort((a, b) => Math.abs(a.row - center) + Math.abs(a.col - center) - Math.abs(b.row - center) - Math.abs(b.col - center));
  return [...preferred, ...rest].find((position, index, points) => points.findIndex((point) => samePoint(point, position)) === index && board[position.row]?.[position.col] === null && openingPositionAllowed(board.length, position, stage) && (stage.player !== "black" || evaluateRenjuMove(board, position).legal)) || null;
};

export const suggestFifthCandidates = (board: Cell[][], count: number): Position[] => {
  const center = (board.length - 1) / 2;
  const points: Position[] = [];
  for (let row = 0; row < board.length; row += 1) for (let col = 0; col < board.length; col += 1) {
    if (board[row][col] === null && evaluateRenjuMove(board, { row, col }).legal) points.push({ row, col });
  }
  points.sort((a, b) => Math.hypot(a.row - center, a.col - center) - Math.hypot(b.row - center, b.col - center) || a.row - b.row || a.col - b.col);
  const seen = new Set<string>();
  return points.filter((point) => { const key = shapeKey(board, point); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, count);
};

export const openingInstruction = (session: OpeningSession): string => {
  const stage = session.stage;
  if (stage.kind === "normal") return "开局阶段完成，进入正常对局";
  if (stage.kind === "place") return `第 ${stage.moveNumber} 手 · ${stage.player === "black" ? "黑" : "白"}方${stage.radius === null ? "可在棋盘任意空位落子" : stage.radius === 0 ? "必须落在天元" : `须落在中心 ${stage.radius * 2 + 1}×${stage.radius * 2 + 1} 区域`}`;
  if (stage.kind === "swap") return stage.taraguchiChoice ? "第4手后：交换并继续单点第5手，或不交换进入十打" : `第 ${stage.afterMove} 手后可选择是否交换黑白方`;
  if (stage.kind === "offer-fifths") return `请提供 ${stage.count} 个不同棋形的黑方第5手候选（${session.candidates.length}/${stage.count}）`;
  return `请从 ${session.candidates.length} 个候选中选择黑方第5手`;
};
