import { useEffect, useState, type CSSProperties } from "react";
import "./opening-reveal.css";

/**
 * 开局名浮字（用户 2026-10-09）。
 *
 * 用户原话：「当我们摆出这个开局后，会出现弹窗的字『xx』，比如花月，雨月这种的，
 * 这个字出现在棋盘中心的下面，**不会影响点击棋盘什么的**，然后也**不会出现很久**」。
 * 第二轮追加两条：
 *   「落子后一下子就没了，还不到1秒钟」——**修的是 CSS 的时长 bug**（关键帧自带淡出，
 *   而 animation 时长只给了 260ms，等于整个揭示被压成 0.26 秒；详见 opening-reveal.css 头注）。
 *   「没有美术效果，没有设计感，应该要搞成那个毛笔字体，里面应该加一点东西」——做成
 *   **一方宣纸题签**：落墨 + 楷体题名 + 竖排「直指/斜指」落款 + 朱红编号小印 + 一道墨扫。
 *
 * 三条硬要求与做法：
 *  1. **出现在棋盘中心下方**：绝对定位挂在 `.duel-board`（棋盘的 flex 槽，已加 `position:relative`）
 *     上，水平居中、贴在棋盘下缘**内侧**一点。**不写进文档流**，所以对棋盘位置零影响——
 *     这一点在本应用是被钉死的（R110：棋盘曾因下方条件渲染的条每 200ms 换行而上下跳 12px，
 *     实测位移 12px→0px 后才收工），任何"在棋盘附近新增一行"的写法都会重犯那个 bug。
 *  2. **不影响点击**：整块 `pointer-events:none`。棋盘的点击热区一个都不碰。
 *  3. **不出现很久**：`OPENING_REVEAL_MS` 后自己卸载（淡入→停留→淡出），DOM 里不留残留。
 *     这个常量也是 CSS 的 `--reveal-ms`：**总时长只有一个来源**，避免时长与关键帧各说各话
 *     （那正是「不到 1 秒就没了」的成因）。
 *
 * 无障碍：`role="status"`（polite）念一句「开局 花月 d4」。它不是关键信息，
 * 所以不抢焦点、不打断正在进行的朗读。
 */

/**
 * 停留时长：够看清题名与落款，又不至于挡着下一步思考。
 * ⚠ 改这里就够了——组件把它写进 `--reveal-ms`，CSS 的关键帧按百分比分配节奏。
 */
export const OPENING_REVEAL_MS = 2600;

export interface OpeningRevealProps {
  /** 开局名（如「花月」）；null 表示这一局没有可识别的标准开局，组件不渲染。 */
  name: string | null;
  /** RIF 编号（d4 / i11…），刻在朱红小印上。 */
  code?: string;
  /** 直指 / 斜指，作竖排落款。 */
  family?: "direct" | "indirect";
  /**
   * 触发标识：同一个标识只揭示一次；换了标识（新的一局、或重摆到第三手）
   * 会重新走一遍「淡入 → 停留 → 淡出」。用第三手节点的 id 当这个值最自然。
   */
  epoch: string;
}

export function OpeningReveal({ name, code, family, epoch }: OpeningRevealProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!name) { setVisible(false); return; }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), OPENING_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [name, epoch]);

  if (!name || !visible) return null;
  return (
    <div
      className="opening-reveal"
      data-opening-reveal=""
      role="status"
      aria-live="polite"
      // 总时长只有一个来源：CSS 关键帧按百分比走节奏，改这个数就同时改了停留时间。
      style={{ "--reveal-ms": `${OPENING_REVEAL_MS}ms` } as CSSProperties}
    >
      <b className="opening-reveal-name" data-opening-reveal-name>{name}</b>
      {family && <span className="opening-reveal-family">{family === "direct" ? "直指" : "斜指"}</span>}
      {code && <span className="opening-reveal-seal" data-opening-reveal-seal>{code}</span>}
      <i className="opening-reveal-stroke" aria-hidden="true"/>
    </div>
  );
}
