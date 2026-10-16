// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VcfChallengePage } from "./VcfChallengePage";
import { loadVcfItems, saveVcfItems, VCF_ITEMS_KEY } from "./items";
import { resetSoulLedger, setActiveSoulTuning } from "../progress/soul";
import { refreshSoulShop } from "../progress/use-soul-shop";
import { vcfGeometry } from "./board-geometry";
import { pickMatchedProblem, type ChallengeProblem } from "./problems";

vi.mock("./problems", () => ({
  poolSummary: async () => ({ material: 1, batch: 0, kaibao: 0, total: 1, matched: 1 }),
  pickMatchedProblem: vi.fn(async () => ({
    id: "test", attacker: "black", depth: 3, tier: "short", source: "material",
    black: [{ row: 7, col: 6 }, { row: 7, col: 7 }, { row: 7, col: 8 }],
    white: [{ row: 7, col: 5 }],
    solution: [{ row: 7, col: 9, player: "black" }, { row: 7, col: 10, player: "white" }],
  })),
}));

describe("VCF 道具保存与效果接线", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;
  beforeEach(() => {
    vi.mocked(pickMatchedProblem).mockClear();
    localStorage.clear();
    resetSoulLedger();
    setActiveSoulTuning();
    saveVcfItems({ "extra-time": 2, hint: 2, undo: 2 });
    refreshSoulShop();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });
  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const start = async () => {
    await act(async () => root.render(<VcfChallengePage/>));
    await act(async () => {
      (container.querySelector(".vcfch-bottom button") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector("[data-vcf-stone]")).not.toBeNull();
  };
  const use = async (id: string) => {
    await act(async () => (container.querySelector(`[data-vcf-item='${id}'] .vcfch-item-use`) as HTMLButtonElement).click());
  };
  const refuseInventorySave = () => {
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === VCF_ITEMS_KEY) throw new Error("quota");
      write.call(this, key, value);
    });
  };

  it("库存无法保存时加时/提示不生效，存储恢复后每次只扣一个", async () => {
    await start();
    const before = Number(container.querySelector(".vcfch-clock b")?.textContent);
    refuseInventorySave();
    await use("extra-time");
    expect(Number(container.querySelector(".vcfch-clock b")?.textContent)).toBe(before);
    await use("hint");
    expect(container.querySelector("[data-vcf-hint]")).toBeNull();
    expect(loadVcfItems()).toEqual({ "extra-time": 2, hint: 2, undo: 2 });
    expect(container.textContent).toContain("尚未使用");
    vi.restoreAllMocks();
    await use("extra-time");
    expect(Number(container.querySelector(".vcfch-clock b")?.textContent)).toBe(before + 30);
    await use("hint");
    expect(container.querySelector("[data-vcf-hint]")).not.toBeNull();
    expect(loadVcfItems()).toEqual({ "extra-time": 1, hint: 1, undo: 2 });
  });

  it("无落子悔棋不扣卡，有落子但保存失败也不撤棋，恢复后一次撤棋只扣一卡", async () => {
    await start();
    await use("undo");
    expect(loadVcfItems().undo).toBe(2);
    const geo = vcfGeometry();
    const board = container.querySelector("svg.vcfch-board") as SVGSVGElement;
    board.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: geo.viewBox, bottom: geo.viewBox,
      width: geo.viewBox, height: geo.viewBox, toJSON: () => ({}) });
    await act(async () => board.dispatchEvent(new MouseEvent("click", {
      bubbles: true, clientX: geo.line(9), clientY: geo.line(7),
    })));
    expect(container.querySelectorAll("[data-vcf-stone]")).toHaveLength(6);
    refuseInventorySave();
    await use("undo");
    expect(container.querySelectorAll("[data-vcf-stone]")).toHaveLength(6);
    expect(loadVcfItems().undo).toBe(2);
    vi.restoreAllMocks();
    await use("undo");
    expect(container.querySelectorAll("[data-vcf-stone]")).toHaveLength(4);
    expect(loadVcfItems().undo).toBe(1);
  });

  it("下一题复用尚未结束的预取，只匹配一次且不提前取消", async () => {
    await start();
    let complete!: (problem: ChallengeProblem) => void;
    vi.mocked(pickMatchedProblem).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await act(async () => (container.querySelector(".vcfch-bottom button") as HTMLButtonElement).click());
    expect(pickMatchedProblem).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(pickMatchedProblem).mock.calls[1][0].signal!;
    await act(async () => {
      (container.querySelector(".vcfch-bottom button") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(pickMatchedProblem).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(false);
    await act(async () => complete({
      id: "prefetched", attacker: "black", depth: 3, tier: "short", source: "novel", generatedOnDemand: true,
      black: [{ row: 7, col: 6 }, { row: 7, col: 7 }, { row: 7, col: 8 }, { row: 8, col: 8 }],
      white: [{ row: 7, col: 5 }], solution: [],
    }));
    expect(container.querySelectorAll("[data-vcf-stone]")).toHaveLength(5);
    expect(container.textContent).toContain("生成器出题");
    expect(container.querySelector(".vcfch-bottom button")?.textContent).toContain("认输");
  });

  it("离开挑战页会取消后台预取，完成的旧结果不能再更新页面", async () => {
    await start();
    let complete!: (problem: ChallengeProblem | null) => void;
    vi.mocked(pickMatchedProblem).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await act(async () => (container.querySelector(".vcfch-bottom button") as HTMLButtonElement).click());
    const signal = vi.mocked(pickMatchedProblem).mock.calls[1][0].signal!;
    expect(signal.aborted).toBe(false);
    await act(async () => { root.unmount(); mounted = false; });
    expect(signal.aborted).toBe(true);
    await act(async () => complete(null));
    expect(container.textContent).toBe("");
  });

  it("确认新的匹配设置时取消旧预取，旧答案不会覆盖新设置", async () => {
    await start();
    let complete!: (problem: ChallengeProblem | null) => void;
    vi.mocked(pickMatchedProblem).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await act(async () => (container.querySelector(".vcfch-bottom button") as HTMLButtonElement).click());
    const signal = vi.mocked(pickMatchedProblem).mock.calls[1][0].signal!;
    await act(async () => (container.querySelector('[aria-label="VCF 挑战设置"]') as HTMLButtonElement).click());
    const whiteOption = [...container.querySelectorAll(".vcfch-sheet button")].find((button) => button.textContent === "白先") as HTMLButtonElement;
    expect(whiteOption).toBeDefined();
    await act(async () => whiteOption.click());
    await act(async () => (container.querySelector(".vcfch-sheet-actions .vcfch-primary") as HTMLButtonElement).click());
    expect(signal.aborted).toBe(true);
    await act(async () => complete({
      id: "stale", attacker: "black", depth: 34, tier: "deep", source: "novel", generatedOnDemand: true,
      black: [{ row: 7, col: 6 }], white: [], solution: [],
    }));
    expect(container.querySelectorAll("[data-vcf-stone]")).toHaveLength(0);
    expect(container.querySelector(".vcfch-bottom button")?.textContent).toContain("开始挑战");
  });

  it("匹配下一题期间载入记录会取消匹配，旧结果不能覆盖不计分的复盘", async () => {
    await start();
    let complete!: (problem: ChallengeProblem | null) => void;
    vi.mocked(pickMatchedProblem).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await act(async () => (container.querySelector(".vcfch-bottom button") as HTMLButtonElement).click());
    const signal = vi.mocked(pickMatchedProblem).mock.calls[1][0].signal!;
    await act(async () => {
      (container.querySelector(".vcfch-bottom button") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector(".vcfch-bottom button")?.textContent).toContain("匹配中");
    await act(async () => (container.querySelector('[aria-label="VCF 挑战设置"]') as HTMLButtonElement).click());
    await act(async () => (container.querySelector('[role="tab"]:not([aria-selected="true"])') as HTMLButtonElement).click());
    await act(async () => (container.querySelector('[aria-label="载入这道题"]') as HTMLButtonElement).click());
    expect(signal.aborted).toBe(true);
    expect(container.querySelector("[data-vcf-setup-turn]")).not.toBeNull();
    await act(async () => complete({
      id: "stale", attacker: "black", depth: 34, tier: "deep", source: "novel", generatedOnDemand: true,
      black: [{ row: 7, col: 6 }], white: [], solution: [],
    }));
    expect(container.querySelectorAll("[data-vcf-stone]")).toHaveLength(4);
    expect(container.querySelector("[data-vcf-setup-turn]")).not.toBeNull();
    expect(container.textContent).toContain("已载入这条记录");
    expect(pickMatchedProblem).toHaveBeenCalledTimes(2);
  });
});
