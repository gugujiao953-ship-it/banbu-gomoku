import { afterEach, describe, expect, it, vi } from "vitest";
import { AiRequestRetry } from "./request-retry";

afterEach(() => vi.useRealTimers());
describe("AI delayed restarts", () => {
  it.each([0, 400, 800])("does not restart a cancelled request after %i ms", (delay) => {
    vi.useFakeTimers();
    const retry = new AiRequestRetry();
    const restart = vi.fn();
    retry.schedule(restart, delay);
    retry.cancel();
    vi.runAllTimers();
    expect(restart).not.toHaveBeenCalled();
  });
  it("deduplicates errors from the same request", () => {
    vi.useFakeTimers();
    const retry = new AiRequestRetry();
    const oldRestart = vi.fn(), restart = vi.fn();
    retry.schedule(oldRestart, 400);
    retry.schedule(restart, 800);
    vi.advanceTimersByTime(400);
    expect(oldRestart).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(restart).toHaveBeenCalledTimes(1);
  });
  it("drops a restart when the request completed or the app went into the background", () => {
    vi.useFakeTimers();
    const retry = new AiRequestRetry();
    let current = true;
    const restart = vi.fn();
    retry.schedule(restart, 800, () => current);
    current = false;
    vi.runAllTimers();
    expect(restart).not.toHaveBeenCalled();
  });
});
