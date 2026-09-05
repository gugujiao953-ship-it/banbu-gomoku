import { useCallback, useEffect, useRef, useState } from "react";

export type PlaybackBranchPolicy = "pause" | "mainline";
export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;
export type PlaybackStopReason = "idle" | "end" | "branch" | "blocked";
export interface PlaybackPreferences {
  speed: PlaybackSpeed;
  branchPolicy: PlaybackBranchPolicy;
  loop: boolean;
}

const PLAYBACK_PREFERENCES_KEY = "banbu-record-playback-preferences-v1";
export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  speed: 1,
  branchPolicy: "pause",
  loop: false,
};

type PlaybackStorage = Pick<Storage, "getItem" | "setItem">;

export const loadPlaybackPreferences = (storage?: PlaybackStorage): PlaybackPreferences => {
  const target = storage || (typeof localStorage === "undefined" ? undefined : localStorage);
  if (!target) return { ...DEFAULT_PLAYBACK_PREFERENCES };
  try {
    const parsed = JSON.parse(target.getItem(PLAYBACK_PREFERENCES_KEY) || "{}") as Partial<PlaybackPreferences>;
    const speed = parsed.speed === 0.5 || parsed.speed === 1 || parsed.speed === 1.5 || parsed.speed === 2
      ? parsed.speed
      : DEFAULT_PLAYBACK_PREFERENCES.speed;
    return {
      speed,
      branchPolicy: parsed.branchPolicy === "mainline" ? "mainline" : "pause",
      loop: parsed.loop === true,
    };
  } catch {
    return { ...DEFAULT_PLAYBACK_PREFERENCES };
  }
};

export const savePlaybackPreferences = (preferences: PlaybackPreferences, storage?: PlaybackStorage) => {
  const target = storage || (typeof localStorage === "undefined" ? undefined : localStorage);
  if (!target) return;
  try { target.setItem(PLAYBACK_PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* ignore unavailable storage */ }
};

export const playbackDelayMs = (speed: PlaybackSpeed) => Math.round(900 / speed);

export const resolvePlaybackStep = (
  childIds: string[],
  preferredChildId: string | undefined,
  branchPolicy: PlaybackBranchPolicy,
): { kind: "advance"; targetId: string } | { kind: "end" } | { kind: "branch" } => {
  if (!childIds.length) return { kind: "end" };
  if (childIds.length > 1 && branchPolicy === "pause") return { kind: "branch" };
  const targetId = preferredChildId && childIds.includes(preferredChildId) ? preferredChildId : childIds[0];
  return { kind: "advance", targetId };
};

export const useRecordPlayback = ({
  currentId,
  childIds,
  preferredChildId,
  sessionKey,
  disabled,
  onAdvance,
  onLoop,
}: {
  currentId: string;
  childIds: string[];
  preferredChildId?: string;
  sessionKey: string;
  disabled: boolean;
  onAdvance: (targetId: string) => boolean | void;
  onLoop: (targetId: string) => boolean | void;
}) => {
  const initialPreferences = useRef<PlaybackPreferences | null>(null);
  if (!initialPreferences.current) initialPreferences.current = loadPlaybackPreferences();
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(initialPreferences.current.speed);
  const [branchPolicy, setBranchPolicy] = useState<PlaybackBranchPolicy>(initialPreferences.current.branchPolicy);
  const [loop, setLoop] = useState(initialPreferences.current.loop);
  const [originId, setOriginId] = useState(currentId);
  const [stopReason, setStopReason] = useState<PlaybackStopReason>("idle");
  const advanceRef = useRef(onAdvance);
  const loopRef = useRef(onLoop);

  useEffect(() => { advanceRef.current = onAdvance; }, [onAdvance]);
  useEffect(() => { loopRef.current = onLoop; }, [onLoop]);
  useEffect(() => { savePlaybackPreferences({ speed, branchPolicy, loop }); }, [branchPolicy, loop, speed]);

  const pause = useCallback((reason: PlaybackStopReason = "idle") => {
    setIsPlaying(false);
    setStopReason(reason);
  }, []);

  const start = useCallback(() => {
    if (disabled) {
      pause("blocked");
      return;
    }
    setOriginId(currentId);
    setStopReason("idle");
    setIsPlaying(true);
  }, [currentId, disabled, pause]);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else start();
  }, [isPlaying, pause, start]);

  useEffect(() => {
    pause();
    setOriginId(currentId);
  }, [sessionKey, pause]);

  useEffect(() => {
    if (disabled && isPlaying) pause("blocked");
  }, [disabled, isPlaying, pause]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setTimeout(() => {
      const step = resolvePlaybackStep(childIds, preferredChildId, branchPolicy);
      if (step.kind === "branch") {
        pause("branch");
        return;
      }
      if (step.kind === "end") {
        if (loop && originId !== currentId) {
          if (loopRef.current(originId) === false) pause("blocked");
        }
        else pause("end");
        return;
      }
      if (advanceRef.current(step.targetId) === false) pause("blocked");
    }, playbackDelayMs(speed));
    return () => window.clearTimeout(timer);
  }, [branchPolicy, childIds, currentId, isPlaying, loop, originId, pause, preferredChildId, speed]);

  return {
    isPlaying,
    speed,
    branchPolicy,
    loop,
    stopReason,
    start,
    pause,
    toggle,
    setSpeed,
    setBranchPolicy,
    setLoop,
  };
};
