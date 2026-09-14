import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Compass, X } from "lucide-react";
import { TOUR_STEPS, type TourStep } from "./tour-steps";

// 新手引导（T32）：SVG mask 多点聚光 + 自适应锚定卡片。纯覆盖层设计——
// 目标元素只按选择器锚定，布局被用户重排/隐藏时对应光孔自动熄灭（tip 行
// 降透明度），文案永远完整；tab 切换靠点击真实底部导航，零 App 内部耦合。
interface Hole { x: number; y: number; w: number; h: number; }

export function AppTour({ steps = TOUR_STEPS, onNavigate, onFinish, onStepChange }: { steps?: TourStep[]; onNavigate: (tab: "record" | "library" | "settings") => void; onFinish: (completed: boolean) => void; onStepChange?: (step: TourStep) => void }) {
  const [index, setIndex] = useState(0);
  const [holes, setHoles] = useState<(Hole | null)[]>([]);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const step = steps[index];

  const goto = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    setIndex(clamped);
    const tab = steps[clamped].tab;
    if (tab) onNavigate(tab);
  }, [onNavigate, steps]);

  // 步骤变化时通知宿主（如 quick-layout 步需要 App 打开快捷中心、离开时关闭）
  useEffect(() => {
    onStepChange?.(steps[index]);
  }, [index, onStepChange, steps]);

  // 测量：rAF 节流 120ms 常驻轮询（tab 切换/滚动/重排全自动跟随）
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let last = 0;
    const measure = () => {
      if (cancelled) return;
      const next = step.tips.map((tip) => {
        let element: Element | null = null;
        try { element = document.querySelector(tip.sel); } catch { /* 无效选择器：灭孔不崩 */ }
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > innerHeight) return null;
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      });
      setHoles((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const loop = (t: number) => { if (cancelled) return; if (t - last > 120) { last = t; measure(); } raf = requestAnimationFrame(loop); };
    measure();
    raf = requestAnimationFrame(loop);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [step]);

  // 卡片锚定：主光孔下方优先，放不下翻上方，左右夹进取整；无命中→居中
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const cw = element.offsetWidth;
    const ch = element.offsetHeight;
    const vw = innerWidth;
    const vh = innerHeight;
    // 锚定「最小光孔」：小按钮必须完整露出，大孔（棋盘）允许被卡片盖一角
    const foundHoles = holes.filter((hole): hole is Hole => hole !== null);
    const primary = foundHoles.length ? foundHoles.reduce((best, hole) => (hole.w * hole.h < best.w * best.h ? hole : best)) : null;
    if (!primary) { setCardPos({ top: Math.max(10, (vh - ch) / 2), left: Math.max(10, (vw - cw) / 2) }); return; }
    const gap = 14;
    const below = primary.y + primary.h + gap;
    const top = below + ch <= vh - 10 ? below : Math.max(10, Math.min(primary.y - gap - ch, vh - ch - 10));
    const left = Math.max(10, Math.min(primary.x, vw - cw - 10));
    setCardPos({ top: Math.round(top), left: Math.round(left) });
  }, [holes, index]);

  // 键盘：Esc 跳过、←/→ 翻页、Enter=下一步。必须捕获阶段监听——app 的
  // 打谱快捷键监听器（方向键=走棋）注册在前且会 stopImmediatePropagation，
  // 冒泡阶段根本轮不到引导。
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish(false);
      else if (event.key === "ArrowRight") { event.stopPropagation(); goto(index + 1); }
      else if (event.key === "ArrowLeft") { event.stopPropagation(); goto(index - 1); }
      else if (event.key === "Enter" || event.key === " ") { if (document.activeElement === document.body || document.activeElement === cardRef.current) { event.preventDefault(); if (step.final) onFinish(true); else goto(index + 1); } }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [goto, index, onFinish, step.final]);

  useEffect(() => {
    document.body.classList.add("tour-lock");
    return () => document.body.classList.remove("tour-lock");
  }, []);

  const found = holes.map((hole) => hole !== null);
  return createPortal(<div className="app-tour" role="dialog" aria-modal="true" aria-label="新手引导">
    <svg className="app-tour-spot" aria-hidden="true">
      <defs><mask id="banbu-tour-mask">
        <rect x="0" y="0" width="100%" height="100%" fill="white"/>
        {holes.map((hole, i) => hole && <rect key={`${step.id}-${i}`} x={hole.x - 6} y={hole.y - 6} width={hole.w + 12} height={hole.h + 12} rx={15} fill="black"/>)}
      </mask></defs>
      <rect className="app-tour-veil" x="0" y="0" width="100%" height="100%" mask="url(#banbu-tour-mask)"/>
      {holes.map((hole, i) => hole && <g key={`ring-${step.id}-${i}`}>
        <rect className="app-tour-ring" x={hole.x - 6} y={hole.y - 6} width={hole.w + 12} height={hole.h + 12} rx={15}/>
        <rect className="app-tour-ring soft" x={hole.x - 6} y={hole.y - 6} width={hole.w + 12} height={hole.h + 12} rx={15}/>
      </g>)}
    </svg>
    <div ref={cardRef} className="app-tour-card" style={cardPos ? { top: cardPos.top, left: cardPos.left } : { visibility: "hidden" }} tabIndex={-1}>
      <div className="app-tour-head">
        <span className="app-tour-badge"><Compass size={13}/>新手引导 · {index + 1}/{steps.length}</span>
        <button type="button" className="app-tour-x" onClick={() => onFinish(false)} aria-label="跳过引导"><X size={16}/></button>
      </div>
      <h3>{step.title}</h3>
      <p className="app-tour-lead">{step.lead}</p>
      <ul className="app-tour-tips" aria-live="polite">
        {step.tips.map((tip, i) => <li key={tip.sel} className={found[i] ? "lit" : "dim"}>
          <i><tip.icon size={15}/></i>
          <div><b>{tip.name}</b><small>{tip.desc}</small></div>
        </li>)}
      </ul>
      <div className="app-tour-foot">
        <div className="app-tour-dots" role="group" aria-label="引导进度">
          {steps.map((each, i) => <button key={each.id} type="button" aria-label={each.title} className={i === index ? "on" : ""} onClick={() => goto(i)}/>)}
        </div>
        <div className="app-tour-btns">
          {index > 0 && <button type="button" className="secondary-button" onClick={() => goto(index - 1)}><ChevronLeft size={15}/>上一步</button>}
          {step.final
            ? <button type="button" className="primary-button" onClick={() => onFinish(true)}><Check size={15}/>开始使用</button>
            : <button type="button" className="primary-button" onClick={() => goto(index + 1)}>下一步<ChevronRight size={15}/></button>}
        </div>
      </div>
    </div>
  </div>, document.body);
}
