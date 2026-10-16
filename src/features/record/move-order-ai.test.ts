import { describe, expect, it, vi } from "vitest";
import {
  buildPositionPrompt,
  buildVisionRequest,
  chatCompletionsUrl,
  extractVisionReply,
  isAiVisionConfigured,
  normalizeAiVisionConfig,
  parseMoveOrderReply,
  parsePositionReply,
  visionEndpointUrl,
  testAiVisionConnection,
} from "./move-order-ai";

/**
 * 「AI 复原手序」的纯函数层单测（用户 09-28 方案③）。
 * 网络调用不在此层测；重点是**校验门槛**——AI 读错时必须整体拒绝，
 * 因为错手序与对手序在界面上长得一模一样，只能靠这里兜底。
 * 09-28 二批加了三种接口格式（chat/claude/responses），请求结构与
 * 回复提取逐格式钉住，防止以后改动把某一路静默改坏。
 */

describe("AI 识图配置", () => {
  it("非 http(s) 端点归一为空，防止填成任意字符串", () => {
    expect(normalizeAiVisionConfig({ baseUrl: "ftp://x", apiKey: "k", model: "m" }).baseUrl).toBe("");
    expect(normalizeAiVisionConfig("nope").baseUrl).toBe("");
    expect(normalizeAiVisionConfig(null).model).toBe("");
  });
  it("端点与模型齐全才算已配置；Key 可为空（自建无鉴权）", () => {
    expect(isAiVisionConfigured({ baseUrl: "https://a.b", apiKey: "", model: "m" })).toBe(true);
    expect(isAiVisionConfigured({ baseUrl: "https://a.b", apiKey: "k", model: "" })).toBe(false);
  });
  it("chat/completions 拼接容忍尾斜杠与已含路径", () => {
    expect(chatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4/")).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(chatCompletionsUrl("https://x.example/v1/chat/completions")).toBe("https://x.example/v1/chat/completions");
    expect(() => chatCompletionsUrl("not-a-url")).toThrow(/http/);
  });
});

it("AI 原生请求无响应时仍在期限内报超时", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true, Plugins: { CapacitorHttp: { request: () => new Promise(() => undefined) } } });
  try {
    const request = testAiVisionConnection({ baseUrl: "https://ai.example/v1", apiKey: "", model: "vision" });
    const rejected = expect(request).rejects.toThrow(/请求超时/);
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

describe("接口格式三种分派（09-28 二批：Chat Completions / Claude / Responses）", () => {
  const DATA_URL = "data:image/jpeg;base64,QUJD";

  it("端点拼接逐格式（含用户已把完整路径粘进来的容忍）", () => {
    expect(visionEndpointUrl("https://api.anthropic.com", "claude")).toBe("https://api.anthropic.com/v1/messages");
    expect(visionEndpointUrl("https://relay.example/v1", "claude")).toBe("https://relay.example/v1/messages");
    expect(visionEndpointUrl("https://relay.example/v1/messages/", "claude")).toBe("https://relay.example/v1/messages");
    expect(visionEndpointUrl("https://api.openai.com/v1", "responses")).toBe("https://api.openai.com/v1/responses");
    expect(visionEndpointUrl("https://api.openai.com/v1/responses", "responses")).toBe("https://api.openai.com/v1/responses");
    expect(visionEndpointUrl("https://relay.example/api/v3", "chat")).toBe("https://relay.example/api/v3/chat/completions");
  });

  it("旧配置（没有 format 字段）与非法值一律回落 chat", () => {
    expect(normalizeAiVisionConfig({ baseUrl: "https://a.b", model: "m" }).format).toBe("chat");
    expect(normalizeAiVisionConfig({ baseUrl: "https://a.b", model: "m", format: "gpt4free" }).format).toBe("chat");
    expect(normalizeAiVisionConfig({ baseUrl: "https://a.b", model: "m", format: "claude" }).format).toBe("claude");
  });

  it("Claude 请求：x-api-key + anthropic-version 头，图片拆成 base64 段", () => {
    const request = buildVisionRequest({ baseUrl: "https://api.anthropic.com", apiKey: "sk-ant", model: "claude-sonnet-4-5", format: "claude" }, DATA_URL, "读序号");
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("sk-ant");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    const content = (request.body.messages as Array<{ content: unknown[] }>)[0].content;
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    expect(content[1]).toMatchObject({ type: "text", text: "读序号" });
  });

  it("Responses 请求：input + input_image 直接用 dataURL，不传 temperature", () => {
    const request = buildVisionRequest({ baseUrl: "https://api.openai.com/v1", apiKey: "sk-oai", model: "gpt-4o", format: "responses" }, DATA_URL, "读序号");
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.headers.Authorization).toBe("Bearer sk-oai");
    const input = request.body.input as Array<{ content: Record<string, unknown>[] }>;
    expect(input[0].content[0]).toMatchObject({ type: "input_text", text: "读序号" });
    expect(input[0].content[1]).toMatchObject({ type: "input_image", image_url: DATA_URL });
    expect(request.body.temperature).toBeUndefined();
  });

  it("Chat 请求结构不退步（防以后改动砸掉已上线的一路）", () => {
    const request = buildVisionRequest({ baseUrl: "https://x.example/v1", apiKey: "", model: "m" }, DATA_URL, "读序号");
    expect(request.url).toBe("https://x.example/v1/chat/completions");
    expect(request.headers.Authorization).toBeUndefined();
    const messages = request.body.messages as Array<{ content: Record<string, unknown>[] }>;
    expect(messages[0].content[0]).toMatchObject({ type: "text", text: "读序号" });
    expect(messages[0].content[1]).toMatchObject({ type: "image_url", image_url: { url: DATA_URL } });
  });

  it("回复提取逐格式读对应字段；空回复一律如实报错", () => {
    expect(extractVisionReply("chat", { choices: [{ message: { content: "OK" } }] })).toBe("OK");
    expect(extractVisionReply("claude", { content: [{ type: "text", text: "OK Claude" }] })).toBe("OK Claude");
    expect(extractVisionReply("responses", { output: [{ content: [{ type: "output_text", output_text: "OK R" }] }] })).toBe("OK R");
    expect(extractVisionReply("responses", { output_text: "OK top" })).toBe("OK top");
    expect(() => extractVisionReply("claude", { content: [] })).toThrow(/空回复/);
    expect(() => extractVisionReply("responses", {})).toThrow(/空回复/);
    expect(() => extractVisionReply("chat", {})).toThrow(/空回复/);
  });
});

describe("parseMoveOrderReply：书谱序号还原", () => {
  const reply = (entries: Array<{ n: number; c: string; p?: string }>) => JSON.stringify(entries);

  it("标准 JSON：换算 row/col、奇黑偶白", () => {
    const result = parseMoveOrderReply(reply([{ n: 1, c: "H8", p: "B" }, { n: 2, c: "I9", p: "W" }]), 15);
    expect(result.moves).toHaveLength(2);
    expect(result.moves[0]).toMatchObject({ row: 7, col: 7, player: "black", number: 1 });
    expect(result.moves[1]).toMatchObject({ row: 6, col: 8, player: "white", number: 2 });
  });
  it("容忍代码围栏、键名变体与前后废话", () => {
    const text = "好的，结果如下：\n```json\n[{\"number\":1,\"coord\":\"h8\",\"color\":\"黑\"},{\"number\":2,\"coord\":\"8H\",\"color\":\"白\"}]\n```\n完毕。";
    // 注意 8H 与 h8 指向同一交叉点 → 坐标重复，必须拒绝。
    expect(() => parseMoveOrderReply(text, 15)).toThrow(/报了两次/);
  });
  it("小写与数字在前坐标可用", () => {
    const result = parseMoveOrderReply(reply([{ n: 1, c: "h8" }, { n: 2, c: "9i" }]), 15);
    expect(result.moves[1]).toMatchObject({ row: 6, col: 8 });
  });
  it("纯坐标数组按顺序补号", () => {
    const result = parseMoveOrderReply('["H8","I9","J10"]', 15);
    expect(result.moves.map((move) => move.number)).toEqual([1, 2, 3]);
  });
  it("非 JSON 回复走文本兜底解析", () => {
    const result = parseMoveOrderReply("1,H8,B 2,I9,W 3,J10,B", 15);
    expect(result.moves).toHaveLength(3);
    expect(result.notes.join(" ")).toMatch(/兜底/);
  });
  it("序号缺号整体拒绝（缺号补猜＝编造手序）", () => {
    expect(() => parseMoveOrderReply(reply([{ n: 1, c: "H8" }, { n: 3, c: "I9" }]), 15)).toThrow(/缺第 2 手/);
  });
  it("序号不从 1 起整体拒绝", () => {
    expect(() => parseMoveOrderReply(reply([{ n: 2, c: "H8" }, { n: 3, c: "I9" }]), 15)).toThrow(/不连续/);
  });
  it("越界坐标被拦下（20 路盘不出 H20）", () => {
    expect(() => parseMoveOrderReply(reply([{ n: 1, c: "H20" }]), 15)).toThrow(/有效坐标|越界/);
  });
  it("颜色大面积矛盾判为漏读；个别矛盾按交替纠正", () => {
    // 5 子全报白：奇数位的 1/3/5 都矛盾（>max(2, ⌈5/4⌉)）→ 判定漏读。
    expect(() => parseMoveOrderReply(reply([
      { n: 1, c: "H8", p: "W" }, { n: 2, c: "I9", p: "W" }, { n: 3, c: "J10", p: "W" }, { n: 4, c: "K11", p: "W" }, { n: 5, c: "H7", p: "W" },
    ]), 15)).toThrow(/黑白交替矛盾/);
    // 8 子只有第 6、8 手读色反了（2 处 ≤ max(2, ⌈8/4⌉)）→ 按奇偶纠正并注记。
    const fixed = parseMoveOrderReply(reply([
      { n: 1, c: "H8", p: "B" }, { n: 2, c: "I9", p: "W" }, { n: 3, c: "J10", p: "B" }, { n: 4, c: "K11", p: "W" },
      { n: 5, c: "H7", p: "B" }, { n: 6, c: "I7", p: "B" }, { n: 7, c: "J7", p: "B" }, { n: 8, c: "K7", p: "B" },
    ]), 15);
    expect(fixed.moves[1].player).toBe("white");
    expect(fixed.notes.join(" ")).toMatch(/纠正/);
  });
  it("空数组/无坐标明确报错而不是静默成功", () => {
    expect(() => parseMoveOrderReply("[]", 15)).toThrow(/没有读出/);
    expect(() => parseMoveOrderReply("棋盘上没有任何棋子", 15)).toThrow(/没有读出/);
  });
});

describe("AI 辅助识别：通用局面读取（2026-10-02，本地为主、云端为辅）", () => {
  it("无序号局面原样返回，不升级手序", () => {
    const result = parsePositionReply(JSON.stringify([
      { n: null, c: "H8", p: "B" }, { n: null, c: "I9", p: "W" }, { n: null, c: "J10", p: "B" },
    ]), 15);
    expect(result.stones).toHaveLength(3);
    expect(result.stones[0]).toMatchObject({ row: 7, col: 7, player: "black", number: null });
    expect(result.completeMoves).toBeNull();
  });
  it("序号恰好完整 1..N 且覆盖全部棋子 → 升级成手序序列（颜色按奇偶校正）", () => {
    const result = parsePositionReply(JSON.stringify([
      { n: 2, c: "I9", p: "B" }, { n: 1, c: "H8", p: "W" },
    ]), 15);
    expect(result.completeMoves).toEqual([
      { row: 7, col: 7, number: 1, player: "black" },
      { row: 6, col: 8, number: 2, player: "white" },
    ]);
    expect(result.notes.join(" ")).toMatch(/序号完整/);
  });
  it("序号不连续不升级，局面照常返回", () => {
    const result = parsePositionReply(JSON.stringify([
      { n: 1, c: "H8", p: "B" }, { n: 3, c: "J10", p: "B" },
    ]), 15);
    expect(result.completeMoves).toBeNull();
    expect(result.notes.join(" ")).toMatch(/不连续/);
  });
  it("同格重复坐标合并，保留带序号的那条", () => {
    const result = parsePositionReply(JSON.stringify([
      { n: null, c: "H8", p: "W" }, { n: 4, c: "H8", p: "W" }, { n: null, c: "I9", p: "B" },
    ]), 15);
    expect(result.stones).toHaveLength(2);
    const kept = result.stones.find((stone) => stone.row === 7 && stone.col === 7);
    expect(kept?.number).toBe(4);
    expect(result.notes.join(" ")).toMatch(/重复坐标/);
  });
  it("颜色大面积缺失判为不可信；个别缺失按序号奇偶补", () => {
    const stones = Array.from({ length: 5 }, (_, index) => ({ n: null, c: `${String.fromCharCode(65 + index)}8`, p: null }));
    expect(() => parsePositionReply(JSON.stringify(stones), 15)).toThrow(/颜色不明/);
    const patched = parsePositionReply(JSON.stringify([
      { n: 1, c: "H8", p: null }, { n: 2, c: "I9", p: "W" }, { n: null, c: "J10", p: "B" },
    ]), 15);
    expect(patched.stones[0].player).toBe("black");
    expect(patched.notes.join(" ")).toMatch(/奇偶/);
  });
  it("纯坐标自由文本兜底解析", () => {
    const result = parsePositionReply("棋盘上的子：H8 黑，I9 白，J10 黑", 15);
    expect(result.stones).toHaveLength(3);
    expect(result.stones[0]).toMatchObject({ player: "black", number: null });
    expect(result.notes.join(" ")).toMatch(/兜底/);
  });
  it("提示词按路数给出坐标范围", () => {
    expect(buildPositionPrompt(15)).toMatch(/A–O/);
    expect(buildPositionPrompt(9)).toMatch(/9×9/);
  });
});
