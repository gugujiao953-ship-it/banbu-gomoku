import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { OTHER_RESOURCES, otherResourceCopyText } from "./other-resources";

/**
 * 「在线 → 其他」（用户 2026-10-14 要求）：别人分享出来的网盘资料地址。
 *
 * 与「题库」那面习题站导航同一纪律：**只有链接，零请求**。点卡片在浏览器里打开那个网盘页，
 * 点「复制」把地址（连同提取码）写进剪贴板；本应用不下载文件、不代登网盘账号。
 */
export function OnlineOtherPanel() {
  /** 刚复制成功那条的 id；"none" = 这台设备不让程序写剪贴板。 */
  const [copied, setCopied] = useState("");
  const copy = async (id: string, text: string) => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) { setCopied("none"); return; }
    try {
      await clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied("none");
    }
  };

  return (
    <div className="online-other" data-online-other aria-label="网盘资料">
      <p className="online-browse-note" role="note" data-other-note>
        这里放的是分享出来的五子棋资料地址。点一张卡片就在浏览器里打开那个网盘页面，点「复制」把地址（连同提取码）拿走——本应用不下载任何文件，也不代登任何网盘账号。
      </p>
      <ul className="online-puzzle-list" data-other-results>
        {OTHER_RESOURCES.map((resource) => (
          <li key={resource.id} className="online-puzzle-row" data-other-resource={resource.id}>
            <a
              className="online-puzzle-open"
              data-other-open={resource.id}
              href={resource.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="online-puzzle-main">
                <b>{resource.site} · {resource.label}</b>
                <small className="online-puzzle-meta">{resource.note}</small>
                {resource.accessCode && <small className="online-other-code" data-other-code>提取码 <b>{resource.accessCode}</b></small>}
              </span>
              <span className="online-game-action"><ExternalLink size={13}/>打开</span>
            </a>
            <button type="button" className="online-other-copy" data-other-copy={resource.id} onClick={() => void copy(resource.id, otherResourceCopyText(resource))}>
              {copied === resource.id ? "已复制" : "复制"}
            </button>
          </li>
        ))}
      </ul>
      {copied === "none" && <p className="online-browse-note" role="status" data-other-copy-failed>这台设备不让程序写剪贴板：长按地址自己复制。</p>}
      <p className="online-credit" data-other-credit>
        网盘分享会过期或被取消：打开要显示「链接不存在 / 已失效」，那是分享本身没了，不是本应用出错。收录日期 {OTHER_RESOURCES.map((resource) => resource.addedOn).filter((date, index, all) => all.indexOf(date) === index).join("、")}。
      </p>
    </div>
  );
}
