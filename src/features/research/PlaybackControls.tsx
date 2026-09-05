import { Pause, Play } from "lucide-react";
import type { PlaybackStopReason } from "./record-playback";

export const playbackStatusText = (reason: PlaybackStopReason) => reason === "branch"
  ? "自动演示已在分支处暂停"
  : reason === "end" ? "自动演示已到当前变化末尾"
  : reason === "blocked" ? "当前有后台任务，暂时不能自动演示"
  : "播放当前变化";

export function PlaybackButton({
  isPlaying,
  disabled,
  stopReason,
  onToggle,
}: {
  isPlaying: boolean;
  disabled: boolean;
  stopReason: PlaybackStopReason;
  onToggle: () => void;
}) {
  const label = isPlaying ? "暂停" : "播放";
  return <button
    type="button"
    className={isPlaying ? "accent playback-command" : "playback-command"}
    onClick={onToggle}
    disabled={disabled && !isPlaying}
    aria-label={isPlaying ? "暂停自动演示" : "播放自动演示"}
    aria-pressed={isPlaying}
    title={isPlaying ? "暂停自动演示" : playbackStatusText(stopReason)}
  >
    {isPlaying ? <Pause/> : <Play/>}
    <span>{label}</span>
  </button>;
}
