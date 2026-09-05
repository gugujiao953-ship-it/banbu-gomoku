import { useEffect, useRef } from "react";
import { isOverlayPop, OVERLAY_STATE_KEY } from "./useOverlayHistory";

const SENTINEL_STATE_KEY = "__banbuRootSentinel";
const SENTINEL_ARM_MS = 2000;

export const ROOT_BACK_MESSAGE = "再按一次返回键退出应用";

const hasSentinel = (state: unknown): boolean =>
  Boolean((state as Record<string, unknown> | null)?.[SENTINEL_STATE_KEY]);

/**
 * Root-level back handling (Android convention: a single back press at the
 * root must not exit the app). Keeps exactly one shallow history entry
 * ("sentinel") above the bare root while no overlay owns one. The first back
 * press consumes the sentinel and calls `onRootBack` (the app shows a
 * "press again to exit" toast); a second press within SENTINEL_ARM_MS finds
 * no extra entry and leaves the screen. After the window the sentinel
 * re-arms.
 *
 * Pops that land on an overlay token or on the sentinel itself are ignored:
 * those are overlay-closing presses, not exit attempts. On the web this is
 * also the standard "double back to leave the page" behavior for installed
 * PWAs.
 */
export function useRootBackExit(onRootBack: () => void = () => { window.alert(ROOT_BACK_MESSAGE); }, enabled = true): void {
  const callbackRef = useRef(onRootBack);
  callbackRef.current = onRootBack;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.history?.pushState) return undefined;

    const arm = () => {
      const state = window.history.state as Record<string, unknown> | null;
      if (!state) window.history.pushState({ [SENTINEL_STATE_KEY]: 1 }, "");
    };

    arm();

    let reArmTimer = 0;
    const handlePopState = (event: PopStateEvent) => {
      const destination = event.state as Record<string, unknown> | null;
      if (destination && (isOverlayPop(destination) || hasSentinel(destination))) return;
      // Destination carries neither an overlay token nor the sentinel: the
      // shallow entry was consumed by this press. Notify once, then let the
      // window decide whether a follow-up press exits or we re-arm.
      callbackRef.current();
      window.clearTimeout(reArmTimer);
      reArmTimer = window.setTimeout(arm, SENTINEL_ARM_MS);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.clearTimeout(reArmTimer);
    };
  }, [enabled]);
}
