import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ThemeScene } from "./ThemeScene";
import "./theme-preview.css";

const THEMES = [["pelican", "黄昏骑行"], ["dunhuang", "飞天敦煌"], ["soul", "棋魂"]] as const;
type PreviewTheme = typeof THEMES[number][0];
const SIZES = [
  ["portrait", "手机竖屏", 390, 844],
  ["landscape", "手机横屏", 844, 390],
  ["tablet", "平板竖屏", 820, 1180],
  ["tablet-wide", "平板横屏", 1180, 820],
  ["desktop", "桌面", 1440, 900],
] as const;

export default function ThemePreview() {
  const params = new URLSearchParams(location.search);
  const initialTheme: PreviewTheme = THEMES.find(([id]) => id === params.get("theme-preview"))?.[0] ?? "pelican";
  const [theme, setTheme] = useState<PreviewTheme>(initialTheme);
  const [sizeId, setSizeId] = useState(params.get("size") ?? "portrait");
  const [motion, setMotion] = useState(params.get("motion") !== "off");
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const bare = params.has("bare");
  const size = SIZES.find(([id]) => id === sizeId) ?? SIZES[0];
  const [, , width, height] = size;
  const sceneUrl = `?theme-preview=${theme}&bare&motion=${motion ? "on" : "off"}`;

  useLayoutEffect(() => {
    // Preview state stays in its URL; it never changes the user's saved appearance.
    const root = document.documentElement;
    root.dataset.theme = bare ? theme : "dark";
    root.dataset.themeMotion = motion ? "on" : "off";
    root.dataset.motion = "on";
    root.dataset.themePreview = bare ? "scene" : "studio";
    document.title = `${THEMES.find(([id]) => id === theme)?.[1]} · 主题预览`;
    if (bare || !stage.current) return;
    const element = stage.current;
    const resize = () => setScale(Math.max(.05, Math.min(1, (element.clientWidth - 32) / width, (element.clientHeight - 32) / height)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bare, theme, motion, width, height]);

  useEffect(() => {
    if (bare) {
      let cancelled = false;
      const urls = new Set<string>();
      document.querySelectorAll(".theme-scene *").forEach((element) => {
        [undefined, "::before", "::after"].forEach((pseudo) => {
          const background = getComputedStyle(element, pseudo).backgroundImage;
          for (const match of background.matchAll(/url\(["']?([^"')]+)/g)) urls.add(match[1]);
        });
      });
      void Promise.allSettled([...urls].map(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
      })).then((results) => {
        if (!cancelled && window.parent !== window) window.parent.postMessage({
          type: "banbu-theme-preview-ready", theme, motion,
          failed: results.some((result) => result.status === "rejected"),
        }, location.origin);
      });
      return () => { cancelled = true; };
    }
    setReady(false);
    setLoadError(false);
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== "banbu-theme-preview-ready" || event.data.theme !== theme || event.data.motion !== motion) return;
      setReady(true);
      setLoadError(event.data.failed);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [bare, theme, motion]);

  useLayoutEffect(() => {
    if (bare) return;
    const url = new URL(location.href);
    url.searchParams.set("theme-preview", theme);
    url.searchParams.set("size", sizeId);
    url.searchParams.set("motion", motion ? "on" : "off");
    history.replaceState(null, "", url);
  }, [bare, theme, sizeId, motion]);

  if (bare) return <main className="theme-preview-canvas"><ThemeScene theme={theme} /></main>;

  return <main className="theme-studio">
    <header className="theme-studio-toolbar">
      <div className="theme-studio-title"><b>主题画室</b><span>完整风景 · 原尺寸适配</span></div>
      <div className="theme-studio-tabs" role="group" aria-label="预览主题">
        {THEMES.map(([id, name]) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)}>{name}</button>)}
      </div>
      <label className="theme-studio-size">画幅<select aria-label="画幅尺寸" value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
        {SIZES.map(([id, name, w, h]) => <option key={id} value={id}>{name} {w} × {h}</option>)}
      </select></label>
      <button type="button" className="theme-studio-motion" aria-pressed={motion} onClick={() => setMotion(!motion)}>动效{motion ? "开" : "关"}</button>
      <a href={sceneUrl} target="_blank" rel="noreferrer">打开完整背景 ↗</a>
    </header>
    <div className="theme-studio-stage" ref={stage}>
      <div className="theme-studio-frame" style={{ width: width * scale, height: height * scale }}>
        <iframe ref={frame} title={`${THEMES.find(([id]) => id === theme)?.[1]}完整主题`} src={sceneUrl} data-ready={ready}
          style={{ width, height, transform: `scale(${scale})` } as CSSProperties} />
        {!ready && <div className="theme-studio-loading" role="status">正在铺开画卷…</div>}
        {loadError && <div className="theme-studio-loading" role="alert">部分素材未加载，请刷新重试</div>}
      </div>
    </div>
    <footer className="theme-studio-footer"><span>{size[1]} · {width} × {height}</span><span>缩放 {Math.round(scale * 100)}% · 棋盘与按钮已隐藏</span></footer>
  </main>;
}
