/**
 * 「在线 → 其他」的资料清单（用户 2026-10-14：「这是我百度网盘分享的关于五子棋的资料，
 * 你可以在在线里面再加一个『其他』的版面，然后把这个链接放进去。然后下面是夸克的，也加进去」）。
 *
 * 与「题库」那面习题站导航同一纪律：**这里只有链接**。点卡片在浏览器里打开网盘页面，
 * 本应用不下载、不缓存、不代管任何网盘账号，所以打开这一面不发任何请求。
 *
 * ⚠ 网盘分享会过期或被取消，届时页面会显示"链接不存在/已失效"——那不是本应用坏了。
 * 所以每条都记着进清单的日期（`addedOn`），界面上原样写出来。
 */
export interface OtherResource {
  id: string;
  /** 网盘名（卡片标题前缀，例如「百度网盘」）。 */
  site: string;
  /** 这份资料是什么。 */
  label: string;
  /** 一行说明：里面大概有什么、要不要登录。 */
  note: string;
  url: string;
  /** 提取码 / 访问密码。没有就不显示这一行。 */
  accessCode?: string;
  /** 进清单的日期（写进界面，方便判断"是不是我这条过期了"）。 */
  addedOn: string;
}

export const OTHER_RESOURCES: readonly OtherResource[] = [
  {
    id: "baidu-pan",
    site: "百度网盘",
    label: "五子棋资料",
    note: "五子棋相关资料。打开与下载通常要登录百度网盘（或装它的客户端）。",
    url: "https://pan.baidu.com/s/1ui_FxRZD7GmQ132VZNyOqg",
    accessCode: "r7av",
    addedOn: "2026-10-14",
  },
  {
    id: "quark-pan",
    site: "夸克网盘",
    label: "五子棋资料",
    note: "五子棋相关资料。打开与下载通常要登录夸克网盘。",
    url: "https://pan.quark.cn/s/d86e612e28f4",
    addedOn: "2026-10-14",
  },
];

/**
 * 「复制」按钮写进剪贴板的那串：地址＋提取码一行，粘到群里就能直接用。
 * 夸克那条没有提取码，就只给地址——不写「提取码：无」这种废话。
 */
export const otherResourceCopyText = (resource: OtherResource) =>
  resource.accessCode ? `${resource.url}\n提取码: ${resource.accessCode}` : resource.url;
