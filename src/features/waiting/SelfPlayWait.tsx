/**
 * 等待动效「VCF 演算」（用户 2026-10-08 从 7 个创意里挑的第 ① 个；落子逻辑我错了两版，这是第三代）。
 *
 * 形态：**一道 VCF 题被反复演算**。题面布子一开始就在盘上（真实题目就是这样），只演"解"：
 * 黑方一记冲四 → 白方唯一一处被迫挡 → 黑方再冲四 → …；末手成杀后停一拍，解的子一起退场重演。
 * 题面不参与演出，所以不存在"落子顺序不合法"。
 *
 * 用户的三条口径（都落在代码里）：
 *   ① 三子及以下正常、四子＝冲四、五连才是胜利；**只要盘面上不出现五连就行**
 *      → 数据侧硬卡「双方全程最长连子 ≤ 4」（见 qa/gen-wait-vcf.test.ts）。
 *   ② 画面像真实棋盘的**局部特写**：不画外框，格线一直延伸出画面
 *      → 这里没有任何 board 外框元素，格线在垂直方向贯穿整幅（-14 到 114），
 *        最外侧的格线离边缘半格 ⇒ 边缘看到的是"被切掉的半格"，不是一条封边。
 *   ③ 构图**不能上下左右对称**（稍微收拾可以，完全对称显廉价）
 *      → 取景窗口是不等边距的（左/上留 1 格、右/下留 2 格，见 WAIT_CROP），
 *        所以棋子团不居中；棋子分布本身也是不规则的对攻形。
 *
 * ⚠ 落子数据不是我手摆的：手摆过一版，中间直接摆出五连、五连后还在落子（用户点过名）。
 *   现在来自 qa/gen-wait-vcf.test.ts：随机紧凑局面 → 项目自己的 solveVcf 搜线 →
 *   verifyVcfLine 复核通过 → 写成 wait-vcf-data.ts。换局面改那个脚本的种子重跑。
 * ⚠ 纯 CSS 驱动，不跑 JS：每手一段按手数算好的关键帧（生成在 waiting.css 占位区），
 *   用 `animation-name: var(--kf)` 指过去，周期 = 手数 × 每手节拍。
 */
import type { CSSProperties } from "react";
import { WAIT_GIVENS, WAIT_LINE, WAIT_CROP, WAIT_STARS } from './wait-vcf-data';
import './waiting.css';

const [C0, R0, CELLS] = WAIT_CROP;
const CELL = 100 / (CELLS + 1);              // 一格 = 100/(格数+1)，于是最外侧格线离边半格
const at = (k: number, o: number) => +((k - o + 0.5) * CELL).toFixed(3);
/** 格线：贯穿整幅（两端各多画一格半，保证一定被画面切掉，不会在边上收口） */
const LO = -1.5 * CELL, HI = 100 + 1.5 * CELL;
const lines = Array.from({ length: CELLS + 3 }, (_, i) => C0 - 1 + i);

export function SelfPlayWait({ className = "" }: { className?: string }) {
  return <svg className={`wait-vcf ${className}`} viewBox="0 0 100 100" role="img"
    aria-label="正在演算一道 VCF 题：连续冲四"
    style={{ "--wait-cycle": `calc(${WAIT_LINE.length} * var(--wait-step))` } as CSSProperties}>
    {/* 木盘：铺满整幅，**不画外框** */}
    <rect className="wait-vcf__wood" x={LO} y={LO} width={HI - LO} height={HI - LO} />
    <g className="wait-vcf__grid">
      {lines.map(c => <path key={`v${c}`} d={`M${at(c, C0)} ${LO}V${HI}`} />)}
      {lines.map(r => <path key={`h${r}`} d={`M${LO} ${at(r, R0)}H${HI}`} />)}
    </g>
    <g className="wait-vcf__stars">
      {WAIT_STARS.map(([c, r], i) => <circle key={i} cx={at(c, C0)} cy={at(r, R0)} r="1.1" />)}
    </g>
    {/* 题面布子：一开始就在盘上，不参与演出 */}
    <g className="wait-vcf__givens">
      {WAIT_GIVENS.map(([col, row, white], i) => (
        <circle key={i} className={`wait-vcf__stone ${white ? "is-white" : "is-black"}`}
          cx={at(col, C0)} cy={at(row, R0)} r={CELL * 0.44} />
      ))}
    </g>
    {/* 解：按手顺演出。--kf 指向这一手的关键帧（生成在 waiting.css 里） */}
    <g className="wait-vcf__line">
      {WAIT_LINE.map(([col, row, white], i) => (
        <circle key={i} className={`wait-vcf__move ${white ? "is-white" : "is-black"}`}
          cx={at(col, C0)} cy={at(row, R0)} r={CELL * 0.44} style={{ "--kf": `wait-vcf-${i}` } as CSSProperties} />
      ))}
    </g>
  </svg>;
}

/**
 * 等待弹窗：动效 + 一句**会说人话的状态** + 一个能停止的出口。
 * 状态文字由调用方给（接真实进度，别写假百分比——长等待里文字比动画更有用）。
 */
export function WaitingOverlay({ title, detail, onStop, stopLabel = "停止" }: {
  title: string; detail?: string; onStop?: () => void; stopLabel?: string;
}) {
  return <div className="wait-overlay" role="dialog" aria-modal="true" aria-labelledby="wait-overlay-title">
    <div className="wait-card">
      <SelfPlayWait />
      <b id="wait-overlay-title">{title}</b>
      {detail ? <small>{detail}</small> : null}
      {onStop ? <button type="button" className="wait-stop" onClick={onStop}>{stopLabel}</button> : null}
    </div>
  </div>;
}
