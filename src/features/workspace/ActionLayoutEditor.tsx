import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookmarkPlus, Check, Eye, EyeOff, GripVertical, RotateCcw, Trash2, X } from "lucide-react";
import type { AppMode } from "../../app-shell-types";
import { BottomSheet } from "../../ui/overlays/BottomSheet";
import { ACTION_LABELS, LAYOUT_MODES, MAX_SAVED_LAYOUTS, MODE_LABELS, ZONES, ZONE_LABELS, defaultModeLayout, isZoneHidden, loadSavedLayoutPresets, moveAction, normalizeActionLayouts, presetModeLayout, saveSavedLayoutPresets, savedLayoutSummary, setZoneHidden, type ActionId, type ActionLayouts, type LayoutZone, type SavedLayoutPreset } from "./action-layout";
import { ACTION_ICONS } from "./action-icons";
import { MIN_ACTION_OPACITY } from "../../action-opacity";
import "./action-layout.css";

interface Props {
  value: ActionLayouts; mode: AppMode; onApply: (value: ActionLayouts) => boolean; onClose: () => void;
  /** 功能区按钮透明度与它的写入（用户 2026-10-09 新增；值本身存在 App 状态里，与布局同一处设置入口）。 */
  actionOpacity: number; onActionOpacityChange: (value: number) => void;
}
interface Drag { id: ActionId; pointer: number; x: number; y: number; target?: { zone: LayoutZone; index: number; id?: string } }

export function ActionLayoutEditor({ value, mode: initialMode, onApply, onClose, actionOpacity, onActionOpacityChange }: Props) {
  const [draft, setDraft] = useState(() => normalizeActionLayouts(value));
  const [mode, setMode] = useState(initialMode);
  const [selected, setSelected] = useState<ActionId | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState<ActionId | null>(null);
  const [dropId, setDropId] = useState("");
  const [saved, setSaved] = useState<SavedLayoutPreset[]>(loadSavedLayoutPresets);
  const drag = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = draft.modes[mode];
  const update = (next: typeof layout) => { setDraft((current) => ({ ...current, modes: { ...current.modes, [mode]: next } })); setError(""); };
  // 槽位（用户 09-17）：保存的是**当前草稿**（所见即所存，含还没点「应用」的改动），
  // 切换是**一键直接应用整套**并关窗——用户要的就是「以后换了布局，点一下就切回来」。
  const persistSlots = (next: SavedLayoutPreset[]) => {
    setSaved(next);
    if (!saveSavedLayoutPresets(next)) setError("布局槽位写入本机存储失败，改动只在本次有效。");
  };
  const saveSlot = () => {
    if (saved.length >= MAX_SAVED_LAYOUTS) { setError(`最多保存 ${MAX_SAVED_LAYOUTS} 套布局，请先删除一套。`); return; }
    // 名字取「最小的还没用过的编号」，不要用 saved.length + 1：删掉中间那一套之后再存
    // 会生成重名（[布局 2, 布局 4, 布局 5] 存一套又得到「布局 4」，两个槽位分不清）。
    const used = new Set(saved.map((entry) => entry.name));
    let slotIndex = 1;
    while (used.has(`布局 ${slotIndex}`)) slotIndex += 1;
    const name = `布局 ${slotIndex}`;
    const next: SavedLayoutPreset[] = [...saved, { id: `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, savedAt: Date.now(), layouts: normalizeActionLayouts(draft) }];
    persistSlots(next);
    setNotice(`已保存为「${name}」（${savedLayoutSummary(draft)}），以后点它即可一键切回这套布局`);
  };
  const applySlot = (preset: SavedLayoutPreset) => {
    if (onApply(preset.layouts)) setNotice(`已切换到「${preset.name}」`);
    else setError("切换失败，请检查本机存储后重试。");
  };
  const removeSlot = (preset: SavedLayoutPreset) => {
    persistSlots(saved.filter((entry) => entry.id !== preset.id));
    setNotice(`已删除「${preset.name}」`);
  };
  const move = (id: ActionId, zone: LayoutZone, index: number) => {
    update(moveAction(layout, id, zone, index)); setSelected(id);
    setNotice(`${ACTION_LABELS[id]}已移至${ZONE_LABELS[zone]}第 ${index + 1} 位`);
  };
  const hitTest = () => {
    const current = drag.current;
    if (!current) return;
    const hit = document.elementFromPoint(current.x, current.y);
    const zoneElement = hit?.closest<HTMLElement>("[data-layout-zone]");
    if (!zoneElement || !scrollRef.current?.contains(zoneElement)) { current.target = undefined; setDropId(""); return; }
    const zone = zoneElement.dataset.layoutZone as LayoutZone;
    const tile = hit?.closest<HTMLElement>("[data-layout-id]");
    const ids = layout[zone].filter((id) => id !== current.id);
    const index = tile ? ids.indexOf(tile.dataset.layoutId as ActionId) : ids.length;
    if (tile?.dataset.layoutId === current.id) { current.target = undefined; setDropId(""); return; }
    current.target = { zone, index: Math.max(0, index), id: tile?.dataset.layoutId };
    setDropId(tile?.dataset.layoutId || zone);
  };
  const hitRef = useRef(hitTest); hitRef.current = hitTest;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const current = drag.current, scroller = scrollRef.current;
      if (!current || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      if (current.y < rect.top + 40) scroller.scrollTop -= 5;
      if (current.y > rect.bottom - 40) scroller.scrollTop += 5;
      hitRef.current(); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  const start = (event: PointerEvent<HTMLButtonElement>, id: ActionId) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY };
    setSelected(id); setDragging(id);
  };
  const finish = (event: PointerEvent, commit: boolean) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (commit && current.target) move(current.id, current.target.zone, current.target.index);
    drag.current = null; setDragging(null); setDropId("");
  };
  const zone = selected ? (ZONES.find((item) => layout[item].includes(selected)) ?? null) : null;
  const nextZone: LayoutZone | null = zone ? ZONES[(ZONES.indexOf(zone) + 1) % ZONES.length] : null;
  const index = selected && zone ? layout[zone].indexOf(selected) : -1;
  const selectedHidden = !!selected && layout.hidden.includes(selected);
  const toggleVisibility = () => {
    if (!selected) return;
    update({ ...layout, hidden: selectedHidden ? layout.hidden.filter((id) => id !== selected) : [...layout.hidden, selected] });
    setNotice(`${ACTION_LABELS[selected]}已${selectedHidden ? "启用" : "隐藏"}，应用后保存`);
  };
  return <BottomSheet title="功能区布局" onClose={onClose} manageHistory className="action-layout-sheet">
    <div className="layout-modes" role="tablist" aria-label="布局模式">{LAYOUT_MODES.map((item) => <button type="button" key={item} role="tab" aria-selected={mode === item} onClick={() => { setMode(item); setSelected(null); setNotice(""); }} disabled={!!dragging}>{MODE_LABELS[item]}</button>)}</div>
    <div className="layout-presets" role="group" aria-label="预设模板">
      <span>预设</span>
      <button type="button" onClick={() => { update(presetModeLayout(mode, "default")); setSelected(null); setNotice(`已载入${MODE_LABELS[mode]}默认模板，应用后保存`); }}>默认模式<small>完整功能区</small></button>
      <button type="button" onClick={() => { update(presetModeLayout(mode, "compact")); setSelected(null); setNotice(`已载入${MODE_LABELS[mode]}简略模板：只有图标没有文字，应用后保存`); }}>简略模式<small>只有图标</small></button>
    </div>
    <div className="layout-saved" role="group" aria-label="我的布局">
      <div className="layout-saved-head">
        <span>我的布局<small>最多 {MAX_SAVED_LAYOUTS} 套 · 一键切回</small></span>
        <button type="button" className="layout-saved-add" disabled={saved.length >= MAX_SAVED_LAYOUTS} aria-label="保存当前布局" title={saved.length >= MAX_SAVED_LAYOUTS ? `已存满 ${MAX_SAVED_LAYOUTS} 套，先删一套再存` : "把当前这套布局（三个模式一起）存成一个槽位"} onClick={saveSlot}><BookmarkPlus aria-hidden="true"/><span>保存当前布局</span></button>
      </div>
      {/* 用户 2026-10-09：「保存当前布局下面的说明你去掉吧，给下面腾一点空间」——
          没保存过布局时原来会占一行提示文案，现在整段不渲染（空态靠上面的按钮本身说明）。 */}
      {saved.length > 0 && <ul className="layout-saved-list">{saved.map((preset) => <li key={preset.id}>
            <button type="button" className="layout-saved-apply" aria-label={`切换到${preset.name}`} title={`一键切换到「${preset.name}」`} onClick={() => applySlot(preset)}>
              <b>{preset.name}</b><small>{savedLayoutSummary(preset.layouts)}</small>
            </button>
            <button type="button" className="layout-saved-remove" aria-label={`删除${preset.name}`} title={`删除「${preset.name}」`} onClick={() => removeSlot(preset)}><Trash2 aria-hidden="true"/></button>
          </li>)}</ul>}
    </div>
    <div className="layout-options">
      <label>按钮大小<select aria-label="按钮大小" value={layout.size} onChange={(event) => update({ ...layout, size: event.target.value as typeof layout.size })}><option value="compact">紧凑（默认）</option><option value="standard">标准</option><option value="large">宽松</option></select></label>
      <label><input type="checkbox" checked={layout.iconsOnly} onChange={(event) => update({ ...layout, size: layout.size, iconsOnly: event.target.checked, movesLabels: event.target.checked ? layout.movesLabels : true })}/>仅图标</label>
      {/* 功能区按钮透明度（用户 2026-10-09：「加入一个调整功能区按钮透明度的功能，放到功能区设置里面，
          可以自由调整功能区的按钮的透明度」）。作用于三排功能区的按钮底子，让背景主题透出来。 */}
      <label className="layout-opacity">按钮透明度
        <input type="range" aria-label="功能区按钮透明度" min={Math.round(MIN_ACTION_OPACITY * 100)} max="100" step="1"
          value={Math.round(actionOpacity * 100)} onChange={(event) => onActionOpacityChange(Number(event.target.value) / 100)}/>
        <output>{Math.round(actionOpacity * 100)}%</output>
      </label>
    </div>
    <div ref={scrollRef} className="layout-preview" aria-label={`${MODE_LABELS[mode]}布局预览`} data-action-size={layout.size} data-icons-only={layout.iconsOnly}>
      {(["bottom", "top", "moves"] as LayoutZone[]).map((region) => { const zoneHidden = isZoneHidden(layout, region); const zoneIds = layout[region]; return <section key={region} data-layout-zone={region} data-zone-hidden={zoneHidden || undefined} className={dropId === region ? "drop-target" : ""} aria-label={ZONE_LABELS[region]}>
        <div className="layout-zone-head"><h3>{ZONE_LABELS[region]}<small>{zoneIds.filter((id) => !layout.hidden.includes(id)).length} / {zoneIds.length}</small></h3>
          <button type="button" className="layout-zone-visibility" aria-label={zoneHidden ? `显示${ZONE_LABELS[region]}` : `隐藏${ZONE_LABELS[region]}`} title={zoneHidden ? "显示整个功能区" : "隐藏整个功能区（页面自动收起这一行）"} onClick={() => { update(setZoneHidden(layout, region, !zoneHidden)); setSelected(null); setNotice(`${ZONE_LABELS[region]}已${zoneHidden ? "显示" : "整区隐藏"}，应用后保存`); }}>{zoneHidden ? <Eye aria-hidden="true"/> : <EyeOff aria-hidden="true"/>}</button>
        </div>
        <div className="layout-tiles">{zoneIds.map((id) => { const Icon = ACTION_ICONS[id]; return <div key={id} data-layout-id={id} data-hidden={layout.hidden.includes(id)} className={`layout-tile ${selected === id ? "selected" : ""} ${dragging === id ? "dragging" : ""} ${dropId === id ? "drop-target" : ""}`}>
          <button type="button" className="layout-tile-select" aria-label={ACTION_LABELS[id]} aria-pressed={selected === id} title={ACTION_LABELS[id]} onClick={() => setSelected(id)}><Icon aria-hidden="true"/><span className="action-label">{ACTION_LABELS[id]}</span></button>
          <button type="button" className="layout-grip" aria-label={`拖动${ACTION_LABELS[id]}`} title={`拖动${ACTION_LABELS[id]}`} onPointerDown={(event) => start(event, id)} onPointerMove={(event) => { if (drag.current?.pointer === event.pointerId) { drag.current.x = event.clientX; drag.current.y = event.clientY; hitTest(); } }} onPointerUp={(event) => finish(event, true)} onPointerCancel={(event) => finish(event, false)} onLostPointerCapture={(event) => finish(event, false)}><GripVertical aria-hidden="true"/></button>
        </div>; })}</div>
      </section>; })}
    </div>
    <div className="layout-selection" aria-label="位置调整"><b>{selected ? ACTION_LABELS[selected] : "未选择"}{selectedHidden && <small>已隐藏</small>}</b><div>
      <button type="button" disabled={!selected || !zone || index <= 0} aria-label="前移" title="前移" onClick={() => selected && zone && move(selected, zone, index - 1)}><ArrowLeft/></button>
      <button type="button" disabled={!selected || !zone || index >= (zone ? layout[zone].length : 0) - 1} aria-label="后移" title="后移" onClick={() => selected && zone && move(selected, zone, index + 1)}><ArrowRight/></button>
      <button type="button" disabled={!selected || !nextZone} aria-label={`移至${nextZone ? ZONE_LABELS[nextZone] : "下一功能区"}`} title={`移至${nextZone ? ZONE_LABELS[nextZone] : "下一功能区"}`} onClick={() => selected && zone && nextZone && move(selected, nextZone, layout[nextZone].length)}>{zone === "moves" ? <ArrowDown/> : <ArrowUp/>}</button>
      <button type="button" className="layout-visibility" disabled={!selected} aria-label={selectedHidden ? "启用" : "隐藏"} title={selectedHidden ? "启用按钮" : "隐藏按钮"} onClick={toggleVisibility}>{selectedHidden ? <Eye/> : <EyeOff/>}<span>{selectedHidden ? "启用" : "隐藏"}</span></button>
    </div></div>
    <div className="layout-notice" role={error ? "alert" : "status"}>{error || notice}</div>
    <footer className="layout-footer"><button type="button" onClick={() => { update(defaultModeLayout(mode)); setSelected(null); setNotice(`已恢复${MODE_LABELS[mode]}默认，应用后保存`); }}><RotateCcw/>恢复当前模式默认</button><button type="button" onClick={onClose}><X/>取消</button><button type="button" className="primary-button" onClick={() => { if (!onApply(draft)) setError("保存失败，请检查本机存储后重试。布局尚未应用。"); }}><Check/>应用</button></footer>
  </BottomSheet>;
}
