import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { PROBLEM_SITES, problemSiteTags, problemSitesCheckedOn, searchProblemSites } from "./problem-sites";

const QUERY_KEY = "banbu-online-puzzle-query-v2";
const TAG_KEY = "banbu-online-puzzle-tag-v2";

const loadStored = (key: string) => {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
};
const store = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* 记不住也不影响这次浏览 */ }
};

/**
 * 在线题库＝**习题站导航**（用户 09-26 的口径）。
 *
 * 一屏卡片，每张写清「这个站主要有什么题、什么语言、要不要登录」，点整张卡片就在浏览器
 * 里打开那个站的习题页。本应用不取题、不缓存、不入库，所以打开这一面不发任何请求，
 * 关键词与题型筛选也都是本地过滤。
 *
 * 上一版这里是「填你自己托管的 GitHub 地址 → 检索题集 → 下载并导入」（`self-hosted.ts`，
 * 那条通道的代码与单测都还在，只是界面不再摆出来；要恢复入口见 `sources.ts` 与改造表 R89）。
 */
export function OnlinePuzzlePanel() {
  const [query, setQuery] = useState(() => loadStored(QUERY_KEY));
  const [tag, setTag] = useState(() => loadStored(TAG_KEY));
  const tags = useMemo(() => problemSiteTags(), []);
  const hits = useMemo(() => searchProblemSites(query, tag), [query, tag]);
  const checkedOn = problemSitesCheckedOn();

  const patchQuery = (next: string) => { setQuery(next); store(QUERY_KEY, next); };
  const patchTag = (next: string) => { setTag(next); store(TAG_KEY, next); };

  return (
    <div className="online-puzzle" data-online-puzzle-dir aria-label="习题站导航">
      <p className="online-browse-note" role="note" data-puzzle-note>
        这些站点各有各的五子棋 / 连珠习题。看清哪一家对得上你想练的东西，再点进去——点一张卡片就在浏览器里打开它的习题页，本应用不下载题目、也不代管任何账号。
      </p>

      <div className="online-filters">
        <label className="online-field">找题
          <input
            value={query}
            data-puzzle-query
            placeholder="题型、站点名、语言都可，例如 VCF、每日一题、日文"
            onChange={(event) => patchQuery(event.target.value)}
          />
        </label>
      </div>

      {tags.length > 0 && (
        <div className="online-puzzle-tags" role="group" aria-label="题型" data-puzzle-tags>
          <button type="button" className={tag ? "online-puzzle-tag" : "online-puzzle-tag active"} data-puzzle-tag="" onClick={() => patchTag("")}>全部题型</button>
          {tags.map((entry) => (
            <button
              key={entry}
              type="button"
              className={tag === entry ? "online-puzzle-tag active" : "online-puzzle-tag"}
              aria-pressed={tag === entry}
              data-puzzle-tag={entry}
              onClick={() => patchTag(tag === entry ? "" : entry)}
            >{entry}</button>
          ))}
        </div>
      )}

      {PROBLEM_SITES.length === 0 && (
        <p className="helper" data-puzzle-dir-empty>习题站目录正在逐站核实（要真的打开看到题才敢放进来），这一版还没有可推荐的站点。</p>
      )}

      {hits.length > 0 && (
        <ul className="online-puzzle-list" data-puzzle-results>
          {hits.map((site) => (
            <li key={site.id} className="online-puzzle-row" data-puzzle-site={site.id}>
              <a
                className="online-puzzle-open"
                href={site.url}
                target="_blank"
                rel="noreferrer"
                data-puzzle-site-open={site.id}
                aria-label={`在浏览器中打开 ${site.name} 的习题页`}
              >
                <span className="online-puzzle-main">
                  <b>{site.name}</b>
                  <small>{site.what}</small>
                  <small className="online-puzzle-meta">{[site.tags.join(" · "), site.language, site.access].filter(Boolean).join(" · ")}</small>
                </span>
                <span className="online-game-action"><ExternalLink size={13}/>打开</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {PROBLEM_SITES.length > 0 && hits.length === 0 && (
        <p className="helper" data-puzzle-no-hit>目录里没有匹配的站点。换个关键词，或点「全部题型」看看都有什么。</p>
      )}

      <p className="online-credit" data-puzzle-credit>
        {checkedOn ? `目录核实于 ${checkedOn}` : "目录核实中"} · 共 {PROBLEM_SITES.length} 家；题目与解析的版权归各站点和原作者，本应用只做指路。
      </p>
    </div>
  );
}
