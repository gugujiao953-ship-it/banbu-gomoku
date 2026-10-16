import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { DROP_EFFECTS_RAW_SCHEMES, PLACE_EFFECTS_RAW_SCHEMES, type EffectScheme } from "../../appearance/effects";
import { loadMotionEffectsSettings } from "../../motion-effects-settings";
import { findStoneMaterial, stoneMarkup } from "../../appearance/render";
import { DEFAULT_STONE_SCALE, stoneRadiusFor } from "./stone-size";
import "./motion-preview.css";

/**
 * 「外观 → 特效」的实时预览（用户 2026-10-02：「公用动效没有预览，加一个，切换后都可以看到预览」）。
 *
 * 做法：**直接跑真代码**，不是另画一份近似动画——
 *  - 棋子进场（`dp-*`）是纯 CSS 类，本体里挂在 `.stone-piece` 上，这里就重建一枚
 *    预览棋子、挂同一个类名，动画自然从头播；
 *  - 落子交互（`pl-*`）是 `spawn(id, {x,y,r,host,accent})` 往 `<svg>` 里插特效元素，
 *    这里把 host 换成预览那块 `<svg>`，调的就是设置里选中的那套方案。
 * 所以预览和真实落子的差别只有盘面尺寸与棋子半径，不会出现"预览好看、实盘另一个样"。
 *
 * ⚠ 2026-10-09 改为**寄生于外观那块共用预览**（用户：「公用特效那里还是一块新棋盘，上面一个下面一个的，
 *   我们要用那一套预览，你适配一下，不过里面的棋子可以只有一个，和其他预览的三个棋子里面不一样，
 *   以方便用来展示不同棋子材质下的动效」）。
 *   所以本组件默认不再自建棋盘，而是把动效元素插进 `hostRef` 那块共用预览：
 *     · 预览里那 5 枚静态棋子在动效版面由 AppearancePanes 隐藏，只留这一枚「演出用」棋子；
 *     · 一颗就够看动效，也正好用来对比同一套动效在不同棋子材质下的样子。
 *   `inline` 为 false 时保留原来"自建舞台"的形态（独立使用/测试时仍可用）。
 *
 * ⚠ 预览**不受「界面动效」总开关影响**（关了就什么都看不见，没法挑方案）；
 *   总开关关着时下面会明说"实盘不会播"，避免挑完发现没生效。
 *
 * ⚠ 两套**都关**时（1.1.9 起这是默认值）舞台也不许哑：仍然播各自选中的方案——
 *   预览的意义是"让你看清要不要开"，这时只剩一颗静止棋子就等于把入口废掉。
 *   父组件在这种情形传进来的是两个 null，而开关关掉并不会丢掉下拉里的选择，
 *   它就存在持久化设置里，这里就地取回，`SettingsPage` 不必配合改任何东西。
 */
const SVG_NS = "http://www.w3.org/2000/svg";
/** 演出棋子的半径（共用预览 viewBox 572、15 路、gap≈36 时，静态子半径约 17–18）。 */
const STONE_R = 18;
/** 演出棋子的落点：共用预览的盘心（viewBox 572 的中心）。 */
const CX = 286, CY = 286;
/** 重播间隔：留够时间看完最慢的一套（pl-ripple 1.05s + 延迟）。 */
const REPLAY_MS = 2000;

/** 系统/浏览器是否报告「减少动态效果」。
 *  ⚠ 老 Android WebView（K20 这类）**常年把它报成 reduce**，所以这里只是拿来说明情况，
 *    不用来掐预览：实盘那套 CSS 仍带 `animation:none` 降级，系统这么设时实盘真的不播。 */
const usePrefersReducedMotion = () => {
  const query = "(prefers-reduced-motion: reduce)";
  const read = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    /* 老 WebView 只有 addListener/removeListener，新的是 addEventListener —— 两条都挂上。 */
    mq.addEventListener?.("change", onChange);
    mq.addListener?.(onChange);
    return () => { mq.removeEventListener?.("change", onChange); mq.removeListener?.(onChange); };
  }, []);
  return reduced;
};

/** 舞台用的方案：**取不带 reduced-motion 降级的原始列表**（见 effects.ts 的说明），
 *  取不到就回落该列表第一套，绝不返回 null —— 预览不许因为一个坏 id 变空白。 */
const stageScheme = (list: EffectScheme[], id: string): EffectScheme | null => list.find((scheme) => scheme.id === id) ?? list[0] ?? null;

export function MotionEffectsPreview({ place, drop, live, hostRef, inline = false, stoneTheme, stoneGap }: {
  place: EffectScheme | null;
  drop: EffectScheme | null;
  live: boolean;
  /** 寄生模式：把动效插进这块外部 `<svg>`（外观那块共用预览）。 */
  hostRef?: React.RefObject<SVGSVGElement | null>;
  /** true＝寄生模式：不画棋盘，只出「重播」与说明文字。 */
  inline?: boolean;
  /** 当前棋子材质：演出棋子**按这个材质渲染**，于是"换个棋子材质就能对比同一套动效"
   *  （用户 2026-10-09：「里面的棋子可以只有一个……以方便用来展示不同棋子材质下的动效」）。 */
  stoneTheme?: string;
  /** 15 路的格距（本体 viewBox 572、默认边距 34）——用来算棋子半径，和真实棋盘一致。 */
  stoneGap?: number;
}) {
  const ownStageRef = useRef<SVGSVGElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  /* 都关时（父组件给的就是两个 null）改从持久化设置里取"各自选中的方案"继续播；
     只关一套时不动，仍然只播开着的那一套。取 id 之后一律回到**原始方案列表**上取实现
     （舞台要真的动起来，见上面 stageScheme 的说明），所以引用是稳定的，不会反复重播。 */
  const bothOff = !place && !drop;
  const saved = bothOff ? loadMotionEffectsSettings() : null;
  const activePlace = place ? stageScheme(PLACE_EFFECTS_RAW_SCHEMES, place.id) : saved ? stageScheme(PLACE_EFFECTS_RAW_SCHEMES, saved.placeId) : null;
  const activeDrop = drop ? stageScheme(DROP_EFFECTS_RAW_SCHEMES, drop.id) : saved ? stageScheme(DROP_EFFECTS_RAW_SCHEMES, saved.dropId) : null;

  const play = useCallback(() => {
    const svg = hostRef?.current ?? ownStageRef.current;
    if (!svg) return;
    const accent = getComputedStyle(svg).getPropertyValue("--green").trim() || "#3f6f52";
    /* 重建演出棋子：交给 DOM 而不是 React —— `spawn()` 会把特效元素**直接插进同一个 svg**，
       两者抢同一个父节点会互相覆盖。
       ⚠ 棋子**必须按当前棋子材质渲染**（stoneMarkup），否则只是一颗死色圆圈：
         用户要"一个棋子"的用意正是「换个棋子材质就能对比同一套动效的效果」，
         画死色就失去意义了。材质查不到时退回一个中性黑圆。 */
    svg.querySelector("[data-preview-stone]")?.remove();
    const stone = document.createElementNS(SVG_NS, "g");
    stone.setAttribute("data-preview-stone", "");
    stone.setAttribute("class", activeDrop ? `stone-piece ${activeDrop.id}` : "stone-piece");
    const r = stoneGap ? stoneRadiusFor(stoneGap, DEFAULT_STONE_SCALE) : STONE_R;
    const mat = stoneTheme ? findStoneMaterial(stoneTheme) : null;
    if (mat) {
      /* 材质自带 defs（渐变等）要先注入：材质是自包含的，缺 defs 会渲染成无色。 */
      if (mat.defs && !svg.querySelector(`[data-stone-defs="${mat.src}"]`)) {
        const defs = document.createElementNS(SVG_NS, "defs");
        defs.setAttribute("data-stone-defs", mat.src);
        defs.innerHTML = mat.defs;
        svg.insertBefore(defs, svg.firstChild);
      }
      stone.innerHTML = stoneMarkup(mat, CX, CY, r, 1, false, false);
    } else {
      const body = document.createElementNS(SVG_NS, "circle");
      body.setAttribute("cx", String(CX));
      body.setAttribute("cy", String(CY));
      body.setAttribute("r", String(r));
      body.setAttribute("fill", "#25241f");
      body.setAttribute("stroke", "#1b1a17");
      body.setAttribute("stroke-width", "0.8");
      stone.appendChild(body);
    }
    svg.appendChild(stone);
    /* spawn 是各方案自己的代码：包一层 try/catch —— 某一套在旧 WebView 上出问题时要
       「只剩棋子」，而不是把整个预览连棋盘一起搞没（用户 10-05：老安卓上预览总是出不来）。 */
    const safeSpawn = (scheme: EffectScheme | null) => {
      if (!scheme?.spawn) return;
      try {
        scheme.spawn(scheme.id, { x: CX, y: CY, r: STONE_R, host: svg, accent });
      } catch (error) {
        console.warn("公用效果预览：这套方案的落子特效没能播出来", scheme.id, error);
      }
    };
    safeSpawn(activePlace);
    /* 「棋子进场」那 4 套（dp-spin/dp-squash/dp-fall/dp-spiral）除了给子挂动画类，还各带一段
       插在棋子下面的伴随特效（拖尾、冲击环、扬尘、螺旋）。以前这里只播 place 的 spawn，
       预览里看不到它们 —— 和实盘是同一个漏，两边一起补上。 */
    safeSpawn(activeDrop);
  }, [activePlace, activeDrop, hostRef, stoneTheme, stoneGap]);

  /* 换方案（下拉里选另一套）立刻重播一次，这就是"切换后都能看到预览"。 */
  useEffect(() => { play(); }, [play]);
  useEffect(() => {
    if (!activePlace && !activeDrop) return;
    const timer = window.setInterval(play, REPLAY_MS);
    return () => window.clearInterval(timer);
  }, [play, activePlace, activeDrop]);

  const styles = [activePlace ? activePlace.css(activePlace.id) : "", activeDrop ? activeDrop.css(activeDrop.id) : ""].filter(Boolean).join("\n");
  /* 舞台 CSS 同样不能每次渲染重写：React 19 在每次提交都会重写 dangerouslySetInnerHTML
     （哪怕内容一模一样），style 一被重写，预览的 @keyframes 就从 0 重来 —— 表现是
     设置页里任何无关重渲染都会把预览动画打断重播。改成 ref + 变了才写。 */
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const previewCss = `${styles}
.motion-effects-preview .stone-piece,.material-live-preview .stone-piece{transform-box:fill-box;transform-origin:center}`;
  useLayoutEffect(() => {
    const el = styleRef.current;
    if (el && el.textContent !== previewCss) el.textContent = previewCss;
  }, [previewCss]);

  const caption = <>
    {activePlace ? <small>{`落子交互 · ${activePlace.name}：${activePlace.desc}`}</small> : <small>落子交互已关闭</small>}
    {activeDrop ? <small>{`棋子进场 · ${activeDrop.name}：${activeDrop.desc}`}</small> : <small>棋子进场已关闭</small>}
    {!live && <small className="motion-effects-preview-off">「无障碍与反馈 → 界面动效」当前是关的：这里能看到样子，但实盘不会播。</small>}
    {reducedMotion && <small className="motion-effects-preview-off" data-motion-preview-reduced="">系统/浏览器报告「减少动态效果」（老安卓 WebView 常默认如此）：实盘一律不播动画，预览这里仍播一遍，方便你挑方案。</small>}
  </>;

  /* 寄生模式：棋盘由共用预览提供，这里只出重播按钮与说明。 */
  if (inline) return <div className="motion-effects-preview motion-effects-preview-inline" data-motion-preview={activePlace?.id ?? ""}>
    <style ref={styleRef}/>
    <div className="motion-effects-inline-bar">
      <button type="button" className="motion-effects-preview-replay" onClick={play} aria-label="重播预览动画"><RotateCw size={14}/>重播</button>
      <span>
        <b>{bothOff ? "当前已关闭 · 上面播的是各自选中的方案，打开开关后实盘生效" : activePlace && activeDrop ? "两套一起播" : activePlace ? "只播落子交互" : "只播棋子进场"}</b>
        <small>预览里只有一枚棋子 —— 换个棋子材质就能对比同一套动效的效果</small>
      </span>
    </div>
    <p className="motion-effects-preview-caption">{caption}</p>
  </div>;

  return <div className="motion-effects-preview" data-motion-preview={activePlace?.id ?? ""}>
    <style ref={styleRef}/>
    <div className="motion-effects-preview-stage">
      <svg ref={ownStageRef} viewBox="0 0 176 176" role="img" aria-label="公用效果预览棋盘">
        <defs>
          <radialGradient id="motionPreviewStone" cx="32%" cy="26%" r="82%">
            <stop offset="0" stopColor="#5c5b55"/>
            <stop offset=".45" stopColor="#25241f"/>
            <stop offset="1" stopColor="#0a0a09"/>
          </radialGradient>
        </defs>
        <rect x="6" y="6" width="164" height="164" rx="12" className="motion-effects-preview-bg"/>
        {[0.28, 0.5, 0.72].map((ratio) => <g key={ratio} stroke="currentColor" strokeWidth="0.7" opacity=".28">
          <line x1={12} x2={164} y1={12 + 152 * ratio} y2={12 + 152 * ratio}/>
          <line y1={12} y2={164} x1={12 + 152 * ratio} x2={12 + 152 * ratio}/>
        </g>)}
      </svg>
      <button type="button" className="motion-effects-preview-replay" onClick={play} aria-label="重播预览动画"><RotateCw size={14}/>重播</button>
    </div>
    <p className="motion-effects-preview-caption">
      <b>{bothOff ? "当前已关闭 · 这里播的是各自选中的方案，打开开关后实盘生效" : activePlace && activeDrop ? "两套一起播" : activePlace ? "只播落子交互" : "只播棋子进场"}</b>
      {caption}
    </p>
  </div>;
}
