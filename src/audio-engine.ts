import { DEFAULT_SOUND_SETTINGS, type SoundSettings } from "./audio-settings";
import { STONE_TIMBRES, timbreDuration, type SynthStoneProfile, type StoneTimbre } from "./stone-sound-recipes";

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

/** Bundled recordings for sample-backed profiles (mono 16-bit WAV, ~15KB
 * each). One drop randomly picks a pool variant so rapid play does not sound
 * machine-gunned; provenance and licensing live in public/sounds/CREDITS.md.
 * Black and white share one pool: alternating color-specific recordings read
 * as two different sounds to the user. Peaks were normalized to 0.45. */
const REAL_SAMPLES = ["real-black-1", "real-black-2", "real-black-3", "real-white-1", "real-white-2"];
const SAMPLE_PROFILES: Record<string, { black: string[]; white: string[]; gain: number }> = {
  real: { black: REAL_SAMPLES, white: REAL_SAMPLES, gain: 0.5 },
};

/** The recipes intentionally keep their individual peaks below 0.5 to avoid
 * harsh transients. Apply a modest output-stage boost so 100% on the in-app
 * slider is audible on phones whose media volume is already capped, while
 * retaining 0% as true silence. */
export const AUDIO_OUTPUT_BOOST = 1.8;
export const outputGainForVolume = (volume: number, enabled = true) => enabled ? Math.min(AUDIO_OUTPUT_BOOST, Math.max(0, volume) * AUDIO_OUTPUT_BOOST) : 0;

const categoryEnabled = (cue: SoundCue, settings: SoundSettings) => cue === "navigate"
  ? settings.navigateEnabled
  : cue.startsWith("move-") ? true : settings.feedbackEnabled;

export class BanbuAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  private sampleBuffers = new Map<string, AudioBuffer | null>();
  private sampleLoads = new Map<string, Promise<AudioBuffer | null>>();
  private activeVoices = 0;
  private contextCount = 0;
  private played = 0;
  private skipped = 0;
  private readonly maxVoices = 8;

  setSettings(settings: SoundSettings) {
    this.settings = { ...settings };
    if (this.master && this.context) this.master.gain.setTargetAtTime(outputGainForVolume(settings.volume, settings.enabled), this.context.currentTime, 0.01);
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
      if (cue === "move-black" || cue === "move-white") {
        if (SAMPLE_PROFILES[this.settings.profile]) await this.playSample(context, cue === "move-black");
        else this.playStone(context, cue === "move-black");
      } else this.playTone(context, cue);
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
    this.sampleBuffers.clear(); this.sampleLoads.clear();
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
    master.gain.value = outputGainForVolume(this.settings.volume, this.settings.enabled);
    master.connect(context.destination);
    this.context = context; this.master = master; this.contextCount += 1;
    return context;
  }

  /** The first node must be the one that ends last: its "ended" event releases
   * the voice and disconnects every node in the list. */
  private withVoice(endTime: number, nodes: AudioNode[]) {
    this.activeVoices += 1;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      for (const node of nodes) node.disconnect();
    };
    (nodes[0] as AudioScheduledSourceNode).addEventListener("ended", finish, { once: true });
    window.setTimeout(finish, Math.max(80, (endTime - (this.context?.currentTime || 0)) * 1000 + 80));
  }

  private noise(context: AudioContext) {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(1, Math.round(context.sampleRate * 0.035));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** Schedules a synthesized drop from the recipe layers in
   * stone-sound-recipes.ts. Slight pitch/gain jitter per play keeps repeated
   * drops from sounding identical, like real stones. */
  private playStone(context: AudioContext, black: boolean) {
    const timbre: StoneTimbre | undefined = STONE_TIMBRES[this.settings.profile as SynthStoneProfile]?.[black ? "black" : "white"];
    if (!timbre || !this.master) return;
    const now = context.currentTime;
    const pitchJitter = 1 + (Math.random() - 0.5) * 0.05;
    const gainJitter = (timbre.gain ?? 1) * (1 + (Math.random() - 0.5) * 0.16);
    const scheduled: Array<{ node: AudioScheduledSourceNode; stop: number }> = [];
    for (const partial of timbre.partials) {
      const start = now + (partial.delay ?? 0);
      const peakTime = start + partial.attack;
      const stopTime = peakTime + partial.decay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = partial.type;
      oscillator.frequency.setValueAtTime(partial.from * pitchJitter, start);
      if (partial.to) oscillator.frequency.exponentialRampToValueAtTime(partial.to * pitchJitter, stopTime);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(partial.peak * gainJitter, peakTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(start); oscillator.stop(stopTime);
      scheduled.push({ node: oscillator, stop: stopTime });
    }
    for (const hit of timbre.noises) {
      const start = now + (hit.delay ?? 0);
      const peakTime = start + hit.attack;
      const stopTime = peakTime + hit.decay;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = this.noise(context);
      filter.type = hit.filterType; filter.frequency.value = hit.frequency; filter.Q.value = hit.q;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(hit.peak * gainJitter, peakTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(start); source.stop(stopTime);
      scheduled.push({ node: source, stop: stopTime });
    }
    scheduled.sort((a, b) => b.stop - a.stop);
    this.withVoice(now + timbreDuration(timbre), scheduled.map(({ node }) => node));
  }

  private async playSample(context: AudioContext, black: boolean) {
    const config = SAMPLE_PROFILES[this.settings.profile];
    if (!config || !this.master) { this.playStone(context, black); return; }
    const pool = black ? config.black : config.white;
    const name = pool[Math.floor(Math.random() * pool.length)] || pool[0]!;
    const buffer = await this.loadSample(context, name);
    if (!buffer) { this.playStone(context, black); return; }
    const playbackRate = 1 + (Math.random() - 0.5) * 0.04;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    const gain = context.createGain();
    gain.gain.value = config.gain * (1 + (Math.random() - 0.5) * 0.12);
    source.connect(gain).connect(this.master);
    const now = context.currentTime;
    source.start(now);
    this.withVoice(now + buffer.duration / playbackRate, [source, gain]);
  }

  private loadSample(context: AudioContext, name: string): Promise<AudioBuffer | null> {
    const cached = this.sampleBuffers.get(name);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.sampleLoads.get(name);
    if (pending) return pending;
    const base = import.meta.env.BASE_URL || "/";
    const load = fetch(`${base}sounds/${name}.wav`)
      .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => { this.sampleBuffers.set(name, buffer); this.sampleLoads.delete(name); return buffer; })
      .catch(() => { this.sampleBuffers.set(name, null); this.sampleLoads.delete(name); return null; });
    this.sampleLoads.set(name, load);
    return load;
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
