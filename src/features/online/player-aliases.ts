/**
 * 中文名 → 来源站点拉丁写法的别名层。
 *
 * 为什么需要：renju.net 的棋手检索只认拉丁名，而且**只认小写**（实测 2026-09-15：
 * `query=cao` 有结果、`query=Cao` 空）。用户想用汉字搜「曹冬」，站点那条路走不通，
 * 所以在应用侧先把汉字映射成拉丁名，再交给来源去查。
 *
 * 数据是 `public/online/player-aliases.json`（豆包联网检索生成，可按需扩充而不改代码）。
 * 定位是**辅助而非权威**：命中就用拉丁名去查，查不到仍然回落到用户原文；表里写错的
 * 条目只会少搜到，不会搜错人。
 */
export interface PlayerAlias {
  cn: string;
  latin: string[];
}

let cache: PlayerAlias[] | null = null;
let loading: Promise<PlayerAlias[]> | null = null;

const HAS_CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
export const hasCjk = (value: string) => HAS_CJK.test(value);

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** 拉丁名的小写化：站点只认小写，这一步无论有没有别名表都要做。 */
export const toSiteQueryText = (value: string) => normalize(value);

export const loadPlayerAliases = (): Promise<PlayerAlias[]> => {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  loading = (async () => {
    try {
      const response = await fetch(new URL("online/player-aliases.json", document.baseURI).href, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { aliases?: PlayerAlias[] };
      cache = (payload.aliases || []).filter((entry) => entry?.cn && Array.isArray(entry.latin) && entry.latin.length);
      return cache;
    } catch {
      cache = [];
      return cache;
    } finally {
      loading = null;
    }
  })();
  return loading;
};

/** 同步查表（表已加载时才有结果）。搜索路径上用它避免为了查一个名字去 await。 */
export const lookupPlayerAlias = (text: string): PlayerAlias | null => lookupPlayerAliasIn(cache || [], text);

export const lookupPlayerAliasIn = (aliases: PlayerAlias[], text: string): PlayerAlias | null => {
  const wanted = normalize(text);
  if (!wanted) return null;
  return aliases.find((entry) => normalize(entry.cn) === wanted)
    || aliases.find((entry) => normalize(entry.cn).replace(/\s/g, "") === wanted.replace(/\s/g, ""))
    || null;
};

/**
 * 把用户输入转成该拿去来源检索的写法：
 *   · 命中别名 → 用拉丁名（取第一个写法，站点检索是多词子串匹配）
 *   · 没命中但含汉字 → 原样返回，让来源自己决定（多半查不到，面板会提示）
 *   · 拉丁输入 → 一律小写（站点只认小写，`Cao` 查不到、`cao` 能查到）
 */
export const resolvePlayerQueryWith = (aliases: PlayerAlias[], text: string): { query: string; alias: PlayerAlias | null } => {
  const trimmed = text.trim();
  if (!trimmed) return { query: "", alias: null };
  const alias = lookupPlayerAliasIn(aliases, trimmed);
  if (alias) return { query: normalize(alias.latin[0]), alias };
  return { query: toSiteQueryText(trimmed), alias: null };
};

export const resolvePlayerQuery = (text: string): { query: string; alias: PlayerAlias | null } =>
  resolvePlayerQueryWith(cache || [], text);
