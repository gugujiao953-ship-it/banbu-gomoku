import { DEFAULT_SOUND_SETTINGS, type SoundSettings } from "./audio-settings";

export type SoundCue = "move-black" | "move-white" | "navigate" | "success" | "warning" | "error";

export interface AudioDiagnostics {
  supported: boolean;
  contextState: AudioContextState | "not-created";
  contextCount: number;
  activeVoices: number;
  played: number;
  skipped: number;
}

type ContextConstructor = new () => AudioContext;

const categoryEnabled = (cue: SoundCue, settings: SoundSettings) => cue.startsWith("move-") || cue === "navigate"
  ? settings.moveEnabled
  : settings.feedbackEnabled;

export class BanbuAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  private activeVoices = 0;
  private contextCount = 0;
  private played = 0;
  private skipped = 0;
  private readonly maxVoices = 8;

  setSettings(settings: SoundSettings) {
    this.settings = { ...settings };
    if (this.master && this.context) this.master.gain.setTargetAtTime(settings.enabled ? settings.volume : 0, this.context.currentTime, 0.01);
  }

  async play(cue: SoundCue): Promise<boolean> {
    if (!this.settings.enabled || !categoryEnabled(cue, this.settings) || this.settings.volume <= 0 || this.activeVoices >= this.maxVoices) {
      this.skipped += 1;
      return false;
    }
    const context = this.ensureContext();
    if (!context || !this.master) { this.skipped += 1; return false; }
    try {
      if (context.state === "suspended") await context.resume();
      if (context.state !== "running") { this.skipped += 1; return false; }
      if (cue === "move-black" || cue === "move-white") this.playStone(context, cue === "move-black");
      else this.playTone(context, cue);
      this.played += 1;
      return true;
    } catch {
      this.skipped += 1;
      return false;
    }
  }

  diagnostics(): AudioDiagnostics {
    return {
      supported: this.constructorForContext() !== null,
      contextState: this.context?.state || "not-created",
      contextCount: this.contextCount,
      activeVoices: this.activeVoices,
      played: this.played,
      skipped: this.skipped,
    };
  }

  async close() {
    const context = this.context;
    this.context = null; this.master = null; this.noiseBuffer = null; this.activeVoices = 0;
    if (context && context.state !== "closed") await context.close().catch(() => undefined);
  }

  private constructorForContext(): ContextConstructor | null {
    if (typeof window === "undefined") return null;
    const candidate = window.AudioContext || (window as typeof window & { webkitAudioContext?: ContextConstructor }).webkitAudioContext;
    return candidate || null;
  }

  private ensureContext() {
    if (this.context && this.context.state !== "closed") return this.context;
    const Constructor = this.constructorForContext();
    if (!Constructor) return null;
    const context = new Constructor();
    const master = context.createGain();
    master.gain.value = this.settings.enabled ? this.settings.volume : 0;
    master.connect(context.destination);
    this.context = context; this.master = master; this.contextCount += 1;
    return context;
  }

  private withVoice(endTime: number, nodes: AudioScheduledSourceNode[]) {
    this.activeVoices += 1;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      for (const node of nodes) node.disconnect();
    };
    nodes[0]!.addEventListener("ended", finish, { once: true });
    window.setTimeout(finish, Math.max(80, (endTime - (this.context?.currentTime || 0)) * 1000 + 80));
  }

  private noise(context: AudioContext) {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(1, Math.round(context.sampleRate * 0.035));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    this.noiseBuffer = buffer;
    return buffer;
  }

  private playStone(context: AudioContext, black: boolean) {
    const now = context.currentTime;
    const recipes = {
      classic: {
        duration: 0.075, type: "sine", start: black ? 185 : 225, end: black ? 115 : 145,
        bodyPeak: black ? 0.34 : 0.27, noisePeak: black ? 0.18 : 0.14,
        filterType: "bandpass", filterFrequency: black ? 1050 : 1450, filterQ: 0.8, noiseDuration: 0.04,
      },
      wood: {
        duration: 0.09, type: "triangle", start: black ? 145 : 172, end: black ? 78 : 96,
        bodyPeak: black ? 0.38 : 0.31, noisePeak: black ? 0.24 : 0.19,
        filterType: "lowpass", filterFrequency: black ? 820 : 980, filterQ: 0.55, noiseDuration: 0.045,
      },
      crystal: {
        duration: 0.13, type: "sine", start: black ? 540 : 650, end: black ? 360 : 430,
        bodyPeak: black ? 0.18 : 0.16, noisePeak: black ? 0.065 : 0.055,
        filterType: "highpass", filterFrequency: black ? 1850 : 2200, filterQ: 1.15, noiseDuration: 0.032,
      },
    } as const;
    const recipe = recipes[this.settings.profile];
    const end = now + recipe.duration;
    const body = context.createOscillator();
    const bodyGain = context.createGain();
    const noise = context.createBufferSource();
    const noiseGain = context.createGain();
    const filter = context.createBiquadFilter();
    body.type = recipe.type;
    body.frequency.setValueAtTime(recipe.start, now);
    body.frequency.exponentialRampToValueAtTime(recipe.end, end);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(recipe.bodyPeak, now + 0.004);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, end);
    noise.buffer = this.noise(context);
    filter.type = recipe.filterType; filter.frequency.value = recipe.filterFrequency; filter.Q.value = recipe.filterQ;
    noiseGain.gain.setValueAtTime(recipe.noisePeak, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(0.035, recipe.noiseDuration));
    body.connect(bodyGain).connect(this.master!);
    noise.connect(filter).connect(noiseGain).connect(this.master!);
    body.start(now); body.stop(end); noise.start(now); noise.stop(now + recipe.noiseDuration);
    this.withVoice(end, [body, noise]);
  }

  private playTone(context: AudioContext, cue: Exclude<SoundCue, "move-black" | "move-white">) {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const recipes = {
      navigate: [260, 210, 0.045, 0.10],
      success: [520, 760, 0.14, 0.16],
      warning: [190, 150, 0.09, 0.14],
      error: [145, 95, 0.13, 0.16],
    } as const;
    const [startFrequency, endFrequency, duration, peak] = recipes[cue];
    const end = now + duration;
    oscillator.type = cue === "success" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, end);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(this.master!);
    oscillator.start(now); oscillator.stop(end);
    this.withVoice(end, [oscillator]);
  }
}

export const banbuAudio = new BanbuAudioEngine();
