import { ChevronLeft } from "lucide-react";

/**
 * 「关于 → 引擎与模型介绍」（用户 2026-10-01 要这一页；2026-10-02 再改口径：
 * 「介绍里面简单一点，不要牵着到作者什么的了，就简单介绍」）。
 *
 * 所以这一页只回答三件事：**这是什么、要不要下载、多大**。
 * 不写谁的作品、不写社区来源、不写跨设备的速度对比（没有稳定口径，写了就是假话）。
 * 授权条款在「关于」主列表的「第三方引擎与模型许可」那张卡里，这里不重复。
 *
 * 数字对着打包产物核（2026-10-02；2026-10-12 补 f15 无禁手网）：
 *  - `public/engine-packs/rapfi-full-v3.data` 40,306,406 B = 38.4MB；
 *  - `android/.../engine-katago/distill-fp16.onnx` 3,357,951 B = 3.2MB（连珠/有禁手）；
 *  - `android/.../engine-katago/distill-freestyle-fp16.onnx` 3,357,951 B = 3.2MB（无禁手/标准 f15）;
 *  - `android/.../engine-katago/zhizi-b24-int8.onnx` 22,929,583 B = 21.9MB
 *    （原来是 fp16 的 42MB 那份，换成 int8 量化后小了约 20MB、同机实测快近一倍）；
 *  - 安卓原生 rapfi 是 0.43.02（比 0.43.01 同预算多算 14%~48% 的节点）。
 */
interface EngineRow { name: string; tag: string; text: string }

const ENGINE_ROWS: EngineRow[] = [
  {
    name: "rapfi",
    tag: "默认 · 网页与安卓 · 不用下载",
    text: "开箱即用的本机引擎。网页版是 wasm 构建（约 1.0MB），安卓是同一套权重的原生版（0.43.02，约 1.4MB）。线程数与内存上限可调（内存 64–2048MB、默认 128MB），棋盘 5–22 路都能算。",
  },
  {
    name: "rapfi 冠军权重包",
    tag: "网页版可选下载 · 38.4MB",
    text: "不下载也能用，下载后棋力更强，装完自动生效。安卓自带同一套权重，不需要下这份。",
  },
  {
    name: "katago · b10c128 小网",
    tag: "仅安卓 · 3.2MB ×2 · 不用下载",
    text: "蒸馏小网络（10 块 × 128 通道），随安装包自带。快，适合边看边算。按规则自动换网：连珠（有禁手）一张、无禁手与标准另一张——无禁手下双三双四是黑方最凶的杀法，用有禁手那张网会把它当成走不通。",
  },
  {
    name: "katago · b24c256 大网",
    tag: "仅安卓 · 21.9MB · 不用下载",
    text: "更强的网络（24 块 × 256 通道），同样随安装包自带。这份用的是 int8 量化权重，比原来的 fp16 版小约 20MB、速度快近一倍，但比小网仍慢得多、也更耗电。线程与缓存上限在设置里调，支持 15 路以内棋盘。",
  },
  {
    name: "云端引擎（iKataGo）",
    tag: "连你自己的服务 · 可选",
    text: "填服务器地址、用户名、密码、平台四项，把计算转到你自己的服务上；凭据只存在本机。目前只有「分析」走云端，人机对弈还没接上——选云端时对弈仍跑本机引擎。",
  },
  {
    name: "内置兜底",
    tag: "引擎起不来时自动用",
    text: "KataGo 连续两次启动失败就自动换回 rapfi；最坏情况退回纯 JS 搜索，保证点了「分析」一定有结果。",
  },
];

const ENGINE_NOTES: string[] = [
  "对弈强度（初级 / 中级 / 高级 / 大师 / 自由）和用哪个引擎是两回事：强度只管思考时间与深度。引擎在快捷中心「分析引擎」或设置 →「AI 引擎」里换。",
  "各引擎与权重的授权条款见「关于」主列表的「第三方引擎与模型许可」。",
];

export function EngineInfoView({ onBack }: { onBack: () => void }) {
  return (
    <div className="about-detail" data-about-view="engine">
      <button type="button" className="about-detail-back" data-about-back="" onClick={onBack}>
        <ChevronLeft size={16}/>返回「关于」
      </button>
      <header className="about-detail-head">
        <b>引擎与模型</b>
        <small>这台设备上有哪些 AI 引擎、要不要下载、各多大。体积按打包产物实测，2026-10-02 核对。</small>
      </header>
      <ul className="engine-list" data-engine-list="">
        {ENGINE_ROWS.map((row) => (
          <li key={row.name}>
            <b>{row.name}</b>
            <span className="engine-tag">{row.tag}</span>
            <span>{row.text}</span>
          </li>
        ))}
      </ul>
      {ENGINE_NOTES.map((note) => <p className="engine-note" key={note.slice(0, 12)}>{note}</p>)}
    </div>
  );
}
