/**
 * 在线题库的**习题站目录**（用户 09-26：「题库搜索那里，也不再是连接 github，而是你自己
 * 去网上找一份：都有什么五子棋网站、里面有什么主要的习题，点击后就跳转到对应的界面」）。
 *
 * 与已下架的「自己托管清单」方案的区别：那份要用户自己托管地址、我们把题集抓回本机；这一份是
 * **一张导航表**——列清楚哪个站有什么题、语言与是否需要登录，点了就在浏览器里打开那个
 * 站的习题页。本应用不取回、不缓存、不入库任何题目，所以这里的数据**全部是编辑性内容**，
 * 直接放在代码里（十几条而已，随包、离线可用，也不必处理加载失败）。
 *
 * 收录纪律（每条都要过这三关，`problem-sites.test.ts` 盯着结构那一半）：
 *   1. `url` 必须是**实际打开核实过**的直达习题页，不能是凭印象拼的；`checked` 记核实日期。
 *   2. `evidence` 写清在页面上看到了什么（题型、栏目、题量），没有证据的条目不收。
 *   3. 需要注册/付费才能看题的、只有 App 没有网页的，一律不收（点了跳过去看不到题＝坑用户）。
 *
 * 题目内容的版权都还在原作者手里，所以我们只做「指路」；每条都带站点自己的名字，
 * 界面底部另有一行提示。
 */
export interface ProblemSite {
  id: string;
  /** 站点名（中文用户习惯的叫法；原名不通用时在括号里保留）。 */
  name: string;
  /** 直达习题区的地址：点这张卡片就打开它。 */
  url: string;
  /** 一句话：里面主要有什么题。 */
  what: string;
  /** 题型标签，用于筛选：VCF / VCT / 死活 / 开局 / 每日一题 / 段级位 等。 */
  tags: string[];
  /** 页面语言，如「中」「日」「英」「俄」。 */
  language: string;
  /** 免登录能否看题；不能要写清楚。 */
  access: string;
  /** 收录依据：核实时在页面上看到的东西。 */
  evidence: string;
  /** 最近一次核实日期（YYYY-MM-DD）。 */
  checked: string;
}

/**
 * 目录本体。每条都是**用真浏览器打开过、在页面上看到题**才写进来的（核实日期见各条
 * `checked`，`evidence` 记的是当时页面上实际看到的东西）。
 *
 * 一并记下面这批**看过但不收**的，免得下个人重复调研（2026-09-26 浏览器实测）：
 *   · renjusha.net/puzzles/posts/（日本连珠社问题栏）—— 今天返回 403 Forbidden；
 *     仓库 09-16 的合规复核记录它「41 页 ~400 题、内联 SVG 带坐标」，说明是**现在**拒访问，
 *     待它恢复后再收（收进来要点开就是题，不能让用户吃 403）。
 *   · www.33iq.com/question/ —— 跳到极验「安全验证」，人机验证之前看不到题。
 *   · lfz084.github.io/renju/puzzle.html（连珠答题器）—— 标题在，等 2 秒正文仍是空的，
 *     脚本没渲染出题面，收进来等于给一个看不见的页面。
 *   · renju.app/learn（RenjuEveryDay）—— 做题要先注册登录；table28.renju.info（mikkoi 连珠道场）
 *     —— 源码里对无 cookie 的游客截断菜单，题栏目看不见；www.renjuworld.net/edu.html（五林）
 *     —— 面向培训机构的 B2B 题库，不对公众开放。
 *   · 俄语公开网页题库：renju.su（域名已被劫持占用）、renjugame.ru、renju.net.ua、omok.or.kr、
 *     cafe.naver.com/koreaomok（要登录）等一律打不开或要登录 —— 俄罗斯的题活在 App 与实体书里。
 *   · ku10.com（RenjuClass 现代连珠教室）—— 开局课件站，不是习题；renjuarena.com —— 对战平台；
 *     tsumego.com / goproblems.com / gomagic.org —— 是**围棋**死活，不是五子棋题。
 *   · renju.net —— 没有习题栏目（仓库 09-16 实测 `/problems/`、`/puzzle/` 均 404）。
 */
export const PROBLEM_SITES: ProblemSite[] = [
  {
    id: "renjuportal-puzzle",
    name: "RenjuPortal · 詰め連珠（连珠追诘题）",
    url: "https://renjuportal.com/puzzle/",
    what: "每天上新题，黑先四追い胜（四步内取胜）与追い詰め胜（追诘胜）两类，题面可下子作答；站内还有对局、棋谱、连珠盘",
    tags: ["每日一题", "VCF", "追诘胜", "禁手"],
    language: "日文",
    access: "免登录可看题（顶栏有登录入口，不登录也能翻题）",
    evidence: "2026-09-26 浏览器实测：首页「新着」列出「黒先、追い詰め勝ち 連珠(追い詰め) 2026-09-26-01」「黒先、四追い勝ち「Go! 5 ゴール」(四追い) 2026-09-26-01」等条目，每条有自己的 /puzzle/<id> 地址，另有 /puzzle/list 全量列表",
    checked: "2026-09-26",
  },
  {
    id: "renjumap-xitiku",
    name: "五子棋地图 renjumap · 在线习题库",
    url: "https://renjumap.com/xitiku/index.htm",
    what: "按难度分级：入门题 / 初级题 / 中级题 / 高级题 / 实战与原创习题（混合难度），另有「今日习题」。入门题即坂田吾朗三手胜 30 道，按 1-10 / 11-20 / 21-30 分页",
    tags: ["分级题库", "三手胜", "VCF"],
    language: "中文",
    access: "免注册可看题",
    evidence: "2026-09-26 浏览器实测：页面写明「解题规则：黑棋有禁手；轮到行棋的一方为先手胜方；解题以最短线路为标准答案」，栏目链接 rumen/chuji/zhongji/gaoji/shizhanyuanchuang-yuanjinfeng.htm；入门题库页标题「五子棋入门习题库」，子页 rumen1-10.htm 等",
    checked: "2026-09-26",
  },
  {
    id: "wuziqi123-qipu",
    name: "五子琪在线玩 · 练习题库",
    url: "https://www.wuziqi123.com/qipu/",
    what: "栏目最多的一家：初级题 / 中级题 / 高级题 / 超级题 / 测试题 / 三手胜 / 连珠乐园 / 连珠挑战 / 连珠学堂 / 天狗道场 / 高飞习题 / 大道五目 / VCT 追诘胜 / 每日一练；另有「五子讲座」讲实战取胜技巧",
    tags: ["分级题库", "三手胜", "VCT", "天狗道场", "每日一练"],
    language: "中文",
    access: "免登录；站点自述「内容来源网民提供，不保证真实可靠」，答案要自己把关",
    evidence: "2026-09-26 浏览器实测：/qipu/ 标题「练习题库」，导航给出 /qipu/chujiti/、/qipu/zhongjiti/、/qipu/gaojiti/ 等子栏目；某题页标题「VCF取胜百题002」，正文含「初级题 中级题 高级题 超级题 测试题 三手胜 连珠乐园 连珠挑战 连珠学堂 天狗道场 高飞习题 大道五目 VCT追诘胜 每日一练」",
    checked: "2026-09-26",
  },
  {
    id: "onegreen-daily",
    name: "游戏中国 · 五子棋每日一练",
    url: "http://g.onegreen.net/wzq/List/List_1034.html",
    what: "「五子题库 → 每日一练」的题列表页：每日一题（编号到日期）、冲四取胜 VCF 练习题、天狗道场两手胜等，逐条点进去看",
    tags: ["每日一练", "VCF", "两手胜"],
    language: "中文",
    access: "免登录；只有 http 地址（无 https）",
    evidence: "2026-09-26 浏览器实测：页面导航「五子谱库 / 五子题库 / 五子棋手 / 五子教程」，列表可见「每日一题0620」「冲四取胜VCF练习题」「天狗道场两手胜37」等 86 条链接",
    checked: "2026-09-26",
  },

  {
    id: "tw-renju-tsumego",
    name: "台湾五子棋协会 教学网 · 詰棋专区",
    url: "https://587.renju.org.tw/test.htm",
    what: "专门的「詰棋」（死活 / 取胜题）分区：入门詰棋（双活三、四三、双四各 20 题）、三手胜詰棋、四手连五胜、RIF 五级测试题、俄罗斯五级、大陆七级、日本连珠社段级位题、中村名人作、坂田吾朗白胜詰棋（上 / 下）、珠玉詰棋、冲四胜 VCF 等十余个题集，多数附解答",
    tags: ["三手胜", "VCF", "VCT", "死活", "段级位", "附解答"],
    language: "繁体中文",
    access: "免登录；老式表格排版，手机上要缩放看",
    evidence: "2026-09-26 浏览器实测：页面「詰棋」栏正文写着「詰棋是出于实战或刻意安排的棋局…可用来训练计算力及测试棋力」，并建议从入门詰棋练到三手胜、四手连五胜；同站的题集清单按「内容 / 题数 / 难度 / 解答」列出十余个题集（另以 WebFetch + curl 复核过清单）",
    checked: "2026-09-26",
  },
  {
    id: "renjutool-puzzle",
    name: "五子棋小工具 · 连珠答题器",
    url: "https://www.renjutool.top/puzzle.html",
    what: "题集最多的一家中文站：「每日」系列（每日 VCF / 每日 VCT / 每日残局 / 每日三手胜 / 每日做四三 / 每日双杀 / 每日防禁手…）加四十多个成册题集（坂田吾郎、中村茂、岡部寬、高村政則、五子棋阶梯训练、入门一手法至五手题）",
    tags: ["题集", "每日一练", "VCF", "VCT", "三手胜"],
    language: "中文",
    access: "免登录；单页应用，打开后要等一两秒把题集列表读出来",
    evidence: "2026-09-26 浏览器实测页面标题为「连珠答题器」（正文由脚本渲染，静态抓取看不到列表）；题集清单取自该站自己的 defaultPuzzles.json 与 puzzle/json/ 目录清单（本项目另以 WebFetch + curl 复核，61 个题集文件）。这些题集的内容多来自具名出版物、站点未声明授权，所以我们只指路、不取内容",
    checked: "2026-09-26",
  },
  {
    id: "rifchina-problems",
    name: "那V连珠网（原中国连珠网）· 生杀定夺",
    url: "http://www.rifchina.com/plus/list.php?tid=142",
    what: "「生杀定夺」栏目连载题图：VCF 习题已出到第二十期（2026-06-28 修复答题上传系统后重新更新）、白先如何胜多期、必胜练习（浦月等开局）、跨棋类的算路练习",
    tags: ["VCF", "VCT", "题图"],
    language: "中文",
    access: "免登录；只有 http 地址、站点较旧，打开偏慢",
    evidence: "2026-09-26 浏览器实测：栏目页可见「习题库N年后首次更新VCF第二十期…请大家欣赏VCF习题第二十期」（2026-06-28）与「智起来！…一、五子棋（自认为有一定难度VCT）黑先如何胜？」等条目",
    checked: "2026-09-26",
  },
  {
    id: "gomoku-vcf-analyzer",
    name: "五子棋 VCF 分析器（hangsau）",
    url: "https://hangsau.github.io/gomoku-vcf/",
    what: "不是题库，是**自查答案的工具**：摆局面或直接粘坐标（H8 G7 J5 …），选黑/白方与是否启用禁手，求连续冲四胜的最短路径；还能把当前局面存成自己的题目、导出 JSON",
    tags: ["VCF", "路径验证", "禁手"],
    language: "繁中",
    access: "免登录，纯前端（GitHub Pages）",
    evidence: "2026-09-26 浏览器实测：页面标题「五子棋 VCF 分析器」，可见「盘面编辑 / 路径验证」「启用黑棋禁手」「找最短路徑（較慢）」「計算黑棋 VCF / 計算白棋 VCF」「儲存目前局面為題目」等控件",
    checked: "2026-09-26",
  },
];

/** 目录里出现过的全部题型（筛选按钮由它生成，顺序按题量从多到少）。 */
export const problemSiteTags = (sites: ProblemSite[] = PROBLEM_SITES): string[] => {
  const counts = new Map<string, number>();
  for (const site of sites) for (const tag of site.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh")).map(([tag]) => tag);
};

/** 最近一次核实日期（界面上告诉用户这张表有多新）。 */
export const problemSitesCheckedOn = (sites: ProblemSite[] = PROBLEM_SITES): string =>
  sites.map((site) => site.checked).filter(Boolean).sort().slice(-1)[0] || "";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

/**
 * 目录内检索（纯本地，不发任何请求）：关键词命中站名、说明、题型或依据文字。
 * 空关键词＝给全部。
 */
export const searchProblemSites = (text: string, tag = "", sites: ProblemSite[] = PROBLEM_SITES): ProblemSite[] => {
  const wanted = normalize(text);
  const type = normalize(tag);
  return sites.filter((site) => {
    if (type && !site.tags.some((entry) => normalize(entry) === type)) return false;
    if (!wanted) return true;
    const haystack = normalize([site.name, site.what, site.tags.join(" "), site.evidence, site.language].join(" "));
    return haystack.includes(wanted);
  });
};
