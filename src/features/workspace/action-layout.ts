import type { AppMode } from "../../app-shell-types";
import { loadEnhancementSettings, type EnhancementSettings } from "../../enhancement-settings";

export const ACTION_LAYOUT_KEY = "banbu-action-layout-v1";
export const LAYOUT_MODES: AppMode[] = ["record", "review", "puzzle"];
export const MODE_LABELS = { record: "打谱", review: "读谱", puzzle: "做题" };
export const ACTION_LABELS = {
  comment: "注释框", new: "新建", save: "保存", delete: "删除", color: "落子颜色",
  navStart: "起点", navPrev: "上一手", navNext: "下一手", navEnd: "终点",
  navUndo: "撤销", navRedo: "重做", navDiscard: "放弃", playback: "播放",
  analysis: "分析", analysisToggle: "分析开关", annotation: "标注", notes: "编辑", tree: "分支树", view: "更多", play: "应战", setup: "摆棋", vcf: "VCF", rule: "禁手规则",
} as const;
export type ActionId = keyof typeof ACTION_LABELS;
// 三个功能区：常驻操作区（上）、走棋功能区（中，导航按钮逐个独立可移动）、
// 首行功能区（棋盘正下方）。LayoutZone 值保持持久化稳定。
export type LayoutZone = "top" | "moves" | "bottom";
export const ZONES: LayoutZone[] = ["top", "moves", "bottom"];
export const ZONE_LABELS = { top: "常驻操作区", moves: "走棋功能区", bottom: "首行功能区" };
// 导航动作的模式适用性：撤销/重做/放弃只在打谱出现，播放只在读谱出现。
export const MODE_GATED_ACTIONS: ActionId[] = ["navUndo", "navRedo", "navDiscard", "playback"];
export const actionVisibleInMode = (id: ActionId, mode: AppMode): boolean => {
  if (id === "playback") return mode === "review";
  if (id === "navUndo" || id === "navRedo" || id === "navDiscard") return mode === "record";
  return true;
};
export type ActionSize = "compact" | "standard" | "large";
export interface ModeLayout {
  top: ActionId[];
  moves: ActionId[];
  bottom: ActionId[];
  hidden: ActionId[];
  size: ActionSize;
  iconsOnly: boolean;
  movesLabels: boolean;
}
// 存储版本：v1/v2 是旧存档（做题默认当天改版两次）；v3 起做题默认稳定为「只两行」。
// 载入 v1/v2 存档时做题模式重置为新默认，打谱/读谱保留用户既有排布——否则老存档里的
// 做题排布会残留标注/编辑/分支树与整条常驻行。
export const ACTION_LAYOUT_VERSION = 3;
export interface ActionLayouts { version: number; modes: Record<AppMode, ModeLayout> }

export function defaultModeLayout(mode: AppMode): ModeLayout {
  const nav = mode === "review"
    ? (["navStart", "navPrev", "navNext", "navEnd", "playback"] as ActionId[])
    : (["navStart", "navPrev", "navNext", "navEnd", "navUndo", "navRedo", "navDiscard"] as ActionId[]);
  return {
    // 打谱/读谱（用户 09-08 钦定）：常驻行 = 注释 + 保存 + 新建 + 删除 + 禁手规则 +
    // 黑白切换；走棋功能区 = 起点/上一手/下一手/终点（+打谱的撤销/重做/放弃、读谱的
    // 播放）；其余在首行。简略模板只是这套布局去掉文字，不搬按钮。
    //
    // 做题（用户 2026-09-10 二次钦定 + 同日复选补正 + 09-10 反馈）：**只两行**——首行
    // 功能区 = 分析/应战·摆棋/VCF/禁手规则/更多（黑白切换已移出首行，固定在状态条
    // 右侧=首行之上；应战与摆棋是同一枚按钮的两种状态，按当前是否在摆棋互斥显示，
    // 见 App 的 renderWorkspaceAction，所以一行是 5 格、392px 上不折行）。常驻走棋区 =
    // 上一题/选题/下一题/悔棋/重启（固定渲染、不进布局池；摆棋时**保持五键不变**，摆棋
    // 的局面导航仍在弹出的面板里）。做题不需要标注/编辑/分支树，故不进池子；状态文字
    // 与黑白切换渲染在首行功能区之上。
    top: mode === "puzzle" ? [] : ["comment", "save", "new", "delete", "rule", "color"],
    moves: mode === "puzzle" ? [] : nav,
    bottom: mode === "puzzle" ? ["analysis", "play", "setup", "vcf", "rule", "view"] : ["analysis", "annotation", "notes", "tree", "view"],
    hidden: [], size: "standard", iconsOnly: false, movesLabels: true,
  };
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function normalizeModeLayout(value: unknown, mode: AppMode): ModeLayout {
  const fallback = defaultModeLayout(mode);
  const input = object(value);
  const allowed = new Set<ActionId>([...fallback.top, ...fallback.moves, ...fallback.bottom]);
  const seen = new Set<ActionId>();
  const clean = (ids: unknown): ActionId[] => (Array.isArray(ids) ? ids : []).filter((id): id is ActionId => {
    if (!allowed.has(id as ActionId) || seen.has(id as ActionId)) return false;
    seen.add(id as ActionId);
    return true;
  });
  const zones: Record<LayoutZone, ActionId[]> = { top: clean(input.top), moves: clean(input.moves), bottom: clean(input.bottom) };
  // Legacy two-zone saves: a former "moves" action (no longer exists) means the
  // row was there — seed the new zone with the default navigation set instead.
  const legacyHadMovesRow = (Array.isArray(input.top) && input.top.includes("moves")) || (Array.isArray(input.bottom) && input.bottom.includes("moves"));
  if (legacyHadMovesRow && !Array.isArray(input.moves)) for (const id of fallback.moves) if (!seen.has(id)) { zones.moves.push(id); seen.add(id); }
  // Missing/new actions return to their default region without disturbing saved order.
  for (const zone of ZONES) for (const id of fallback[zone]) {
    if (!seen.has(id)) { zones[zone].push(id); seen.add(id); }
  }
  const hidden = [...new Set(Array.isArray(input.hidden) ? input.hidden : [])].filter((id): id is ActionId => allowed.has(id as ActionId));
  return { top: zones.top, moves: zones.moves, bottom: zones.bottom, hidden, size: input.size === "compact" || input.size === "large" ? input.size : "standard", iconsOnly: input.iconsOnly === true, movesLabels: input.movesLabels !== false };
}

export function visibleModeLayout(layout: ModeLayout): ModeLayout {
  const visible = (ids: ActionId[]) => ids.filter((id) => !layout.hidden.includes(id));
  return { ...layout, top: visible(layout.top), moves: visible(layout.moves), bottom: visible(layout.bottom) };
}

export function normalizeActionLayouts(value: unknown, legacy?: Pick<EnhancementSettings, "dockMergeMoves" | "movesTextDisplay">): ActionLayouts {
  const input = object(value);
  const modes = object(input.modes);
  const result = { version: ACTION_LAYOUT_VERSION, modes: {} } as ActionLayouts;
  for (const mode of LAYOUT_MODES) {
    // v3 存档全模式读取；v1/v2 存档只读打谱/读谱——做题默认布局已改版，直接给新默认。
    const savedVersion = Number(input.version);
    const saved = savedVersion === ACTION_LAYOUT_VERSION || ((savedVersion === 1 || savedVersion === 2) && mode !== "puzzle") ? modes[mode] : null;
    result.modes[mode] = normalizeModeLayout(saved, mode);
    if (savedVersion !== 1 && savedVersion !== 2 && savedVersion !== ACTION_LAYOUT_VERSION && legacy && mode !== "puzzle") {
      result.modes[mode].movesLabels = legacy.movesTextDisplay;
    }
  }
  return result;
}

/** A zone counts as hidden when every one of its buttons is hidden; the page
 * then collapses that row naturally (visibleModeLayout filters them out). */
export function isZoneHidden(layout: ModeLayout, zone: LayoutZone): boolean {
  return layout[zone].length > 0 && layout[zone].every((id) => layout.hidden.includes(id));
}

export function setZoneHidden(layout: ModeLayout, zone: LayoutZone, hidden: boolean): ModeLayout {
  const next = new Set(layout.hidden);
  for (const id of layout[zone]) { if (hidden) next.add(id); else next.delete(id); }
  return { ...layout, hidden: [...next] };
}

/** Preset templates offered in the layout editor. The compact preset drops
 * button text (icons only) AND hides the secondary rows by default — 用户
 * 2026-09-11：简略模式=仅图标 + 打谱/读谱无首行功能区、无禁手规则；做题无首行
 * 功能区，只留走棋栏（摆棋按钮在走棋栏左侧，见 App 渲染）。 */
export function compactModeLayout(mode: AppMode): ModeLayout {
  if (mode === "puzzle") {
    // 做题简略：无首行功能区（bottom 全隐）、无常驻操作区；走棋栏左侧加摆棋（App 渲染）。
    const base = defaultModeLayout("puzzle");
    return { ...base, hidden: [...base.bottom], iconsOnly: true };
  }
  // 打谱/读谱简略：首行功能区整区隐藏（bottom 全隐）、常驻操作区去「禁手规则」。
  const base = defaultModeLayout(mode);
  return { ...base, hidden: [...base.bottom, "rule"], iconsOnly: true };
}

export function presetModeLayout(mode: AppMode, preset: "default" | "compact"): ModeLayout {
  return preset === "default" ? defaultModeLayout(mode) : compactModeLayout(mode);
}

export function moveAction(layout: ModeLayout, id: ActionId, zone: LayoutZone, index: number): ModeLayout {
  if (![...layout.top, ...layout.moves, ...layout.bottom].includes(id)) return layout;
  const next: ModeLayout = { ...layout, top: layout.top.filter((item) => item !== id), moves: layout.moves.filter((item) => item !== id), bottom: layout.bottom.filter((item) => item !== id) };
  next[zone].splice(Math.max(0, Math.min(next[zone].length, Number.isFinite(index) ? Math.trunc(index) : 0)), 0, id);
  return next;
}

export function loadActionLayouts(): ActionLayouts {
  const legacy = loadEnhancementSettings();
  try { return normalizeActionLayouts(JSON.parse(localStorage.getItem(ACTION_LAYOUT_KEY) || "null"), legacy); }
  catch { return normalizeActionLayouts(null, legacy); }
}

export function saveActionLayouts(value: ActionLayouts): boolean {
  try { localStorage.setItem(ACTION_LAYOUT_KEY, JSON.stringify(normalizeActionLayouts(value))); return true; }
  catch { return false; }
}
