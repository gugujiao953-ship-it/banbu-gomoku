/**
 * 在线来源的启用 / 停用登记表。
 *
 * 单独成一个模块，是为了让「哪些来源在用、哪些已按条款停用」这件事可被测试直接读到——
 * `source-csp.test.ts` 会断言「启用中的来源，域名必须在 index.html 的 connect-src 里」，
 * 并反向断言「停用的来源不在启用清单里、域名也已从 CSP 收掉」。否则一旦有人把停用来源
 * 挪回启用位，会先上线、再表现成「跨域失败」，白查半天。
 */
import { LJRENJU_SOURCE } from "./ljrenju";
import { RENJU_NET_SOURCE } from "./renju-net";
import type { OnlinePuzzleSource, OnlineSource } from "./types";

/**
 * 启用中的棋谱来源（用户 2026-09-19 晚：「跳出去看不方便，把应用内浏览加回来，只是不能下载」）。
 *
 * 当前形态（用户 2026-09-26）：**应用内只列清单，点开一律去浏览器看原页**。
 *   · 能做的：面板里列出赛事 → 展开看轮次 → 列出该轮的对局（黑白、日期、结果、手数），
 *     每一行都是一个新标签外链，点了才打开来源站那一页；棋手维度不抓任何站，读我们自己
 *     整理的目录（`record-index.ts`，数据是打进包里的 `record-index-data.ts`，09-28 起含历届世界锦标赛两千来局、由 `loadRecordIndex()` 按需读一个本地分片，不依赖运行时去取文件）。
 *   · 不能做的：把一局取回本应用里看局面（原来的「在线查看」已撤，代码留在 App 的
 *     `previewOnlineRecord`，目前没有接线）；勾选批量取回 / 一键入库（由
 *     `ONLINE_GAME_DOWNLOAD_ENABLED` 门控）。
 *
 * 请求负担的纪律（用户 09-26 问过「用得多会不会压到对方站」）：打开在线面与做任何检索、
 * 筛选都是零第三方请求；只有用户主动点开「最近赛事」的某一层才取那一页，取页走
 * `online-http.ts` 的**同主机串行 + 每次至少间隔 1.1 秒 + 20 秒超时 + 不并发 + 不预取**。
 *
 * 为什么只留励精连珠教室：它没有 robots.txt，且此前反对的是「把第三方内容成规模复制进本机库」
 * （应用含网页版）。按需浏览一页、只在内存里打开看局面，不落库、不批量，属于用户点一下看一局的
 * 正常浏览；下载通道仍然关闭。
 *
 * **renju.net 没有恢复**（保留在停用清单里）：它的 `robots.txt` 末段是 `User-agent: *` +
 * `Disallow: /`，未列名客户端全站禁止抓取；条款也写明库内容只能用于离线数据库、禁止用于任何
 * 网站或在线系统。这类技术性禁止不因需求而改变——要恢复得先拿到站点授权，再按下面步骤操作。
 *
 * ## 想恢复下载时怎么做（用户 2026-09-19 要求留下记录）
 * 1. 把 `ONLINE_GAME_DOWNLOAD_ENABLED` 改成 `true`：面板会重新出现勾选框与吸底的
 *    「下载并导入」（下载/导入代码一直没删，只是被这个开关门控）。
 * 2. 确认授权：最省事的是问站点维护者一句「能否在本应用内提供离线副本」。
 * 3. `qa/online-library-check.mjs` 里被替换掉的「整轮下载 / 重复导入」等步骤可从 git 历史取回。
 *
 * ## 想恢复 renju.net（棋手/赛事检索）时怎么做
 * 1. 先取得授权（robots 与条款目前都禁止）。
 * 2. 把 `RENJU_NET_SOURCE` 从 `QUARANTINED_ONLINE_SOURCES` 挪进这里，并把
 *    `https://www.renju.net` 加回 `index.html` 的 CSP `connect-src`。
 * 3. 把它从 `external-links.ts` 的 `EXTERNAL_SOURCES` 里删掉——**同一来源不能既抓取又只给链接**
 *    （`source-csp.test.ts` 与 `external-links.test.ts` 都有这条互斥断言）。
 */
export const ONLINE_GAME_SOURCES: OnlineSource[] = [LJRENJU_SOURCE];

/**
 * 棋谱的「下载并导入」通道开关（用户 2026-09-19：在线棋谱一律不下载）。
 *
 * 关掉的是**成规模复制**这条路：勾选多局、批量取回、写进本机棋谱库（应用还有网页版）。
 * 面板里的勾选框与吸底「下载并导入」按钮由它门控；`onImport` 与 `importOnlineRecords`
 * 一直保留着，改成 `true` 即可恢复。
 */
export const ONLINE_GAME_DOWNLOAD_ENABLED = false;

/** 启用中的题库来源：**目前一个都没有**。
 *
 *  2026-10-05（用户第二次提同一件事）：「去掉在线里面那个用自己网站当题库的功能，那个填 url 的」——
 *  入口上一轮已经撤了（`OnlinePuzzlePanel` 现在只剩习题站导航），这一轮把**剩下的接线也一起下架**：
 *  来源不再注册（本数组清空）、App 里那条没人调用的导入通道删掉、CSP 里那三个只服务它的域名收掉、
 *  手册与题库界面里还写着「自建题库」的文案改成中性说法。
 *
 *  适配器本体（`self-hosted.ts`）与它的单测按仓库对停用来源的一贯做法**保留不删**：真要有授权来源，
 *  照 `RETAINED_GAME_SOURCES` 那套把它挪回本数组、再把域名加回 CSP 即可（见下方 quarantined 条目）。
 *  题集格式识别（`puzzle-set-format.ts`）与题集导出都没动——那是本机能力，跟这条在线通道无关。 */
export const ONLINE_PUZZLE_SOURCES: OnlinePuzzleSource[] = [];

/**
 * 已停用的来源（保留适配器与单测，等有授权的来源再启用）。
 *
 * **renju.net**（棋谱，2026-09-17 停用）：两条独立的禁止——
 *   1. `robots.txt` 最后一段是 `User-agent: *` + `Disallow: /`：未列名客户端全站禁止抓取
 *      （Googlebot 等 14 个具名 bot 才拿到 `Allow: /game/search/$`，说明站点是有意区分）。
 *   2. 棋谱库页写明 *"non-commercial purposes in the forms of OFFLINE databases only.
 *      It is forbidden to use any contents of this database … in any website or ONLINE system."*
 *      ——本应用有网页版，属于在线系统；连自建托管也在禁内。
 *   面板上它的检索框仍在，但只是**拼 URL 跳转**（`external-links.ts`，永不抓取）。
 *
 * **renjutool.top**（题库，2026-09-17 停用）：站点无 robots.txt，但**全站没有任何版权/授权/免责文字**，
 *   上游仓库 `lfz084/renju` 在 GitHub 是 `license: null`、Gitee 是「License: Not specified」；
 *   而它的题集内容来自具名在版作品（坂田吾郎、中村茂、岡部寬、高村政則…）。默认保留一切权利 ⇒ 停用。
 *
 * 库里的题集格式知识没有丢：`puzzle-set-format.ts` 仍然认得那套带 `mode` 的格式，
 * 你自己托管的题集文件如果来自那个生态，照样能导入（选点/选择题模式会被跳过并报数）。
 */
/**
 * 停用但**完整保留**的棋谱适配器（含抓取、解析、SGF 生成与各自的单测）。
 * 恢复某个来源时把对应项挪进 `ONLINE_GAME_SOURCES` 并把它域名加回 CSP `connect-src` 即可——
 * 代码一行没删，删掉的只是入口。
 */
export const RETAINED_GAME_SOURCES: OnlineSource[] = [LJRENJU_SOURCE, RENJU_NET_SOURCE];

export const QUARANTINED_ONLINE_SOURCES: Array<{ id: string; label: string; origin: string; reason: string }> = [
  {
    id: "renju-net",
    label: "国际连珠联盟 renju.net",
    origin: "https://www.renju.net",
    reason: "robots.txt 对未列名客户端 Disallow: /，且条款禁止用于任何在线系统；未获授权（面板只提供拼 URL 的跳转）",
  },
  {
    id: "renjutool",
    label: "五子棋小工具 renjutool.top",
    origin: "https://www.renjutool.top",
    reason: "站点无任何版权/授权说明、上游仓库无 LICENSE，题集内容来自具名在版作品；未获授权",
  },
  {
    id: "self-hosted-puzzles",
    label: "自建题库（自己托管清单）",
    origin: "https://raw.githubusercontent.com",
    reason: "用户 2026-10-05 要求下架：不再注册来源、入口与文案全部撤掉；域名已从 CSP connect-src 收掉（适配器与单测按惯例保留）",
  },
];
