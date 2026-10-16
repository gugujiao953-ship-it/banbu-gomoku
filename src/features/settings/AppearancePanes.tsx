/** 外观「三版面」：**一块共用预览**（三个版面看到的完全一样），下面横向排「棋盘 / 棋子 / 特效」三个标签，
 *  切到哪个标签就只换下面的设置面板 —— 预览本身不随版面变化。
 *
 *  用户 2026-10-09 两轮口径（第二轮纠正了我的错解）：
 *    ①「切换版面就调试对应设置」—— 指的是**下面的设置面板**换，不是让预览跟着变；
 *      第一版我做成了"切到棋子就把盘面压暗、换裁剪窗口"，用户明确否掉：「我要的是共用一个」。
 *    ②「落子动效的话，就挑预览里面其中一手播放动效就行」—— 特效版面不给第二块预览，
 *      而是在**这一块**预览里让其中一枚棋子重演落子动效。
 *    ③「预览棋盘不同步透明度调整，不用和下面的棋盘显示一样了」—— 预览恒以原样显示，
 *      不乘 boardOpacity/stoneOpacity（那两个滑杆只作用于真实棋盘）。
 *
 *  为什么预览必须共用：外观里三节原本各自独立展开、而材质预览只挂在「棋盘」那节，
 *  切到「棋子」时看不到任何棋盘棋子的样子，只能对着材质列表盲选
 *  （用户原话「棋盘界面有预览，棋子界面没有呀」）。共用一块才谈得上"看着调"。
 */
import { useRef, useState, type ReactNode } from "react";
import type { BoardTheme, StoneTheme } from "../../app-shell-types";
import { MaterialBoardCrop } from "../../appearance/preview";
import type { EffectScheme } from "../../appearance/effects";
import { MIN_BOARD_OPACITY } from "../../board-opacity";
import { MIN_STONE_OPACITY } from "../../stone-opacity";
import { MotionEffectsPreview } from "./MotionEffectsPreview";

export type AppearancePane = "board" | "stone" | "motion";

const PANES: Array<{ id: AppearancePane; label: string; hint: string }> = [
  { id: "board", label: "棋盘", hint: "棋盘材质与新建路数" },
  { id: "stone", label: "棋子", hint: "棋子材质与落子外观" },
  { id: "motion", label: "特效", hint: "落子交互与棋子进场，与材质无关；上面的预览里有一枚棋子在重演落子动效" },
];

/** 预览的截取格数与尺寸：**三个版面共用同一组值**（不随版面变）。 */
const CROP_SIZE = 196;
const CROP_SPAN = 5;
/** 15 路的格距＝(572 − 2×34) / 14 ≈ 36 —— 演出棋子的半径按它算，才和真实棋盘一样大。 */
const STONE_GAP = (572 - 2 * 34) / 14;

/** 特效版面的方案（由调用方从 props 传下来，本组件负责把它接到共用预览上）。 */
interface MotionPaneProps {
  place: EffectScheme | null;
  drop: EffectScheme | null;
  live: boolean;
  /** 当前棋子材质：预览里那枚**演出棋子按它渲染**，于是"换棋子材质就能对比同一套动效"
   *  （用户 2026-10-09：「里面的棋子可以只有一个……以方便用来展示不同棋子材质下的动效」）。 */
  stoneTheme?: string;
  /** 15 路的格距（算棋子半径用，和真实棋盘一致）。 */
  stoneGap?: number;
}

interface Props {
  boardTheme: BoardTheme;
  stoneTheme: StoneTheme;
  /** 棋盘/棋子透明度：**预览要跟着变**（用户 2026-10-09：「这两个的设置好像没有对那个预览生效呀」）。 */
  boardOpacity: number;
  stoneOpacity: number;
  /** 透明度滑杆的写入（用户 2026-10-09：「在外观，棋盘棋子设置的棋盘上面还是加回一个棋盘和棋子
   *  透明度的调度吧」——滑杆放在预览上方，与预览就近联动）。 */
  onBoardOpacityChange: (value: number) => void;
  onStoneOpacityChange: (value: number) => void;
  /** 预览**上方**的内容（标注高亮——用户 2026-10-09：「标注高亮放在棋盘的上方呀不是下面」）。 */
  abovePreview?: ReactNode;
  /** 棋盘 / 棋子两个版面的内容（由调用方渲染） */
  boardPane: ReactNode;
  stonePane: ReactNode;
  /** 特效版面：用"寄生在共用预览上"的版本（默认路径）。 */
  motionProps?: MotionPaneProps;
  /** 兜底：调用方想自己给特效版面内容时用（一般不用）。 */
  motionPane?: ReactNode;
}

export function AppearancePanes({ boardTheme, stoneTheme, boardOpacity, stoneOpacity, onBoardOpacityChange, onStoneOpacityChange, abovePreview, boardPane, stonePane, motionPane, motionProps }: Props) {
  const [pane, setPane] = useState<AppearancePane>("board");
  const label = PANES.find((x) => x.id === pane)!;
  /** 共用预览那块 <svg> —— 特效版面要把落子特效插进**同一块**，不再另起舞台。 */
  const cropSvgRef = useRef<SVGSVGElement | null>(null);

  return <div className="appearance-panes">
    {/* 预览上方：标注高亮（它是作用在棋盘上的显示项，放预览上面才读得通"上面这块盘"） */}
    {abovePreview ? <div className="appearance-above-preview">{abovePreview}</div> : null}

    {/* 透明度两项（棋盘 / 棋子）：用户 2026-10-09「在外观，棋盘棋子设置的棋盘上面还是加回一个
        棋盘和棋子透明度的调度吧」——放在**共用预览上方**，拖滑杆时下面那块预览即时跟着变。
        只留「名字 + 滑杆 + 读数」，不带说明文字。 */}
    <div className="appearance-opacity-row">
      <label>
        <span>棋盘透明度</span>
        <input type="range" aria-label="棋盘透明度" min={Math.round(MIN_BOARD_OPACITY * 100)} max="100" step="1"
          value={Math.round(boardOpacity * 100)} onChange={(event) => onBoardOpacityChange(Number(event.target.value) / 100)}/>
        <output>{Math.round(boardOpacity * 100)}%</output>
      </label>
      <label>
        <span>棋子透明度</span>
        <input type="range" aria-label="棋子透明度" min={Math.round(MIN_STONE_OPACITY * 100)} max="100" step="1"
          value={Math.round(stoneOpacity * 100)} onChange={(event) => onStoneOpacityChange(Number(event.target.value) / 100)}/>
        <output>{Math.round(stoneOpacity * 100)}%</output>
      </label>
    </div>

    {/* 共用的一块预览。三个版面看到的是同一块、同一个裁剪、同样的呈现。
        ⚠ 特效版面：预览里那 5 枚静态棋子**隐藏**，只留 MotionEffectsPreview 插进来的
          一枚"演出用"棋子 —— 一颗就够看动效，也方便对比不同棋子材质
          （用户 2026-10-09：「里面的棋子可以只有一个，和其他预览的三个棋子里面不一样，
          以方便用来展示不同棋子材质下的动效」）。 */}
    <div className={`material-live-preview board-${boardTheme} stones-${stoneTheme}${pane === "motion" ? " pane-motion-live" : ""}`}
      aria-label={`当前外观预览：棋盘 ${boardTheme}、棋子 ${stoneTheme}`}>
      {/* 两层各自乘自己的透明度：拖「棋盘显示」里的滑杆时这块预览即时跟着变
          （用户 2026-10-09：「这两个的设置好像没有对那个预览生效呀」）。
          拆两层而不是整块乘：棋盘透明度只该影响盘面、棋子透明度只该影响棋子。 */}
      <span className="material-preview-crop" style={{ opacity: boardOpacity }} aria-hidden="true">
        <MaterialBoardCrop boardTheme={boardTheme} stoneTheme={stoneTheme} size={CROP_SIZE} span={CROP_SPAN} part="board" />
      </span>
      {/* ⚠ ref 挂在**棋子层**上：特效版面的落子特效是要插到棋子那里（同一坐标系、且在盘面之上），
          挂到盘面层会被后画的棋子层盖住。 */}
      <span className="material-preview-crop" style={{ opacity: stoneOpacity }} aria-hidden="true">
        <MaterialBoardCrop boardTheme={boardTheme} stoneTheme={stoneTheme} size={CROP_SIZE} span={CROP_SPAN}
          part="stones" svgRef={cropSvgRef} />
      </span>
    </div>

    {/* 三个版面标签：横向排列，放预览下面 */}
    <div className="appearance-pane-tabs" role="tablist" aria-label="外观调试版面">
      {PANES.map((x) => (
        <button key={x.id} type="button" role="tab" aria-selected={pane === x.id}
          className={pane === x.id ? "selected" : ""} onClick={() => setPane(x.id)} title={x.hint}>
          {x.label}
        </button>
      ))}
    </div>
    <p className="appearance-pane-hint">{label.hint}</p>

    {/* 当前版面的设置面板。
        特效版面＝**两部分**：① 寄生在共用预览上的动效（inline：重播条 + 说明）
        ② 真正的选项面板（两个开关 + 两个方案下拉，即 motionPane）。
        ⚠ 曾经只渲染了 ①，于是"公用特效的选项全不见了"（用户 2026-10-09 报）——
          预览和选项是两件事，必须都渲染。 */}
    <div className="appearance-pane-body" role="tabpanel" aria-label={label.label}>
      {pane === "board" ? boardPane
        : pane === "stone" ? stonePane
        : <>
            {motionProps ? <MotionEffectsPreview hostRef={cropSvgRef} inline
              stoneTheme={stoneTheme} stoneGap={STONE_GAP} {...motionProps}/> : null}
            {motionPane}
          </>}
    </div>
  </div>;
}
