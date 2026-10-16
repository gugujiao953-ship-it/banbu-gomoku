// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { parseCoordinate } from "../../game";
import { importKaibaoPuzzleJson } from "../../puzzles";
import { resetOnlineTransportState } from "./online-http";
import { normalizePuzzleSet } from "./puzzle-set-format";
import {
  SELF_HOSTED_PUZZLE_SOURCE,
  githubContentsApiFor,
  listGitHubFolderSets,
  parseSelfHostedManifest,
  searchSelfHostedPuzzleSets,
} from "./self-hosted";
import blackFirstVcf from "./__fixtures__/self-hosted/black-first-vcf.json?raw";
import manifestFixture from "./__fixtures__/self-hosted/manifest.json?raw";
import sixPath from "./__fixtures__/self-hosted/six-path.json?raw";

/**
 * 夹具是真实抓下来的样本（2026-09-16，renjutool.top，各截几条）：
 * 15 路 VCF、声明 6 路却把坐标写到 15 路的六路题集、以及混在里面的选点题与脏 side。
 * 现在这些内容不再从那个站点取（未获授权已停用），但**格式照样得认**——
 * 用户自己找的题很可能就来自那个生态。
 */

/** 来源的坐标写法：列 A–O、行自下往上，且一律按 15 路编号。 */
const sourcePoints = (text: string) =>
  [...text.matchAll(/([A-Za-z])(\d{1,2})/g)].map((match) => ({ col: match[1].toUpperCase().charCodeAt(0) - 65, row: 15 - Number(match[2]) }));

/** 规整后的写法在**目标棋盘**上必须解析回来源的同一个点位（6 路题集最容易在这里翻车）。 */
const parseWith = (text: string, size: number) =>
  [...text.matchAll(/([A-Za-z])(\d{1,2})/g)].map((match) => {
    const position = parseCoordinate(match[0], size);
    return position ? { row: position.row, col: position.col } : null;
  });

describe("题库文件格式", () => {
  it("本地导入走的是同一条管线：选点题不会被当成普通题收下", () => {
    // App 的 handlePuzzleFile 以前直接把文件文本交给 importKaibaoPuzzleJson，绕过了这一层规整，
    // 于是「摆棋小工具」格式里判不了对错的选点/选择题会被当普通题收下、坐标还可能整体错位。
    // 判据：规整后的文本再交给导入器，题数必须等于「来源总数 − 选点/选择题」。
    const raw = normalizePuzzleSet(blackFirstVcf, "黑先VCF");
    const naive = importKaibaoPuzzleJson(blackFirstVcf, "黑先VCF");
    const viaPipeline = importKaibaoPuzzleJson(raw.text, raw.title);
    expect(naive.collection.puzzles.length).toBe(3); // 旧行为：三条全收，含那条选择题
    expect(viaPipeline.collection.puzzles.length).toBe(2);
    expect(viaPipeline.collection.puzzles.length).toBe(raw.puzzles);
  });

  it("本应用自己的格式原样透传（一个字都不改）", () => {
    const native = JSON.stringify({ defaultSettings: { title: "我的题集" }, puzzles: [{ stones: "H8I9", side: 2, size: 15, rule: "renju", title: "第一题" }] });
    const result = normalizePuzzleSet(native, "兜底名");
    expect(result.text).toBe(native);
    expect(result.title).toBe("我的题集");
    expect(result.puzzles).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("摆棋小工具那套（带 mode）跳过选点/选择题并如实报数", () => {
    const result = normalizePuzzleSet(blackFirstVcf, "黑先VCF");
    expect(result.title).toBe("黑先VCF");
    expect(result.total).toBe(3);
    expect(result.puzzles).toBe(2); // 第三条 mode 193 是选择题
    expect(result.skipped).toBe(1);
  });

  it("15 路题集的坐标与首子不变", () => {
    const payload = JSON.parse(normalizePuzzleSet(blackFirstVcf, "黑先VCF").text) as { puzzles: Array<Record<string, unknown>> };
    expect(payload.puzzles[0].rule).toBe("renju");
    expect(parseWith(String(payload.puzzles[0].stones), 15)[0]).toEqual(parseCoordinate("G12", 15));
  });

  it("写在 15 路坐标系里的 6 路题落到 6 路棋盘上，且逐点对齐", () => {
    const result = normalizePuzzleSet(sixPath, "六路连珠1");
    // 4 条里 mode 193 那条被跳过（选点/选择题），其余 3 条留下
    expect(result.total).toBe(4);
    expect(result.puzzles).toBe(3);
    expect(result.skipped).toBe(1);
    const payload = JSON.parse(result.text) as { puzzles: Array<Record<string, unknown>> };
    const raw = JSON.parse(sixPath) as { puzzles: Array<Record<string, string>> };
    expect([...new Set(payload.puzzles.map((puzzle) => puzzle.size))]).toEqual([6]);
    // 留下的就是原始的第 1、2、4 条（第 3 条被跳过）——按这个对应关系逐点对齐，
    // 行列都不许平移或翻转。
    const survivors = [raw.puzzles[0], raw.puzzles[1], raw.puzzles[3]];
    for (const [index, puzzle] of payload.puzzles.entries()) {
      for (const field of ["stones", "blackStones", "whiteStones"] as const) {
        const source = survivors[index][field];
        if (!source) continue;
        expect(parseWith(String(puzzle[field]), 6), `第 ${index + 1} 条的 ${field}`).toEqual(sourcePoints(source));
      }
    }
  });

  it("side 只认 1/2；脏数据按子数奇偶回退", () => {
    const payload = JSON.parse(normalizePuzzleSet(sixPath, "六路连珠1").text) as { puzzles: Array<{ side: number }> };
    // 夹具最后一条 side=204、2 子（偶数）⇒ 黑走
    expect(payload.puzzles[2].side).toBe(1);
    // 前两条来源明确写了 side=1，不受奇偶影响（该题集 11 子为奇数，来源仍标黑先）
    expect(payload.puzzles[0].side).toBe(1);
    expect(payload.puzzles[1].side).toBe(1);
  });

  it("声明的棋盘装不下坐标时按坐标放大（宁可变大也不静默丢子）", () => {
    // H8 在 15 路坐标系里是自下往上第 8 行，6 路棋盘装不下 ⇒ 放大到 9 路并记一条提示。
    const result = normalizePuzzleSet(JSON.stringify({ defaultSettings: { title: "装不下" }, puzzles: [{ mode: 32, size: 6, side: 1, stones: "H8I9" }] }), "装不下");
    const payload = JSON.parse(result.text) as { puzzles: Array<Record<string, unknown>> };
    expect(payload.puzzles[0].size).toBe(9);
    expect(result.warnings.join(" ")).toMatch(/改为 9 路/);
  });

  it("缺 title 时按题型补一个带题型的题名（比「第 N 题」有用）", () => {
    const payload = JSON.parse(normalizePuzzleSet(sixPath, "六路连珠1").text) as { puzzles: Array<{ title: string }> };
    expect(payload.puzzles[0].title).toContain("VCT");
  });

  it("整集都是做不了的题时报错，而不是交出一个空题集", () => {
    expect(() => normalizePuzzleSet(JSON.stringify({ defaultSettings: { title: "只有选择题" }, puzzles: [{ mode: 193, size: 15, stones: "H8I9H10", options: "D9" }] }), "只有选择题"))
      .toThrow(/没有本应用能做的题目/);
  });

  it("不是题库 JSON 时给出可读的错，而不是崩在解析里", () => {
    expect(() => normalizePuzzleSet("不是 json", "x")).toThrow(/不是合法的 JSON/);
    expect(() => normalizePuzzleSet(JSON.stringify({ defaultSettings: {} }), "x")).toThrow(/没有 puzzles 数组/);
  });

  // 开宝「二维 JSON 题集」顶层是题目数组（README 承诺的兼容格式），导入器认它，
  // 所以归整这一步必须原样透传而不是报错——否则本地导入开宝数组文件必失败。
  it("开宝二维数组题集原样透传，不报「没有 puzzles 数组」", () => {
    const kaibao = JSON.stringify([["★", "H8,1", "H9,2"]]);
    const result = normalizePuzzleSet(kaibao, "兼容题集");
    expect(result.text).toBe(kaibao);
    expect(result.title).toBe("兼容题集");
    expect(result.total).toBe(1);
    expect(result.puzzles).toBe(1);
    // 透传后导入器确实能认下来（这条路径以前被前置校验挡死）。
    expect(() => importKaibaoPuzzleJson(kaibao, "兼容题集")).not.toThrow();
  });
});

describe("自建题库清单", () => {
  const manifestUrl = "https://gugujiao953-ship-it.github.io/my-puzzles/puzzles/manifest.json";

  it("相对路径按清单所在目录解析，缺 file 的条目丢掉并报数", () => {
    const parsed = parseSelfHostedManifest(manifestFixture, manifestUrl);
    expect(parsed.title).toBe("我的题库");
    expect(parsed.sets).toHaveLength(4);
    expect(parsed.dropped).toBe(1); // 「坏条目」没有 file
    expect(parsed.sets[0]).toEqual({ title: "黑先VCF", file: "https://gugujiao953-ship-it.github.io/my-puzzles/puzzles/sets/black-first-vcf.json", type: "VCF", count: 3 });
    // 绝对地址原样保留（可指向 raw 链接）
    expect(parsed.sets[2].file).toBe("https://raw.githubusercontent.com/someone/renju/main/big.json");
    // 没写 title/type/count 的：标题取文件名、题型标「未标注」、题数未知（不编造）
    expect(parsed.sets[1].title).toBe("六路连珠1");
    expect(parsed.sets[1].count).toBeUndefined();
    expect(parsed.sets[3]).toMatchObject({ title: "untitled", type: "未标注" });
  });

  it("清单不是对象 / 没有 sets 时给出可读的错", () => {
    expect(() => parseSelfHostedManifest("[]", manifestUrl)).toThrow(/顶层应是一个对象/);
    expect(() => parseSelfHostedManifest("{}", manifestUrl)).toThrow(/没有 sets 数组/);
    expect(() => parseSelfHostedManifest("nope", manifestUrl)).toThrow(/不是合法的 JSON/);
  });

  it("来源说明里要写明内容由用户自己提供、并给出清单格式", () => {
    expect(SELF_HOSTED_PUZZLE_SOURCE.credit).toMatch(/你自己托管/);
    expect(SELF_HOSTED_PUZZLE_SOURCE.notes.join(" ")).toMatch(/manifest\.json/);
    expect(SELF_HOSTED_PUZZLE_SOURCE.notes.join(" ")).toMatch(/GitHub 目录接口|GitHub Pages/);
  });
});

describe("GitHub 文件夹模式（丢文件就能被搜到）", () => {
  it("认得出 github.com/…/tree/… 与 api.github.com/…/contents/…，其余返回 null", () => {
    expect(githubContentsApiFor("https://github.com/someone/renju/tree/main/puzzles"))
      .toBe("https://api.github.com/repos/someone/renju/contents/puzzles?ref=main");
    // 子目录要整段带上
    expect(githubContentsApiFor("https://github.com/someone/renju/tree/master/a/b"))
      .toBe("https://api.github.com/repos/someone/renju/contents/a/b?ref=master");
    // 已经是接口地址：原样用
    expect(githubContentsApiFor("https://api.github.com/repos/someone/renju/contents/puzzles"))
      .toBe("https://api.github.com/repos/someone/renju/contents/puzzles");
    // 仓库首页、blob 文件页、Pages 链接都不是文件夹
    expect(githubContentsApiFor("https://github.com/someone/renju")).toBeNull();
    expect(githubContentsApiFor("https://github.com/someone/renju/blob/main/x.json")).toBeNull();
    expect(githubContentsApiFor("https://someone.github.io/renju/puzzles/")).toBeNull();
  });

  it("列出文件夹里的 .json（跳过 manifest.json 与子目录），题型题数如实标未知", async () => {
    const folder = JSON.stringify([
      { name: "manifest.json", type: "file", download_url: "https://raw.githubusercontent.com/someone/renju/main/puzzles/manifest.json" },
      { name: "san-shou.json", type: "file", download_url: "https://raw.githubusercontent.com/someone/renju/main/puzzles/san-shou.json" },
      { name: "vcf.json", type: "file", download_url: "https://raw.githubusercontent.com/someone/renju/main/puzzles/vcf.json" },
      { name: "notes.md", type: "file", download_url: "https://raw.githubusercontent.com/someone/renju/main/puzzles/notes.md" },
      { name: "sub", type: "dir", download_url: null },
    ]);
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(folder, { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    resetOnlineTransportState();

    const found = await listGitHubFolderSets("https://api.github.com/repos/someone/renju/contents/puzzles?ref=main");
    expect(found.items.map((item) => item.title)).toEqual(["san-shou", "vcf"]);
    expect(found.items[0].typeLabel).toBe("未标注");
    expect(found.items[0].total).toBeNull();
    expect(found.items[0].url).toBe("https://raw.githubusercontent.com/someone/renju/main/puzzles/san-shou.json");
    // 「随传随到」的前提：请求必须绕开两层缓存（自带 noStore + 一次性查询串）
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("_=");
    expect(String(globalThis.fetch)).toBeTruthy();
  });

  it("接口给了非数组（例如次数用完）时给出可读的错", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    resetOnlineTransportState();
    await expect(listGitHubFolderSets("https://api.github.com/repos/someone/renju/contents/puzzles")).rejects.toThrow(/rate limit/);
  });

  it("按地址形状自动分流：.json 走清单，文件夹链接走目录接口，认不出的给可执行提示", async () => {
    const manifestCalls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      manifestCalls.push(String(input));
      return new Response(manifestFixture, { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    resetOnlineTransportState();
    const fromManifest = await searchSelfHostedPuzzleSets("https://gugujiao953-ship-it.github.io/my-puzzles/puzzles/manifest.json");
    expect(fromManifest.items).toHaveLength(4);
    expect(manifestCalls[0]).toContain("manifest.json");

    resetOnlineTransportState();
    await expect(searchSelfHostedPuzzleSets("   ")).rejects.toThrow(/还没填地址/);
    await expect(searchSelfHostedPuzzleSets("https://example.com/puzzles/")).rejects.toThrow(/认不出来/);
  });
});
