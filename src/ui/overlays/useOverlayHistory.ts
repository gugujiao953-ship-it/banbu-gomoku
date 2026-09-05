import { useEffect, useRef } from "react";

// Shared history contract for overlay state. An overlay that registers a
// token owns one browser history entry while it is open: the system back
// gesture pops that entry (handled here) instead of leaving the screen state
// unmanaged. Entries nest naturally because each open overlay pushes exactly
// one entry, and a pop always removes the topmost one.
export const OVERLAY_STATE_KEY = "__banbuOverlayToken";

export const isOverlayPop = (state: unknown): boolean => {
  const token = (state as Record<string, unknown> | null)?.[OVERLAY_STATE_KEY];
  return typeof token === "string";
};

const generateToken = () =>
  `banbu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Give an overlay a single history entry it owns while `active`. A back press
 * that pops that entry calls `onClose`; closing by any other means (its own
 * close button) releases the entry so the stack stays balanced.
 *
 * The token is created once per component instance and never reset, so React
 * StrictMode's double-invoke of effects in development cannot push a second,
 * orphaned entry.
 */
export function useOverlayHistory(active: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Stable across StrictMode remounts of the same instance; a fresh instance
  // (a real reopen) gets a fresh token.
  const tokenRef = useRef<string>(generateToken());
  const poppedRef = useRef(false);
  // Tracks whether the overlay is currently mounted. The deferred release
  // probe must not fire while the component is (re)mounted — React StrictMode
  // in development re-runs effects, and a stale probe from the first cleanup
  // would otherwise pop the entry the live mount just pushed.
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === "undefined" || !window.history?.pushState) return undefined;
    const token = tokenRef.current;
    poppedRef.current = false;
    mountedRef.current = true;
    const currentState = window.history.state as Record<string, unknown> | null;
    // Guard against the StrictMode re-run: if this token already owns the top
    // entry, do not push a duplicate.
    if (currentState?.[OVERLAY_STATE_KEY] !== token) {
      window.history.pushState({ ...(currentState || {}), [OVERLAY_STATE_KEY]: token }, "");
    }
    const handlePopState = () => {
      // A pop removes the topmost entry. After the pop, this overlay's entry
      // survives only if the new top still carries its token (which happens
      // when a child overlay above it was the one popped). Otherwise this
      // overlay was the one removed.
      const currentTop = (window.history.state as Record<string, unknown> | null)?.[OVERLAY_STATE_KEY];
      if (currentTop === token) return;
      poppedRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      mountedRef.current = false;
      // If the overlay closed without a back press (its own close button),
      // release the entry we pushed so the stack stays balanced.
      const claimedToken = tokenRef.current;
      window.setTimeout(() => {
        if (mountedRef.current || poppedRef.current) return;
        if (typeof window === "undefined" || !window.history?.state) return;
        const state = window.history.state as Record<string, unknown>;
        if (state[OVERLAY_STATE_KEY] !== claimedToken) return;
        window.history.back();
      }, 0);
    };
  }, [active]);
}
