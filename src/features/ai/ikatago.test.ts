/**
 * iKataGo 云引擎的纯逻辑测试。
 *
 * 重点是两处最容易出错的：URL 与凭据拼接（拼错就连不上、且错误信息会泄露密码）、
 * 以及地址校验（明文 ws:// 要给出风险提示而不是静默放行）。
 */
import { describe, expect, it } from "vitest";
import {
  IKATAGO_DEFAULT_CONFIG,
  buildIkatagoUrl,
  ikatagoUrlProblem,
  type IkatagoConfig,
} from "./ikatago";

const base: IkatagoConfig = {
  serverUrl: "wss://katago.example.com:8443/ws",
  username: "alice",
  password: "s3cr3t",
  platform: "linux-x64",
};

describe("ikatago", () => {
  it("凭据与平台按 query 拼进地址", () => {
    const url = buildIkatagoUrl(base);
    expect(url.startsWith("wss://katago.example.com:8443/ws?")).toBe(true);
    const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(query.get("username")).toBe("alice");
    expect(query.get("password")).toBe("s3cr3t");
    expect(query.get("platform")).toBe("linux-x64");
  });

  it("地址已带 query 时用 & 追加（不能出现两个 ?）", () => {
    const url = buildIkatagoUrl({ ...base, serverUrl: "wss://example.com/ws?token=abc" });
    expect(url.split("?").length).toBe(2);
    expect(url).toContain("token=abc&username=alice");
  });

  it("没填凭据时只留平台（平台有默认值，总要带）", () => {
    const url = buildIkatagoUrl({ ...IKATAGO_DEFAULT_CONFIG, serverUrl: "wss://example.com/ws" });
    // 平台是 iKataGo 选择服务端引擎配置的依据，默认 linux-x64——不填也要带。
    expect(url).toBe("wss://example.com/ws?platform=linux-x64");
    // 连平台都清空时才完全不拼 query
    expect(buildIkatagoUrl({ serverUrl: "wss://example.com/ws", username: "", password: "", platform: "" }))
      .toBe("wss://example.com/ws");
  });

  it("地址校验：空/缺协议/明文", () => {
    expect(ikatagoUrlProblem("")).toBe("请填写服务器地址");
    expect(ikatagoUrlProblem("example.com:8080")).toContain("ws://");
    expect(ikatagoUrlProblem("https://example.com")).toContain("ws://");
    // 明文对外网 = 风险提示（不阻断，局域网/自建服务常用）
    expect(ikatagoUrlProblem("ws://1.2.3.4:8080")).toBe("INSECURE");
    // 明文本机 = 不算风险
    expect(ikatagoUrlProblem("ws://127.0.0.1:8080")).toBeNull();
    expect(ikatagoUrlProblem("wss://example.com/ws")).toBeNull();
  });
});
