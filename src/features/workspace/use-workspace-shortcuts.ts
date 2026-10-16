import { useEffect, useRef } from "react";
import type { AppMode } from "../../app-shell-types";
import { EMPTY_DIGIT_JUMP, feedMoveJumpDigit, isTextEntryTarget } from "./keyboard-shortcuts";

interface WorkspaceShortcuts {
  enabled: boolean;
  blocked: boolean;
  mode: AppMode;
  sessionKey: string;
  onBack: () => void;
  onForward: () => void;
  onJump: (depth: number) => void;
  onPlayback: () => void;
  onDelete: () => void;
}

/** One listener gives navigation and editing the same settings/focus guards. */
export function useWorkspaceShortcuts(options: WorkspaceShortcuts): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const digits = useRef(EMPTY_DIGIT_JUMP);

  useEffect(() => {
    digits.current = EMPTY_DIGIT_JUMP;
  }, [options.enabled, options.blocked, options.mode, options.sessionKey]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const current = optionsRef.current;
      if (!current.enabled || current.blocked || event.defaultPrevented || event.isComposing
        || event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return;
      if (/^[0-9]$/.test(event.key)) {
        if (current.mode === "puzzle") return;
        const step = feedMoveJumpDigit(digits.current, event.key, Date.now());
        if (step) {
          digits.current = step.state;
          event.preventDefault();
          current.onJump(step.jump);
        }
        return;
      }
      digits.current = EMPTY_DIGIT_JUMP;
      let action: (() => void) | undefined;
      if (event.key === "ArrowLeft") action = current.onBack;
      else if (event.key === "ArrowRight") action = current.onForward;
      else if ((event.key === " " || event.key === "Spacebar") && current.mode === "review") action = current.onPlayback;
      else if ((event.key === "Delete" || event.key === "Backspace") && current.mode === "record") action = current.onDelete;
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}
