export type Tab = "record" | "library" | "duel" | "settings";

export type AppMode = "record" | "review" | "puzzle";

export type ThemePreference =
  | "system"
  | "light"
  | "dark"
  | "eye"
  | "mono"
  | "rain"
  | "bamboo"
  | "snow"
  | "porcelain"
  | "plum"
  | "jiangnan"
  | "firefly"
  | "rice"
  | "pixel"
  | "cyber"
  | "blackgold"
  | "pale"
  | "kawaii"
  | "aurora"
  | "deepsea"
  | "baroque"
  | "pelican"
  | "dunhuang"
  | "soul"
  | "custom";

export type ResolvedTheme = Exclude<ThemePreference, "system">;

export type BoardTheme =
  | "wood"
  | "jade"
  | "notebook"
  | "emerald"
  | "porcelain"
  | "whitejade"
  | "walnut"
  | "frosted"
  | "circuit"
  | "minimal"
  | "blackgold"
  | "pale"
  | "kawaii"
  | "aurora"
  /* ↓ 皮肤实验室搬进来的 16 套（走 src/appearance 的数据路，没有 .board-X CSS）。
     notebook / porcelain / frosted 用户点名删了：留着是为了老存档还能读，
     读的时候由 normalizeBoardTheme() 归一化到 wood，设置里不再出现。 */
  | "pencil-forest"
  | "pencil-berry"
  | "blue-midnight"
  | "blue-enamel"
  | "verdant-pine"
  | "ripple-onsen"
  | "gu-xuanzhi"
  | "gu-meihua"
  | "tx-zhusha"
  | "hard-08"
  | "indie-hyperlight-dusk"
  | "indie-monument-ink"
  | "indie-spire-day"
  | "print-woodengrave"
  | "naive-papercut"
  | "dh-feitian"
  /* VCF 挑战页原来写死的那块琥珀盘（用户 2026-10-05 要求加进棋盘清单，排第一行第二个） */
  | "app-amberboard"
  /* 棋魂主题配套材质（用户 2026-10-10）：陈年宣纸盘 + 墨焰/魂芯双子 */
  | "soul-inkflame";

export type StoneTheme =
  | "classic"
  | "jade"
  | "yun"
  | "ink"
  | "mono"
  | "notebook"
  | "porcelain"
  | "snow"
  | "terminal"
  | "gold-diamond"
  | "gold"
  | "diamond"
  | "blackgold"
  | "pale"
  | "kawaii"
  | "aurora"
  /* ↓ 实验室搬进来的 15 枚（走数据路）。gu-meihua / tx-zhusha 的子被点名删了，
     所以比棋盘少两个；ns-lacquer（大漆）和 dh-lianzhu（联珠莲瓣）是手工零件。
     gold 同 BoardTheme 的说明：留着只为读老存档，读时归一化到 classic。 */
  | "pencil-forest"
  | "pencil-berry"
  | "blue-midnight"
  | "blue-enamel"
  | "verdant-pine"
  | "ripple-onsen"
  | "gu-xuanzhi"
  | "hard-08"
  | "indie-hyperlight-dusk"
  | "indie-monument-ink"
  | "indie-spire-day"
  | "naive-papercut"
  | "dh-feitian"
  | "ns-lacquer"
  | "dh-lianzhu"
  /* VCF 挑战页原来写死的纯黑白子（用户 2026-10-05 要求加进棋子清单，排第一行第二个） */
  | "app-flatstone"
  /* 棋魂主题配套材质（用户 2026-10-10）：墨焰（黑）/ 魂芯（白） */
  | "soul-inkflame";

export type Sheet =
  | "comment"
  | "branches"
  | "tree"
  | "metadata"
  | "save"
  | "folder"
  | "rename"
  // 题库管理：单题编辑、拆分、合并、加题共用一个浮层槽位，由各自的 target 决定渲染哪个。
  | "puzzleEdit"
  | "export"
  | "help"
  // 人机对弈：退出后没下完的一局，下次点「人机对战」先问要不要回去（用户 09-28）。
  | "duelResume"
  // 自定义开局（2026-10-14）：摆子界面「局面」那颗点开的局面库（载入 / 改名 / 删除）。
  | "duelSetups"
  | "manual"
  | "about"
  | "feedback"
  | "find"
  | "positionSearch"
  | "marks"
  | "import"
  | "coordinateCode"
  | "imageImport"
  | "online"
  | "aiGame"
  | "fifthCount"
  | "rules"
  | "wrongbook"
  | "bookmarks"
  | "favorites"
  | "puzzleFavorites"
  | "trash"
  | "dataSafety"
  /**
   * 本机凭证（2026-10-11）：写在 App 之外的一份加密快照，
   * 卸载/换机后能恢复回来（用户：「让每一个机子都有本地凭证」）。
   */
  | "vault"
  | "versions"
  | "undoHistory"
  /** 对弈右上角小按钮点开的「战绩与等级分」面板（用户 10-02 要的第一版）。 */
  | "duelStats"
  /** 成就面板（用户 10-09；棋魂已独立成 soul）。 */
  | "achievements"
  /** 棋魂说明页（用户 10-09：点对弈页左上角的魂火徽章进来）。 */
  | "soul"
  | "shop"
  | "duelClock"
  | "health"
  | "batchEdit"
  | "puzzleManage"
  | null;
