/**
 * 抓励精连珠教室「世界连珠锦标赛」各届**正赛轮次页**，生成 `scripts/record-index-sources.json`
 * 同形状的对局清单（`scripts/record-index-sources.generated.json`），供
 * `scripts/build-record-index.mjs` 打进包里的棋手目录使用。
 *
 * 为什么要这份东西（用户 09-28：「搜索棋手后还是没有具体赛事」）：目录里原来只有
 * 第 18 届世锦赛的 8 个页面，绝大多数棋手搜出来是「只有入口、没有对局」。励精史记是
 * 本站**允许浏览**的来源（`sources.ts`：无 robots.txt，应用内本来就在逐页浏览），
 * 把它的正赛轮次页读一遍，就能给棋手补上「他打过哪一届、第几轮、对手是谁」。
 *
 * 纪律（与 sources.ts 一致）：
 *  · 只登记**页面上原文就写着**的「黑 - 白」，不猜胜负、不猜年份、不补走子；
 *  · 同主机串行、每次至少间隔 1.1 秒（与在线面同一口径），只跑一次、结果落盘可复核；
 *  · 每一页都留下地址，人工抽查时按地址回原页对。
 *
 * 跑法：`node scripts/fetch-world-championship-sources.mjs`（约 200 页，4–5 分钟）
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ORIGIN = "https://www.ljrenju.com";
/** HTTP 头只允许 ASCII（上一版这里写了中文，Node 直接抛 ByteString 错）。 */
const UA = "banbu-gomoku/1.1 (manual event list check; 1.2s between pages)";
const GAP_MS = 1150;
/** 一届最多读多少页（个别届有 40+ 个链接，含重复的预赛/决赛页）。 */
const MAX_PAGES_PER_EVENT = 30;
const OUTPUT = "scripts/record-index-sources.generated.json";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 励精站内混编码：news 页是 UTF-8，个别老页是 GBK —— 与 src 里的 decodeText 同一口径。 */
const decode = (buffer) => {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  // 出现替换符说明不是 UTF-8，退回 gb18030（Node 22 起内置该解码器）。
  if (!utf8.includes("\uFFFD")) return utf8;
  try { return new TextDecoder("gb18030").decode(buffer); } catch { return utf8; }
};

const fetchText = async (url, referer) => {
  const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html", ...(referer ? { referer } : {}) }, cache: "no-store" });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return decode(await response.arrayBuffer());
};

const stripTags = (value) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

/** 史记索引 → 世界锦标赛总页（wcall.htm）→ 各届页（rif2025/wc18.htm）→ 轮次页。 */
const eventPages = async () => {
  const index = await fetchText(`${ORIGIN}/news/wcall.htm`);
  const links = [...index.matchAll(/href="([a-z0-9]+\/[^"]*\.htm)"[^>]*>([^<]{1,30})/gi)];
  const out = [];
  for (const match of links) {
    const url = `${ORIGIN}/news/${match[1]}`;
    const label = stripTags(match[2]);
    if (!/wc\d+\.htm$/i.test(match[1])) continue;
    out.push({ url, label, directory: match[1].split("/")[0] });
  }
  return out;
};

/** 一届页面里的轮次链接：只取**正赛**（`wcNNaR.htm`），预赛/女子/团体另有命名，先不混进来。 */
const roundLinks = (html, eventUrl, directory, label) => {
  const out = [];
  for (const match of html.matchAll(/href="([^"#]+\.htm)"[^>]*>([^<]{1,40})/gi)) {
    const href = match[1];
    if (href.includes("..") || href.startsWith("http")) continue;
    // 轮次页命名各届不统一（2026-09-28 实测）：新届正赛是 wc17ar1.htm，13 届是 wc13rqtr1.htm，
    // 4 届是 wc4qtr2.htm……统一成「wc + 届数 + 至多四个字母 + 轮次号」；
    // 会员名单（GA2023.htm）、说明页（wc13info.htm，结尾没数字）这类都被挡掉。
    if (!/^wc\d{1,2}[a-z]{0,4}\d{1,2}\.htm$/i.test(href)) continue;
    out.push({ url: `${ORIGIN}/news/${directory}/${href}`, stage: stripTags(match[2]) || href, event: label });
  }
  return out;
};

/**
 * 轮次页里的对局：励精的题注一律是「黑 - 白」顺序（资格赛页是「黑:/白:」表格，
 * 正赛页是 `wc17ar, r3, 黑 - 白` 的题注，两处都是黑方在前——见 record-index-sources.json 的 method）。
 * 这里只接受**同一行里出现两个拉丁/中文姓名且中间是「 - 」**的题注，其它一律跳过（宁缺不猜）。
 */
const gamesFromPage = (html) => {
  const text = stripTags(html);
  const pairs = [];
  const seen = new Set();
  for (const match of text.matchAll(/([A-ZÀ-Ý][\w'’.\-À-ÿ]{1,24}(?: [A-ZÀ-Ý][\w'’.\-À-ÿ]{1,24}){0,3})\s+-\s+([A-ZÀ-Ý][\w'’.\-À-ÿ]{1,24}(?: [A-ZÀ-Ý][\w'’.\-À-ÿ]{1,24}){0,3})/g)) {
    const black = match[1].trim();
    const white = match[2].trim();
    // 明显不是人名的（地名、轮次名、开局名）宁可不收：两边都得像「名 姓」或 2-4 字中文名
    const looksPerson = (value) => /^[\u4e00-\u9fa5]{2,4}$/.test(value) || /^[A-ZÀ-Ý][\w'’.\-À-ÿ]+( [A-ZÀ-Ý][\w'’.\-À-ÿ]+){1,3}$/.test(value);
    if (!looksPerson(black) || !looksPerson(white) || black === white) continue;
    const key = `${black}|${white}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(`${black} - ${white}`);
  }
  return pairs;
};

const yearFromDirectory = (directory) => Number(directory.match(/(\d{4})/)?.[1] ?? 0);

const main = async () => {
  const events = await eventPages();
  console.log(`世界锦标赛页 ${events.length} 届`);
  const groups = [];
  for (const event of events) {
    await sleep(GAP_MS);
    let html = "";
    try { html = await fetchText(event.url, `${ORIGIN}/news/wcall.htm`); } catch (error) { console.log(`  跳过 ${event.label}：${error.message}`); continue; }
    const rounds = roundLinks(html, event.url, event.directory, event.label).slice(0, MAX_PAGES_PER_EVENT);
    const pages = [];
    for (const round of rounds) {
      await sleep(GAP_MS);
      let pageHtml = "";
      try { pageHtml = await fetchText(round.url, event.url); } catch (error) { console.log(`    跳过 ${round.url}：${error.message}`); continue; }
      const games = gamesFromPage(pageHtml);
      if (!games.length) continue;
      pages.push({ url: round.url, stage: `${event.label} ${round.stage}`.trim(), games });
      process.stdout.write(`\r  ${event.label}：已读 ${pages.length}/${rounds.length} 页        `);
    }
    console.log(`\n  ${event.label}（${event.directory}）→ ${pages.length} 页 / ${pages.reduce((sum, page) => sum + page.games.length, 0)} 局`);
    if (pages.length) {
      groups.push({
        event: event.label.replace(/^第/, "第").trim(),
        year: String(yearFromDirectory(event.directory)),
        checked: new Date().toISOString().slice(0, 10),
        method: "本项目 scripts/fetch-world-championship-sources.mjs 逐页读取励精连珠教室正赛轮次页，只登记页面上原文成对的「黑 - 白」；无 robots 限制（该站 robots.txt 为 404），逐页间隔 1.2 秒。",
        pages,
        notes: "由脚本抓取，未逐页人工复核；每条都带页面地址，抽查时按地址回原页对。轮次页不给胜负分，结果一律留空。",
      });
    }
  }
  writeFileSync(resolve(root, OUTPUT), `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), events: groups }, null, 2)}\n`, "utf8");
  const totals = groups.reduce((sum, group) => sum + group.pages.reduce((inner, page) => inner + page.games.length, 0), 0);
  console.log(`\n已写出 ${OUTPUT}：${groups.length} 届 · ${totals} 局`);
};

await main();
