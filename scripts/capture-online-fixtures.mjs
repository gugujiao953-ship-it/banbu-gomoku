/**
 * 重新抓取 renju.net 的真实响应，裁剪成在线棋谱库的测试夹具。
 *
 * 夹具必须来自真站：解析器是照着真实标记写的，合成 HTML 只会把解析器测成
 * 「对自己造的 HTML 正确」。改过解析器、或发现 renju-net.live.test.ts 报漂移时，
 * 跑这个脚本刷新夹具，再跑一次单测确认断言仍然成立（夹具变了断言可能也要跟着改）。
 *
 *   node scripts/capture-online-fixtures.mjs
 *
 * 只读，不改仓库其它内容；联网（不做任何自动化遍历，只取固定的 4 个页面）。
 */
import { mkdirSync, writeFileSync } from "node:fs";

const DIR = "src/features/online/__fixtures__/renju-net";
mkdirSync(DIR, { recursive: true });

const get = async (path) => {
  const r = await fetch("https://www.renju.net" + path, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0" } });
  return await r.text();
};

const cut = (text, from, to, extraAfter = 0) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`cut failed: ${from} / ${to}`);
  return text.slice(start, end + to.length + extraAfter);
};

// 1) 检索结果页：总数行 + 统计表（干扰项）+ 真正的 gamelist 行 + 分页
{
  const html = await get("/game/search?year_from=2024&year_to=2024");
  const total = html.match(/<p class="gray">[^<]*<\/p>/)?.[0] ?? "";
  // 页面上有两个 class="gamelist" 的表：先是统计表，后是对局表。夹具必须保留这个歧义。
  const tables = [...html.matchAll(/<table class="gamelist">[\s\S]*?<\/table>/g)].map((m) => m[0]);
  const stats = tables.find((t) => !/\/game\/\d+\//.test(t)) ?? "";
  const list = tables.find((t) => /\/game\/\d+\//.test(t)) ?? "";
  const rows = [...list.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const trimmed = `${total}\n${stats}\n<table class="gamelist">\n<thead><tr><th>Black</th><th>Result</th><th>White</th><th>Date</th></tr></thead>\n<tbody>\n${rows.slice(1, 5).join("\n")}\n</tbody>\n</table>\n${cut(html, "<p><b>Pages:</b>", "</p>", 0)}`;
  writeFileSync(`${DIR}/search-2024.html`, trimmed);
  console.log("search-2024.html", trimmed.length, "bytes; 表数=", tables.length, "总行=", total);
}

// 2) 单局页：棋盘 div + 元信息表
{
  const html = await get("/tournament/2058/game/190334/");
  const board = html.match(/<div class="renjuboardbbcode"[\s\S]*?>/)?.[0] ?? "";
  const info = cut(html, '<div class="container d-md-flex', "</table>");
  writeFileSync(`${DIR}/game-190334.html`, `${info}\n${board}\n`);
  console.log("game-190334.html", info.length + board.length, "bytes");
}

// 3) 锦标赛页（地点/规则/日期范围）——整页保存，正文只有几 KB
{
  const html = await get("/tournament/2058/");
  const start = html.indexOf('<div class="container d-md-flex');
  const body = html.slice(start, html.indexOf("</body>"));
  writeFileSync(`${DIR}/tournament-2058.html`, body);
  const hasPlace = /Place:/.test(body);
  console.log("tournament-2058.html", body.length, "bytes; 含 Place =", hasPlace, "; 含 table =", /<table/.test(body));
}

// 4) 棋手 / 赛事检索 JSON
writeFileSync(`${DIR}/people-kawada.json`, await get("/media/people.json?query=kawada&escape=1"));
writeFileSync(`${DIR}/tournaments-world.json`, await get("/media/tournaments.json?query=world&escape=1"));
console.log("json fixtures ok");

// 5) 打印检索表单的规则/开局选项，供映射表使用
{
  const html = await get("/game/search/");
  for (const name of ["rule", "opening", "type"]) {
    const block = html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`));
    console.log(`### ${name}:`, block ? [...block[1].matchAll(/<option value="([^"]*)">([^<]*)</g)].map((m) => `${m[1]}=${m[2]}`).join(" | ") : "none");
  }
}
