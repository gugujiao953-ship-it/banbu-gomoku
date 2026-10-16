// @vitest-environment jsdom
/** 公用特效方案的契约测试。
 *
 *  这层是从 `预览/parts/motion.js` 移植的，所以测的是**结构不变量**：
 *    · id 唯一、前缀正确、数量写死（改数量必须是有意识的决定）
 *    · css(id) 真的带 id / @keyframes / prefers-reduced-motion 降级
 *    · spawn 只插元素、自己插的节点动画结束会自删、且绝不在 spawn 里插 <style>
 *  刻意不断言具体颜色/坐标字符串 —— 那种测试改个排版就一片红。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DROP_EFFECTS, PLACE_EFFECTS } from "./effects";

describe("公用特效方案", () => {
  it("落子交互 11 套、棋子进场 12 套", () => {
    expect(PLACE_EFFECTS.length).toBe(11);
    expect(DROP_EFFECTS.length).toBe(12);
  });

  it("id 不重名且前缀正确", () => {
    expect(PLACE_EFFECTS.filter((s) => !s.id.startsWith("pl-")).map((s) => s.id)).toEqual([]);
    expect(DROP_EFFECTS.filter((s) => !s.id.startsWith("dp-")).map((s) => s.id)).toEqual([]);
    const ids = [...PLACE_EFFECTS.map((s) => s.id), ...DROP_EFFECTS.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(PLACE_EFFECTS[0].id).toBe("pl-ripple");
    expect(DROP_EFFECTS[0].id).toBe("dp-settle");
  });

  it("每套都有 name / desc，css(id) 带 id 与 keyframes 与 reduced-motion 降级", () => {
    for (const scheme of [...PLACE_EFFECTS, ...DROP_EFFECTS]) {
      expect(scheme.name.length).toBeGreaterThan(0);
      expect(scheme.desc.length).toBeGreaterThan(0);
      const css = scheme.css(scheme.id);
      expect(css).toContain(scheme.id);
      expect(css).toContain("@keyframes");
      expect(css).toContain("prefers-reduced-motion:reduce");
    }
  });

  it("spawn 只插元素、绝不在 spawn 里插 <style>，且动画结束后自删", () => {
    vi.useFakeTimers();
    const headStylesBefore = document.head.querySelectorAll("style").length;
    for (const scheme of [...PLACE_EFFECTS, ...DROP_EFFECTS]) {
      if (!scheme.spawn) continue;
      const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      document.body.appendChild(host);
      scheme.spawn(scheme.id, { x: 100, y: 120, r: 12, host, accent: "#365e4b", gridMin: 30, gridMax: 500 });
      const layer = host.firstElementChild as Element | null;
      expect(layer, `${scheme.id} 应该往 host 里插了节点`).toBeTruthy();
      // 插进来的整段 markup 里不许有 <style>
      expect(layer!.innerHTML.includes("<style")).toBe(false);
      // drop 的伴随特效要压在棋子下面（host 里没有棋子时退回 append）
      host.remove();
    }
    // spawn 期间没有往 head 里追加任何 <style>
    expect(document.head.querySelectorAll("style").length).toBe(headStylesBefore);

    // 兜底定时器到点后，节点必须自己消失（不累积）
    for (const scheme of [...PLACE_EFFECTS, ...DROP_EFFECTS]) {
      if (!scheme.spawn) continue;
      const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      document.body.appendChild(host);
      scheme.spawn(scheme.id, { x: 100, y: 120, r: 12, host, accent: "#365e4b" });
      expect(host.childElementCount).toBe(1);
      vi.runAllTimers();
      expect(host.childElementCount, `${scheme.id} 的节点应在兜底定时器后自删`).toBe(0);
      host.remove();
    }
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });
});
