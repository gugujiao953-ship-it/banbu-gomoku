// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameDocument } from "./types";
import { DEFAULT_SPEECH_RATE, describeCurrentStep, describeMove, loadSpeechEnabled, loadSpeechRate, saveSpeechEnabled, saveSpeechRate, speakStep, speechSupported, stopSpeaking } from "./speech";

const makeDocument = (): GameDocument => ({
  id: "doc", version: 1, rootId: "root",
  nodes: {
    root: { id: "root", parentId: null, children: ["n1"], move: null, comment: "", marks: [] },
    // 一个「过手」式的非落子节点：move 为空但仍有父链，用来验证向上回溯
    n1: { id: "n1", parentId: "root", children: ["n2"], move: { row: 7, col: 0, player: "black" }, comment: "", marks: [] },
    n2: { id: "n2", parentId: "n1", children: [], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] },
  },
  metadata: { title: "t", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
}) as unknown as GameDocument;

/** 装一个最小的 speechSynthesis 桩，记录说过的句子。 */
const stubSpeech = () => {
  const spoken: string[] = [];
  let cancelCount = 0;
  class FakeUtterance { text: string; rate = 1; lang = ""; voice: unknown = null; constructor(text: string) { this.text = text; } }
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, writable: true, value: FakeUtterance });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true, writable: true,
    value: {
      speak: (utterance: { text: string }) => { spoken.push(utterance.text); },
      cancel: () => { cancelCount += 1; },
      getVoices: () => [{ lang: "zh-CN", name: "stub" }],
    },
  });
  return { spoken, cancelCount: () => cancelCount };
};
const dropSpeech = () => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "speechSynthesis");
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "SpeechSynthesisUtterance");
};

describe("语音报手", () => {
  afterEach(() => { dropSpeech(); localStorage.clear(); vi.restoreAllMocks(); });

  it("文案是「颜色 手数 · 坐标」，坐标随棋盘路数换算", () => {
    const doc = makeDocument();
    expect(describeMove(doc, { row: 7, col: 0, player: "black" }, 1)).toBe("黑 1 · A8");
    expect(describeMove(doc, { row: 7, col: 8, player: "white" }, 2)).toBe("白 2 · I8");
  });

  it("起始局面单独成句，不念成「第 0 手」", () => {
    expect(describeMove(makeDocument(), null, 0)).toBe("起始局面");
    expect(describeCurrentStep(makeDocument(), "root", 0)).toBe("起始局面");
  });

  it("非落子节点向上回溯到最近的落子（过手 / 摆局面节点）", () => {
    const doc = makeDocument();
    // n2 是白 2；把当前节点指向一个没有 move 的临时节点时应回落到祖先
    doc.nodes.n3 = { id: "n3", parentId: "n2", children: [], move: null, comment: "", marks: [] } as never;
    expect(describeCurrentStep(doc, "n3", 2)).toBe("白 2 · I8");
    expect(describeCurrentStep(doc, "n1", 1)).toBe("黑 1 · A8");
  });

  it("关闭时不念，且不触碰 speechSynthesis", () => {
    const stub = stubSpeech();
    expect(speakStep("黑 1 · A8", false)).toBe(false);
    expect(stub.spoken).toEqual([]);
  });

  it("开启时先 cancel 再念：连续导航不会越积越久", () => {
    const stub = stubSpeech();
    expect(speakStep("黑 1 · A8", true)).toBe(true);
    expect(speakStep("白 2 · I8", true)).toBe(true);
    expect(stub.spoken).toEqual(["黑 1 · A8", "白 2 · I8"]);
    expect(stub.cancelCount()).toBe(2);
  });

  it("平台不支持时静默降级：不支持、不抛错，stopSpeaking 也不炸", () => {
    dropSpeech();
    expect(speechSupported()).toBe(false);
    expect(speakStep("黑 1 · A8", true)).toBe(false);
    expect(() => stopSpeaking()).not.toThrow();
  });

  it("系统抛错时不冒泡", () => {
    stubSpeech();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: () => { throw new Error("blocked"); }, cancel: () => {}, getVoices: () => [] } });
    expect(speakStep("黑 1 · A8", true)).toBe(false);
  });

  it("语速偏好：只接受登记的三档，其余回落默认", () => {
    expect(loadSpeechRate()).toBe(DEFAULT_SPEECH_RATE);
    saveSpeechRate(1.2);
    expect(loadSpeechRate()).toBe(1.2);
    localStorage.setItem("banbu-speech-rate-v1", "9");
    expect(loadSpeechRate()).toBe(DEFAULT_SPEECH_RATE);
  });

  it("开关默认关闭，只有显式保存 true 才开", () => {
    expect(loadSpeechEnabled()).toBe(false);
    saveSpeechEnabled(true);
    expect(loadSpeechEnabled()).toBe(true);
    saveSpeechEnabled(false);
    expect(loadSpeechEnabled()).toBe(false);
  });
});
