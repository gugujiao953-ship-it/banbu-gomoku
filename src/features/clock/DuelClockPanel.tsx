import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play, RotateCcw, Scale, Settings, X } from "lucide-react";
import {
  CLOCK_LOW_MS,
  CLOCK_PRESETS,
  CLOCK_PRESET_GROUPS,
  clockDisplaySlots,
  clockWinner,
  createClock,
  flagBothClock,
  formatClockMs,
  isClockDraw,
  isClockIdle,
  isClockOver,
  isLowOnTime,
  lowTimeSecond,
  pauseClock,
  remainingAt,
  resignClock,
  restartClock,
  resumeClock,
  sideLabel,
  switchClock,
  tickClock,
  type ClockMode,
  type ClockPresetGroup,
  type ClockSettings,
  type ClockSide,
  type ClockState,
} from "./duel-clock";
import { sameClockSettings } from "./clock-settings";
import { OverlayBrandMark, OverlayPattern } from "../../ui/overlays/OverlayBrand";
import "./clock.css";

/**
 * 线下比赛的计时器（用户 2026-09-23）。
 *
 * **这是一个独立功能，不是对弈的一部分**：两个人用真实棋盘真实棋子下棋，手机/平板
 * 放在旁边当钟用。所以界面里**没有棋盘、没有任何其它东西**——占满整屏、上下各一半、
 * 中间一枚退出按钮。
 *
 * 按钟方式：**点自己那半屏任意位置**（用户钦定）。整半屏都是热区，跟实体棋钟的拍键
 * 一样盲按也能中；谁走完谁按一下，时间就交给对方。
 *
 * 开局钟是**停着**的（`runningSince` 为 null）：摆好设备、双方就位之后，由**先走的那一方**
 * 点自己那半屏按下开始——在按下之前一秒都不扣（用户 09-23 点名）。所以刚开始时先走那半屏
 * 亮着并写着「点一下开始计时」，按下之后才变成「点一下交给对方」。
 *
 * 数字大小是**算出来的**，不是写死的（用户 09-23 点名「2 小时的秒数被挤出画面」）：
 * 见 `useFitFontSize`。写死字号时 5 分钟档看着正好，切到 2 小时就变成 7 个字符、
 * 横向撑爆自己的半屏。现在按「这档可能出现的最长字符串」反推字号，并把最长字符串的
 * 宽度也一并算进去，所以任何档位都完整落在自己的半屏里。
 *
 * 摆法是**上下互为镜像**的（用户 09-24 定）：设备平放桌上、两人对坐，**上半屏整块转 180°**。
 * 这样上面那个人读到的 `5:00` 是正向的——因为那半屏本来就是冲着他摆的。
 *
 * 之前做过一版「翻转按钮」（点一下两半一起转），是错的：一个按钮只能让**一种**朝向生效，
 * 而两个人对坐这件事是对称的，总有一个人得歪着头读。镜像不是可选项，是这张屏幕的默认摆法，
 * 所以它现在没有任何开关。热区与控制条都不跟着转：整半屏始终可点，中控条固定在正中。
 *
 * 时间真相在 duel-clock.ts 的纯函数状态机里（用到期时间戳而非累加计数），
 * 这里的定时器只负责重绘——息屏/切走回来时间依然准。
 */

export interface DuelClockPanelProps {
  initialSettings: ClockSettings;
  onSettingsChange: (settings: ClockSettings) => void;
  onExit: () => void;
  /** 双方的落子音与报时音。 */
  onPressSound?: (side: ClockSide) => void;
  onTickSound?: () => void;
  onFlagSound?: () => void;
}

/**
 * 把数字缩到刚好铺满自己的半屏——按**这一档可能出现的最长字符串**算一次，整局不再变。
 *
 * 为什么不是「每帧按当前值算」：那样从 `10:00` 走到 `9:59` 时字号会跳一下，隔着桌子
 * 看像是卡了一帧；而且每 200ms 重排一次字体代价不小。所以只在**档位改变或转屏**时重算。
 *
 * 宽度系数是**实测**出来的，不是估的：把 `.clock-half-time` 的离屏副本按 100px / 187px
 * 两档字号量各档字符串（`5:00` / `59:59` / `2:00:00` / `-0:09`），得到每字符占 0.48~0.53 em；
 * 取 0.535 覆盖最宽的 `59:59` 再留一点余量。用 0.62 这种粗估会让字号白白小掉近两成
 * （5 分钟档本来能到 187px，粗估只给到 116px）。
 */
const EM_PER_CHAR = 0.535;
/**
 * 半屏里除数字之外要占的高度：方名 19px + 提示行 35px + 两处 6px 间距 + 上下留白。
 * 这个数也是实测的（见文件里 `.clock-half-*` 各行的高度），不是估的：
 * 估大了会让字号白白小一档，等于把「隔着桌子看得见」这个前提让掉。
 */
const READOUT_CHROME_PX = 86;

/**
 * 半屏里给数字留的内边距（左右各 14px，与 .clock-half 的 padding 一致）。
 * 留出来是为了不贴边：数字顶到屏幕边线上会很廉价，也容易被机身边缘挡住。
 */
const HALF_PADDING_X = 28;

/**
 * 量一个字符串在等宽字型下、给定字号时的宽度（em 为单位的比例）。
 *
 * 为什么不直接写死「每字符 0.535em」：`5:00` 与 `2:00:00` 里冒号更窄、数字更宽，
 * 按最宽字符统一乘会把短字符串算得过宽（5 分钟档因此白白小掉三成）。
 * 这里用离屏量一次真实比例，缓存起来——只在档位改变时量，不进渲染循环。
 */
const measureEmRatio = (text: string): number => {
  const probe = document.createElement("output");
  probe.className = "clock-half-time";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.left = "-9999px";
  probe.style.fontSize = "100px";
  probe.textContent = text;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  // 宽度 / 字号 / 字符数 = 平均每字符占多少 em
  return width / 100 / text.length;
};

const useFitFontSize = (slots: number) => {
  const [size, setSize] = useState(120);
  useLayoutEffect(() => {
    const measure = () => {
      // 按这一档可能出现的最长字符串量真实比例（不是按当前值——那会让字号跳动）。
      // clockDisplaySlots 只会给 5 / 7 / 8 三档，所以 5 档要按 **5 字符**的 `00:00` 量：
      // 5 分钟档加秒后能显示 10:52，20/30 分钟档一开局就是「20:00」「30:00」，
      // 按 4 字符的 `0:00` 量会把字号算大 1/4（2026-10-01 实测 392px 宽只剩 28px 余量）。
      const longest = slots >= 8 ? "00:00:00" : slots >= 7 ? "0:00:00" : "00:00";
      const ratio = measureEmRatio(longest) || EM_PER_CHAR;
      const landscape = window.matchMedia("(orientation: landscape) and (max-height: 560px)").matches;
      const halfWidth = (landscape ? window.innerWidth / 2 : window.innerWidth) - HALF_PADDING_X;
      const halfHeight = (landscape ? window.innerHeight : window.innerHeight / 2) - READOUT_CHROME_PX;
      const byWidth = halfWidth / (longest.length * ratio);
      // 数字本身的行高就是 1em（CSS line-height: 1），所以高度预算可以直接给字号。
      const byHeight = halfHeight;
      setSize(Math.max(38, Math.min(240, Math.floor(Math.min(byWidth, byHeight)))));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [slots]);
  return size;
};

/** 制式的中文名（设置面板与描述都用这一份，避免两处写不一样的词）。 */
const MODE_LABEL: Record<ClockMode, string> = { fischer: "包干 / 加秒", bronstein: "延时", readOff: "读秒" };

/** 把毫秒拆成「分 + 秒」两个输入框要显示的值。 */
const splitMs = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
};

export function DuelClockPanel({ initialSettings, onSettingsChange, onExit, onPressSound, onTickSound, onFlagSound }: DuelClockPanelProps) {
  const [settings, setSettings] = useState<ClockSettings>(initialSettings);
  const [clock, setClock] = useState<ClockState>(() => createClock(initialSettings, "black", performance.now()));
  const [now, setNow] = useState(() => performance.now());
  const [showSetup, setShowSetup] = useState(false);
  const lastTickSecond = useRef<number | null>(null);
  const flaggedRef = useRef<ClockSide | null>(null);
  // 定时器与 visibilitychange 回调要读最新 clock，但不该因 clock 变化反复重建。
  const clockRef = useRef(clock);
  clockRef.current = clock;

  // 每 200ms 只把「现在几点」推给渲染；真正的扣减在 tickClock 里按时间戳算。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = performance.now();
      setNow(current);
      setClock((state) => tickClock(state, current));
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  // 息屏/切走回来立刻补算一次，不等下一个 tick。
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) { const current = performance.now(); setNow(current); setClock((state) => tickClock(state, current)); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 逐秒报时：只在「剩 ≤10 秒 + 轮走方」时，整秒变化才响。
  useEffect(() => {
    if (!onTickSound) return;
    const second = lowTimeSecond(clock, now);
    if (second === null) { lastTickSecond.current = null; return; }
    if (lastTickSecond.current !== second) { lastTickSecond.current = second; onTickSound(); }
  }, [clock, now, onTickSound]);

  // 超时只通知一次。
  useEffect(() => {
    if (clock.flagged && flaggedRef.current !== clock.flagged) { flaggedRef.current = clock.flagged; onFlagSound?.(); }
    if (!clock.flagged) flaggedRef.current = null;
  }, [clock.flagged, onFlagSound]);

  /** 点自己那半边＝我这手走完了，把钟交给对方。 */
  const pressSide = useCallback((side: ClockSide) => {
    const state = clockRef.current;
    if (state.paused || isClockOver(state) || state.turn !== side) return;
    onPressSound?.(side);
    const advanced = switchClock(state, side, performance.now());
    clockRef.current = advanced;
    setClock(advanced);
  }, [onPressSound]);

  const remaining = useMemo(() => ({
    black: remainingAt(clock, "black", now),
    white: remainingAt(clock, "white", now),
  }), [clock, now]);

  const winner = clockWinner(clock);
  const over = isClockOver(clock);
  const draw = isClockDraw(clock);
  // 「判和」什么时候可用：没认负、还没记过和。认负是明确原因不能改；
  // 一方超时**不算**明确原因——双超时按连珠规则就是和棋（见下面那颗按钮的注释）。
  const canFlagBoth = !clock.resigned && !clock.flaggedBoth;
  // 开局钟是停的，等先走方按一下才开始——提示语要说得像句人话，别只说「点一下开始」。
  const idle = isClockIdle(clock);
  const startHint = (side: ClockSide) => (clock.turn === side ? "先走的一方点这里开始计时" : "点一下开始计时");

  // 字号按「这一档可能出现的最长字符串」定一次（见 useFitFontSize 的注释）。
  const slots = clockDisplaySlots(settings.baseMs);
  const fitSize = useFitFontSize(slots);

  const applySettings = (next: ClockSettings) => {
    setSettings(next);
    onSettingsChange(next);
    const fresh = createClock(next, "black", performance.now());
    clockRef.current = fresh;
    setClock(fresh);
  };

  /** 换计时方式：只改 mode，数值字段原样保留（方便来回比较几种方式）。 */
  const applyMode = (mode: ClockMode) => applySettings({ ...settings, mode });

  const baseParts = splitMs(settings.baseMs);
  // 总时限的最小值是 1 秒——填 0 分 0 秒等于开局即负，没有意义。
  const applyBase = (minutes: number, seconds: number) => {
    const totalMs = Math.max(1000, (Math.max(0, minutes) * 60 + Math.max(0, seconds)) * 1000);
    applySettings({ ...settings, baseMs: totalMs });
  };

  const renderHalf = (side: ClockSide) => {
    const left = remaining[side];
    const active = !over && !clock.paused && clock.turn === side;
    const low = isLowOnTime(clock, side, now);
    const won = winner === side;
    // 还没按下去：先走那半屏亮着等「按下开始」，另一半照旧等着，谁都不走时间。
    const waitingToStart = idle && active;
    // 读秒段要额外把周期数说出来：那时屏上倒的是「本手读秒」，不提周期会让人
    // 以为是主时间。这是读秒制式的关键信息（实体钟也有周期指示）。
    const inPeriod = clock.settings.mode === "readOff" && clock.remaining[side] <= 0 && clock.periods[side] > 0;
    return (
      <button
        type="button"
        key={side}
        className={`clock-half clock-half--${side}${active ? " is-active" : ""}${low ? " is-low" : ""}${won ? " is-winner" : ""}${waitingToStart ? " is-idle" : ""}`}
        data-clock-side={side}
        data-clock-active={active ? "true" : "false"}
        data-clock-low={low ? "true" : "false"}
        data-clock-idle={waitingToStart ? "true" : "false"}
        onClick={() => pressSide(side)}
        aria-label={`${sideLabel(side)}：${waitingToStart ? "点一下开始计时" : active ? "走时中，点一下交给对方" : "等待"}`}
      >
        {/* 白方那半**整块**由 CSS 转 180°（.clock-half--white，默认摆法不是开关）：
            设备平放桌上、两人对坐时，上半屏正对着对面那个人，整块倒过来他读到的就是正向。
            这里不再单独转内层——只转内层而外层照常居中，两半就只是各自倒过来、
            接缝处对不上（阿Q棋钟是把 rotation 放在整块容器上，照这个来）。 */}
        <span className="clock-half-readout">
          <span className="clock-half-name">{sideLabel(side)}</span>
          <output className="clock-half-time" data-clock-time={side} style={{ fontSize: `${fitSize}px` }}>{formatClockMs(left)}</output>
          <span className="clock-half-hint">
            {over && clock.flagged === side ? "超时"
              : waitingToStart ? startHint(side)
              : active ? (clock.paused ? "已暂停" : "点一下交给对方")
              : "\u00a0"}
          </span>
          {/* 左下：读秒剩余次数；只有进读秒段才显示（照阿Q棋钟的摆法：
              它左下角是「当前剩余读秒次数」、右下角是「当前步数」）。
              读秒段里屏上倒的是「本手读秒」，不标次数会让人以为是主时间。 */}
          {inPeriod && (
            <span className="clock-half-corner clock-half-corner--start" data-clock-period={side}>
              读秒 {clock.periods[side]} 次
            </span>
          )}
          {/* 右下：本手数。线下对局要靠它核对「是不是该黑方走了」，也是复盘起点。 */}
          {clock.moves[side] > 0 && (
            <span className="clock-half-corner clock-half-corner--end" data-clock-moves={side}>
              {clock.moves[side]} 手
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="clock-fullscreen" data-clock-panel="" data-clock-fullscreen="">
      {/* 上半屏是白方、下半屏是黑方；白方那半整体转 180°（见上面 renderHalf 里的注释），
          所以两人对坐时各自的读数都是正向的。 */}
      {renderHalf("white")}
      {renderHalf("black")}

      {/* 正中：唯一的控制区。暂停可一眼看出状态，退出是这里唯一的出口。 */}
      <div className="clock-center">
        <button
          type="button"
          className={`clock-center-button${clock.paused ? " is-paused" : ""}`}
          data-clock-action="pause"
          onClick={() => { const current = performance.now(); setClock((state) => state.paused ? resumeClock(state, current) : pauseClock(state, current)); }}
          disabled={over}
          aria-label={clock.paused ? "继续计时" : "暂停计时"}
        >
          {clock.paused ? <Play size={18}/> : <Pause size={18}/>}
          <span>{clock.paused ? "继续" : "暂停"}</span>
        </button>
        {/* 双超时判和：连珠/五子棋规则规定「发现时两个钟都走完、又分不出谁先」是和棋。
            线下很常见（两人都没盯钟，抬头一看两边都是 0），所以给一个明确的按钮，
            免得僵在那里不知道该记谁输。
            **注意不要用 disabled={over}**：状态机在任意一方时间走完的那一刻就已经终局了，
            而这条按钮要处理的正是「终局之后才发现两边都走完」——2026-10-01 实测那时它点不动。
            只有认负（明确的终局原因）和已经记过和才禁掉。 */}
        <button
          type="button"
          className="clock-center-button clock-center-button--ghost"
          data-clock-action="flag-both"
          onClick={() => setClock((state) => flagBothClock(state))}
          disabled={!canFlagBoth}
          aria-label="双方都已超时，按连珠规则判和"
        >
          <Scale size={18}/>
          <span>判和</span>
        </button>
        <button type="button" className="clock-center-button clock-center-button--ghost" data-clock-action="settings" onClick={() => setShowSetup(true)} aria-label="时限设置">
          <Settings size={18}/>
          <span>设置</span>
        </button>
        {/* 退出：整个界面唯一的「离开这里」。 */}
        <button type="button" className="clock-exit" data-clock-action="exit" onClick={onExit} aria-label="退出计时器">
          <X size={20}/>
        </button>
      </div>

      {over && (
        <div className="clock-over" role="status" data-clock-result={draw ? "draw" : winner ?? "none"}>
          <div className="clock-over-card">
            <div className="clock-result-decoration" aria-hidden="true"><OverlayPattern/></div>
            <div className="clock-result-art" aria-hidden="true"><OverlayBrandMark/></div>
            <b>{draw ? "和棋" : winner ? `${sideLabel(winner)}胜` : "结束"}</b>
            <small>
              {draw ? "双方都超时（连珠规则：无法确定谁先超时 → 和棋）"
                : clock.flagged ? `${sideLabel(clock.flagged)}超时`
                : clock.resigned ? `${sideLabel(clock.resigned)}认输` : ""}
            </small>
            <div className="clock-over-actions">
              {/* 终局卡片上也给一颗「记和」：`.clock-over` 是铺满整屏的浮层，
                  会把中控条盖住——只在中控条给按钮的话，超时之后那颗根本点不到（2026-10-01 实测）。 */}
              {canFlagBoth && clock.flagged && (
                <button type="button" data-clock-action="flag-both-over" onClick={() => setClock((state) => flagBothClock(state))}>
                  <Scale size={15}/>对方也走完了，记和
                </button>
              )}
              <button type="button" onClick={() => { const fresh = createClock(settings, "black", performance.now()); clockRef.current = fresh; setClock(fresh); }}><RotateCcw size={15}/>再来一局</button>
              <button type="button" className="clock-over-exit" onClick={onExit}>退出</button>
            </div>
          </div>
        </div>
      )}

      {showSetup && (
        <div className="clock-setup-overlay" role="dialog" aria-modal="true" aria-label="时限设置" data-clock-setup="">
          <div className="clock-setup-card">
            <div className="clock-setup-head">
              <div className="clock-overlay-decoration" aria-hidden="true"><OverlayPattern/></div>
              <b>时限设置</b>
              <button type="button" onClick={() => setShowSetup(false)} aria-label="关闭设置"><X size={18}/></button>
            </div>

            {/* 计时方式：三格**各带自己那一制的当前数值**，所以三种设置一眼看全，
                不用来回点着猜「选过去会是多少」（用户 2026-10-01：设置要一屏看完）。
                改方式只动 mode，其余字段原样保留，方便几种方式之间来回比较。 */}
            <div className="clock-setup-section">
              <span className="clock-setup-label">计时方式（格上的数字就是各制的设置）</span>
              <div className="clock-modes" role="radiogroup" aria-label="计时方式">
                <ModeButton mode="fischer" current={settings.mode} onPick={applyMode} label="包干 / 加秒"
                  value={settings.incrementMs > 0 ? `每手 +${Math.round(settings.incrementMs / 1000)} 秒` : "不加秒（包干）"} icon="sudden" />
                <ModeButton mode="bronstein" current={settings.mode} onPick={applyMode} label="延时"
                  value={`每手返 ≤${Math.round(settings.delayMs / 1000)} 秒`} icon="delay" />
                <ModeButton mode="readOff" current={settings.mode} onPick={applyMode} label="读秒"
                  value={`${Math.round(settings.readOffMs / 1000)} 秒 × ${settings.readOffPeriods}`} icon="yomi" />
              </div>
            </div>

            {/* 时限一行放完：总时限（分 + 秒）+ 当前制式的那一项。
                分与秒分开填，所以 1:30、0:45 这类非整分档也填得出来（老版本只有整分钟框）。
                只显示当前制式用得上的额度字段——四个都摆出来只会让人猜「哪个算数」；
                三种制式的额度各是多少，上面那三格已经写着了。 */}
            <div className="clock-setup-section">
              <span className="clock-setup-label">{settings.mode === "readOff" ? "主时间 + 读秒" : "总时限 + 每手"}</span>
              <div className="clock-duration-row">
                <NumberUnit unit="分" value={baseParts.minutes} min={0} max={360} field="base-min"
                  onChange={(minutes) => applyBase(minutes, baseParts.seconds)} />
                <NumberUnit unit="秒" value={baseParts.seconds} min={0} max={59} field="base-sec"
                  onChange={(seconds) => applyBase(baseParts.minutes, seconds)} />
                {settings.mode === "fischer" && (
                  <NumberUnit unit="秒 / 手" value={Math.round(settings.incrementMs / 1000)} min={0} max={300} field="increment"
                    onChange={(seconds) => applySettings({ ...settings, incrementMs: seconds * 1000 })} />
                )}
                {settings.mode === "bronstein" && (
                  <NumberUnit unit="秒 / 手" value={Math.round(settings.delayMs / 1000)} min={0} max={300} field="delay"
                    onChange={(seconds) => applySettings({ ...settings, delayMs: seconds * 1000 })} />
                )}
                {settings.mode === "readOff" && (
                  <>
                    <NumberUnit unit="秒 / 次" value={Math.round(settings.readOffMs / 1000)} min={1} max={600} field="readoff"
                      onChange={(seconds) => applySettings({ ...settings, readOffMs: seconds * 1000 })} />
                    <NumberUnit unit="次" value={settings.readOffPeriods} min={1} max={20} field="periods"
                      onChange={(periods) => applySettings({ ...settings, readOffPeriods: periods })} />
                  </>
                )}
              </div>
              {settings.mode === "fischer" && (
                <p className="clock-setup-help">每手加秒填 <b>0</b> 就是<b>包干</b>（用完判负）。填秒数是<b>菲舍尔加秒</b>：每手无条件加回这么多，走得快时<b>可以超过总时限</b>（实体钟也这样，RIF 世锦赛即 2 小时 + 30 秒）。</p>
              )}
              {settings.mode === "bronstein" && (
                <p className="clock-setup-help"><b>布龙斯坦延时</b>：每手加回「本手用时」与「延时额度」的较小者，所以剩余<b>不会变多</b>。额度是这一手的<b>保护时</b>：主时间走完不判负，要用满「主时间 + 延时」才超时（保护期里数字为负＝已吃掉的延时，交钟时补回）。</p>
              )}
              {settings.mode === "readOff" && (
                <p className="clock-setup-help"><b>读秒（byo-yomi）</b>：主时间用完后每手限固定秒数，超时扣一次、同一手接着吃下一个周期；次数用完仍没落子即判负。屏上会标出还剩几次。</p>
              )}
            </div>

            {/* 预设：组名在左、档位一行横向滑。两列铺开时 17 档要 9 行 ≈700px，
                光这一块就吃掉一整屏（392×852 实测整个浮层要滚 696px）——用户 10-01 要求
                「设置尽量一屏看完，就像人机对战里面那样」，所以改成每组一行。 */}
            <div className="clock-setup-section">
              <span className="clock-setup-label">常用时限（每组一行，往右滑）</span>
              {CLOCK_PRESET_GROUPS.map((group) => (
                <div className="clock-preset-group" key={group} data-clock-preset-group={group}>
                  <span className="clock-preset-group-name">{group}</span>
                  <div className="clock-presets" role="radiogroup" aria-label={`${group} 时限`}>
                    {CLOCK_PRESETS.filter((preset) => preset.group === group).map((preset) => {
                      const active = sameClockSettings(preset.settings, settings);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`clock-preset${active ? " selected" : ""}`}
                          data-clock-preset={preset.id}
                          onClick={() => applySettings(preset.settings)}
                        >
                          <b>{preset.title}</b>
                          <small>{preset.text}</small>
                          {active && <Check size={14} className="clock-preset-check"/>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <p className="clock-setup-help">改动会立刻重开一局，并且要先走的一方按一下才开始计时。</p>
            <button type="button" className="clock-setup-done" onClick={() => setShowSetup(false)}>知道了</button>
          </div>
        </div>
      )}

      {!over && !clock.paused && clock.turn && remaining[clock.turn] <= CLOCK_LOW_MS && remaining[clock.turn] > 0 && (
        <p className="clock-low-note" role="status">只剩 {Math.ceil(remaining[clock.turn] / 1000)} 秒</p>
      )}
    </div>
  );
}

/**
 * 「分 + 秒」两个数字框中的一个，带单位后缀。
 *
 * 单位不进输入框、单独放右边，是为了让输入框本身宽度固定、四个字段排得整齐；
 * 也避免用户把「分」当成「秒」填错一位（1 分 30 秒填成 130 秒那种）。
 */
function NumberUnit({ unit, value, min, max, field, onChange }: {
  unit: string;
  value: number;
  min: number;
  max: number;
  field: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="clock-unit">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        data-clock-field={field}
        aria-label={unit}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          const next = Number.isFinite(parsed) ? parsed : min;
          onChange(Math.min(max, Math.max(min, Math.round(next))));
        }}
      />
      <span className="clock-unit-suffix">{unit}</span>
    </label>
  );
}

const MODE_ICON: Record<string, string> = { sudden: "⏱", delay: "⏳", yomi: "🔁" };

/** 计时方式的一个选项卡。选中态要明显——这是设置面板里最上面的决定。
 *  第二行显示**该制式当前的数值**，三种设置因此可以一眼看全。 */
function ModeButton({ mode, current, onPick, label, value, icon }: {
  mode: ClockMode;
  current: ClockMode;
  onPick: (mode: ClockMode) => void;
  label: string;
  value: string;
  icon: string;
}) {
  const active = mode === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`clock-mode${active ? " selected" : ""}`}
      data-clock-mode={mode}
      onClick={() => onPick(mode)}
    >
      <span className="clock-mode-icon" aria-hidden="true">{MODE_ICON[icon]}</span>
      <b>{label}</b>
      <span className="clock-mode-value">{value}</span>
    </button>
  );
}
