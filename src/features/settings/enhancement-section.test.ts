import { describe, expect, it } from "vitest";
import { DEFAULT_ENHANCEMENT_SETTINGS, type EnhancementSettings } from "../../enhancement-settings";
import { ENHANCEMENT_SECTION_KEYS, countEnabledEnhancements } from "./enhancement-section";

/**
 * 用户 09-23 报的「设置里明明功能已经很多了，标着的却还是 10 个」。
 *
 * 根因：摘要的 N 拿**整个** enhancementSettings 去数 `true`，而不是数本分区渲染的行。
 * 新装时它显示 10，而用户在「可选增强功能」里只数得到 7 个开着的开关——多出来的是
 * 设备布局的 movesTextDisplay/buttonOverflow 和分析分区的 analysisShowCandidates。
 *
 * 这几条断言就是钉住「摘要数字 == 分区的行」：
 */
describe("可选增强功能分区计数", () => {
  it("摘要只数本分区的开关：新装 11/17，而不是整个对象算出来的 13", () => {
    // 14 而非 16：在线入口的两个实验开关随「在线常驻」（用户 09-26）一起删掉了。
    // → 15：用户 09-26 新增「点棋子回退一步」（tapStonePrev，渲染在本分区里；当天先默认开、
    // 体验后改成默认关，所以开启数没有跟着变）。
    // → 14：同一天按用户要求删掉了「画中画」（整功能移除，见 R93）。
    // → 15：用户 10-07 新增「顶栏折叠开关」（chromeCollapseToggle，默认开启，渲染在本分区里）。
    // → 17：用户 10-09（本轮）两处改动，都与"分区到底渲染几行"有关：
    //   · 新增 openingNameHint「开局名提示」（本轮用户点名要的开关，默认**开启**）；
    //   · libraryOnlineEntry「棋谱库显示在线页签」从「设备布局」**搬进**本分区
    //     （它管的是"界面上多不多一个页签"，与顶栏折叠同类；搬进来之前它属别的分区，
    //      所以那时数本分区不会数到它）。
    //   17 = 15 + 2。
    // → 19：用户 10-11 新增两枚奖励弹窗开关（achievementPopup / soulPopup，**默认都开**，
    //   渲染在本分区的「界面与提示」里——它们管的是"界面上弹不弹东西"，与顶栏折叠同类）。
    //   19 = 17 + 2。
    expect(ENHANCEMENT_SECTION_KEYS).toHaveLength(19);
    // 7 → 6：用户 09-28 把「终局自动存档」改成默认关闭（不主动保存就不进棋谱库），
    // 这一项就在本分区里，所以新装的开启数跟着少一个。
    // 8 → 9：用户 10-07 新增「顶栏折叠开关」，默认开启（顶栏折叠按钮做成增强开关项）。
    // 9 → 11：（本轮）openingNameHint 默认开（+1）、libraryOnlineEntry 默认开且搬进本分区（+1）。
    // 11 → 13：用户 10-11 两枚奖励弹窗开关默认都开（+2）。
    expect(countEnabledEnhancements(DEFAULT_ENHANCEMENT_SETTINGS)).toBe(13);
    // 旧口径（全对象 true）当年是 10，正是用户看到的那个错数——把它钉住，防止回退。
    // 之后几次默认值调整让它一路降下来：09-26 布尔 actionRails 换成 buttonOverflow
    // （"wrap"/"scroll"，不再是 true）→ 9；09-28 aiGameAutoSave 默认关 → 8；
    // 10-01 横屏默认双栏（tabletSplit 改成默认开，见 R102）→ 9；同日 R109 干脆**删掉这个开关**
    // （横屏一律双栏，不再可选，用户 10-01：「无论是浏览器还是手机，只要横屏都是这样」）→ 回到 8。
    // 它属于「设备布局」分区，所以本分区真正渲染的行数一个字没变——这正是两条数字要分开钉的原因。
    // 10-04 又加回一个布尔开关：「棋谱库显示在线页签」（群友要求能关掉，默认开）。
    // 它当时渲染在「设备布局」，所以本分区的开启数不动，只有这个旧口径 +1 → 11。
    // 10-07「顶栏折叠开关」默认开且渲染在本分区：本分区 8→9，旧口径 11→12。
    // 10-09（本轮）：openingNameHint 新增且默认开（本分区 +1、旧口径 +1）；
    // 「棋谱库显示在线页签」从设备布局搬进本分区（本分区 +1，**旧口径不变**——它本来就true）。
    // 所以：旧口径 12→13、本分区 9→11。这条 13 是跑出来对过的，不是推出来的。
    // 10-11 两枚弹窗开关默认开：本分区 11→13，旧口径 13→15。
    const legacyCount = Object.entries(DEFAULT_ENHANCEMENT_SETTINGS).filter(([, value]) => value === true).length;
    expect(legacyCount).toBe(15);
    expect(countEnabledEnhancements(DEFAULT_ENHANCEMENT_SETTINGS)).not.toBe(legacyCount);
  });

  it("不含属于其它分区的开关（设备布局 / 分析 / 开发测试）", () => {
    const section = new Set<string>(ENHANCEMENT_SECTION_KEYS);
    // 这几项默认开启且属于别处，是旧口径多算的元凶
    for (const foreign of ["movesTextDisplay", "analysisShowCandidates"]) {
      expect(section.has(foreign), `${foreign} 不该出现在本分区计数里`).toBe(false);
      expect(DEFAULT_ENHANCEMENT_SETTINGS[foreign as keyof EnhancementSettings]).toBe(true);
    }
    // 「按钮宽度溢出后」（原「功能栏边界栏」，用户 09-26 改成 自动换行/横向滚动）也属于设备布局
    expect(section.has("buttonOverflow")).toBe(false);
    // 开发测试功能的两个开关也都不在本分区（否则开启后摘要会凭空 +1）
    expect(section.has("devBoardSizeDetect")).toBe(false);
    expect(section.has("devMoveOrderRestore")).toBe(false);
    // 反例（防"以后又搬出去忘了同步"）：这两个是本轮**搬进来**的，必须留在本分区。
    // 它们搬家的理由见 enhancement-section.ts 的注释——管的是"界面上多不多一个页签/题签"。
    expect(section.has("libraryOnlineEntry")).toBe(true);
    expect(section.has("openingNameHint")).toBe(true);
  });

  it("分区里每个 key 都真实存在于设置类型中（防改名/删除后留下死键）", () => {
    for (const key of ENHANCEMENT_SECTION_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_ENHANCEMENT_SETTINGS, key), `${key} 不在默认设置里`).toBe(true);
    }
  });

  it("逐项开启时计数同步 +1（不是按固定值硬编码）", () => {
    const base = countEnabledEnhancements(DEFAULT_ENHANCEMENT_SETTINGS);
    const off = ENHANCEMENT_SECTION_KEYS.find((key) => DEFAULT_ENHANCEMENT_SETTINGS[key] === false)!;
    expect(countEnabledEnhancements({ ...DEFAULT_ENHANCEMENT_SETTINGS, [off]: true })).toBe(base + 1);
    const on = ENHANCEMENT_SECTION_KEYS.find((key) => DEFAULT_ENHANCEMENT_SETTINGS[key] === true)!;
    expect(countEnabledEnhancements({ ...DEFAULT_ENHANCEMENT_SETTINGS, [on]: false })).toBe(base - 1);
  });
});
