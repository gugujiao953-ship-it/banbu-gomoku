/**
 * 自建题库来源：从**你自己托管的清单**里取题集。
 *
 * 为什么是自建：站点来源逐个复核后，没有一个同时满足「明确许可 + 机读数据」——
 * renju.net 的 robots 对未列名客户端是 `Disallow: /` 且条款禁止任何在线系统使用，
 * 「五子棋小工具」renjutool.top 全站没有任何版权/授权文字（上游仓库 `license: null`），
 * 励精连珠教室页脚「版权所有」。所以在线题库的通道保留，但**内容由你自己提供**：
 * 你放什么问题、以什么授权放，由你决定；应用只按你填的地址取回并存在本机。
 *
 * ## 两种填法（面板里同一个输入框，按地址自动识别）
 *
 * **① 文件夹链接（推荐，最省事）**：直接填 GitHub 上放题集的文件夹地址，例如
 * `https://github.com/你的用户名/你的仓库/tree/main/puzzles`。应用走 GitHub 的目录接口列出
 * 该文件夹里**所有 `.json`**（跳过 `manifest.json`）——**往文件夹里丢一个文件，下次检索就会出现**，
 * 不用改任何清单。题型显示「未标注」、题数「下载后可见」（接口不给这些，不编造）。
 *
 * **② 清单文件（想自己定标题/题型/题数时）**：填一份 `manifest.json` 的地址：
 * ```json
 * {
 *   "title": "我的题库",
 *   "sets": [
 *     { "title": "三手胜入门", "file": "sets/sanshou.json", "type": "三手胜", "count": 120 },
 *     { "title": "实战 VCF", "file": "https://example.com/vcf.json", "type": "VCF" }
 *   ]
 * }
 * ```
 * - `file`：题集文件，相对路径按清单地址解析；也可直接写完整 https 地址。
 * - `type` / `count` 可省：省了就在界面上显示「未标注」/「题数下载后可见」，不编造。
 * - 题集文件就是本应用的题库 JSON（`{defaultSettings, puzzles:[…]}`）——**题库页可以导出这个格式**，
 *   「摆棋小工具」那套带 `mode` 的文件也认（见 `puzzle-set-format.ts`）。
 *
 * ## 动态更新与缓存
 * 两个内容面都是**每次检索现取**，不做本地登记：刚推上去的题集，下一次点「检索题库」就能看到。
 * 但中间隔着两层缓存，所以手工动作（检索/下载）一律**绕过缓存**：
 *   - 应用自己那层 10 分钟响应缓存：用 `noCache` 绕过；
 *   - GitHub 的 CDN 缓存：给地址加一次性查询串绕过（否则刚推的文件可能拿到旧的）。
 * 代价是每次检索都真的发一次请求（本来也就一次），换来「随传随到」。
 *
 * ## 放哪里
 * GitHub Pages、`raw.githubusercontent.com`、`github.com` 文件夹链接都行（都在 CSP 白名单里）。
 * 换成别的域名：安卓端走系统网络直连不受限；网页版会被 CSP 拦，需要配代理。
 */
import { assertPublicHttpUrl } from "../../url-safety";
import { fetchOnlineText } from "./online-http";
import { normalizePuzzleSet } from "./puzzle-set-format";
import type { OnlineFetchedPuzzleSet, OnlinePuzzleSearchResult, OnlinePuzzleSetSummary, OnlinePuzzleSource } from "./types";

export const SELF_HOSTED_MANIFEST_KEY = "banbu-online-selfhosted-manifest-v1";

/**
 * 推荐托管域名。清单与题集的地址由用户填，取回域名没法预先枚举，所以应用只能放行确定的两个：
 * 你自己的 GitHub Pages 与 `raw.githubusercontent.com`（两者已在 index.html 的 connect-src 里，
 * 且 source-csp 门禁会盯着这条一致性）。换别的域名：安卓端走原生网络不受 CSP 限制，
 * 网页版会被安全策略拦下——界面上如实说明，不让人以为是「网站不支持跨域」。
 */
export const SELF_HOSTED_STATIC_ORIGINS = ["https://gugujiao953-ship-it.github.io", "https://raw.githubusercontent.com"];

export const loadSelfHostedManifestUrl = () => {
  try { return localStorage.getItem(SELF_HOSTED_MANIFEST_KEY) || ""; } catch { return ""; }
};

export const saveSelfHostedManifestUrl = (url: string) => {
  const trimmed = url.trim();
  try {
    if (trimmed) localStorage.setItem(SELF_HOSTED_MANIFEST_KEY, trimmed);
    else localStorage.removeItem(SELF_HOSTED_MANIFEST_KEY);
  } catch { /* 私密模式：设置不持久化也不影响这次取回 */ }
};

interface ManifestSet {
  title: string;
  file: string;
  type: string;
  count?: number;
}

/** 清单解析是纯函数：条目缺 `file` 的直接丢掉并如实报数，不猜。 */
export const parseSelfHostedManifest = (text: string, manifestUrl: string): { title: string; sets: ManifestSet[]; dropped: number } => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("清单不是合法的 JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("清单顶层应是一个对象");
  const source = raw as { title?: unknown; sets?: unknown };
  if (!Array.isArray(source.sets)) throw new Error("清单里没有 sets 数组");
  const base = manifestUrl.replace(/[^/]*$/, "");
  const sets: ManifestSet[] = [];
  let dropped = 0;
  for (const entry of source.sets) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) { dropped += 1; continue; }
    const item = entry as Record<string, unknown>;
    const file = typeof item.file === "string" ? item.file.trim() : "";
    if (!file) { dropped += 1; continue; }
    // 相对路径按清单所在目录解析；绝对地址原样用（取回前还会过一遍出网守卫）。
    let resolved: string;
    try {
      resolved = new URL(file, base).toString();
    } catch {
      dropped += 1;
      continue;
    }
    const count = typeof item.count === "number" && Number.isFinite(item.count) && item.count > 0 ? Math.round(item.count) : undefined;
    sets.push({
      title: (typeof item.title === "string" && item.title.trim()) || file.split("/").pop()!.replace(/\.json$/i, ""),
      file: resolved,
      type: (typeof item.type === "string" && item.type.trim()) || "未标注",
      count,
    });
  }
  const title = typeof source.title === "string" && source.title.trim() ? source.title.trim() : "自建题库";
  return { title, sets, dropped };
};

/**
 * 手工动作不走缓存：用户刚推上去的东西必须立刻看到。
 * 应用自己那层 10 分钟响应缓存用 `noCache` 绕过；GitHub 的 CDN 缓存靠加一次性查询串绕过。
 * 注意**只用它取文件，不用它当 id**——id 必须保持干净，否则同一个题集每次都会被当成新的。
 */
const freshUrl = (url: string) => {
  const target = new URL(url);
  target.searchParams.set("_", String(Date.now()));
  return target.toString();
};

export const listSelfHostedPuzzleSets = async (manifestUrl: string): Promise<OnlinePuzzleSearchResult> => {
  const url = assertPublicHttpUrl(manifestUrl, "题库清单");
  const parsed = parseSelfHostedManifest(await fetchOnlineText(freshUrl(url), { label: "题库清单", noCache: true }), url);
  const items: OnlinePuzzleSetSummary[] = parsed.sets.map((set) => ({
    id: set.file,
    title: set.title,
    // 自建题库的题型是自由文本：筛选器的选项直接由清单里出现过的值拼出来。
    category: set.type,
    typeLabel: set.type,
    total: set.count ?? null,
    url: set.file,
  }));
  return { items, total: items.length };
};

/** GitHub 文件夹链接 / 目录接口地址 → 目录接口地址；认不出来返回 null。 */
export const githubContentsApiFor = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname === "api.github.com") return parsed.toString();
  if (parsed.hostname !== "github.com") return null;
  // https://github.com/{owner}/{repo}/tree/{branch}/{path...}
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "tree") return null;
  const [owner, repo, , branch, ...rest] = parts;
  const api = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${rest.join("/")}`);
  api.searchParams.set("ref", branch);
  return api.toString();
};

/**
 * 列一个 GitHub 文件夹里的题集：**往文件夹里丢一个 `.json`，下次检索就出现**，不用改清单。
 * 目录接口只给文件名，所以题型标「未标注」、题数「下载后可见」——不编造。
 */
export const listGitHubFolderSets = async (apiUrl: string): Promise<OnlinePuzzleSearchResult> => {
  const target = freshUrl(assertPublicHttpUrl(apiUrl, "题库文件夹"));
  let text: string;
  try {
    text = await fetchOnlineText(target, { label: "题库文件夹", noCache: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 403 在 GitHub 上几乎总是「未登录的接口次数用完了」（每小时 60 次）。
    if (/HTTP 403/.test(message)) throw new Error("GitHub 拒绝了这个请求：多半是接口次数用完了（未登录每小时 60 次），等一会儿再检索；也可以改用「清单文件」方式");
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("GitHub 返回的不是文件夹内容——地址可能指向了单个文件；文件夹链接应形如 https://github.com/用户名/仓库/tree/main/puzzles");
  }
  if (!Array.isArray(raw)) {
    const message = (raw as { message?: string } | null)?.message || "";
    throw new Error(`GitHub 没返回文件夹内容${message ? `：${message}` : ""}（文件夹地址对不对？仓库是公开的吗？）`);
  }
  const items: OnlinePuzzleSetSummary[] = raw
    .filter((entry): entry is { name: string; download_url: string; type?: string } => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .filter((entry) => entry.type === "file" && typeof entry.name === "string" && /\.json$/i.test(entry.name) && entry.name.toLowerCase() !== "manifest.json" && typeof entry.download_url === "string")
    .map((entry) => ({
      id: entry.download_url,
      title: entry.name.replace(/\.json$/i, ""),
      category: "未标注",
      typeLabel: "未标注",
      total: null,
      url: entry.download_url,
    }));
  return { items, total: items.length };
};

export const fetchSelfHostedPuzzleSet = async (set: OnlinePuzzleSetSummary): Promise<OnlineFetchedPuzzleSet> => {
  const text = await fetchOnlineText(freshUrl(assertPublicHttpUrl(set.url, "题集")), { label: "题集", noCache: true });
  const normalized = normalizePuzzleSet(text, set.title);
  return {
    filename: set.id,
    title: normalized.title,
    text: normalized.text,
    total: normalized.total,
    importable: normalized.puzzles,
    unsupported: normalized.skipped,
    warnings: normalized.warnings,
  };
};

export const SELF_HOSTED_PUZZLE_SOURCE: OnlinePuzzleSource = {
  id: "self-hosted",
  label: "自建题库（你的 GitHub）",
  homepage: "https://docs.github.com/pages",
  credit: "题库内容由你自己托管与提供（GitHub 仓库 / Pages / raw 链接等）；本应用只按你填的地址取回并存入本机，不随包分发任何题目。",
  notes: [
    "推荐填 **GitHub 文件夹链接**（如 https://github.com/用户名/仓库/tree/main/puzzles）：往文件夹里丢一个 .json，下次检索就出现，不用改任何清单。",
    "也可以填一份 **manifest.json 的链接**：想自己定标题/题型/题数时用，格式是 { title, sets:[{ title, file, type, count }] }，file 支持相对路径。",
    "题集文件就是本应用的题库 JSON（题库列表里点题集行右侧的下载图标即可导出）；「摆棋小工具」那种带 mode 的文件也认，选点/选择题模式会自动跳过并报数。",
    "地址会记住，下次直接点检索。检索与下载都是现取、且绕开缓存，所以刚推上去的题集马上能看到；已导入的题集要刷新内容，再勾一次它重新下载即可（同一个题集会覆盖更新）。",
    "GitHub 目录接口未登录时每小时 60 次，正常检索够用；放 GitHub Pages / raw / github.com 都在应用白名单里，网页版能直接取。换别的域名：安卓端不受限，网页版会被安全策略拦下。",
  ],
  listSets: () => Promise.reject(new Error("自建题库需要先填地址")),
  fetchSet: fetchSelfHostedPuzzleSet,
};

/**
 * 面板拿它做检索：按地址形状自动识别「清单文件」还是「GitHub 文件夹」，
 * 认不出来时给出可执行的说法（而不是一个必然失败的网络请求）。
 */
export const searchSelfHostedPuzzleSets = async (address: string): Promise<OnlinePuzzleSearchResult> => {
  const url = address.trim();
  if (!url) throw new Error("还没填地址：填 GitHub 上放题集的文件夹链接，或一份 manifest.json 的链接（说明见右上角问号）");
  // `.json` 结尾＝清单文件；否则试 GitHub 文件夹（github.com/…/tree/… 或 api.github.com/…/contents/…）。
  if (/\.json(\?|#|$)/i.test(url)) return listSelfHostedPuzzleSets(url);
  const api = githubContentsApiFor(url);
  if (!api) throw new Error("这个地址认不出来：要么是 GitHub 文件夹链接（形如 https://github.com/用户名/仓库/tree/main/puzzles），要么是 .json 清单文件的链接");
  return listGitHubFolderSets(api);
};
