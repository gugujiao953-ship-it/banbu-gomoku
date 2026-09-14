import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Eye, EyeOff, GripVertical, RotateCcw, X } from "lucide-react";
import type { AppMode } from "../../app-shell-types";
import { BottomSheet } from "../../ui/overlays/BottomSheet";
import { ACTION_LABELS, LAYOUT_MODES, MODE_LABELS, ZONES, ZONE_LABELS, defaultModeLayout, isZoneHidden, moveAction, normalizeActionLayouts, presetModeLayout, setZoneHidden, type ActionId, type ActionLayouts, type LayoutZone } from "./action-layout";
import { ACTION_ICONS } from "./action-icons";
import "./action-layout.css";

interface Props { value: ActionLayouts; mode: AppMode; onApply: (value: ActionLayouts) => boolean; onClose: () => void }
interface Drag { id: ActionId; pointer: number; x: number; y: number; target?: { zone: LayoutZone; index: number; id?: string } }

export function ActionLayoutEditor({ value, mode: initialMode, onApply, onClose }: Props) {
  const [draft, setDraft] = useState(() => normalizeActionLayouts(value));
  const [mode, setMode] = useState(initialMode);
  const [selected, setSelected] = useState<ActionId | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState<ActionId | null>(null);
  const [dropId, setDropId] = useState("");
  const drag = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = draft.modes[mode];
  const update = (next: typeof layout) => { setDraft((current) => ({ ...current, modes: { ...current.modes, [mode]: next } })); setError(""); };
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
    <div className="layout-options">
      <label>按钮大小<select aria-label="按钮大小" value={layout.size} onChange={(event) => update({ ...layout, size: event.target.value as typeof layout.size })}><option value="compact">紧凑</option><option value="standard">标准（默认）</option><option value="large">宽松</option></select></label>
      <label><input type="checkbox" checked={layout.iconsOnly} onChange={(event) => update({ ...layout, size: layout.size, iconsOnly: event.target.checked, movesLabels: event.target.checked ? layout.movesLabels : true })}/>仅图标</label>
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
