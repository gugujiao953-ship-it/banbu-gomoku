import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_LAYOUT_KEY, LAYOUT_MODES, MAX_SAVED_LAYOUTS, SAVED_LAYOUTS_KEY, compactModeLayout, defaultModeLayout, isZoneHidden, loadActionLayouts, loadSavedLayoutPresets, moveAction, normalizeActionLayouts, normalizeModeLayout, normalizeSavedLayoutPresets, presetModeLayout, saveActionLayouts, saveSavedLayoutPresets, savedLayoutSummary, setZoneHidden, visibleModeLayout } from "./action-layout";
import { withAnalysisToggle } from "./action-layout";

afterEach(() => vi.unstubAllGlobals());
describe("workspace action layouts", () => {
  it("preserves the optional analysis switch and its hidden position through storage normalization", () => {
    const layouts = withAnalysisToggle(normalizeActionLayouts(null), true);
    layouts.modes.record = moveAction(layouts.modes.record, "analysisToggle", "top", 0);
    layouts.modes.record.hidden = ["analysisToggle"];
    expect(normalizeActionLayouts(JSON.parse(JSON.stringify(layouts)))).toEqual(layouts);
    expect(withAnalysisToggle(layouts, true)).toBe(layouts);
    for (const mode of LAYOUT_MODES) {
      const all = [...layouts.modes[mode].top, ...layouts.modes[mode].moves, ...layouts.modes[mode].bottom];
      expect(all.filter((id) => id === "analysisToggle")).toHaveLength(1);
    }
  });
  it("removes hidden analysis switches when disabled and enables them visibly again", () => {
    const defaults = normalizeActionLayouts(null);
    expect(withAnalysisToggle(defaults, false)).toBe(defaults);
    const enabled = withAnalysisToggle(defaults, true);
    enabled.modes.review.hidden = ["analysisToggle"];
    const disabled = withAnalysisToggle(enabled, false);
    expect(disabled).toEqual(defaults);
    const reenabled = withAnalysisToggle(disabled, true);
    expect(visibleModeLayout(reenabled.modes.review).bottom.slice(0, 2)).toEqual(["analysisToggle", "analysis"]);
  });
  it.each(LAYOUT_MODES)("preserves hidden positions and enables new actions in %s", (mode) => {
    const defaults = defaultModeLayout(mode);
    const id = defaults.bottom[0];
    const layout = normalizeModeLayout({ top: [], bottom: [id], hidden: [id, id, "unknown", "toString", 123] }, mode);
    expect(layout.hidden).toEqual([id]);
    expect(layout.bottom[0]).toBe(id);
    expect(visibleModeLayout(layout).bottom).not.toContain(id);
    expect(visibleModeLayout(layout).top).toEqual(defaults.top);
    expect(visibleModeLayout({ ...layout, hidden: [] }).bottom[0]).toBe(id);
    expect(normalizeModeLayout(layout, mode)).toEqual(layout);
    expect(moveAction(layout, id, "top", 0).hidden).toEqual([id]);
  });
  it("accepts layouts before hiding existed and ignores malformed hidden data", () => {
    const { hidden: _hidden, ...old } = defaultModeLayout("record");
    expect(normalizeModeLayout(old, "record").hidden).toEqual([]);
    expect(normalizeModeLayout({ ...old, hidden: "save" }, "record").hidden).toEqual([]);
    expect(normalizeModeLayout({ hidden: ["rule", "save"] }, "record").hidden).toEqual(["rule", "save"]);
  });
  it.each(LAYOUT_MODES)("deduplicates, filters and restores missing actions in %s", (mode) => {
    const layout = normalizeModeLayout({ top: ["view", "view", "unknown", "play", 1], bottom: ["view", "annotation", "annotation", "toString"] }, mode);
    const defaults = defaultModeLayout(mode);
    expect([...layout.top, ...layout.bottom].sort()).toEqual([...defaults.top, ...defaults.bottom].sort());
    expect(layout.top[0]).toBe("view");
    expect(layout.bottom.includes("view")).toBe(false);
  });
  it("moves actions across the three zones without losing or duplicating entries", () => {
    const original = defaultModeLayout("record");
    const moved = moveAction(original, "navStart", "top", 0);
    expect(moved.top[0]).toBe("navStart");
    expect(moved.moves.includes("navStart")).toBe(false);
    expect(moveAction(moved, "navStart", "moves", original.moves.indexOf("navStart"))).toEqual(original);
    expect(moveAction(original, "play", "bottom", 0)).toBe(original); // play is not in the record layout
  });
  it("restores a fresh default only for the selected mode", () => {
    const layouts = normalizeActionLayouts(null);
    layouts.modes.record.top.reverse();
    layouts.modes.review.iconsOnly = true;
    layouts.modes.record = defaultModeLayout("record");
    expect(layouts.modes.record).toEqual(defaultModeLayout("record"));
    expect(layouts.modes.review.iconsOnly).toBe(true);
    expect(layouts.modes.puzzle).toEqual(defaultModeLayout("puzzle"));
  });
  it("seeds the moves zone when migrating a legacy layout that had a moves action", () => {
    const legacy = { version: 1, modes: { record: { top: ["comment", "new", "save", "color", "rule", "moves"], bottom: ["analysis", "annotation", "notes", "delete", "tree", "view"] }, review: null, puzzle: null } };
    const migrated = normalizeActionLayouts(legacy);
    expect((migrated.modes.record.top as string[]).includes("moves")).toBe(false);
    expect(migrated.modes.record.moves[0]).toBe("navStart");
    // 遗留 top 里的 save 保持原位，走棋区补入默认导航（不含已被占用的 save/new）。
    expect(migrated.modes.record.top).toContain("save");
    expect(migrated.modes.record.moves).toEqual(["navStart", "navPrev", "navNext", "navEnd", "navUndo", "navRedo", "navDiscard"]);
    expect(migrated.modes.puzzle).toEqual(defaultModeLayout("puzzle"));
  });
  it("honours the legacy moves-text preference when no stored layout exists", () => {
    const migrated = normalizeActionLayouts(null, { dockMergeMoves: false, movesTextDisplay: false });
    expect(migrated.modes.record.movesLabels).toBe(false);
    expect(migrated.modes.puzzle).toEqual(defaultModeLayout("puzzle"));
  });
  it.each([null, [], 4, "invalid", { version: 900 }, { version: 1, modes: [] }])("recovers malformed data %j", (value) => {
    expect(normalizeActionLayouts(value)).toEqual(normalizeActionLayouts(null));
  });
  it("bounds sizes, validates flags and recovers damaged JSON", () => {
    expect(normalizeModeLayout({ size: 999, iconsOnly: "false", movesLabels: null }, "record")).toEqual(defaultModeLayout("record"));
    vi.stubGlobal("localStorage", { getItem: () => "{damaged" });
    expect(loadActionLayouts()).toEqual(normalizeActionLayouts(null));
  });
  it("treats a zone as hidden only when every one of its buttons is hidden", () => {
    const base = defaultModeLayout("record");
    expect(isZoneHidden(base, "top")).toBe(false);
    const oneHidden = { ...base, hidden: [base.top[0]] };
    expect(isZoneHidden(oneHidden, "top")).toBe(false);
    const allHidden = setZoneHidden(base, "top", true);
    expect(isZoneHidden(allHidden, "top")).toBe(true);
    expect(isZoneHidden(allHidden, "bottom")).toBe(false);
    // visibleModeLayout collapses the fully hidden row to nothing.
    expect(visibleModeLayout(allHidden).top).toEqual([]);
    // toggling back restores the row and leaves the other zone untouched.
    expect(setZoneHidden(allHidden, "top", false).hidden).toEqual([]);
    // idempotent
    expect(setZoneHidden(allHidden, "top", true).hidden.sort()).toEqual([...base.top].sort());
  });
  it("offers default and compact presets per mode and persists the hidden zone", () => {
    for (const mode of LAYOUT_MODES) {
      expect(presetModeLayout(mode, "default")).toEqual(defaultModeLayout(mode));
      const compact = presetModeLayout(mode, "compact");
      expect(compact).toEqual(compactModeLayout(mode));
      // 简略（用户 2026-09-11 钦定）：纯图标 + 打谱/读谱首行功能区整区隐藏、无禁手规则；
      // 做题首行功能区整区隐藏（走棋栏左侧加摆棋，见 App 渲染）。
      expect(compact.iconsOnly).toBe(true);
      const visible = visibleModeLayout(compact);
      expect(visible.bottom).toEqual([]);
      expect(compact.hidden).toContain("view");
      if (mode === "puzzle") {
        expect(visible.top).toEqual([]);
      } else {
        expect(visible.top).not.toContain("rule");
        expect(compact.hidden).toContain("rule");
      }
      const sized = { ...compact, size: "large" as const };
      expect(saveRoundTrip(sized, mode).size).toBe("large");
      // 默认档已改成紧凑（用户 10-02 要「比较窄、比较不高」），但**显式存过的「标准」不能**
      // 被兜底分支吞回紧凑——否则设置里那一项选了等于没选。
      expect(defaultModeLayout(mode).size).toBe("compact");
      expect(saveRoundTrip({ ...defaultModeLayout(mode), size: "standard" }, mode).size).toBe("standard");
    }
    // a saved compact layout reloads still-hidden (persistence round trip)。
    // 做题常驻操作区默认为空（只两行），故用首行功能区做往返。
    const layouts = normalizeActionLayouts(null);
    layouts.modes.puzzle = setZoneHidden(defaultModeLayout("puzzle"), "bottom", true);
    const restored = normalizeActionLayouts(JSON.parse(JSON.stringify(layouts)));
    expect(isZoneHidden(restored.modes.puzzle, "bottom")).toBe(true);
  });
  it("keeps the user-approved default layout: 常驻(注释/保存/新建/删除/规则/黑白) + 走棋区(纯导航) + 首行", () => {
    const record = defaultModeLayout("record");
    expect(record.top).toEqual(["comment", "save", "new", "delete", "rule", "color"]);
    expect(record.moves).toEqual(["navStart", "navPrev", "navNext", "navEnd", "navUndo", "navRedo", "navDiscard"]);
    expect(record.bottom).toEqual(["analysis", "annotation", "notes", "tree", "view"]);
    // 读谱默认与打谱只在走棋区不同（播放替代撤销/重做/放弃），首行/常驻完全一致。
    const review = defaultModeLayout("review");
    expect(review.top).toEqual(record.top);
    expect(review.bottom).toEqual(record.bottom);
    expect(review.moves).toEqual(["navStart", "navPrev", "navNext", "navEnd", "playback"]);
    // 做题（用户 2026-09-10 二次钦定 + 09-10 反馈）：只两行——首行功能区 = 分析/应战/
    // 摆棋/VCF/禁手规则/更多（黑白切换已移出首行，固定在状态条右侧）；常驻走棋区为
    // 固定渲染的题目导航（不在布局池里）；常驻操作区留空；做题不需要标注/编辑/分支树。
    const puzzle = defaultModeLayout("puzzle");
    expect(puzzle.top).toEqual([]);
    expect(puzzle.moves).toEqual([]);
    // 应战与摆棋是同一枚按钮的两种状态（App 渲染层互斥显示），两个 id 都要在池子里，
    // 棋题生成器在“对弈”里独立承载，做题首行只保留当前页面里的功能按钮。
    expect(puzzle.bottom).toEqual(["analysis", "play", "setup", "rule", "view"]);
    expect(puzzle.bottom).not.toContain("color");
    expect(puzzle.bottom).not.toContain("annotation");
    expect(puzzle.bottom).not.toContain("notes");
    expect(puzzle.bottom).not.toContain("tree");
  });
  it.each([1, 2])("resets the puzzle default when loading a v%s save but keeps record/review 排布", (version) => {
    const legacy = {
      version,
      modes: {
        record: { top: ["view", "comment"], moves: [], bottom: ["analysis"] },
        review: null,
        puzzle: { top: ["play", "setup", "color"], moves: [], bottom: ["analysis", "annotations", "rule", "view"] },
      },
    };
    const migrated = normalizeActionLayouts(legacy);
    expect(migrated.modes.puzzle).toEqual(defaultModeLayout("puzzle"));
    expect(migrated.modes.record.top[0]).toBe("view");
    expect(migrated.modes.review).toEqual(defaultModeLayout("review"));
    expect(migrated.version).toBe(3);
  });
  it("keeps a v3 save as-is (current format round-trips)", () => {
    const layouts = normalizeActionLayouts(null);
    layouts.modes.puzzle = { ...defaultModeLayout("puzzle"), hidden: ["analysis"] };
    const restored = normalizeActionLayouts(JSON.parse(JSON.stringify(layouts)));
    expect(restored.modes.puzzle.hidden).toEqual(["analysis"]);
    expect(restored.modes.puzzle.bottom).toEqual(defaultModeLayout("puzzle").bottom);
  });
  function saveRoundTrip(layout: ReturnType<typeof defaultModeLayout>, mode: typeof LAYOUT_MODES[number]) {
    const layouts = normalizeActionLayouts(null);
    layouts.modes[mode] = layout;
    return normalizeModeLayout(JSON.parse(JSON.stringify(layout)), mode);
  }
  it('drops the retired VCF entry from saved layouts without disturbing other choices', () => {
    const value = { version: 3, modes: { puzzle: { ...defaultModeLayout('puzzle'), bottom: ['view','vcf','analysis','play','setup','rule'], hidden: ['vcf','rule'] } } };
    const migrated = normalizeActionLayouts(value).modes.puzzle;
    expect(migrated.bottom).toEqual(['view','analysis','play','setup','rule']);
    expect(migrated.hidden).toEqual(['rule']);
  });
  it("reports storage failure, and writes only the layout key", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    expect(saveActionLayouts(normalizeActionLayouts(null))).toBe(true);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(ACTION_LAYOUT_KEY, JSON.stringify(normalizeActionLayouts(null)));
    setItem.mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(saveActionLayouts(normalizeActionLayouts(null))).toBe(false);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("SecurityError"); } });
    expect(loadActionLayouts()).toEqual(normalizeActionLayouts(null));
  });

});

// 槽位（用户 09-17：保存自定义布局，最多 5 套，一键切换）
describe("saved layout presets", () => {
  it("drops unusable entries instead of half-keeping them", () => {
    const layouts = normalizeActionLayouts(null);
    const kept = normalizeSavedLayoutPresets([
      { name: "缺 id" },
      "垃圾",
      null,
      { id: "", name: "空 id", layouts },
      { id: "ok-1", name: "  我的   布局  ", savedAt: 5, layouts },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("ok-1");
    // 名字折叠空白并截断，避免槽位标题把行撑破
    expect(kept[0].name).toBe("我的 布局");
    expect(kept[0].savedAt).toBe(5);
    expect(kept[0].layouts).toEqual(layouts);
  });

  it("caps the list at MAX_SAVED_LAYOUTS and normalizes each snapshot", () => {
    const layouts = normalizeActionLayouts(null);
    const many = Array.from({ length: 9 }, (_, index) => ({ id: `s${index}`, name: `布局 ${index}`, savedAt: index, layouts }));
    expect(normalizeSavedLayoutPresets(many)).toHaveLength(MAX_SAVED_LAYOUTS);
    // 快照进槽位前也要过一遍归一化：手工改坏过的存档不能把槽位变成坏布局
    const broken = normalizeSavedLayoutPresets([{ id: "x", name: "坏", savedAt: 1, layouts: { version: 3, modes: { record: { top: ["不存在的按钮"], moves: [], bottom: [] } } } }]);
    expect(broken[0].layouts.modes.record.top).toEqual(defaultModeLayout("record").top);
  });

  it("summarizes each mode's visible button count", () => {
    const layouts = normalizeActionLayouts(null);
    const summary = savedLayoutSummary(layouts);
    const record = visibleModeLayout(layouts.modes.record);
    expect(summary).toContain(`打谱 ${record.top.length + record.moves.length + record.bottom.length}`);
    expect(summary).toContain("读谱");
    expect(summary).toContain("做题");
  });

  it("round-trips through storage and survives a broken read", () => {
    const layouts = normalizeActionLayouts(null);
    const stored: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => { stored[key] = value; },
    });
    expect(loadSavedLayoutPresets()).toEqual([]);
    const slot = { id: "a", name: "布局 1", savedAt: 1, layouts };
    expect(saveSavedLayoutPresets([slot])).toBe(true);
    expect(stored[SAVED_LAYOUTS_KEY]).toBe(JSON.stringify([slot]));
    expect(loadSavedLayoutPresets()).toEqual([slot]);
    stored[SAVED_LAYOUTS_KEY] = "{ 不是 JSON";
    expect(loadSavedLayoutPresets()).toEqual([]);
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("QuotaExceededError"); } });
    expect(saveSavedLayoutPresets([slot])).toBe(false);
  });
});
