import type { EnhancementSettings } from "../../enhancement-settings";

/**
 * 「可选增强功能」分区里**实际渲染**的开关 key（用户 09-23 报「标着 10 项、数出来只有 7 项」）。
 *
 * 摘要里的 N 原先拿整个 enhancementSettings 对象去数 `value === true`，把别的分区
 * 也算进来了：`movesTextDisplay`/`buttonOverflow`（原 actionRails）属于「设备布局」，`analysisShowCandidates`
 * 属于「分析」，`devBoardSizeDetect` 属于「开发测试功能」（原口径只排除了
 * devMoveOrderRestore，漏排它）。于是新装就显示「10 项已开启」，而用户在本分区里
 * 只数得到 7 个开着的开关。
 *
 * 这张表就是分区的行清单：**摘要的 N 只数它**，加/删行时同步改这里，
 * 「摘要数字」与「点开看到的行」就永远一致。放在独立模块是为了能脱离 React 单测。
 */
export const ENHANCEMENT_SECTION_KEYS = [
  "fastRecognition", "pinchZoom", "gestureSwipe",
  // 手感增强组（用户 09-17 第二批）：只改「手怎么摸」，不碰棋谱数据，默认开启。
  "boardRotateGesture", "moveRail", "chromeCollapseToggle", "radialMenu", "tapStonePrev", "keyboardShortcuts",
  "importShelf", "aiBoardHints", "openingBook", "coachMarks",
  // 在线入口的两个实验开关已删除（用户 09-26：在线常驻），本清单随之少两行。
  "analysisCache", "aiGameAutoSave",
  // 用户 10-09 新增一行、并从「设备布局」搬来一行：
  //   · openingNameHint —— 本轮用户点名要的开关（开局名浮字，默认开启）；
  //   · libraryOnlineEntry —— 原在「设备布局」，但它管的是"界面上多不多一个页签"，
  //     与顶栏折叠同类，所以归到本分区的「界面与提示」板块。
  // 分区的行清单必须与渲染同步，否则摘要的 N 会与实际数得到的行对不上——
  // 这正是本模块存在的理由（见文件头注）。
  "openingNameHint", "libraryOnlineEntry",
  // 用户 10-11 新增两行：奖励弹窗的总开关（成就大卡 / 棋魂紧凑条）。
  // 归「界面与提示」——它们管的是"界面上弹不弹东西"，与顶栏折叠、开局名提示同类。
  "achievementPopup", "soulPopup",
] as const satisfies ReadonlyArray<keyof EnhancementSettings>;

export type EnhancementSectionKey = (typeof ENHANCEMENT_SECTION_KEYS)[number];

/** 本分区里处于开启状态的项数（只数本分区渲染的开关）。 */
export const countEnabledEnhancements = (settings: EnhancementSettings): number =>
  ENHANCEMENT_SECTION_KEYS.filter((key) => settings[key] === true).length;
